// Runs against the Firestore emulator: npm test (firebase emulators:exec … node --test tests/)
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, setLogLevel, updateDoc } from 'firebase/firestore';

import { DEFAULT_SLIDES, ROOT } from '../client/src/simposio.js';
import { ensurePresentacion, getPresentacion, presentacionRef, savePresentacion, subscribePresentacion } from '../client/src/data/presentacion.js';
import {
  endSession,
  eventoRef,
  goToSlide,
  publishResults,
  sessionReport,
  setResultsVisible,
  startSession,
  subscribeAdmin,
} from '../client/src/data/evento.js';
import { myRegistration, register, subscribe, vote } from '../client/src/data/publico.js';
import { attendeesCsv, resultsCsv } from '../client/src/data/export.js';

let env;
let admin; // Firestore as the symposium admin
let stranger; // signed in, not an admin, not registered
let nobody; // not signed in

before(async () => {
  setLogLevel('silent'); // expected PERMISSION_DENIED writes would otherwise flood the output
  env = await initializeTestEnvironment({
    projectId: 'demo-rss',
    firestore: {
      rules: readFileSync('firestore.simposio-protegido.rules', 'utf8'),
      host: '127.0.0.1',
      port: Number(process.env.FIRESTORE_EMULATOR_HOST?.split(':')[1]) || 8080, // set by emulators:exec
    },
  });
});

after(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), ROOT, 'admins'), { uids: ['admin-1'] }));
  admin = env.authenticatedContext('admin-1', { email: 'admin@x.co' }).firestore();
  await ensurePresentacion(admin);
  stranger = env.authenticatedContext('stranger').firestore();
  nobody = env.unauthenticatedContext().firestore();
});

/** A phone: anonymous uid + its Firestore. */
function phone(uid) {
  const db = env.authenticatedContext(uid).firestore();
  return {
    db,
    uid,
    register: (cedula, extra = {}) =>
      register(db, uid, { nombre: `Persona ${uid}`, cedula, correo: `${uid}@x.co`, consentimiento: true, ...extra }),
    vote: (sid, slideId, cedula, opcion) => vote(db, uid, sid, slideId, cedula, opcion),
  };
}

const evento = async () => (await getDoc(eventoRef(admin))).data();
const go = async (slideId) => goToSlide(admin, await evento(), slideId);

const waitFor = (subscribeFn, predicate, ms = 5000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => (unsub(), reject(new Error('timeout'))), ms);
    const unsub = subscribeFn((value) => {
      if (predicate(value)) {
        clearTimeout(timer);
        setTimeout(() => unsub());
        resolve(value);
      }
    });
  });

// ── The rest of the shared project is untouched ────────────────────────────

test('other collections of the project stay exactly as open as before', async () => {
  for (const db of [nobody, stranger]) {
    await assertSucceeds(setDoc(doc(db, 'events', 'x'), { a: 1 }));
    await assertSucceeds(getDoc(doc(db, 'events', 'x')));
    await assertSucceeds(getDocs(collection(db, 'users')));
    await assertSucceeds(setDoc(doc(db, 'organizations', 'o', 'members', 'm'), { a: 1 }));
    await assertSucceeds(deleteDoc(doc(db, 'events', 'x')));
    await assertSucceeds(setDoc(doc(db, 'brand_new_collection', 'y', 'deep', 'z'), { a: 1 }));
  }
});

test('the symposium collection is locked down', async () => {
  await startSession(admin, 'Ensayo');
  for (const db of [nobody, stranger]) {
    await assertFails(setDoc(doc(db, ROOT, 'evento'), { status: 'live', slideId: 'p3-2' }));
    await assertFails(updateDoc(doc(db, ROOT, 'evento'), { resultsVisible: true }));
    await assertFails(setDoc(doc(db, ROOT, 'admins'), { uids: ['stranger'] }));
    await assertFails(getDoc(doc(db, ROOT, 'admins')));
    await assertFails(getDocs(collection(db, ROOT)));
    await assertFails(getDocs(collection(db, ROOT, 'evento', 'asistentes')));
    await assertFails(getDocs(collection(db, ROOT, 'evento', 'sesiones')));
    await assertFails(setDoc(doc(db, ROOT, 'otro'), { a: 1 }));
  }
  await assertSucceeds(getDoc(doc(nobody, ROOT, 'evento'))); // the live state is public
  await assertSucceeds(getDoc(doc(admin, ROOT, 'admins')));
});

// ── Registration (once per phone) ──────────────────────────────────────────

test('registration is validated by the rules and remembered for the phone', async () => {
  const ana = phone('ana');
  assert.equal(await myRegistration(ana.db, 'ana'), null); // first visit: show the form

  const raw = (data) =>
    setDoc(doc(ana.db, ROOT, 'evento', 'asistentes', '123456'), {
      nombre: 'Ana Pérez', cedula: '123456', correo: 'ana@x.co', uid: 'ana', consentimiento: true,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...data,
    });
  await assertFails(raw({ correo: 'nope' }));
  await assertFails(raw({ consentimiento: false }));
  await assertFails(raw({ uid: 'someone-else' }));
  await assertFails(raw({ admin: true }));
  await assert.rejects(ana.register('12'), /cédula/);

  await ana.register('1.234.567');
  assert.deepEqual(await myRegistration(ana.db, 'ana'), { cedula: '1234567', nombre: 'Persona ana' }); // next visit: no form

  // Personal data is private.
  await assertFails(getDoc(doc(stranger, ROOT, 'evento', 'asistentes', '1234567')));
  await assertFails(getDoc(doc(stranger, ROOT, 'evento', 'dispositivos', 'ana')));
  await assertFails(setDoc(doc(stranger, ROOT, 'evento', 'dispositivos', 'stranger'), { cedula: '1234567', nombre: 'x' }));
  assert.equal((await getDocs(collection(admin, ROOT, 'evento', 'asistentes'))).size, 1);
});

test('registering with the same cédula on another phone takes it over and keeps the votes', async () => {
  const sid = await startSession(admin, 'Día 1');
  const phone1 = phone('ana-1');
  await phone1.register('123456');
  await go('p1-inicial');
  await phone1.vote(sid, 'p1-inicial', '123456', 'A');

  const phone2 = phone('ana-2');
  await phone2.register('123456');
  assert.equal((await myRegistration(phone2.db, 'ana-2')).cedula, '123456');
  const seen = await waitFor((cb) => subscribe(phone2.db, '123456', cb), (s) => s.myVoteLoaded);
  assert.equal(seen.myVote, 'A'); // sees the vote cast from phone 1
  await assert.rejects(phone2.vote(sid, 'p1-inicial', '123456', 'B')); // still once

  await go('p1-revotacion');
  await assert.rejects(phone1.vote(sid, 'p1-revotacion', '123456', 'C')); // the old phone lost it
  await phone2.vote(sid, 'p1-revotacion', '123456', 'C');
  assert.equal((await getDocs(collection(admin, ROOT, 'evento', 'asistentes'))).size, 1);
});

// ── Voting follows the projected slide ─────────────────────────────────────

test('votes only on the projected question, as yourself, with a valid option, once', async () => {
  const sid = await startSession(admin, 'Día 1');
  const ana = phone('ana');
  const bob = phone('bob');
  await ana.register('111111');
  await bob.register('222222');

  await assert.rejects(ana.vote(sid, 'p1-inicial', '111111', 'A'), /cerró/); // cover is projected
  await go('p1-inicial');
  await assert.rejects(phone('ghost').vote(sid, 'p1-inicial', '999999', 'A')); // not registered
  await assert.rejects(bob.vote(sid, 'p1-inicial', '111111', 'A')); // as someone else
  await assert.rejects(ana.vote(sid, 'p1-inicial', '111111', 'E')); // invalid option
  await assert.rejects(ana.vote(sid, 'p2-inicial', '111111', 'A')); // not the projected question
  await assert.rejects(ana.vote('other-session', 'p1-inicial', '111111', 'A')); // not the live session
  await ana.vote(sid, 'p1-inicial', '111111', 'B');
  await assert.rejects(ana.vote(sid, 'p1-inicial', '111111', 'C'), /habías votado/);

  await go('p3-1');
  await assert.rejects(bob.vote(sid, 'p3-1', '222222', 'D')); // 3.1 only has A–C
  await bob.vote(sid, 'p3-1', '222222', 'C');

  await go('p1-inicial'); // moving away closed it; coming back reopens it, but the vote stays single
  await bob.vote(sid, 'p1-inicial', '222222', 'A');

  await assertFails(getDocs(collection(bob.db, ROOT, 'evento', 'sesiones', sid, 'votos')));
  await assertFails(getDoc(doc(bob.db, ROOT, 'evento', 'sesiones', sid, 'votos', 'p1-inicial__111111')));
  await assertSucceeds(getDoc(doc(ana.db, ROOT, 'evento', 'sesiones', sid, 'votos', 'p1-inicial__111111')));
  await assertFails(updateDoc(doc(ana.db, ROOT, 'evento', 'sesiones', sid, 'votos', 'p1-inicial__111111'), { opcion: 'A' }));

  await endSession(admin, await evento());
  await assert.rejects(bob.vote(sid, 'p1-inicial', '222222', 'B'));
});

test('initial vote and re-vote are independent; sessions never mix; attendees persist', async () => {
  const s1 = await startSession(admin, 'Ensayo');
  const ana = phone('ana');
  await ana.register('111111');
  await go('p1-inicial');
  await ana.vote(s1, 'p1-inicial', '111111', 'A');
  await go('p1-revotacion');
  await ana.vote(s1, 'p1-revotacion', '111111', 'C');
  await endSession(admin, await evento());

  const s2 = await startSession(admin, 'Día 1');
  assert.notEqual(s1, s2);
  assert.ok(await myRegistration(ana.db, 'ana')); // no need to register again
  await go('p1-inicial');
  await ana.vote(s2, 'p1-inicial', '111111', 'D');

  const [r1, r2] = await Promise.all([sessionReport(admin, s1), sessionReport(admin, s2)]);
  const counts = (r, id) => r.polls.find((p) => p.slideId === id).options.map((o) => o.votes);
  assert.deepEqual(counts(r1, 'p1-inicial'), [1, 0, 0, 0]);
  assert.deepEqual(counts(r1, 'p1-revotacion'), [0, 0, 1, 0]);
  assert.deepEqual(counts(r2, 'p1-inicial'), [0, 0, 0, 1]);
  assert.deepEqual(counts(r2, 'p1-revotacion'), [0, 0, 0, 0]);
  assert.equal(r1.session.status, 'ended');
  assert.equal(r2.polls[0].pollInstanceId, `${s2}:p1-inicial`);
});

// ── Realtime sync ──────────────────────────────────────────────────────────

test('phones follow the projector slide by slide; results only when shown', async () => {
  const sid = await startSession(admin, 'Día 1');
  const ana = phone('ana');
  await ana.register('111111');
  const follow = (cb) => subscribe(ana.db, '111111', cb);
  const adminView = (cb) => subscribeAdmin(admin, cb);

  assert.equal((await waitFor(follow, (s) => s.slide)).slide.id, 'portada');

  const onQ1 = waitFor(follow, (s) => s.slide?.id === 'p1-inicial' && s.myVoteLoaded);
  await go('p1-inicial');
  const q1 = await onQ1;
  assert.equal(q1.myVote, null);
  assert.equal(q1.results, null);

  const counted = waitFor(adminView, (s) => s.polls.find((p) => p.slideId === 'p1-inicial').total === 1 && s.attendeeCount === 1);
  const voted = waitFor(follow, (s) => s.myVote === 'B');
  await ana.vote(sid, 'p1-inicial', '111111', 'B');
  const adminState = await counted;
  await voted;

  const shown = waitFor(follow, (s) => s.results?.total === 1);
  await setResultsVisible(admin, await evento(), true, adminState.polls.find((p) => p.slideId === 'p1-inicial'));
  assert.deepEqual((await shown).results.options.map((o) => o.votes), [0, 1, 0, 0]);

  // Next slide: the previous question closes on the phone at once; the re-vote starts clean.
  const onRevote = waitFor(follow, (s) => s.slide?.id === 'p1-revotacion' && s.myVoteLoaded);
  await go('p1-revotacion');
  const rv = await onRevote;
  assert.equal(rv.myVote, null);
  assert.equal(rv.resultsVisible, false);

  // Going back shows the first question again with its results still visible.
  const back = waitFor(follow, (s) => s.slide?.id === 'p1-inicial' && s.results && s.myVoteLoaded);
  await go('p1-inicial');
  assert.equal((await back).myVote, 'B');

  const ended = waitFor(follow, (s) => s.status === 'ended');
  await endSession(admin, await evento());
  assert.equal((await ended).slide, null);
});

test('published results follow new votes', async () => {
  const sid = await startSession(admin, 'Día 1');
  const ana = phone('ana');
  const bob = phone('bob');
  await ana.register('111111');
  await bob.register('222222');
  await go('p3-2');
  await setResultsVisible(admin, await evento(), true, { slideId: 'p3-2', total: 0, options: [] });
  await ana.vote(sid, 'p3-2', '111111', 'A');
  await bob.vote(sid, 'p3-2', '222222', 'A');
  const report = await sessionReport(admin, sid);
  await publishResults(admin, await evento(), report.polls.find((p) => p.slideId === 'p3-2'));
  const e = await evento();
  assert.deepEqual(e.results, { total: 2, counts: { A: 2, B: 0, C: 0, D: 0 } });
  assert.deepEqual(e.published['p3-2'], e.results);
});

// ── Export ─────────────────────────────────────────────────────────────────

test('CSV exports: totals per question and each attendee answers', async () => {
  const sid = await startSession(admin, 'Día 1');
  await phone('ana').register('111111', { nombre: 'Ana; "la doc"' });
  const bob = phone('bob');
  await bob.register('222222', { nombre: 'Bob Ruiz' });
  await go('p1-inicial');
  await bob.vote(sid, 'p1-inicial', '222222', 'B');

  const report = await sessionReport(admin, sid);
  const people = attendeesCsv(report).replace('﻿', '').trim().split('\r\n');
  assert.match(people[0], /^Nombre;Cédula;Correo;Fecha de registro;Diap\. 2 · 1\. Contrapunteo/);
  assert.equal(people[0].split(';').length, 4 + 6);
  assert.match(people[1], /^"Ana; ""la doc""";111111;ana@x\.co;[^;]+;;;;;;$/);
  assert.match(people[2], /^Bob Ruiz;222222;bob@x\.co;[^;]+;"B\. Agente estimulante[^"]+";;;;;$/); // quoted: text has ";"
  const totals = resultsCsv(report).replace('﻿', '').trim().split('\r\n');
  assert.equal(totals.length, 1 + 4 * 5 + 3);
  assert.equal(DEFAULT_SLIDES.length, 7);
});

// ── Production today: the project's rules are open, the app enforces its own checks ──

test('with open rules (as deployed), the app still votes once and only on the projected question', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore(); // no rules at all, like `allow read, write: if true`
    await setDoc(doc(db, ROOT, 'admins'), { uids: ['admin-1'] });
    const sid = await startSession(db, 'Día 1');
    const reg = await register(db, 'ana', { nombre: 'Ana Pérez', cedula: '111111', correo: 'ana@x.co', consentimiento: true });
    assert.deepEqual(await myRegistration(db, 'ana'), reg);

    const ev = async () => (await getDoc(eventoRef(db))).data();
    await assert.rejects(vote(db, 'ana', sid, 'p1-inicial', '111111', 'A'), /cerró/); // cover projected
    await goToSlide(db, await ev(), 'p1-inicial');
    await assert.rejects(vote(db, 'ana', sid, 'p1-inicial', '111111', 'Z'), /no válida/);
    await assert.rejects(vote(db, 'ana', 'otra', 'p1-inicial', '111111', 'A'), /cerró/);
    await vote(db, 'ana', sid, 'p1-inicial', '111111', 'B');
    await assert.rejects(vote(db, 'ana', sid, 'p1-inicial', '111111', 'C'), /habías votado/);
    await goToSlide(db, await ev(), 'p1-revotacion');
    await assert.rejects(vote(db, 'ana', sid, 'p1-inicial', '111111', 'C'), /cerró/);
    await vote(db, 'ana', sid, 'p1-revotacion', '111111', 'C');

    const report = await sessionReport(db, sid);
    const counts = (id) => report.polls.find((p) => p.slideId === id).options.map((o) => o.votes);
    assert.deepEqual(counts('p1-inicial'), [0, 1, 0, 0]);
    assert.deepEqual(counts('p1-revotacion'), [0, 0, 1, 0]);
  });
});

// ── Editor ─────────────────────────────────────────────────────────────────

test('only admins can edit the presentation; everyone can read it', async () => {
  const { slides } = await getPresentacion(nobody);
  assert.equal(slides.length, 7);
  await assertFails(setDoc(presentacionRef(stranger), { slides: [] }));
  await assertFails(setDoc(presentacionRef(nobody), { slides: [] }));
  await assert.rejects(savePresentacion(admin, []), /al menos una diapositiva/);
  const bad = structuredClone(slides);
  bad[1].options = [{ id: 'A', text: 'Solo una' }];
  await assert.rejects(savePresentacion(admin, bad), /al menos 2 opciones/);
  bad[1].options = Array.from({ length: 11 }, (_, i) => ({ text: `O${i}` }));
  await assert.rejects(savePresentacion(admin, bad), /más de 10/);
});

test('edits (texts, options, chart, image, new slides) reach phones live and votes follow them', async () => {
  const sid = await startSession(admin, 'Día 1');
  const ana = phone('ana');
  await ana.register('111111');
  const follow = (cb) => subscribe(ana.db, '111111', cb);

  const { slides } = await getPresentacion(admin);
  const edited = structuredClone(slides);
  edited[1].question = '¿Pregunta editada?';
  edited[1].options.push({ text: 'Opción nueva E' }); // new option gets an id on save
  edited[1].style.chartType = 'donut';
  edited[1].style.textScale = 1.3;
  edited[1].image = { url: '/media/1.jpg', position: 'left', size: 30 };
  edited.splice(2, 0, { type: 'poll', question: 'Diapositiva nueva', options: [{ text: 'Sí' }, { text: 'No' }], style: {} });
  const clean = await savePresentacion(admin, edited, { evento: await evento() });
  assert.equal(clean.length, 8);
  const newOption = clean[1].options[4];
  assert.ok(newOption.id && newOption.text === 'Opción nueva E');
  assert.equal(clean[1].options[0].id, 'A'); // existing ids are kept
  assert.equal(clean[1].style.chartType, 'donut');
  assert.deepEqual(clean[1].image, { url: '/media/1.jpg', position: 'left', size: 30 });
  assert.equal(clean[2].style.chartType, 'bar'); // defaults filled in

  const onQ = waitFor(follow, (s) => s.slide?.question === '¿Pregunta editada?' && s.myVoteLoaded);
  await go('p1-inicial');
  const q = await onQ;
  assert.equal(q.slide.options.length, 5);
  await ana.vote(sid, 'p1-inicial', '111111', newOption.id); // the new option can be voted (rules check optionIds)

  // A brand-new slide is navigable and votable too.
  await go(clean[2].id);
  await ana.vote(sid, clean[2].id, '111111', clean[2].options[1].id);

  // Editing while the phone looks at a slide updates it in place.
  const renamed = structuredClone(clean);
  renamed[2].question = 'Diapositiva nueva (corregida)';
  const live = waitFor(follow, (s) => s.slide?.question === 'Diapositiva nueva (corregida)');
  await savePresentacion(admin, renamed, { evento: await evento() });
  await live;

  const report = await sessionReport(admin, sid);
  const p1 = report.polls.find((p) => p.slideId === 'p1-inicial');
  assert.deepEqual(p1.options.map((o) => o.votes), [0, 0, 0, 0, 1]);
  assert.equal(report.polls.find((p) => p.slideId === clean[2].id).question, 'Diapositiva nueva (corregida)');
});

test('each session keeps the questions as they were asked', async () => {
  const s1 = await startSession(admin, 'Día 1');
  await endSession(admin, await evento());
  const { slides } = await getPresentacion(admin);
  const changed = structuredClone(slides);
  changed[1].question = 'Pregunta cambiada después';
  await savePresentacion(admin, changed, { evento: await evento() });
  const report = await sessionReport(admin, s1);
  assert.equal(report.polls[0].question, '¿Cuál sería su conducta inicial en esta paciente?');
  assert.equal((await sessionReport(admin, await startSession(admin, 'Día 2'))).polls[0].question, 'Pregunta cambiada después');
});

test('admin view follows presentation edits', async () => {
  await startSession(admin, 'Día 1');
  const { slides } = await getPresentacion(admin);
  const fewer = slides.filter((s) => s.id !== 'p3-2');
  const seen = waitFor((cb) => subscribeAdmin(admin, cb), (s) => s.slides.length === 6 && s.polls.length === 5);
  await savePresentacion(admin, fewer);
  await seen;
  const p = await waitFor((cb) => subscribePresentacion(nobody, cb), (x) => x.saved);
  assert.equal(p.slides.length, 6);
});
