import { io } from 'socket.io-client';

const ADMIN_KEY = 'rss.adminKey';

function storage(fn, fallback = null) {
  try {
    return fn(localStorage);
  } catch {
    return fallback;
  }
}

export const adminKey = {
  get: () => storage((s) => s.getItem(ADMIN_KEY)) ?? '',
  set: (key) => storage((s) => s.setItem(ADMIN_KEY, key)),
  clear: () => storage((s) => s.removeItem(ADMIN_KEY)),
};

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(method, url, body, { raw = false } = {}) {
  const headers = { 'x-admin-key': adminKey.get() };
  if (body && !raw) headers['Content-Type'] = 'application/json';
  if (raw) headers['Content-Type'] = body.type;
  const res = await fetch(`/api${url}`, { method, headers, body: raw ? body : body && JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event('rss:unauthorized'));
    throw new ApiError(res.status, data.error || res.statusText);
  }
  return data;
}

/** Downloads an admin-only file (sends the admin key, which a plain link cannot). */
async function download(url, filename) {
  const res = await fetch(`/api${url}`, { headers: { 'x-admin-key': adminKey.get() } });
  if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({}))).error || res.statusText);
  const href = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

export const api = {
  config: () => request('GET', '/config'),
  checkAdmin: () => request('GET', '/admin/check'),
  listPresentations: () => request('GET', '/presentations'),
  createPresentation: (title) => request('POST', '/presentations', { title }),
  getPresentation: (id) => request('GET', `/presentations/${id}`),
  renamePresentation: (id, title) => request('PATCH', `/presentations/${id}`, { title }),
  addSlide: (presentationId, slide) => request('POST', `/presentations/${presentationId}/slides`, slide),
  updateSlide: (id, patch) => request('PATCH', `/slides/${id}`, patch),
  deleteSlide: (id) => request('DELETE', `/slides/${id}`),
  duplicateSlide: (id, position) => request('POST', `/slides/${id}/duplicate`, { position }),
  moveSlide: (id, position) => request('POST', `/slides/${id}/move`, { position }),
  uploadImage: (file) => request('POST', '/media', file, { raw: true }),
  startSession: (presentationId) => request('POST', `/presentations/${presentationId}/sessions`),
  listSessions: (presentationId) => request('GET', `/presentations/${presentationId}/sessions`),
  sessionReport: (id) => request('GET', `/sessions/${id}/report`),
  exportResults: (id) => download(`/sessions/${id}/export/results.csv`, `resultados-${id}.csv`),
  exportAttendees: (id) => download(`/sessions/${id}/export/attendees.csv`, `asistentes-${id}.csv`),

  joinInfo: (code) => request('GET', `/join/${encodeURIComponent(code)}`),
  register: (code, data) => request('POST', `/join/${encodeURIComponent(code)}/register`, data),
};

export function createSocket({ admin = false } = {}) {
  return io({ transports: ['websocket', 'polling'], auth: admin ? { adminKey: adminKey.get() } : {} });
}

/** Emits with an ack and turns `{ ok, error }` into a promise. */
export function call(socket, event, payload) {
  return new Promise((resolve, reject) =>
    socket.timeout(15000).emit(event, payload, (err, r) => {
      if (err) return reject(new Error('Sin conexión con el servidor. Reintentando…'));
      if (r?.ok) return resolve(r.data);
      if (r?.status === 401) window.dispatchEvent(new Event('rss:unauthorized'));
      reject(new ApiError(r?.status, r?.error || 'error'));
    }),
  );
}

/** The attendee registered from this browser for a given session. */
export const attendeeStore = {
  get: (sessionId) => storage((s) => JSON.parse(s.getItem(`rss.attendee.${sessionId}`) || 'null')),
  set: (sessionId, attendee) => storage((s) => s.setItem(`rss.attendee.${sessionId}`, JSON.stringify(attendee))),
  clear: (sessionId) => storage((s) => s.removeItem(`rss.attendee.${sessionId}`)),
};

/** URL the audience should open (PUBLIC_URL when configured, else this origin). */
export async function joinUrl(code) {
  const { publicUrl } = await api.config().catch(() => ({}));
  return `${(publicUrl || location.origin).replace(/\/$/, '')}/join/${code}`;
}
