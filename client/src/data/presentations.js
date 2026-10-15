// Admin operations on presentations and slides. Every function takes the Firestore instance first.
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { AppError, clampIndex, normalizeOptions, reorder, slideFields } from './model.js';

const presentationsCol = (db) => collection(db, 'presentations');
const slidesCol = (db, pid) => collection(db, 'presentations', pid, 'slides');
const slideRef = (db, pid, slideId) => doc(db, 'presentations', pid, 'slides', slideId);

const toSlide = (pid) => (snap) => ({ id: snap.id, presentationId: pid, ...snap.data() });

/** Live (non-deleted) slides ordered by position. */
export async function listSlides(db, pid) {
  const snap = await getDocs(slidesCol(db, pid));
  return snap.docs
    .map(toSlide(pid))
    .filter((s) => !s.deleted)
    .sort((a, b) => a.position - b.position);
}

async function getSlide(db, pid, slideId) {
  const snap = await getDoc(slideRef(db, pid, slideId));
  if (!snap.exists() || snap.data().deleted) throw new AppError('Diapositiva no encontrada');
  return toSlide(pid)(snap);
}

/** Rewrites positions 0..n-1 following `orderedIds` inside `batch` (only where they changed). */
function writeOrder(batch, db, pid, orderedIds, current = new Map()) {
  orderedIds.forEach((id, i) => {
    if (current.get(id) !== i) batch.update(slideRef(db, pid, id), { position: i });
  });
}

const positions = (slides) => new Map(slides.map((s) => [s.id, s.position]));

// ── Presentations ──────────────────────────────────────────────────────────

export async function listPresentations(db) {
  const snap = await getDocs(presentationsCol(db));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
}

export async function createPresentation(db, title) {
  const ref = await addDoc(presentationsCol(db), {
    title: String(title || 'Nueva presentación').trim(),
    createdAt: serverTimestamp(),
  });
  return getPresentation(db, ref.id);
}

export async function getPresentation(db, pid) {
  const snap = await getDoc(doc(db, 'presentations', pid));
  if (!snap.exists()) throw new AppError('Presentación no encontrada');
  return { id: snap.id, ...snap.data(), slides: await listSlides(db, pid) };
}

export async function renamePresentation(db, pid, title) {
  await updateDoc(doc(db, 'presentations', pid), { title: String(title).trim() });
  return getPresentation(db, pid);
}

// ── Slides ─────────────────────────────────────────────────────────────────

/** Inserts slide data at `position` (0-based, default: end) and reindexes the rest. */
async function insertSlideAt(db, pid, data, position) {
  const slides = await listSlides(db, pid);
  const ids = slides.map((s) => s.id);
  const ref = doc(slidesCol(db, pid));
  const index = clampIndex(position, ids.length);
  ids.splice(index, 0, ref.id);

  const current = positions(slides);
  current.set(ref.id, index); // the new doc is written with its final position below
  const batch = writeBatch(db);
  batch.set(ref, { ...data, position: index, deleted: false, createdAt: serverTimestamp() });
  writeOrder(batch, db, pid, ids, current);
  await batch.commit();
  return getSlide(db, pid, ref.id);
}

export async function addSlide(db, pid, input = {}) {
  const type = input.type === 'content' ? 'content' : 'poll';
  const defaults =
    type === 'poll' ? { question: 'Nueva pregunta', options: ['Opción A', 'Opción B'] } : { question: 'Título', body: '' };
  const fields = slideFields(type, { ...defaults, ...input });
  return insertSlideAt(db, pid, { ...fields, type, sourceSlideId: null }, input.position);
}

export async function updateSlide(db, pid, slideId, patch = {}) {
  const current = await getSlide(db, pid, slideId);
  const fields = slideFields(current.type, {
    title: patch.title ?? current.title,
    question: patch.question ?? current.question,
    body: patch.body ?? current.body,
    options: patch.options ?? current.options,
    style: { ...current.style, ...(patch.style ?? {}) },
  });
  await updateDoc(slideRef(db, pid, slideId), fields);
  return getSlide(db, pid, slideId);
}

/**
 * Copies title, case text, question, options and visual config into a new slide with its own id
 * (option ids are regenerated too). Defaults to right after the original.
 */
export async function duplicateSlide(db, pid, slideId, position) {
  const original = await getSlide(db, pid, slideId);
  const ids = (await listSlides(db, pid)).map((s) => s.id);
  const data = {
    type: original.type,
    title: original.title ?? '',
    question: original.question,
    body: original.body ?? '',
    options: normalizeOptions(original.options, { keepIds: false }),
    style: original.style,
    sourceSlideId: original.id,
  };
  return insertSlideAt(db, pid, data, position ?? ids.indexOf(original.id) + 1);
}

export async function moveSlide(db, pid, slideId, position) {
  const slides = await listSlides(db, pid);
  const batch = writeBatch(db);
  writeOrder(batch, db, pid, reorder(slides.map((s) => s.id), slideId, position), positions(slides));
  await batch.commit();
  return getPresentation(db, pid);
}

/** Soft delete, so past sessions keep a valid reference to the slide. */
export async function deleteSlide(db, pid, slideId) {
  const slides = await listSlides(db, pid);
  const batch = writeBatch(db);
  batch.update(slideRef(db, pid, slideId), { deleted: true });
  writeOrder(batch, db, pid, slides.map((s) => s.id).filter((id) => id !== slideId), positions(slides));
  await batch.commit();
  return getPresentation(db, pid);
}
