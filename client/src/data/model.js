// Pure helpers shared by the data layer (no Firebase imports).

export class AppError extends Error {}

export const randomId = (length = 8) => {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
};

// ── Slides ─────────────────────────────────────────────────────────────────

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 10;
const CHARTS = ['bar', 'column', 'pie', 'donut'];
const POSITIONS = ['right', 'left', 'top', 'bottom'];
const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};
const color = (value, fallback) => (/^#[0-9a-f]{3,8}$/i.test(String(value)) ? String(value) : fallback);

/** Relative paths, http(s) URLs (e.g. Firebase Storage) or embedded images (local development). */
export function validImageUrl(url) {
  const s = String(url ?? '').trim();
  return /^(\/|https?:\/\/)[\w\-./:%?=&~+@,!]*$/.test(s) || /^data:image\/(png|jpe?g|webp|gif);base64,[\w+/=]+$/.test(s);
}

function slideStyle(style = {}) {
  const image = String(style.backgroundImage ?? '').trim();
  if (image && !validImageUrl(image)) throw new AppError('La imagen de fondo no es válida');
  return {
    background: color(style.background, '#ffffff'),
    textColor: color(style.textColor, '#123f47'),
    accent: color(style.accent, '#2aa3b3'),
    chartType: CHARTS.includes(style.chartType) ? style.chartType : 'bar',
    backgroundImage: image,
    overlay: clamp(style.overlay, 0, 0.85, 0),
    contentTop: clamp(style.contentTop, 0, 50, 0),
    textScale: clamp(style.textScale, 0.6, 1.6, 1),
  };
}

function slideImage(image) {
  if (!image?.url) return null;
  if (!validImageUrl(image.url)) throw new AppError('La imagen de la diapositiva no es válida');
  return {
    url: String(image.url).trim(),
    position: POSITIONS.includes(image.position) ? image.position : 'right',
    size: clamp(image.size, 15, 60, 35),
  };
}

/**
 * Validates and normalises the whole presentation. Option ids are kept (votes reference them) and new
 * options get fresh ids; letters A, B, C… are always derived from the order.
 */
export function normalizeSlides(slides) {
  if (!Array.isArray(slides) || slides.length === 0) throw new AppError('La presentación necesita al menos una diapositiva');
  const ids = new Set();
  return slides.map((s, i) => {
    const id = typeof s.id === 'string' && /^[\w-]{1,40}$/.test(s.id) && !ids.has(s.id) ? s.id : randomId(10);
    ids.add(id);
    const type = s.type === 'content' ? 'content' : 'poll';
    const optionIds = new Set();
    const options =
      type === 'poll'
        ? (s.options ?? [])
            .map((o) => ({ id: o.id, text: String(o.text ?? '').trim() }))
            .filter((o) => o.text)
            .map((o) => {
              const oid = typeof o.id === 'string' && /^[\w-]{1,20}$/.test(o.id) && !optionIds.has(o.id) ? o.id : randomId(6);
              optionIds.add(oid);
              return { id: oid, text: o.text };
            })
        : [];
    if (type === 'poll' && options.length < MIN_OPTIONS) {
      throw new AppError(`La diapositiva ${i + 1} necesita al menos ${MIN_OPTIONS} opciones con texto`);
    }
    if (options.length > MAX_OPTIONS) throw new AppError(`La diapositiva ${i + 1} tiene más de ${MAX_OPTIONS} opciones`);
    return {
      id,
      type,
      title: String(s.title ?? '').trim(),
      body: String(s.body ?? ''),
      question: String(s.question ?? '').trim(),
      options,
      style: slideStyle(s.style),
      image: slideImage(s.image),
    };
  });
}

// ── Registration ───────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Validates the registration form; returns { nombre, cedula, correo }. */
export function normalizeAttendee({ nombre, cedula, correo, consentimiento } = {}) {
  const out = {
    nombre: String(nombre ?? '').trim().replace(/\s+/g, ' '),
    cedula: String(cedula ?? '').replace(/[\s.\-]/g, ''),
    correo: String(correo ?? '').trim().toLowerCase(),
  };
  if (out.nombre.length < 3 || out.nombre.length > 120) throw new AppError('Escribe tu nombre completo.');
  if (!/^\d{5,15}$/.test(out.cedula)) throw new AppError('La cédula debe tener solo números (5 a 15 dígitos).');
  if (!EMAIL_RE.test(out.correo) || out.correo.length > 160) throw new AppError('El correo no es válido.');
  if (consentimiento !== true) throw new AppError('Debes autorizar el tratamiento de tus datos personales.');
  return out;
}

/** Vote counts of one poll from its votes ({ opcion }[]). */
export function tally(sessionId, poll, votes) {
  const byOption = {};
  for (const v of votes) byOption[v.opcion] = (byOption[v.opcion] ?? 0) + 1;
  const options = poll.options.map((o) => ({ ...o, votes: byOption[o.id] ?? 0 }));
  return {
    sessionId,
    slideId: poll.id,
    pollInstanceId: `${sessionId}:${poll.id}`,
    total: options.reduce((sum, o) => sum + o.votes, 0),
    options,
  };
}

/** Compact form of a tally that the audience can read: { total, counts: { A: n, … } }. */
export const publicResults = (t) => ({
  total: t.total,
  counts: Object.fromEntries(t.options.map((o) => [o.id, o.votes])),
});

/** Re-attaches option texts to published results. */
export const withOptions = (poll, results) => ({
  slideId: poll.id,
  total: results.total,
  options: poll.options.map((o) => ({ ...o, votes: results.counts?.[o.id] ?? 0 })),
});
