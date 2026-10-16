// The editable slides: simposio_leucemias_2026/presentacion { slides, optionIds, imagenes, updatedAt }.
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { DEFAULT_SLIDES, ROOT } from '../simposio.js';
import { normalizeSlides } from './model.js';

export const presentacionRef = (db) => doc(db, ROOT, 'presentacion');
const sesionRef = (db, sid) => doc(db, ROOT, 'evento', 'sesiones', sid);

/** slideId → option ids (kept next to the slides so rules or tools can validate votes cheaply). */
const optionIdsOf = (slides) => Object.fromEntries(slides.map((s) => [s.id, s.options.map((o) => o.id)]));

const fromSnap = (snap) =>
  snap.exists() && Array.isArray(snap.data().slides) && snap.data().slides.length
    ? { slides: snap.data().slides, imagenes: snap.data().imagenes ?? [], saved: true }
    : { slides: DEFAULT_SLIDES, imagenes: [], saved: false };

export async function getPresentacion(db) {
  return fromSnap(await getDoc(presentacionRef(db)));
}

/** Live slides; falls back to the built-in ones until the presentation is first saved. */
export function subscribePresentacion(db, onChange, onError = console.error) {
  return onSnapshot(presentacionRef(db), (snap) => onChange(fromSnap(snap)), onError);
}

/**
 * Saves the presentation. While a session is live its snapshot is updated too, so the saved results of
 * every session always show the questions as they were asked.
 */
export async function savePresentacion(db, slides, { imagenes, evento } = {}) {
  const clean = normalizeSlides(slides);
  const batch = writeBatch(db);
  const data = { slides: clean, optionIds: optionIdsOf(clean), updatedAt: serverTimestamp() };
  if (imagenes) data.imagenes = imagenes;
  batch.set(presentacionRef(db), data, { merge: true });
  if (evento?.status === 'live' && evento.sessionId) batch.update(sesionRef(db, evento.sessionId), { slides: clean });
  await batch.commit();
  return clean;
}

/** Writes the built-in slides the first time an admin opens the app. */
export async function ensurePresentacion(db) {
  const current = await getPresentacion(db);
  if (!current.saved) {
    await setDoc(presentacionRef(db), {
      slides: DEFAULT_SLIDES,
      optionIds: optionIdsOf(DEFAULT_SLIDES),
      imagenes: [],
      updatedAt: serverTimestamp(),
    });
  }
}

export const restoreDefaults = (db, evento) => savePresentacion(db, DEFAULT_SLIDES, { evento });
