import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createRepo } from '../src/repo.js';
import { attendeesCsv, resultsCsv } from '../src/export.js';

function setup() {
  const repo = createRepo(openDb(':memory:'));
  const p = repo.createPresentation('Demo');
  const intro = repo.addSlide(p.id, { type: 'content', question: 'Bienvenida' });
  const poll = repo.addSlide(p.id, {
    title: 'Caso 1',
    body: 'Texto del caso',
    question: '¿Cómo te sientes?',
    options: ['Bien', 'Regular', 'Mal'],
    style: { background: '#000000', accent: '#ff0000', chartType: 'column', backgroundImage: '/media/2.jpg', contentTop: 19 },
  });
  const outro = repo.addSlide(p.id, { type: 'content', question: 'Gracias' });
  return { repo, p, intro, poll, outro };
}

const order = (repo, pid) => repo.getPresentation(pid).slides.map((s) => s.id);

/** Registers a person in the session (idempotent per name) and returns the attendee id. */
function person(repo, sessionId, who) {
  const cedula = String(10000000 + [...who].reduce((n, c) => n * 31 + c.charCodeAt(0), 7) % 1000000);
  return repo.registerAttendee(sessionId, { name: `Persona ${who}`, cedula, email: `${who}@example.com`, consent: true }).id;
}

const vote = (repo, sessionId, slideId, optionId, who) =>
  repo.vote({ sessionId, slideId, optionId, participantId: person(repo, sessionId, who) });

test('duplicate keeps title, case, question, options and style but gets new ids', () => {
  const { repo, poll } = setup();
  const copy = repo.duplicateSlide(poll.id);
  assert.notEqual(copy.id, poll.id);
  assert.equal(copy.sourceSlideId, poll.id);
  assert.equal(copy.title, poll.title);
  assert.equal(copy.body, poll.body);
  assert.equal(copy.question, poll.question);
  assert.deepEqual(copy.style, poll.style);
  assert.equal(copy.style.backgroundImage, '/media/2.jpg');
  assert.deepEqual(copy.options.map((o) => o.text), poll.options.map((o) => o.text));
  for (const o of copy.options) assert.ok(!poll.options.some((x) => x.id === o.id));
});

test('duplicate lands right after the original by default, or at a given position', () => {
  const { repo, p, intro, poll, outro } = setup();
  const a = repo.duplicateSlide(poll.id);
  assert.deepEqual(order(repo, p.id), [intro.id, poll.id, a.id, outro.id]);
  const b = repo.duplicateSlide(poll.id, 99);
  assert.deepEqual(order(repo, p.id), [intro.id, poll.id, a.id, outro.id, b.id]);
  repo.moveSlide(b.id, 0);
  assert.deepEqual(order(repo, p.id), [b.id, intro.id, poll.id, a.id, outro.id]);
  assert.deepEqual(repo.getPresentation(p.id).slides.map((s) => s.position), [0, 1, 2, 3, 4]);
});

test('editing the copy does not touch the original', () => {
  const { repo, poll } = setup();
  const copy = repo.duplicateSlide(poll.id);
  repo.updateSlide(copy.id, { title: 'Caso 1 · Revotación', style: { accent: '#00ff00' } });
  const fresh = repo.getPresentation(poll.presentationId).slides.find((s) => s.id === poll.id);
  assert.equal(fresh.title, 'Caso 1');
  assert.equal(fresh.style.accent, '#ff0000');
});

test('rejects unsafe background image URLs', () => {
  const { repo, poll } = setup();
  assert.throws(() => repo.updateSlide(poll.id, { style: { backgroundImage: 'x"); background: red' } }), /invalid/);
});

test('registration validates data and re-identifies by cédula', () => {
  const { repo, poll } = setup();
  const s = repo.startSession(poll.presentationId);
  const ok = { name: 'Ana Pérez', cedula: '1.020.304.050', email: 'Ana@Mail.com', consent: true };
  assert.throws(() => repo.registerAttendee(s.id, { ...ok, name: 'A' }), /nombre/);
  assert.throws(() => repo.registerAttendee(s.id, { ...ok, cedula: 'abc' }), /cédula/);
  assert.throws(() => repo.registerAttendee(s.id, { ...ok, email: 'nope' }), /correo/);
  assert.throws(() => repo.registerAttendee(s.id, { ...ok, consent: false }), /autorizar/);
  const a = repo.registerAttendee(s.id, ok);
  const again = repo.registerAttendee(s.id, { ...ok, cedula: '1020304050', email: 'otro@mail.com' });
  assert.equal(again.id, a.id);
  assert.equal(repo.attendeeCount(s.id), 1);
});

test('only registered attendees of that session can vote', () => {
  const { repo, poll } = setup();
  const s1 = repo.startSession(poll.presentationId);
  const s2 = repo.startSession(poll.presentationId);
  repo.goToSlide(s2.id, poll.id);
  const fromS1 = person(repo, s1.id, 'ana');
  assert.throws(
    () => repo.vote({ sessionId: s2.id, slideId: poll.id, optionId: poll.options[0].id, participantId: fromS1 }),
    /Regístrate/,
  );
  assert.throws(
    () => repo.vote({ sessionId: s2.id, slideId: poll.id, optionId: poll.options[0].id, participantId: 'random' }),
    /Regístrate/,
  );
});

test('original and duplicate collect votes independently', () => {
  const { repo, poll } = setup();
  const copy = repo.duplicateSlide(poll.id);
  const s = repo.startSession(poll.presentationId);

  repo.goToSlide(s.id, poll.id);
  vote(repo, s.id, poll.id, poll.options[0].id, 'u1');
  vote(repo, s.id, poll.id, poll.options[0].id, 'u2');

  repo.goToSlide(s.id, copy.id);
  vote(repo, s.id, copy.id, copy.options[2].id, 'u1'); // same person answers the copy (re-vote)

  const r1 = repo.results(s.id, poll.id);
  const r2 = repo.results(s.id, copy.id);
  assert.notEqual(r1.pollInstanceId, r2.pollInstanceId);
  assert.deepEqual(r1.options.map((o) => o.votes), [2, 0, 0]);
  assert.deepEqual(r2.options.map((o) => o.votes), [0, 0, 1]);
});

test('votes only go to the active poll, once per participant, with valid options', () => {
  const { repo, poll } = setup();
  const copy = repo.duplicateSlide(poll.id);
  const s = repo.startSession(poll.presentationId);
  repo.goToSlide(s.id, poll.id);

  assert.throws(() => vote(repo, s.id, copy.id, copy.options[0].id, 'u1'), /not active/);
  assert.throws(() => vote(repo, s.id, poll.id, copy.options[0].id, 'u1'), /unknown option/);
  vote(repo, s.id, poll.id, poll.options[1].id, 'u1');
  assert.throws(() => vote(repo, s.id, poll.id, poll.options[0].id, 'u1'), /already voted/);
  assert.equal(repo.myVote(s.id, poll.id, person(repo, s.id, 'u1')), poll.options[1].id);
});

test('results visibility is per slide', () => {
  const { repo, poll } = setup();
  const copy = repo.duplicateSlide(poll.id);
  const s = repo.startSession(poll.presentationId);
  assert.equal(repo.setResultsVisible(s.id, poll.id, true).resultsVisible, true);
  assert.equal(repo.ensureInstance(s.id, copy.id).resultsVisible, false);
  assert.equal(repo.setResultsVisible(s.id, poll.id, false).resultsVisible, false);
});

test('results persist after the session ends and survive slide edits/deletes', () => {
  const { repo, poll } = setup();
  const s = repo.startSession(poll.presentationId);
  repo.goToSlide(s.id, poll.id);
  vote(repo, s.id, poll.id, poll.options[0].id, 'u1');
  const u2 = person(repo, s.id, 'u2');
  repo.endSession(s.id);

  assert.throws(
    () => repo.vote({ sessionId: s.id, slideId: poll.id, optionId: poll.options[0].id, participantId: u2 }),
    /ended/,
  );
  repo.updateSlide(poll.id, { question: 'Otra', options: ['X', 'Y'] });
  repo.deleteSlide(poll.id);

  const report = repo.sessionReport(s.id);
  assert.equal(report.session.status, 'ended');
  assert.equal(report.attendeeCount, 2);
  assert.equal(report.polls.length, 1);
  assert.equal(report.polls[0].question, '¿Cómo te sientes?');
  assert.equal(report.polls[0].body, 'Texto del caso');
  assert.equal(report.polls[0].total, 1);
  assert.equal(report.polls[0].slideDeleted, true);
});

test('a new session of the same presentation starts from zero', () => {
  const { repo, poll } = setup();
  const s1 = repo.startSession(poll.presentationId);
  repo.goToSlide(s1.id, poll.id);
  vote(repo, s1.id, poll.id, poll.options[0].id, 'u1');
  repo.endSession(s1.id);

  const s2 = repo.startSession(poll.presentationId);
  repo.goToSlide(s2.id, poll.id);
  assert.equal(repo.results(s2.id, poll.id).total, 0);
  assert.equal(repo.attendeeCount(s2.id), 0);
  vote(repo, s2.id, poll.id, poll.options[2].id, 'u1');

  assert.deepEqual(repo.results(s1.id, poll.id).options.map((o) => o.votes), [1, 0, 0]);
  assert.deepEqual(repo.results(s2.id, poll.id).options.map((o) => o.votes), [0, 0, 1]);
  assert.notEqual(repo.results(s1.id, poll.id).pollInstanceId, repo.results(s2.id, poll.id).pollInstanceId);
});

test('CSV exports list each attendee answer and the totals', () => {
  const { repo, poll } = setup();
  const s = repo.startSession(poll.presentationId);
  repo.goToSlide(s.id, poll.id);
  repo.registerAttendee(s.id, { name: 'Ana; "la doc"', cedula: '111111', email: 'a@x.co', consent: true });
  const bob = repo.registerAttendee(s.id, { name: 'Bob', cedula: '222222', email: 'b@x.co', consent: true });
  repo.vote({ sessionId: s.id, slideId: poll.id, optionId: poll.options[1].id, participantId: bob.id });

  const people = attendeesCsv(repo.sessionExport(s.id)).replace('﻿', '').trim().split('\r\n');
  assert.equal(people[0], 'Nombre;Cédula;Correo;Fecha de registro;Diap. 2 · Caso 1');
  assert.match(people[1], /^"Ana; ""la doc""";111111;a@x\.co;[^;]+;$/);
  assert.match(people[2], /^Bob;222222;b@x\.co;[^;]+;B\. Regular$/);

  const totals = resultsCsv(repo.sessionReport(s.id)).replace('﻿', '').trim().split('\r\n');
  assert.equal(totals.length, 4);
  assert.match(totals[2], /^2;Caso 1;¿Cómo te sientes\?;B;Regular;1;100,0;1;/);
});
