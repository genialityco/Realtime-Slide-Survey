// Pure helpers shared by the data layer (no Firebase imports).

export class AppError extends Error {}

export const randomId = (length = 8) => {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
};

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
