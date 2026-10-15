import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import SlideView from '../components/SlideView.jsx';

export default function Report() {
  const { sessionId } = useParams();
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.sessionReport(sessionId).then(setReport).catch((e) => setError(e.message));
  }, [sessionId]);

  if (!report) return <main className="page">{error || 'Cargando…'}</main>;
  const { session, presentation, polls, attendeeCount } = report;
  const exportFile = (fn) => fn(session.id).catch((e) => setError(e.message));

  return (
    <main className="page">
      <header className="toolbar">
        <Link to={`/p/${presentation.id}`}>← {presentation.title}</Link>
        <span className={`badge badge--${session.status}`}>{session.status === 'live' ? 'En vivo' : 'Finalizada'}</span>
        <span className="spacer" />
        <button onClick={() => exportFile(api.exportResults)}>⬇ Resultados (CSV)</button>
        <button onClick={() => exportFile(api.exportAttendees)}>⬇ Asistentes y respuestas (CSV)</button>
      </header>
      {error && <p className="error">{error}</p>}
      <h2>Resultados de la sesión</h2>
      <p className="muted">
        Inicio: {new Date(session.startedAt).toLocaleString()}
        {session.endedAt && ` · Fin: ${new Date(session.endedAt).toLocaleString()}`} · {attendeeCount} asistentes
        registrados · sessionId <code>{session.id}</code>
      </p>

      {!polls.length && <p>No se presentó ninguna encuesta en esta sesión.</p>}
      {polls.map((p) => (
        <section key={p.pollInstanceId} className="report-item">
          <p className="muted small">
            Diapositiva {p.slidePosition !== null && !p.slideDeleted ? p.slidePosition + 1 : '(eliminada)'} · slideId{' '}
            <code>{p.slideId}</code> · pollInstanceId <code>{p.pollInstanceId}</code>
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
