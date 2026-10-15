import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { db } from '../firebase.js';
import { createPresentation, listPresentations } from '../data/presentations.js';
import { seedSimposio } from '../data/seed-simposio.js';
import { useAdmin } from '../components/AdminGate.jsx';
import { formatDate } from '../local.js';

export default function Home() {
  const { user, logout } = useAdmin();
  const [presentations, setPresentations] = useState(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    listPresentations(db).then(setPresentations).catch((e) => setError(e.message));
  }, []);

  const run = (fn) => async (e) => {
    e?.preventDefault();
    setError('');
    setBusy(true);
    try {
      const p = await fn();
      navigate(`/p/${p.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <main className="page">
      <header className="toolbar">
        <h1>Realtime Slide Survey</h1>
        <span className="spacer" />
        <span className="muted small">{user.email}</span>
        <button onClick={logout}>Salir</button>
      </header>
      {error && <p className="error">{error}</p>}

      <section className="card">
        <h3>Presentaciones</h3>
        <form className="row" onSubmit={run(() => createPresentation(db, title || 'Nueva presentación'))}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título de la presentación" />
          <button disabled={busy}>Crear</button>
        </form>
        <ul className="list">
          {presentations?.map((p) => (
            <li key={p.id}>
              <Link to={`/p/${p.id}`}>{p.title}</Link>
              <small className="muted">{formatDate(p.createdAt)}</small>
            </li>
          ))}
          {presentations && !presentations.length && <li className="muted">Aún no hay presentaciones.</li>}
          {!presentations && !error && <li className="muted">Cargando…</li>}
        </ul>
      </section>

      <section className="card">
        <h3>Plantillas</h3>
        <div className="row">
          <span>Simposio de Leucemias Agudas y Crónicas (portada + 6 encuestas)</span>
          <span className="spacer" />
          <button disabled={busy} onClick={run(() => seedSimposio(db))}>
            Crear desde plantilla
          </button>
        </div>
      </section>

      <p className="muted small">
        Los asistentes entran por el QR o en <Link to="/join">/join</Link> con el código de la sesión.
      </p>
    </main>
  );
}
