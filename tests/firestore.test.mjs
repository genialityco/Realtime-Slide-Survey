// Runs against the Firestore emulator: npm test (firebase emulators:exec … node --test tests/)
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc, setLogLevel, updateDoc } from 'firebase/firestore';

import {
  addSlide,
  createPresentation,
  deleteSlide,
  duplicateSlide,
  getPresentation,
  listPresentations,
  moveSlide,
  updateSlide,
} from '../client/src/data/presentations.js';
import {
  endSession,
  goToSlide,
  publishResults,
  sessionReport,
  setResultsVisible,
  startSession,
  subscribeAdmin,
} from '../client/src/data/sessions.js';
import { castVote, findLiveSession, registerAttendee, subscribeAudience } from '../client/src/data/audience.js';
import { attendeesCsv, resultsCsv } from '../client/src/data/export.js';
import { seedSimposio } from '../client/src/data/seed-simposio.js';

let env;
let admin; // Firestore as an admin
let anon; // Firestore as a signed-in user who is not an admin

before(async () => {
  setLogLevel('silent'); // expected PERMISSION_DENIED writes would otherwise flood the output
  env = await initializeTestEnvironment({
    projectId: 'demo-rss',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});

after(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'admins', 'admin-1'), { email: 'a@x.co' }));
  admin = env.authenticatedContext('admin-1').firestore();
  anon = env.authenticatedContext('intruder').firestore();
});

/** A signed-in attendee: its Firestore, uid and registration helper. */
function attendee(uid) {
  const db = env.authenticatedContext(uid).firestore();
  return {
    db,
    uid,
    register: (sid, cedula, extra = {}) =>
      registerAttendee(db, uid, sid, { name: `Persona ${uid}`, cedula, email: `${uid}@x.co`, consent: true, ...extra }),
    vote: (sid, slideId, cedula, optionId) => castVote(db, uid, sid, slideId, cedula, optionId),
  };
}

async function setup() {
  const p = await createPresentation(admin, 'Demo');
  const intro = await addSlide(admin, p.id, { type: 'content', question: 'Bienvenida' });
  const poll = await addSlide(admin, p.id, {
    title: 'Caso 1',
    body: 'Texto del caso',
    question: '¿Cómo te sientes?',
    options: ['Bien', 'Regular', 'Mal'],
    style: { backgroundImage: '/media/2.jpg', contentTop: 19, accent: '#ff0000' },
  });
  const outro = await addSlide(admin, p.id, { type: 'content', question: 'Gracias' });
  return { p, intro, poll, outro };
}

const order = async (pid) => (await getPresentation(admin, pid)).slides.map((s) => s.id);
const waitFor = (subscribe, predicate, ms = 5000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => (unsub(), reject(new Error('timeout'))), ms);
    const unsub = subscribe((value) => {
      if (predicate(value)) {
        clearTimeout(timer);
        setTimeout(() => unsub());
        resolve(value);
      }
    });
  });

// ── Presentations ──────────────────────────────────────────────────────────

test('only admins can read or write presentations', async () => {
  await setup();
  await assertFails(getDocs(collection(anon, 'presentations')));
  await assertFails(setDoc(doc(anon, 'presentations', 'x'), { title: 'hack' }));
  await assertFails(setDoc(doc(anon, 'admins', 'intruder'), {}));
  assert.equal((await listPresentations(admin)).length, 1);
});

test('duplicate keeps title, case, question, options and style but gets new ids', async () => {
  const { p, poll } = await setup();
  const copy = await duplicateSlide(admin, p.id, poll.id);
  assert.notEqual(copy.id, poll.id);
  assert.equal(copy.sourceSlideId, poll.id);
  assert.equal(copy.title, poll.title);
  assert.equal(copy.body, poll.body);
  assert.equal(copy.question, poll.question);
  assert.deepEqual(copy.style, poll.style);
  assert.deepEqual(copy.options.map((o) => o.text), poll.options.map((o) => o.text));
  for (const o of copy.options) assert.ok(!poll.options.some((x) => x.id === o.id));
});

test('duplicate lands after the original by default or at a position; move and delete reindex', async () => {
  const { p, intro, poll, outro } = await setup();
  const a = await duplicateSlide(admin, p.id, poll.id);
  assert.deepEqual(await order(p.id), [intro.id, poll.id, a.id, outro.id]);
  const b = await duplicateSlide(admin, p.id, poll.id, 99);
  assert.deepEqual(await order(p.id), [intro.id, poll.id, a.id, outro.id, b.id]);
  await moveSlide(admin, p.id, b.id, 0);
  assert.deepEqual(await order(p.id), [b.id, intro.id, poll.id, a.id, outro.id]);
  await deleteSlide(admin, p.id, intro.id);
  const slides = (await getPresentation(admin, p.id)).slides;
  assert.deepEqual(slides.map((s) => s.id), [b.id, poll.id, a.id, outro.id]);
  assert.deepEqual(slides.map((s) => s.position), [0, 1, 2, 3]);
});

test('editing the copy does not touch the original', async () => {
  const { p, poll } = await setup();
  const copy = await duplicateSlide(admin, p.id, poll.id);
  await updateSlide(admin, p.id, copy.id, { title: 'Caso 1 · Revotación', style: { accent: '#00ff00' } });
  const fresh = (await getPresentation(admin, p.id)).slides.find((s) => s.id === poll.id);
  assert.equal(fresh.title, 'Caso 1');
  assert.equal(fresh.style.accent, '#ff0000');
});

// ── Registration ───────────────────────────────────────────────────────────

test('registration: validated by the rules, private, and re-claimable by cédula', async () => {
  const { p } = await setup();
  const s = await startSession(admin, p.id);
  assert.equal((await findLiveSession(anon, s.code.toLowerCase())).sessionId, s.id);

  const ana = attendee('ana');
  // Bypassing client validation does not help: the rules reject bad data.
  const raw = (data) => setDoc(doc(ana.db, 'sessions', s.id, 'attendees', '123456'), {
    name: 'Ana Pérez', cedula: '123456', email: 'ana@x.co', uid: 'ana', consent: true,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...data,
  });
  await assertFails(raw({ email: 'nope' }));
  await assertFails(raw({ consent: false }));
  await assertFails(raw({ uid: 'someone-else' }));
  await assertFails(raw({ isAdmin: true }));
  await assertFails(setDoc(doc(ana.db, 'sessions', s.id, 'attendees', 'abc'), { cedula: 'abc' }));
  await assertSucceeds(raw({}));

  // Others cannot read personal data; the owner and admins can.
  await assertFails(getDoc(doc(anon, 'sessions', s.id, 'attendees', '123456')));
  await assertFails(getDocs(collection(anon, 'sessions', s.id, 'attendees')));
  await assertSucceeds(getDoc(doc(ana.db, 'sessions', s.id, 'attendees', '123456')));
  assert.equal((await getDocs(collection(admin, 'sessions', s.id, 'attendees'))).size, 1);

  // Same cédula from another phone takes the registration over (no duplicate).
  const phone2 = attendee('ana-phone-2');
  await phone2.register(s.id, '123.456');
  const row = (await getDoc(doc(admin, 'sessions', s.id, 'attendees', '123456'))).data();
  assert.equal(row.uid, 'ana-phone-2');
  assert.equal((await getDocs(collection(admin, 'sessions', s.id, 'attendees'))).size, 1);
});

test('taking a registration over keeps its votes visible and blocks the old phone', async () => {
  const { p, poll } = await setup();
  const copy = await duplicateSlide(admin, p.id, poll.id);
  const s = await startSession(admin, p.id);
  const phone1 = attendee('ana-1');
  await phone1.register(s.id, '123456');
  await goToSlide(admin, s.id, poll.id);
  await phone1.vote(s.id, poll.id, '123456', poll.options[0].id);

  const phone2 = attendee('ana-2');
  await phone2.register(s.id, '123456');
  const vote = await getDoc(doc(phone2.db, 'sessions', s.id, 'polls', poll.id, 'votes', '123456'));
  assert.equal(vote.data().optionId, poll.options[0].id); // sees the vote cast from phone 1
  await assert.rejects(phone2.vote(s.id, poll.id, '123456', poll.options[1].id)); // still only once

  await goToSlide(admin, s.id, copy.id);
  await assert.rejects(phone1.vote(s.id, copy.id, '123456', copy.options[0].id)); // old phone lost it
  await phone2.vote(s.id, copy.id, '123456', copy.options[1].id);
});

// ── Voting ─────────────────────────────────────────────────────────────────

test('votes: registered, as yourself, on the active poll, with a valid option, once', async () => {
  const { p, poll } = await setup();
  const copy = await duplicateSlide(admin, p.id, poll.id);
  const s = await startSession(admin, p.id);
  const ana = attendee('ana');
  const bob = attendee('bob');
  await ana.register(s.id, '111111');
  await bob.register(s.id, '222222');

  // The intro (content) is current: polls are not active yet.
  await assert.rejects(ana.vote(s.id, poll.id, '111111', poll.options[0].id), /no está activa/);
  await goToSlide(admin, s.id, poll.id);

  await assert.rejects(attendee('ghost').vote(s.id, poll.id, '999999', poll.options[0].id)); // not registered
  await assert.rejects(bob.vote(s.id, poll.id, '111111', poll.options[0].id)); // as someone else
  await assert.rejects(ana.vote(s.id, poll.id, '111111', copy.options[0].id)); // option of another slide
  await assert.rejects(ana.vote(s.id, copy.id, '111111', copy.options[0].id)); // not the active poll
  await ana.vote(s.id, poll.id, '111111', poll.options[1].id);
  await assert.rejects(ana.vote(s.id, poll.id, '111111', poll.options[0].id), /ya votaste/);
  await assertFails(updateDoc(doc(ana.db, 'sessions', s.id, 'polls', poll.id, 'votes', '111111'), { optionId: 'x' }));

  // Own vote readable; others' votes are not; only admins list them.
  await assertSucceeds(getDoc(doc(ana.db, 'sessions', s.id, 'polls', poll.id, 'votes', '111111')));
  await assertFails(getDoc(doc(bob.db, 'sessions', s.id, 'polls', poll.id, 'votes', '111111')));
  await assertFails(getDocs(collection(bob.db, 'sessions', s.id, 'polls', poll.id, 'votes')));
  // Attendees cannot tamper with the poll or the session.
  await assertFails(updateDoc(doc(ana.db, 'sessions', s.id, 'polls', poll.id), { resultsVisible: true }));
  await assertFails(updateDoc(doc(ana.db, 'sessions', s.id), { currentSlideId: copy.id }));
});

test('original and duplicate collect votes independently; results visibility is per slide', async () => {
  const { p, poll } = await setup();
  const copy = await duplicateSlide(admin, p.id, poll.id);
  const s = await startSession(admin, p.id);
  const ana = attendee('ana');
  const bob = attendee('bob');
  await ana.register(s.id, '111111');
  await bob.register(s.id, '222222');

  await goToSlide(admin, s.id, poll.id);
  await ana.vote(s.id, poll.id, '111111', poll.options[0].id);
  await bob.vote(s.id, poll.id, '222222', poll.options[0].id);
  await setResultsVisible(admin, s.id, poll.id, true);

  await goToSlide(admin, s.id, copy.id);
  await ana.vote(s.id, copy.id, '111111', copy.options[2].id); // re-vote on the copy

  const report = await sessionReport(admin, s.id);
  const r1 = report.polls.find((x) => x.slideId === poll.id);
  const r2 = report.polls.find((x) => x.slideId === copy.id);
  assert.notEqual(r1.pollInstanceId, r2.pollInstanceId);
  assert.deepEqual(r1.options.map((o) => o.votes), [2, 0, 0]);
  assert.deepEqual(r2.options.map((o) => o.votes), [0, 0, 1]);
  assert.equal(r1.resultsVisible, true);
  assert.equal(r2.resultsVisible, false);
});

test('results persist after the session ends and survive slide edits and deletes', async () => {
  const { p, poll } = await setup();
  const s = await startSession(admin, p.id);
  const ana = attendee('ana');
  await ana.register(s.id, '111111');
  await goToSlide(admin, s.id, poll.id);
  await ana.vote(s.id, poll.id, '111111', poll.options[0].id);
  await endSession(admin, s.id);

  await assert.rejects(attendee('late').register(s.id, '333333'), /registro/);
  await assert.rejects(findLiveSession(anon, s.code), /terminó/);
  await updateSlide(admin, p.id, poll.id, { question: 'Otra', options: ['X', 'Y'] });
  await deleteSlide(admin, p.id, poll.id);

  const report = await sessionReport(admin, s.id);
  assert.equal(report.session.status, 'ended');
  assert.equal(report.polls[0].question, '¿Cómo te sientes?');
  assert.equal(report.polls[0].body, 'Texto del caso');
  assert.equal(report.polls[0].total, 1);
  assert.equal(report.polls[0].slideDeleted, true);
});

test('a new session of the same presentation starts from zero', async () => {
  const { p, poll } = await setup();
  const s1 = await startSession(admin, p.id);
  const ana1 = attendee('ana');
  await ana1.register(s1.id, '111111');
  await goToSlide(admin, s1.id, poll.id);
  await ana1.vote(s1.id, poll.id, '111111', poll.options[0].id);
  await endSession(admin, s1.id);

  const s2 = await startSession(admin, p.id);
  assert.notEqual(s2.code, s1.code);
  await ana1.register(s2.id, '111111');
  await goToSlide(admin, s2.id, poll.id);
  await ana1.vote(s2.id, poll.id, '111111', poll.options[2].id);

  const [r1, r2] = await Promise.all([sessionReport(admin, s1.id), sessionReport(admin, s2.id)]);
  assert.deepEqual(r1.polls[0].options.map((o) => o.votes), [1, 0, 0]);
  assert.deepEqual(r2.polls[0].options.map((o) => o.votes), [0, 0, 1]);
  assert.notEqual(r1.polls[0].pollInstanceId, r2.polls[0].pollInstanceId);
});

// ── Realtime ───────────────────────────────────────────────────────────────

test('realtime: audience follows slides and sees results only when published', async () => {
  const { p, poll } = await setup();
  const copy = await duplicateSlide(admin, p.id, poll.id);
  const s = await startSession(admin, p.id);
  const ana = attendee('ana');
  await ana.register(s.id, '111111');

  const audience = (cb) => subscribeAudience(ana.db, s.id, '111111', cb);
  const adminView = (cb) => subscribeAdmin(admin, s.id, cb);

  const onPoll = waitFor(audience, (st) => st.slide?.id === poll.id && st.poll);
  await goToSlide(admin, s.id, poll.id);
  const st1 = await onPoll;
  assert.equal(st1.poll.results, null);
  assert.equal(st1.slide.question, '¿Cómo te sientes?');

  const counted = waitFor(adminView, (st) => st.polls.find((x) => x.slideId === poll.id)?.total === 1 && st.attendeeCount === 1);
  const myVote = waitFor(audience, (st) => st.poll?.myVote === poll.options[1].id);
  await ana.vote(s.id, poll.id, '111111', poll.options[1].id);
  const adminState = await counted;
  await myVote;

  const shown = waitFor(audience, (st) => st.poll?.results?.total === 1);
  await setResultsVisible(admin, s.id, poll.id, true, adminState.polls.find((x) => x.slideId === poll.id));
  assert.deepEqual((await shown).poll.results.options.map((o) => o.votes), [0, 1, 0]);

  const moved = waitFor(audience, (st) => st.slide?.id === copy.id && st.poll);
  await goToSlide(admin, s.id, copy.id);
  const st2 = await moved;
  assert.equal(st2.poll.myVote, null);
  assert.equal(st2.poll.resultsVisible, false);

  const ended = waitFor(audience, (st) => st.status === 'ended');
  await endSession(admin, s.id);
  await ended;
  await publishResults(admin, s.id, poll.id, adminState.polls[0]); // admin can still publish after end
});

// ── Export & template ──────────────────────────────────────────────────────

test('CSV exports list each attendee answer and the totals', async () => {
  const { p, poll } = await setup();
  const s = await startSession(admin, p.id);
  await goToSlide(admin, s.id, poll.id);
  await attendee('ana').register(s.id, '111111', { name: 'Ana; "la doc"' });
  const bob = attendee('bob');
  await bob.register(s.id, '222222', { name: 'Bob Ruiz' });
  await bob.vote(s.id, poll.id, '222222', poll.options[1].id);

  const report = await sessionReport(admin, s.id);
  const people = attendeesCsv(report).replace('﻿', '').trim().split('\r\n');
  assert.equal(people[0], 'Nombre;Cédula;Correo;Fecha de registro;Diap. 2 · Caso 1');
  assert.match(people[1], /^"Ana; ""la doc""";111111;ana@x\.co;[^;]+;$/);
  assert.match(people[2], /^Bob Ruiz;222222;bob@x\.co;[^;]+;B\. Regular$/);
  const totals = resultsCsv(report).replace('﻿', '').trim().split('\r\n');
  assert.equal(totals.length, 4);
  assert.match(totals[2], /^2;Caso 1;¿Cómo te sientes\?;B;Regular;1;100,0;1;/);
});

test('symposium template creates the 7 slides with re-votes as duplicates', async () => {
  const p = await seedSimposio(admin);
  assert.deepEqual(
    p.slides.map((s) => [s.type, s.title || '(portada)']),
    [
      ['content', '(portada)'],
      ['poll', '1. Contrapunteo: Manejo del SMD de bajo riesgo con anemia refractaria · Votación inicial'],
      ['poll', '1. Contrapunteo: Manejo del SMD de bajo riesgo con anemia refractaria · Revotación'],
      ['poll', '2. Contrapunteo: SMD de alto riesgo, ¿quién y cuándo va a trasplante alogénico? · Votación inicial'],
      ['poll', '2. Contrapunteo: SMD de alto riesgo, ¿quién y cuándo va a trasplante alogénico? · Revotación'],
      ['poll', 'Pregunta 3.1'],
      ['poll', 'Pregunta 3.2'],
    ],
  );
  assert.equal(p.slides[2].sourceSlideId, p.slides[1].id);
  assert.equal(p.slides[0].style.backgroundImage, '/media/1.jpg');
  assert.equal(p.slides[6].style.backgroundImage, '/media/2.jpg');
});
