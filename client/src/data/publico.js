// Audience side: one-time registration per phone, following the projected slide, voting.
import { doc, getDoc, onSnapshot, runTransaction, serverTimestamp, writeBatch } from 'firebase/firestore';
import { ROOT, slideById } from '../simposio.js';
import { AppError, normalizeAttendee, withOptions } from './model.js';

const asistenteRef = (db, cedula) => doc(db, ROOT, 'evento', 'asistentes', cedula);
const dispositivoRef = (db, uid) => doc(db, ROOT, 'evento', 'dispositivos', uid);
const votoRef = (db, sid, slideId, cedula) => doc(db, ROOT, 'evento', 'sesiones', sid, 'votos', `${slideId}__${cedula}`);

const isDenied = (err) => err?.code === 'permission-denied';

/** The registration held by this phone (anonymous uid), or null: the form is shown only once. */
export async function myRegistration(db, uid) {
  try {
    const snap = await getDoc(dispositivoRef(db, uid));
    return snap.exists() ? snap.data() : null;
  } catch (err) {
    if (isDenied(err)) return null;
    throw err;
  }
}

/**
 * Registers this phone. Registering again with the same cédula (e.g. from another phone) takes that
 * registration over and keeps its votes.
 */
export async function register(db, uid, form) {
  const data = normalizeAttendee(form);
  const fields = { ...data, uid, consentimiento: true, updatedAt: serverTimestamp() };
  const device = { cedula: data.cedula, nombre: data.nombre };

  // With protective rules, attendees cannot read others' registrations: try "new registration" first,
  // and fall back to taking the existing one over. With open rules the first write simply succeeds.
  const first = writeBatch(db);
  first.set(asistenteRef(db, data.cedula), { ...fields, createdAt: serverTimestamp() });
  first.set(dispositivoRef(db, uid), device);
  try {
    await first.commit();
  } catch (err) {
    if (!isDenied(err)) throw err;
    const takeOver = writeBatch(db);
    takeOver.update(asistenteRef(db, data.cedula), fields);
    takeOver.set(dispositivoRef(db, uid), device);
    try {
      await takeOver.commit();
    } catch (err2) {
      if (isDenied(err2)) throw new AppError('No se pudo completar el registro. Verifica tus datos.');
      throw err2;
    }
  }
  return device;
}

/**
 * Follows the projected slide. Listens to `evento` (one document carries the slide, its visibility and
 * published results) plus this person's vote on the current poll.
 * onChange({ status, sessionId, slide, resultsVisible, results, myVote, myVoteLoaded })
 */
export function subscribe(db, cedula, onChange, onError = console.error) {
  let evento = null;
  let myVote = null;
  let myVoteLoaded = false;
  let voteKey = null;
  let voteUnsub = null;

  const emit = () => {
    if (!evento) return;
    const slide = evento.status === 'live' ? slideById(evento.slideId) : null;
    const isPoll = slide?.type === 'poll';
    onChange({
      status: evento.status ?? 'idle',
      sessionId: evento.sessionId ?? null,
      slide,
      resultsVisible: isPoll && !!evento.resultsVisible,
      results: isPoll && evento.resultsVisible && evento.results ? withOptions(slide, evento.results) : null,
      myVote: isPoll ? myVote : null,
      myVoteLoaded: isPoll ? myVoteLoaded : true,
    });
  };

  const followVote = (sid, slideId) => {
    const key = sid && slideId ? `${sid}/${slideId}` : null;
    if (key === voteKey) return;
    voteUnsub?.();
    voteUnsub = null;
    voteKey = key;
    myVote = null;
    myVoteLoaded = !key;
    if (!key) return;
    voteUnsub = onSnapshot(
      votoRef(db, sid, slideId, cedula),
      (s) => {
        myVote = s.exists() ? s.data().opcion : null;
        myVoteLoaded = true;
        emit();
      },
      onError,
    );
  };

  const unsubEvento = onSnapshot(
    doc(db, ROOT, 'evento'),
    (s) => {
      evento = s.exists() ? s.data() : { status: 'idle' };
      const slide = evento.status === 'live' ? slideById(evento.slideId) : null;
      followVote(evento.sessionId, slide?.type === 'poll' ? slide.id : null);
      emit();
    },
    onError,
  );

  return () => {
    unsubEvento();
    voteUnsub?.();
  };
}

/**
 * Casts a vote atomically: only while that question is projected in that session, and only once.
 * (The project's Firestore rules are open, so these checks run here, inside a transaction.)
 */
export async function vote(db, uid, sid, slideId, cedula, opcion) {
  const closed = 'No se registró el voto: la pregunta ya se cerró.';
  try {
    await runTransaction(db, async (tx) => {
      const [evento, existing] = await Promise.all([
        tx.get(doc(db, ROOT, 'evento')),
        tx.get(votoRef(db, sid, slideId, cedula)),
      ]);
      const e = evento.data();
      if (!e || e.status !== 'live' || e.sessionId !== sid || e.slideId !== slideId) throw new AppError(closed);
      if (!slideById(slideId)?.options?.some((o) => o.id === opcion)) throw new AppError('Opción no válida.');
      if (existing.exists()) throw new AppError('Ya habías votado en esta pregunta.');
      tx.set(votoRef(db, sid, slideId, cedula), { slideId, cedula, opcion, uid, createdAt: serverTimestamp() });
    });
  } catch (err) {
    if (isDenied(err)) throw new AppError(`${closed} (o ya habías votado)`);
    throw err;
  }
}
