import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';

export default function Home() {
  const [presentations, setPresentations] = useState([]);
  const [title, setTitle] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.listPresentations().then(setPresentations).catch((e) => setError(e.message));
  }, []);

  async function create(e) {
    e.preventDefault();
    try {
      const p = await api.createPresentation(title || 'Nueva presentación');
      navigate(`/p/${p.id}`);
    } catch (err) {
      setError(err.message);
    }
  }

  function join(e) {
    e.preventDefault();
    navigate(`/join/${code.trim().toUpperCase()}`);
  }

  return (
    <main className="page">
      <h1>Realtime Slide Survey</h1>
      {error && <p className="error">{error}</p>}

      <section className="card">
        <h3>Unirse como participante</h3>
        <form className="row" onSubmit={join}>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Código (p. ej. K7QX2M)" />
          <button disabled={!code.trim()}>Entrar</button>
        </form>
      </section>

      <section className="card">
        <h3>Presentaciones</h3>
        <form className="row" onSubmit={create}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título de la presentación" />
          <button>Crear</button>
        </form>
        <ul className="list">
          {presentations.map((p) => (
            <li key={p.id}>
              <Link to={`/p/${p.id}`}>{p.title}</Link>
              <small className="muted">{new Date(p.createdAt).toLocaleString()}</small>
            </li>
          ))}
          {!presentations.length && <li className="muted">Aún no hay presentaciones.</li>}
        </ul>
      </section>
    </main>
  );
}
