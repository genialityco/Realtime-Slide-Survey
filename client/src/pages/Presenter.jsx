import { useEffect, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { db } from '../firebase.js';
import { endSession, goToSlide, publishResults, sessionReport, setResultsVisible, setShowQr } from '../data/sessions.js';
import { attendeesCsv, downloadText, resultsCsv } from '../data/export.js';
import SlideView from '../components/SlideView.jsx';
import QrCode from '../components/QrCode.jsx';
import { plural } from '../letter.js';
import { currentSlide, useAdminSession } from '../useAdminSession.js';

const sameCounts = (published, tally) =>
  published && published.total === tally.total && tally.options.every((o) => (published.counts?.[o.id] ?? 0) === o.votes);

export default function Presenter() {
  const { sessionId } = useParams();
  const { state, error, joinUrl, run } = useAdminSession(sessionId);
  const publishTimer = useRef(null);

  const view = state && currentSlide(state);
  const live = state?.session.status === 'live';
  const poll = view?.poll;

  const go = (i) => view?.slides[i] && run(() => goToSlide(db, sessionId, view.slides[i].id));

  // The audience cannot read votes: while results are visible, this page publishes the counts
  // (at most about once per second, and only when they changed).
  useEffect(() => {
    if (!poll?.resultsVisible || sameCounts(poll.published, poll) || publishTimer.current) return;
    publishTimer.current = setTimeout(() => {
      publishTimer.current = null;
      run(() => publishResults(db, sessionId, poll.slideId, poll));
    }, 800);
  });
  useEffect(() => () => clearTimeout(publishTimer.current), []);

  useEffect(() => {
    if (!view || !live) return;
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      if (['ArrowRight', 'PageDown', ' '].includes(e.key)) (e.preventDefault(), go(view.index + 1));
      if (['ArrowLeft', 'PageUp'].includes(e.key)) (e.preventDefault(), go(view.index - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!state) return <main className="page">{error || 'Conectando…'}</main>;

  const { session, presentation, attendeeCount } = state;
  const { slides, index, slide, shown } = view;
  const exportCsv = (kind) =>
    run(async () => {
      const report = await sessionReport(db, sessionId);
      if (kind === 'results') downloadText(`resultados-${session.code}.csv`, resultsCsv(report));
      else downloadText(`asistentes-${session.code}.csv`, attendeesCsv(report));
    });

  return (
    <main className="page page--wide">
      <header className="toolbar">
        <Link to={`/p/${presentation.id}`}>← Editor</Link>
        <strong>{presentation.title}</strong>
        <span className={`badge badge--${session.status}`}>{live ? 'En vivo' : 'Finalizada'}</span>
        <span className="spacer" />
        <span className="stat">
          <b>{attendeeCount}</b> registrados
        </span>
        <button onClick={() => window.open(`/screen/${session.id}`, `screen-${session.id}`)}>🖥 Abrir proyección</button>
      </header>
      {error && <p className="error">{error}</p>}

      {!live && (
        <p className="card">
          La sesión ha finalizado. <Link to={`/sessions/${session.id}`}>Ver resultados guardados →</Link>
        </p>
      )}

      <div className="presenter">
        <section>
          <p className="muted small">
            Vista privada del presentador: el recuento siempre está visible aquí. El público y la proyección solo lo ven
            si activas «Mostrar resultados». Mantén esta pestaña abierta mientras los resultados estén visibles.
          </p>
          {shown ? (
            <SlideView slide={shown} results={poll} hideBody footer={poll && <b>{plural(poll.total, 'respuesta')}</b>} />
          ) : (
            <p>No hay diapositiva activa.</p>
          )}

          <div className="row controls">
            <button disabled={!live || index <= 0} onClick={() => go(index - 1)}>
              ← Anterior
            </button>
            <span>
              {index + 1} / {slides.length}
            </span>
            <button disabled={!live || index >= slides.length - 1} onClick={() => go(index + 1)}>
              Siguiente →
            </button>
            <span className="spacer" />
            {slide?.type === 'poll' && poll && (
              <button
                className={poll.resultsVisible ? '' : 'primary'}
                disabled={!live}
                onClick={() =>
                  run(() => setResultsVisible(db, sessionId, slide.id, !poll.resultsVisible, poll.resultsVisible ? null : poll))
                }
              >
                {poll.resultsVisible ? 'Ocultar resultados' : 'Mostrar resultados'}
              </button>
            )}
            <button disabled={!live} onClick={() => run(() => setShowQr(db, sessionId, !session.showQr))}>
              {session.showQr ? 'Ocultar QR en proyección' : 'Mostrar QR en proyección'}
            </button>
          </div>
        </section>

        <aside className="slide-list">
          {live && (
            <div className="card join-box">
              <QrCode value={joinUrl} size={180} />
              <div>
                Código <b className="code">{session.code}</b>
              </div>
              <a href={joinUrl} target="_blank" rel="noreferrer" className="small">
                {joinUrl}
              </a>
              {/^https?:\/\/(localhost|127\.)/.test(joinUrl) && (
                <p className="warn small">
                  Este enlace usa «localhost» y no funcionará en los celulares. Usa la versión publicada en Firebase
                  Hosting o abre el panel con la IP de este equipo.
                </p>
              )}
            </div>
          )}
          {slides.map((s, i) => {
            const p = state.polls.find((x) => x.slideId === s.id);
            return (
              <button
                key={s.id}
                className={`slide-thumb ${s.id === slide?.id ? 'is-selected' : ''}`}
                disabled={!live}
                onClick={() => go(i)}
              >
                <span className="slide-thumb__index">{i + 1}</span>
                <div className="slide-thumb__body">
                  <span className="tag">{s.type === 'poll' ? 'Encuesta' : 'Contenido'}</span>
                  {p?.resultsVisible && <span className="tag tag--copy">Resultados visibles</span>}
                  <div className="slide-thumb__title">{s.title || s.question || '(portada)'}</div>
                  {p && <small className="muted">{plural(p.total, 'voto')}</small>}
                </div>
              </button>
            );
          })}
          <div className="card">
            <div className="row">
              <button onClick={() => exportCsv('results')}>⬇ Resultados (CSV)</button>
              <button onClick={() => exportCsv('attendees')}>⬇ Asistentes y respuestas (CSV)</button>
            </div>
            <button
              className="danger"
              disabled={!live}
              onClick={() =>
                confirm('¿Finalizar la sesión? Los resultados quedarán guardados.') && run(() => endSession(db, sessionId))
              }
            >
              Finalizar sesión
            </button>
          </div>
        </aside>
      </div>
    </main>
  );
}
