// Image uploads for slides: resized in the browser, stored in Firebase Storage under the symposium folder.
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from '../firebase.js';
import { ROOT } from '../simposio.js';
import { AppError, randomId } from './model.js';

const MAX_SIDE = 1920;
const MAX_BYTES = 15 * 1024 * 1024;

/** Downscales to at most 1920 px and re-encodes (JPEG, or PNG when it has transparency). */
async function resize(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.85));
  return { blob, type, width: canvas.width, height: canvas.height };
}

const toDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

/** Uploads an image and returns { url, name }. Without Storage (local emulators) it is embedded instead. */
export async function uploadImage(file) {
  if (!file?.type?.startsWith('image/')) throw new AppError('El archivo debe ser una imagen (JPG, PNG, WEBP…)');
  if (file.size > MAX_BYTES) throw new AppError('La imagen supera 15 MB');
  const { blob, type } = await resize(file);
  const name = file.name.replace(/\.[^.]+$/, '') || 'imagen';
  if (!storage) return { url: await toDataUrl(blob), name };
  const ext = type === 'image/png' ? 'png' : 'jpg';
  const objectRef = ref(storage, `${ROOT}/imagenes/${Date.now()}-${randomId(6)}.${ext}`);
  await uploadBytes(objectRef, blob, { contentType: type, cacheControl: 'public, max-age=31536000' });
  return { url: await getDownloadURL(objectRef), name };
}
