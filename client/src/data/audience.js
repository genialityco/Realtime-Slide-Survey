// Audience side: find a session by code, register, follow the current slide, vote.
import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { AppError, normalizeAttendee } from './model.js';

const isDenied = (err) => err?.code === 'permission-denied';

export async function findLiveSession(db, code) {
  const snap = await getDocs(
    query(
      collection(db, 'sessions'),
      where('code', '==', String(code).trim().toUpperCase()),
      where('status', '==', 'live'),
      limit(1),
    ),
  );
  if (snap.empty) throw new AppError('El código no es válido o la sesión ya terminó.');
  const d = snap.docs[0];
  return { sessionId: d.id, code: d.data().code, title: d.data().presentationTitle, cover: d.data().cover };
}

/**
 * Registers the signed-in (anonymous) user for the session. Registering again with the same cédula
 * — e.g. from another phone — takes over that registration and keeps its votes.
 */
export async function registerAttendee(db, uid, sid, form) {
  const data = normalizeAttendee(form);
  const ref = doc(db, 'sessions', sid, 'attendees', data.cedula);
  const fields = { ...data, uid, consent: true, updatedAt: serverTimestamp() };
  try {
    await setDoc(ref, { ...fields, createdAt: serverTimestamp() }); // first registration
  } catch (err) {
    if (!isDenied(err)) throw err;
    try {
      await updateDoc(ref, fields); // already registered: take it over
    } catch (err2) {
      if (isDenied(err2)) throw new AppError('No se pudo completar el registro. Verifica tus datos o que la sesión siga activa.');
      throw err2;
    }
  }
  return { cedula: data.cedula, name: data.name };
}

/**
 * Follows what the audience should see. Calls `onChange({ status, slide, poll })`, where `poll` has
 * `{ pollInstanceId, resultsVisible, results, myVote }`. Returns an unsubscribe function.
 */
export function subscribeAudience(db, sid, cedula, onChange, onError = console.error) {
  let session = null;
  let poll = null;
  let myVote = null;
  let pollKey = null;
  let pollUnsubs = [];

  const emit = () => {
    if (!session) return;
    const base = { sessionId: sid, status: session.status, showQr: session.showQr, slide: null, poll: null };
    const current = session.current;
    if (session.status !== 'live' || !current) return onChange(base);
    const slide = { id: current.slideId, ...current };
    if (current.type !== 'poll' || !poll || poll.slideId !== current.slideId) return onChange({ ...base, slide });
    onChange({
      ...base,
      slide,
      poll: {
        pollInstanceId: poll.pollInstanceId,
        resultsVisible: poll.resultsVisible,
        results: poll.resultsVisible && poll.results ? withOptions(poll, poll.results) : null,
        myVote,
      },
    });
  };

  const followPoll = (slideId) => {
    if (pollKey === slideId) return;
    pollUnsubs.forEach((u) => u());
    pollUnsubs = [];
    poll = null;
    myVote = null;
    pollKey = slideId;
    if (!slideId) return;
    pollUnsubs.push(
      onSnapshot(
        doc(db, 'sessions', sid, 'polls', slideId),
        (s) => {
          poll = s.exists() ? s.data() : null;
          emit();
        },
        onError,
      ),
      onSnapshot(
        doc(db, 'sessions', sid, 'polls', slideId, 'votes', cedula),
        (s) => {
          myVote = s.exists() ? s.data().optionId : null;
          emit();
        },
        onError,
      ),
    );
  };

  const unsubSession = onSnapshot(
    doc(db, 'sessions', sid),
    (s) => {
      session = s.exists() ? s.data() : null;
      const current = session?.status === 'live' ? session.current : null;
      followPoll(current?.type === 'poll' ? current.slideId : null);
      emit();
    },
    onError,
  );

  return () => {
    unsubSession();
    pollUnsubs.forEach((u) => u());
  };
}

const withOptions = (poll, results) => ({
  pollInstanceId: poll.pollInstanceId,
  total: results.total,
  options: poll.options.map((o) => ({ ...o, votes: results.counts?.[o.id] ?? 0 })),
});

export async function castVote(db, uid, sid, slideId, cedula, optionId) {
  try {
    await setDoc(doc(db, 'sessions', sid, 'polls', slideId, 'votes', cedula), {
      optionId,
      uid,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    if (isDenied(err)) {
      throw new AppError('No se pudo registrar el voto: ya votaste en esta pregunta o la pregunta ya no está activa.');
    }
    throw err;
  }
}
