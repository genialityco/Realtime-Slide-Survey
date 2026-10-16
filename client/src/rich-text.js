// Inline formatting markers for slide texts: **bold**, *italic*, ==highlight== (no JSX: usable from Node too).

export const FORMATS = {
  bold: { marker: '**', label: 'Negrita' },
  italic: { marker: '*', label: 'Cursiva' },
  highlight: { marker: '==', label: 'Resaltado' },
};

/** Plain text without formatting markers (CSV exports, thumbnails, titles). */
export function stripRich(text) {
  let s = String(text ?? '');
  for (let n = 0; n < 4; n++) {
    const next = s
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*(?!\*)/g, '$1')
      .replace(/==(?=\S)([\s\S]*?\S)==/g, '$1')
      .replace(/\*(?=[^\s*])([^*]*?[^\s*]|[^\s*])\*/g, '$1');
    if (next === s) break;
    s = next;
  }
  return s;
}

/**
 * Toggles `marker` around the selection [start, end) of `value`. Returns { value, start, end } with the
 * selection adjusted to keep covering the same text. Without a selection, inserts a placeholder.
 */
export function toggleFormat(value, start, end, marker) {
  const m = marker.length;
  const selected = value.slice(start, end);
  // Already wrapped just outside the selection → unwrap.
  if (start >= m && value.slice(start - m, start) === marker && value.slice(end, end + m) === marker) {
    return { value: value.slice(0, start - m) + selected + value.slice(end + m), start: start - m, end: end - m };
  }
  // Selection includes the markers → unwrap.
  if (selected.length > 2 * m && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(m, -m);
    return { value: value.slice(0, start) + inner + value.slice(end), start, end: start + inner.length };
  }
  // Keep surrounding spaces outside the markers ("**word** " instead of "**word **").
  const lead = selected.length - selected.trimStart().length;
  const trail = selected.length - selected.trimEnd().length;
  const core = selected.trim() || 'texto';
  const s = start + lead;
  const e = end - trail;
  const wrapped = `${marker}${core}${marker}`;
  const before = value.slice(0, s);
  const after = value.slice(selected.trim() ? e : end);
  return { value: before + wrapped + after, start: s + m, end: s + m + core.length };
}
