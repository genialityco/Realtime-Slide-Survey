// Per-browser state and URLs.

function storage(fn, fallback = null) {
  try {
    return fn(localStorage);
  } catch {
    return fallback;
  }
}

/** The registration made from this browser for a given session ({ cedula, name }). */
export const attendeeStore = {
  get: (sessionId) => storage((s) => JSON.parse(s.getItem(`rss.attendee.${sessionId}`) || 'null')),
  set: (sessionId, attendee) => storage((s) => s.setItem(`rss.attendee.${sessionId}`, JSON.stringify(attendee))),
  clear: (sessionId) => storage((s) => s.removeItem(`rss.attendee.${sessionId}`)),
};

/** URL the audience opens (VITE_PUBLIC_URL when set, else this site). */
export function joinUrl(code) {
  const base = import.meta.env.VITE_PUBLIC_URL || location.origin;
  return `${base.replace(/\/$/, '')}/join/${code}`;
}

/** Formats a Firestore Timestamp (or ISO string) for display; '' when not set yet. */
export function formatDate(value) {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  return date ? date.toLocaleString('es-CO') : '';
}
