import { letter } from '../letter.js';
import { stripRich } from '../rich-text.js';

// Semicolon-separated with a UTF-8 BOM so Excel (es-CO locale) opens it with accents and columns intact.
const SEP = ';';
const BOM = '﻿';

function cell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const toCsv = (rows) => BOM + rows.map((r) => r.map(cell).join(SEP)).join('\r\n') + '\r\n';

const localTime = (iso) => (iso ? new Date(iso).toLocaleString('es-CO', { timeZone: 'America/Bogota' }) : '');

const pollLabel = (p) => `Diap. ${p.slidePosition === null ? '?' : p.slidePosition + 1}${p.title ? ` · ${stripRich(p.title)}` : ''}`;

/** One row per poll option with counts and percentages. */
export function resultsCsv(report) {
  const rows = [['Diapositiva', 'Título', 'Pregunta', 'Opción', 'Texto', 'Votos', '%', 'Total votos', 'pollInstanceId']];
  for (const p of report.polls) {
    p.options.forEach((o, i) => {
      rows.push([
        p.slidePosition === null ? '' : p.slidePosition + 1,
        stripRich(p.title),
        stripRich(p.question),
        letter(i),
        stripRich(o.text),
        o.votes,
        p.total ? ((o.votes / p.total) * 100).toFixed(1).replace('.', ',') : '0',
        p.total,
        p.pollInstanceId,
      ]);
    });
  }
  return toCsv(rows);
}

/** One row per registered attendee, one column per poll with the chosen option. */
export function attendeesCsv(report) {
  const header = ['Nombre', 'Cédula', 'Correo', 'Fecha de registro', ...report.polls.map(pollLabel)];
  const rows = report.attendees.map((a) => [
    a.name,
    a.cedula,
    a.email,
    localTime(a.registeredAt),
    ...report.polls.map((p) => {
      const optionId = report.voteOf(p.slideId, a.cedula);
      const i = p.options.findIndex((o) => o.id === optionId);
      return i < 0 ? '' : `${letter(i)}. ${stripRich(p.options[i].text)}`;
    }),
  ]);
  return toCsv([header, ...rows]);
}

/** Triggers a browser download of `text` as `filename`. */
export function downloadText(filename, text, type = 'text/csv;charset=utf-8') {
  const href = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}
