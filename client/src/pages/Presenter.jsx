import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../firebase.js';
import {
  endSession,
  goToSlide,
  hideAll,
  listSessions,
  sessionReport,
  setResultsVisible,
  setShowQr,
  startSession,
} from '../data/evento.js';
import { attendeesCsv, downloadText, resultsCsv } from '../data/export.js';
import { TITLE } from '../simposio.js';
import { ensurePresentacion } from '../data/presentacion.js';
import SlideView from '../components/SlideView.jsx';
import QrCode from '../components/QrCode.jsx';
import { useAdmin } from '../components/AdminGate.jsx';
import { plural } from '../letter.js';
import { stripRich } from '../rich-text.js';
import { formatDate, joinUrl } from '../local.js';
import { currentSlide, useEvento, usePublishResults, useSlideKeys } from '../useAdminSession.js';

export default function Presenter() {
  const { user, logout } = useAdmin();
  const { state, error, run } = useEvento();
  usePublishResults(state, run);
  useSlideKeys(state, run);
  useEffect(() => {
    run(() => ensurePresentacion(db)); // first admin visit: store the built-in slides so they can be edited
  }, []);

  if (!state) return <main className="page">{error || 'Conectando…'}</main>;

  const { evento, attendeeCount } = state;
  const live = evento.status === 'live';
  const url = joinUrl();

  return (
    <main className="page page--wide">
      <header className="toolbar">
        <strong>{TITLE}</strong>
        {live ? (
          <span className="badge badge--live">En vivo · {evento.sessionLabel}</span>
        ) : (
          <span className="badge">Sin sesión activa</span>
        )}
        <span className="spacer" />
        <span className="stat">
          <b>{attendeeCount}</b> registrados
        </span>
        <Link className="button" to="/admin/editor">✎ Editar diapositivas</Link>
        <button onClick={() => window.open('/proyeccion', 'proyeccion')}>🖥 Abrir proyección</button>
        <span className="muted small">{user.email}</span>
        <button onClick={logout}>Salir</button>
      </header>
      {error && <p className="error">{error}</p>}

      {live ? <LiveControls state={state} run={run} url={url} /> : <StartSession evento={evento} run={run} />}

      <Sessions refreshKey={`${evento.sessionId}:${evento.status}`} />
    </main>
  );
}

function StartSession({ evento, run }) {
  const [label, setLabel] = useState('');
  return (
    <section className="card">
      <h3>Iniciar sesión</h3>
      <p className="muted">
        Cada sesión guarda sus votos por separado (p. ej. «Ensayo», «Día 1»). Los asistentes registrados se conservan
        entre sesiones: no tienen que volver a registrarse.
      </p>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => startSession(db, label || 'Sesión', evento));
        }}
      >
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Nombre de la sesión (p. ej. Día 1)" />
        <button className="primary">▶ Iniciar</button>
      </form>
    </section>
  );
}

function LiveControls({ state, run, url }) {
  const { evento } = state;
  const { index, slide, poll } = currentSlide(state);
  const { slides } = state;
  const go = (i) => slides[i] && run(() => goToSlide(db, evento, slides[i].id));

  return (
    <div className="presenter">
      <section>
        <p className="muted small">
          Vista privada: aquí el recuento siempre está visible. Proyección y celulares lo ven solo con «Mostrar
          resultados». Puedes avanzar con las flechas o un puntero de presentación (aquí o en la ventana de proyección).
        </p>
        <SlideView slide={slide} results={poll} hideBody footer={poll && <b>{plural(poll.total, 'respuesta')}</b>} />

        <div className="row controls">
          <button disabled={index <= 0} onClick={() => go(index - 1)}>
            ← Anterior
          </button>
          <span>
            {index + 1} / {slides.length}
          </span>
          <button disabled={index >= slides.length - 1} onClick={() => go(index + 1)}>
            Siguiente →
          </button>
          <span className="spacer" />
          {poll && (
            <button
              className={evento.resultsVisible ? '' : 'primary'}
              onClick={() => run(() => setResultsVisible(db, evento, !evento.resultsVisible, evento.resultsVisible ? null : poll))}
            >
              {evento.resultsVisible ? 'Ocultar resultados' : 'Mostrar resultados'}
            </button>
          )}
          <button onClick={() => run(() => setShowQr(db, !evento.showQr))}>
            {evento.showQr ? 'Ocultar QR' : 'Mostrar QR'}
          </button>
          <button
            disabled={!evento.showQr && !evento.resultsVisible}
            title="Quita el QR y los resultados de la proyección: queda solo la diapositiva"
            onClick={() => run(() => hideAll(db, evento))}
          >
            Ocultar todo
          </button>
        </div>
      </section>

      <aside className="slide-list">
        <div className="card join-box">
          <QrCode value={url} size={180} />
          <a href={url} target="_blank" rel="noreferrer" className="small">
            {url}
          </a>
          {/^https?:\/\/(localhost|127\.)/.test(url) && (
            <p className="warn small">Este enlace usa «localhost»: en el evento usa la URL publicada.</p>
          )}
        </div>
        {slides.map((s, i) => {
          const p = state.polls.find((x) => x.slideId === s.id);
          return (
            <button key={s.id} className={`slide-thumb ${s.id === slide.id ? 'is-selected' : ''}`} onClick={() => go(i)}>
              <span className="slide-thumb__index">{i + 1}</span>
              <div className="slide-thumb__body">
                <span className="tag">{s.type === 'poll' ? 'Encuesta' : 'Contenido'}</span>
                {p?.resultsVisible && <span className="tag tag--copy">Resultados visibles</span>}
                <div className="slide-thumb__title">{stripRich(s.title || s.question) || '(solo imagen)'}</div>
                {p && <small className="muted">{plural(p.total, 'voto')}</small>}
              </div>
            </button>
          );
        })}
        <button
          className="danger"
          onClick={() =>
            confirm('¿Finalizar la sesión? Los resultados quedarán guardados.') && run(() => endSession(db, evento))
          }
        >
          Finalizar sesión
        </button>
      </aside>
    </div>
  );
}

function Sessions({ refreshKey }) {
  const [sessions, setSessions] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    listSessions(db).then(setSessions).catch((e) => setError(e.message));
  }, [refreshKey]);

  const exportCsv = async (s, kind) => {
    try {
      const report = await sessionReport(db, s.id);
      const name = `${kind}-${s.label.replace(/\W+/g, '-')}-${s.id}.csv`;
      downloadText(name, kind === 'resultados' ? resultsCsv(report) : attendeesCsv(report));
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <section className="card">
      <h3>Sesiones y resultados guardados</h3>
      {error && <p className="error">{error}</p>}
      <ul className="list">
        {sessions?.map((s) => (
          <li key={s.id}>
            <span className={`badge badge--${s.status}`}>{s.status === 'live' ? 'En vivo' : 'Finalizada'}</span>
            <b>{s.label}</b>
            <span className="muted">{formatDate(s.startedAt)}</span>
            <span className="muted">{plural(s.votes, 'voto')}</span>
            <span className="spacer" />
            <Link to={`/admin/sesiones/${s.id}`}>Ver resultados</Link>
            <button onClick={() => exportCsv(s, 'resultados')}>⬇ Resultados</button>
            <button onClick={() => exportCsv(s, 'asistentes')}>⬇ Asistentes y respuestas</button>
          </li>
        ))}
        {sessions && !sessions.length && <li className="muted">Aún no hay sesiones.</li>}
      </ul>
    </section>
  );
}
