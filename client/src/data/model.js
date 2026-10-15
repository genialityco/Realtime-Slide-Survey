// Pure helpers shared by the data layer (no Firebase imports).

export class AppError extends Error {}

export const DEFAULT_STYLE = Object.freeze({
  background: '#1e1b4b',
  textColor: '#ffffff',
  accent: '#f59e0b',
  chartType: 'bar', // 'bar' (horizontal) | 'column'
  backgroundImage: '', // URL, e.g. /media/2.jpg
  overlay: 0, // 0..0.85 darkening layer between the image and the text
  contentTop: 0, // % of slide height kept clear at the top (e.g. a header baked into the image)
});

const MAX_OPTIONS = 10;

export const randomId = (length = 8) => {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
};

/** Join code: 6 unambiguous upper-case characters. */
export const joinCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => alphabet[b % alphabet.length]).join('');
};

export function normalizeOptions(options, { keepIds = true } = {}) {
  if (!Array.isArray(options)) throw new AppError('Las opciones deben ser una lista');
  const out = options
    .map((o) => (typeof o === 'string' ? { text: o } : o))
    .map((o) => ({
      id: keepIds && typeof o.id === 'string' && o.id ? o.id : randomId(),
      text: String(o.text ?? '').trim(),
    }))
    .filter((o) => o.text);
  if (out.length > MAX_OPTIONS) throw new AppError(`Máximo ${MAX_OPTIONS} opciones`);
  return out;
}

export function normalizeStyle(style) {
  const s = { ...DEFAULT_STYLE, ...(style && typeof style === 'object' ? style : {}) };
  if (!['bar', 'column'].includes(s.chartType)) s.chartType = DEFAULT_STYLE.chartType;
  const image = String(s.backgroundImage ?? '').trim();
  if (image && !/^(\/|https?:\/\/)[\w\-./:%?=&~+]*$/.test(image)) {
    throw new AppError('La URL de la imagen de fondo no es válida');
  }
  const overlay = Number(s.overlay);
  const contentTop = Number(s.contentTop);
  return {
    background: String(s.background),
    textColor: String(s.textColor),
    accent: String(s.accent),
    chartType: s.chartType,
    backgroundImage: image,
    overlay: Number.isFinite(overlay) ? Math.max(0, Math.min(0.85, overlay)) : 0,
    contentTop: Number.isFinite(contentTop) ? Math.max(0, Math.min(50, contentTop)) : 0,
  };
}

/** Validated slide fields as stored in Firestore. */
export function slideFields(type, input) {
  const options = type === 'poll' ? normalizeOptions(input.options ?? []) : [];
  if (type === 'poll' && options.length < 2) throw new AppError('Una encuesta necesita al menos 2 opciones');
  return {
    title: String(input.title ?? '').trim(),
    question: String(input.question ?? '').trim(),
    body: String(input.body ?? ''),
    options,
    style: normalizeStyle(input.style),
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeAttendee({ name, cedula, email, consent } = {}) {
  const out = {
    name: String(name ?? '').trim().replace(/\s+/g, ' '),
    cedula: String(cedula ?? '').replace(/[\s.\-]/g, ''),
    email: String(email ?? '').trim().toLowerCase(),
  };
  if (out.name.length < 3 || out.name.length > 120) throw new AppError('Escribe tu nombre completo.');
  if (!/^\d{5,15}$/.test(out.cedula)) throw new AppError('La cédula debe tener solo números (5 a 15 dígitos).');
  if (!EMAIL_RE.test(out.email) || out.email.length > 160) throw new AppError('El correo no es válido.');
  if (consent !== true) throw new AppError('Debes autorizar el tratamiento de tus datos personales.');
  return out;
}

/** Vote counts for a poll instance, from its votes ({ optionId }[]). */
export function tally(poll, votes) {
  const byOption = {};
  for (const v of votes) byOption[v.optionId] = (byOption[v.optionId] ?? 0) + 1;
  const options = poll.options.map((o) => ({ ...o, votes: byOption[o.id] ?? 0 }));
  return {
    sessionId: poll.sessionId,
    slideId: poll.slideId,
    pollInstanceId: poll.pollInstanceId,
    total: options.reduce((sum, o) => sum + o.votes, 0),
    options,
  };
}

/** Moves `id` to `index` within `ids` (clamped); returns the new order. */
export function reorder(ids, id, index) {
  const rest = ids.filter((x) => x !== id);
  const at = clampIndex(index, rest.length);
  rest.splice(at, 0, id);
  return rest;
}

export function clampIndex(position, length) {
  if (position === undefined || position === null) return length;
  const n = Number(position);
  if (!Number.isInteger(n)) throw new AppError('La posición debe ser un entero');
  return Math.max(0, Math.min(n, length));
}
