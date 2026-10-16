// Minimal inline formatting for slide texts: **bold**, *italic*, ==highlight== (nestable).
// Rendered as React elements (never as HTML), so texts cannot inject markup. Markers: see rich-text.js.

// Order matters: ** before *.
const TOKEN = /(\*\*(?=\S)[\s\S]*?\S\*\*(?!\*)|==(?=\S)[\s\S]*?\S==|\*(?=[^\s*])[^*]*?[^\s*]\*|\*[^\s*]\*)/;

function parse(text, key = 'r') {
  const out = [];
  let rest = text;
  let i = 0;
  while (rest) {
    const m = rest.match(TOKEN);
    if (!m) {
      out.push(rest);
      break;
    }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const token = m[0];
    const k = `${key}-${i++}`;
    if (token.startsWith('**')) out.push(<strong key={k}>{parse(token.slice(2, -2), k)}</strong>);
    else if (token.startsWith('==')) out.push(<mark key={k}>{parse(token.slice(2, -2), k)}</mark>);
    else out.push(<em key={k}>{parse(token.slice(1, -1), k)}</em>);
    rest = rest.slice(m.index + token.length);
  }
  return out;
}

/** Renders `text` with its inline formatting. */
export function Rich({ text }) {
  return <>{parse(String(text ?? ''))}</>;
}
