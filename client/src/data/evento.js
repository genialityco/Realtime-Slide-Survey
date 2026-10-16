// Admin side: drive the live event. Everything lives under simposio_leucemias_2026 (see firestore.rules).
import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { ROOT } from '../simposio.js';
import { publicResults, randomId, tally } from './model.js';
import { getPresentacion, presentacionRef } from './presentacion.js';

export const eventoRef = (db) => doc(db, ROOT, 'evento');
const adminsRef = (db) => doc(db, ROOT, 'admins');
const sesionRef = (db, sid) => doc(db, ROOT, 'evento', 'sesiones', sid);
const sesionesCol = (db) => collection(db, ROOT, 'evento', 'sesiones');
const votosCol = (db, sid) => collection(db, ROOT, 'evento', 'sesiones', sid, 'votos');
const asistentesCol = (db) => collection(db, ROOT, 'evento', 'asistentes');

export async function isAdmin(db, uid) {
  try {
    const snap = await getDoc(adminsRef(db));
    return snap.exists() && (snap.data().uids ?? []).includes(uid);
  } catch {
    return false;
  }
}

/**
 * Starts a new run (e.g. "Ensayo", "Día 1"). Votes are stored per session, so runs never mix.
 * A live session, if any, is ended first.
 */
export async function startSession(db, label, current) {
  const { slides } = await getPresentacion(db);
  const sid = `${new Date().toISOString().slice(0, 10)}-${randomId(6)}`;
  const batch = writeBatch(db);
  if (current?.status === 'live' && current.sessionId) {
    batch.update(sesionRef(db, current.sessionId), { status: 'ended', endedAt: serverTimestamp() });
  }
  batch.set(sesionRef(db, sid), {
    label: String(label || 'Sesión').trim(),
    status: 'live',
    startedAt: serverTimestamp(),
    endedAt: null,
    slides, // snapshot: saved results always show the questions as asked
  });
  batch.set(eventoRef(db), {
    sessionId: sid,
    sessionLabel: String(label || 'Sesión').trim(),
    status: 'live',
    slideId: slides[0].id,
    qrMode: 'large',
    resultsVisible: false,
    results: null,
    visible: {},
    published: {},
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
  return sid;
}

/**
 * Moves everyone to `slideId` with a single write to `evento` (the only document phones listen to),
 * carrying that slide's visibility and last published results so phones need nothing else.
 */
export function goToSlide(db, evento, slideId) {
  return updateDoc(eventoRef(db), {
    slideId,
    resultsVisible: !!evento.visible?.[slideId],
    results: evento.published?.[slideId] ?? null,
    updatedAt: serverTimestamp(),
  });
}

/** Shows/hides the current poll's results, publishing `results` (a tally) with them. */
export function setResultsVisible(db, evento, visible, results) {
  const patch = { resultsVisible: !!visible, [`visible.${evento.slideId}`]: !!visible, updatedAt: serverTimestamp() };
  if (results) {
    patch.results = publicResults(results);
    patch[`published.${evento.slideId}`] = patch.results;
  }
  return updateDoc(eventoRef(db), patch);
}

/** Publishes counts for the audience (they cannot read votes). */
export function publishResults(db, evento, results) {
  const r = publicResults(results);
  const patch = { [`published.${results.slideId}`]: r };
  if (evento.slideId === results.slideId) patch.results = r;
  return updateDoc(eventoRef(db), patch);
}

/** QR on the projector: 'large' (big, right half — before starting), 'small' (top-right corner) or 'hidden'. */
export const QR_MODES = ['large', 'small', 'hidden'];

/** Current QR mode, also for sessions saved with the old boolean `showQr`. */
export const qrModeOf = (evento) => evento.qrMode ?? (evento.showQr === false ? 'hidden' : 'small');

export const setQrMode = (db, mode) => updateDoc(eventoRef(db), { qrMode: mode });

/** Clears the projection: hides the QR and the current question's results (only the slide remains). */
export const hideAll = (db, evento) =>
  updateDoc(eventoRef(db), {
    qrMode: 'hidden',
    resultsVisible: false,
    [`visible.${evento.slideId}`]: false,
    updatedAt: serverTimestamp(),
  });

export async function endSession(db, evento) {
  const batch = writeBatch(db);
  batch.update(sesionRef(db, evento.sessionId), { status: 'ended', endedAt: serverTimestamp() });
  batch.update(eventoRef(db), { status: 'ended', qrMode: 'hidden', updatedAt: serverTimestamp() });
  await batch.commit();
}

export async function listSessions(db) {
  const snap = await getDocs(sesionesCol(db));
  const sessions = await Promise.all(
    snap.docs.map(async (d) => ({
      id: d.id,
      ...d.data(),
      votes: (await getCountFromServer(votosCol(db, d.id))).data().count,
    })),
  );
  return sessions.sort((a, b) => (b.startedAt?.toMillis?.() ?? 0) - (a.startedAt?.toMillis?.() ?? 0));
}

const pollMeta = (poll) => ({ title: poll.title, body: poll.body, question: poll.question, style: poll.style });

/**
 * Live admin view: `evento`, per-poll tallies of the current session (from the votes) and registrations.
 * Calls onChange({ evento, polls, attendeeCount }); returns an unsubscribe function.
 */
export function subscribeAdmin(db, onChange, onError = console.error) {
  let evento = null;
  let slides = null;
  let votes = [];
  let attendeeCount = 0;
  let votesSid = null;
  let votesUnsub = null;

  const emit = () => {
    if (!evento || !slides) return;
    const sid = evento.sessionId;
    const polls = slides.filter((s) => s.type === 'poll').map((p) => ({
      ...tally(sid, p, votes.filter((v) => v.slideId === p.id)),
      ...pollMeta(p),
      resultsVisible: !!evento.visible?.[p.id],
      published: evento.published?.[p.id] ?? null,
    }));
    onChange({ evento, slides, polls, attendeeCount });
  };

  const unsubEvento = onSnapshot(
    eventoRef(db),
    (snap) => {
      evento = snap.exists() ? snap.data() : { status: 'idle', sessionId: null, slideId: null };
      if (evento.sessionId !== votesSid) {
        votesUnsub?.();
        votes = [];
        votesSid = evento.sessionId;
        votesUnsub = votesSid
          ? onSnapshot(
              votosCol(db, votesSid),
              (s) => {
                votes = s.docs.map((d) => d.data());
                emit();
              },
              onError,
            )
          : null;
      }
      emit();
    },
    onError,
  );

  const unsubPresentacion = onSnapshot(
    presentacionRef(db),
    (snap) => {
      slides = snap.exists() && snap.data().slides?.length ? snap.data().slides : null;
      if (!slides) getPresentacion(db).then((p) => ((slides = p.slides), emit()), onError);
      emit();
    },
    onError,
  );

  const unsubAsistentes = onSnapshot(
    asistentesCol(db),
    (s) => {
      attendeeCount = s.size;
      emit();
    },
    onError,
  );

  return () => {
    unsubEvento();
    unsubPresentacion();
    unsubAsistentes();
    votesUnsub?.();
  };
}

/** Persisted results of one session, the registered attendees and each one's answers. */
export async function sessionReport(db, sid) {
  const [sesion, votosSnap, asistentesSnap, presentacion] = await Promise.all([
    getDoc(sesionRef(db, sid)),
    getDocs(votosCol(db, sid)),
    getDocs(asistentesCol(db)),
    getPresentacion(db),
  ]);
  const slides = sesion.data()?.slides ?? presentacion.slides; // as asked in that session
  const votes = votosSnap.docs.map((d) => d.data());
  const voteOf = new Map(votes.map((v) => [`${v.slideId}:${v.cedula}`, v.opcion]));
  const polls = slides
    .map((p, position) => ({ p, position }))
    .filter(({ p }) => p.type === 'poll')
    .map(({ p, position }) => ({
      ...tally(sid, p, votes.filter((v) => v.slideId === p.id)),
      ...pollMeta(p),
      slidePosition: position,
    }));
  const attendees = asistentesSnap.docs
    .map((d) => d.data())
    .sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0))
    .map((a) => ({
      name: a.nombre,
      cedula: a.cedula,
      email: a.correo,
      registeredAt: a.createdAt?.toDate?.().toISOString() ?? null,
    }));
  const { slides: _snapshot, ...session } = sesion.data() ?? {};
  return {
    session: { id: sid, ...session },
    attendees,
    attendeeCount: attendees.length,
    polls,
    voteOf: (slideId, cedula) => voteOf.get(`${slideId}:${cedula}`),
  };
}

/** One-time setup (or adding an admin) from a trusted context, e.g. the emulator script. */
export const setAdmins = (db, uids) => setDoc(adminsRef(db), { uids });
