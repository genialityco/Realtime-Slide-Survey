import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { openDb } from '../src/db.js';
import { createServer } from '../src/app.js';

const ADMIN = 'secreto';
const { server, repo, io } = createServer(openDb(':memory:'), { adminPassword: ADMIN });
await new Promise((r) => server.listen(0, r));
const url = `http://localhost:${server.address().port}`;
const clients = [];

after(() => {
  clients.forEach((c) => c.close());
  io.close();
  server.close();
});

function client(auth) {
  const c = connect(url, { transports: ['websocket'], forceNew: true, auth });
  clients.push(c);
  return c;
}

const call = (socket, event, payload) =>
  new Promise((resolve, reject) =>
    socket.emit(event, payload, (r) => (r.ok ? resolve(r.data) : reject(new Error(r.error)))),
  );

const next = (socket, event, predicate = () => true) =>
  new Promise((resolve) => {
    const fn = (data) => {
      if (predicate(data)) {
        socket.off(event, fn);
        resolve(data);
      }
    };
    socket.on(event, fn);
  });

const post = (path, body, headers = {}) =>
  fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('admin API and admin socket events require the password', async () => {
  assert.equal((await fetch(`${url}/api/presentations`)).status, 401);
  assert.equal((await fetch(`${url}/api/presentations`, { headers: { 'x-admin-key': 'mal' } })).status, 401);
  assert.equal((await fetch(`${url}/api/presentations`, { headers: { 'x-admin-key': ADMIN } })).status, 200);
  assert.equal((await fetch(`${url}/api/config`)).status, 200);
  await assert.rejects(call(client(), 'admin:join', { sessionId: 'x' }), /administrador/);
});

test('registration gates voting; live counts reach admin; audience sees results only when shown', async () => {
  const p = repo.createPresentation('RT');
  const poll = repo.addSlide(p.id, { question: 'Q', options: ['A', 'B'] });
  const copy = repo.duplicateSlide(poll.id);
  const session = await (await post(`/api/presentations/${p.id}/sessions`, {}, { 'x-admin-key': ADMIN })).json();

  const admin = client({ adminKey: ADMIN });
  await call(admin, 'admin:join', { sessionId: session.id });

  const alice = client();
  await assert.rejects(call(alice, 'audience:join', { code: session.code, attendeeId: 'nope' }), /not_registered/);

  const bad = await post(`/api/join/${session.code}/register`, { name: 'Alice', cedula: '12', email: 'a@b.co', consent: true });
  assert.equal(bad.status, 400);
  const reg = await post(`/api/join/${session.code}/register`, {
    name: 'Alice Smith',
    cedula: '123456',
    email: 'a@b.co',
    consent: true,
  });
  assert.equal(reg.status, 201);
  const { attendee } = await reg.json();

  const { state } = await call(alice, 'audience:join', { code: session.code, attendeeId: attendee.id });
  assert.equal(state.slide.id, poll.id);
  assert.equal(state.poll.results, null);

  const adminUpdate = next(admin, 'admin:state', (s) => s.polls.some((x) => x.total === 1));
  const voted = await call(alice, 'vote', { slideId: poll.id, optionId: poll.options[1].id });
  assert.equal(voted.results, null);
  const a = await adminUpdate;
  assert.equal(a.attendeeCount, 1);
  assert.deepEqual(a.polls.find((x) => x.slideId === poll.id).options.map((o) => o.votes), [0, 1]);

  const shown = next(alice, 'state', (s) => s.poll?.resultsVisible);
  await call(admin, 'admin:results', { sessionId: session.id, slideId: poll.id, visible: true });
  assert.equal((await shown).poll.results.total, 1);

  const moved = next(alice, 'state', (s) => s.slide?.id === copy.id);
  await call(admin, 'admin:goto', { sessionId: session.id, slideId: copy.id });
  const onCopy = await moved;
  assert.equal(onCopy.poll.myVote, null);
  assert.equal(onCopy.poll.resultsVisible, false);
  assert.notEqual(onCopy.poll.pollInstanceId, state.poll.pollInstanceId);

  const csv = await (
    await fetch(`${url}/api/sessions/${session.id}/export/attendees.csv`, { headers: { 'x-admin-key': ADMIN } })
  ).text();
  assert.match(csv, /Alice Smith;123456;a@b\.co;.+;B\. B;/);

  const ended = next(alice, 'state', (s) => s.status === 'ended');
  await call(admin, 'admin:end', { sessionId: session.id });
  await ended;
  await assert.rejects(call(alice, 'vote', { slideId: copy.id, optionId: copy.options[0].id }), /ended/);
});
