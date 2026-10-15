// Per-browser helpers and URLs.

/** URL the audience opens from the QR: the site root (VITE_PUBLIC_URL when set). */
export function joinUrl() {
  const base = import.meta.env.VITE_PUBLIC_URL || location.origin;
  return `${base.replace(/\/$/, '')}/`;
}

/** Cached registration of this phone, so the form never flashes for people already registered. */
export const registrationCache = {
  get(uid) {
    try {
      const v = JSON.parse(localStorage.getItem('rss.registro') || 'null');
      return v?.uid === uid ? v : null;
    } catch {
      return null;
    }
  },
  set(uid, registration) {
    try {
      localStorage.setItem('rss.registro', JSON.stringify({ ...registration, uid }));
    } catch {
      /* private mode: Firestore still remembers the device */
    }
  },
  clear() {
    try {
      localStorage.removeItem('rss.registro');
    } catch {
      /* ignore */
    }
  },
};

/** Formats a Firestore Timestamp (or ISO string) for display; '' when not set yet. */
export function formatDate(value) {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  return date ? date.toLocaleString('es-CO') : '';
}
