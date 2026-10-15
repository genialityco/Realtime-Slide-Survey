import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { db } from '../firebase.js';
import { sessionReport } from '../data/sessions.js';
import { attendeesCsv, downloadText, resultsCsv } from '../data/export.js';
import { formatDate } from '../local.js';
import SlideView from '../components/SlideView.jsx';

export default function Report() {
  const { sessionId } = useParams();
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    sessionReport(db, sessionId).then(setReport).catch((e) => setError(e.message));
  }, [sessionId]);

  if (!report) return <main className="page">{error || 'Cargando…'}</main>;
  const { session, presentation, polls, attendeeCount } = report;

  return (
    <main className="page">
      <header className="toolbar">
        <Link to={`/p/${presentation.id}`}>← {presentation.title}</Link>
        <span className={`badge badge--${session.status}`}>{session.status === 'live' ? 'En vivo' : 'Finalizada'}</span>
        <span className="spacer" />
        <button onClick={() => downloadText(`resultados-${session.code}.csv`, resultsCsv(report))}>
          ⬇ Resultados (CSV)
        </button>
        <button onClick={() => downloadText(`asistentes-${session.code}.csv`, attendeesCsv(report))}>
          ⬇ Asistentes y respuestas (CSV)
        </button>
      </header>
      {error && <p className="error">{error}</p>}
      <h2>Resultados de la sesión</h2>
      <p className="muted">
        Inicio: {formatDate(session.startedAt)}
        {session.endedAt && ` · Fin: ${formatDate(session.endedAt)}`} · {attendeeCount} asistentes registrados ·
        sessionId <code>{session.id}</code>
      </p>

      {!polls.length && <p>No se presentó ninguna encuesta en esta sesión.</p>}
      {polls.map((p) => (
        <section key={p.pollInstanceId} className="report-item">
          <p className="muted small">
            Diapositiva {p.slidePosition !== null ? p.slidePosition + 1 : '(eliminada)'} · slideId <code>{p.slideId}</code>{' '}
            · pollInstanceId <code>{p.pollInstanceId}</code>
          </p>
          <SlideView
            slide={{ type: 'poll', title: p.title, question: p.question, options: p.options, style: p.style }}
            results={p}
          />
        </section>
      ))}
    </main>
  );
}
