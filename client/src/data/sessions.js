// Admin side of a live session. Realtime comes from Firestore listeners (onSnapshot).
import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { AppError, joinCode, randomId, tally } from './model.js';
import { listSlides } from './presentations.js';

const sessionRef = (db, sid) => doc(db, 'sessions', sid);
const pollsCol = (db, sid) => collection(db, 'sessions', sid, 'polls');
const pollRef = (db, sid, slideId) => doc(db, 'sessions', sid, 'polls', slideId);
const votesCol = (db, sid, slideId) => collection(db, 'sessions', sid, 'polls', slideId, 'votes');
const attendeesCol = (db, sid) => collection(db, 'sessions', sid, 'attendees');

const toSession = (snap) => ({ id: snap.id, ...snap.data() });
const toPoll = (snap) => ({ ...snap.data() });

/** What the audience sees for a slide (polls use the session snapshot). */
const currentOf = (slide, poll) =>
  poll
    ? {
        slideId: slide.id,
        type: 'poll',
        title: poll.title,
        body: poll.body,
        question: poll.question,
        options: poll.options,
        style: poll.style,
      }
    : { slideId: slide.id, type: slide.type, title: slide.title ?? '', body: slide.body, question: slide.question, style: slide.style };

export async function getSession(db, sid) {
  const snap = await getDoc(sessionRef(db, sid));
  if (!snap.exists()) throw new AppError('Sesión no encontrada');
  return toSession(snap);
}

export async function startSession(db, pid) {
  const presentation = await getDoc(doc(db, 'presentations', pid));
  if (!presentation.exists()) throw new AppError('Presentación no encontrada');
  const slides = await listSlides(db, pid);

  let code;
  do code = joinCode();
  while (!(await getDocs(query(collection(db, 'sessions'), where('code', '==', code), limit(1)))).empty);

  const ref = doc(collection(db, 'sessions'));
  await setDoc(ref, {
    presentationId: pid,
    presentationTitle: presentation.data().title,
    cover: slides[0]?.style?.backgroundImage || null,
    code,
    status: 'live',
    currentSlideId: null,
    current: null,
    showQr: false,
    startedAt: serverTimestamp(),
    endedAt: null,
  });
  if (slides[0]) await goToSlide(db, ref.id, slides[0].id);
  return getSession(db, ref.id);
}

/**
 * Makes `slideId` the current slide. For polls, the first time a slide is shown in a session a poll
 * instance is created with a snapshot of its content, so later edits never alter that session's results.
 */
export function goToSlide(db, sid, slideId) {
  return runTransaction(db, async (tx) => {
    const sessionSnap = await tx.get(sessionRef(db, sid));
    if (!sessionSnap.exists()) throw new AppError('Sesión no encontrada');
    const session = sessionSnap.data();
    if (session.status !== 'live') throw new AppError('La sesión ya terminó');

    const slideSnap = await tx.get(doc(db, 'presentations', session.presentationId, 'slides', slideId));
    if (!slideSnap.exists() || slideSnap.data().deleted) throw new AppError('Diapositiva no encontrada');
    const slide = { id: slideSnap.id, ...slideSnap.data() };

    let poll = null;
    if (slide.type === 'poll') {
      const pollSnap = await tx.get(pollRef(db, sid, slideId));
      if (pollSnap.exists()) {
        poll = pollSnap.data();
      } else {
        poll = {
          sessionId: sid,
          slideId,
          pollInstanceId: randomId(12),
          title: slide.title ?? '',
          body: slide.body ?? '',
          question: slide.question,
          options: slide.options,
          optionIds: slide.options.map((o) => o.id),
          style: slide.style,
          resultsVisible: false,
          results: null,
          createdAt: serverTimestamp(),
        };
        tx.set(pollRef(db, sid, slideId), poll);
      }
    }
    tx.update(sessionRef(db, sid), { currentSlideId: slideId, current: currentOf(slide, poll) });
  });
}

/** Shows/hides results for the audience; `results` (a tally) is published with it. */
export async function setResultsVisible(db, sid, slideId, visible, results) {
  const patch = { resultsVisible: !!visible };
  if (results) patch.results = publicResults(results);
  await updateDoc(pollRef(db, sid, slideId), patch);
}

/** Publishes the current counts so the audience (who cannot read votes) can render the chart. */
export async function publishResults(db, sid, slideId, results) {
  await updateDoc(pollRef(db, sid, slideId), { results: publicResults(results) });
}

const publicResults = (t) => ({
  total: t.total,
  counts: Object.fromEntries(t.options.map((o) => [o.id, o.votes])),
});

export async function setShowQr(db, sid, visible) {
  await updateDoc(sessionRef(db, sid), { showQr: !!visible });
}

export async function endSession(db, sid) {
  await updateDoc(sessionRef(db, sid), { status: 'ended', endedAt: serverTimestamp(), showQr: false });
}

export async function listSessions(db, pid) {
  const snap = await getDocs(query(collection(db, 'sessions'), where('presentationId', '==', pid)));
  const sessions = await Promise.all(
    snap.docs.map(async (d) => {
      const polls = await getDocs(pollsCol(db, d.id));
      const counts = await Promise.all(polls.docs.map((p) => getCountFromServer(votesCol(db, d.id, p.id))));
      return {
        ...toSession(d),
        pollCount: polls.size,
        totalVotes: counts.reduce((sum, c) => sum + c.data().count, 0),
      };
    }),
  );
  return sessions.sort((a, b) => (b.startedAt?.toMillis?.() ?? 0) - (a.startedAt?.toMillis?.() ?? 0));
}

/**
 * Live admin view: session, slides, per-poll tallies (from the votes themselves) and registrations.
 * Calls `onChange(state)` on every change; returns an unsubscribe function.
 */
export function subscribeAdmin(db, sid, onChange, onError = console.error) {
  const state = { session: null, slides: [], polls: new Map(), votes: new Map(), attendeeCount: 0 };
  const unsubs = [];
  const voteUnsubs = new Map();
  let slidesUnsub = null;

  const emit = () => {
    if (!state.session) return;
    const polls = [...state.polls.values()].map((p) => ({
      ...tally(p, state.votes.get(p.slideId) ?? []),
      title: p.title,
      body: p.body,
      question: p.question,
      style: p.style,
      resultsVisible: p.resultsVisible,
      published: p.results,
    }));
    onChange({
      session: state.session,
      presentation: { id: state.session.presentationId, title: state.session.presentationTitle, slides: state.slides },
      polls,
      attendeeCount: state.attendeeCount,
    });
  };

  unsubs.push(
    onSnapshot(
      sessionRef(db, sid),
      (snap) => {
        if (!snap.exists()) return onError(new AppError('Sesión no encontrada'));
        state.session = toSession(snap);
        if (!slidesUnsub) {
          slidesUnsub = onSnapshot(
            collection(db, 'presentations', state.session.presentationId, 'slides'),
            (s) => {
              state.slides = s.docs
                .map((d) => ({ id: d.id, ...d.data() }))
                .filter((x) => !x.deleted)
                .sort((a, b) => a.position - b.position);
              emit();
            },
            onError,
          );
        }
        emit();
      },
      onError,
    ),
  );

  unsubs.push(
    onSnapshot(
      pollsCol(db, sid),
      (snap) => {
        for (const d of snap.docs) {
          state.polls.set(d.id, toPoll(d));
          if (!voteUnsubs.has(d.id)) {
            voteUnsubs.set(
              d.id,
              onSnapshot(
                votesCol(db, sid, d.id),
                (v) => {
                  state.votes.set(d.id, v.docs.map((x) => x.data()));
                  emit();
                },
                onError,
              ),
            );
          }
        }
        emit();
      },
      onError,
    ),
  );

  unsubs.push(
    onSnapshot(
      attendeesCol(db, sid),
      (snap) => {
        state.attendeeCount = snap.size;
        emit();
      },
      onError,
    ),
  );

  return () => {
    unsubs.forEach((u) => u());
    slidesUnsub?.();
    voteUnsubs.forEach((u) => u());
  };
}

/** Full persisted results of one session, plus attendees and each attendee's answers. */
export async function sessionReport(db, sid) {
  const session = await getSession(db, sid);
  const [slidesSnap, pollsSnap, attendeesSnap] = await Promise.all([
    getDocs(collection(db, 'presentations', session.presentationId, 'slides')),
    getDocs(pollsCol(db, sid)),
    getDocs(attendeesCol(db, sid)),
  ]);
  const slides = new Map(slidesSnap.docs.map((d) => [d.id, d.data()]));
  const voteOf = new Map(); // `${slideId}:${cedula}` -> optionId

  const polls = await Promise.all(
    pollsSnap.docs.map(async (d) => {
      const poll = toPoll(d);
      const votes = (await getDocs(votesCol(db, sid, d.id))).docs;
      for (const v of votes) voteOf.set(`${d.id}:${v.id}`, v.data().optionId);
      const slide = slides.get(d.id);
      return {
        ...tally(poll, votes.map((v) => v.data())),
        title: poll.title,
        body: poll.body,
        question: poll.question,
        style: poll.style,
        resultsVisible: poll.resultsVisible,
        slidePosition: slide && !slide.deleted ? slide.position : null,
        slideDeleted: !slide || !!slide.deleted,
      };
    }),
  );
  polls.sort((a, b) => (a.slidePosition ?? 1e9) - (b.slidePosition ?? 1e9));

  const attendees = attendeesSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0))
    .map((a) => ({
      id: a.id,
      name: a.name,
      cedula: a.cedula,
      email: a.email,
      registeredAt: a.createdAt?.toDate?.().toISOString() ?? null,
    }));

  return {
    session,
    presentation: { id: session.presentationId, title: session.presentationTitle },
    attendeeCount: attendees.length,
    attendees,
    polls,
    voteOf: (slideId, cedula) => voteOf.get(`${slideId}:${cedula}`),
  };
}
