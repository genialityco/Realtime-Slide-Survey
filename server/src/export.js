import { letter } from './repo.js';

// Semicolon-separated with a UTF-8 BOM so Excel (es-CO locale) opens it with accents and columns intact.
const SEP = ';';
const BOM = '﻿';

function cell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const toCsv = (rows) => BOM + rows.map((r) => r.map(cell).join(SEP)).join('\r\n') + '\r\n';

const localTime = (iso) => (iso ? new Date(iso).toLocaleString('es-CO', { timeZone: 'America/Bogota' }) : '');

const pollLabel = (p) => `Diap. ${p.slidePosition === null ? '?' : p.slidePosition + 1}${p.title ? ` · ${p.title}` : ''}`;

/** One row per poll option with counts and percentages. */
export function resultsCsv(report) {
  const rows = [['Diapositiva', 'Título', 'Pregunta', 'Opción', 'Texto', 'Votos', '%', 'Total votos', 'pollInstanceId']];
  for (const p of report.polls) {
    p.options.forEach((o, i) => {
      rows.push([
        p.slidePosition === null ? '' : p.slidePosition + 1,
        p.title,
        p.question,
        letter(i),
        o.text,
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
export function attendeesCsv(data) {
  const header = ['Nombre', 'Cédula', 'Correo', 'Fecha de registro', ...data.polls.map(pollLabel)];
  const rows = data.attendees.map((a) => [
    a.name,
    a.cedula,
    a.email,
    localTime(a.registeredAt),
    ...data.polls.map((p) => {
      const optionId = data.voteOf(p.pollInstanceId, a.id);
      const i = p.options.findIndex((o) => o.id === optionId);
      return i < 0 ? '' : `${letter(i)}. ${p.options[i].text}`;
    }),
  ]);
  return toCsv([header, ...rows]);
}
