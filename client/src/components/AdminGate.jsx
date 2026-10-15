import { useEffect, useState } from 'react';
import { adminKey, api } from '../api.js';

/** Asks for the admin password (when the server has one) before rendering admin pages. */
export default function AdminGate({ children }) {
  const [status, setStatus] = useState('checking'); // checking | ok | locked
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const check = () =>
    api
      .checkAdmin()
      .then(() => setStatus('ok'))
      .catch((e) => {
        setStatus(e.status === 401 ? 'locked' : 'ok');
        if (e.status !== 401) setError(e.message);
      });

  useEffect(() => {
    check();
    const lock = () => setStatus('locked');
    window.addEventListener('rss:unauthorized', lock);
    return () => window.removeEventListener('rss:unauthorized', lock);
  }, []);

  async function submit(e) {
    e.preventDefault();
    adminKey.set(password);
    setError('');
    try {
      await api.checkAdmin();
      setStatus('ok');
    } catch {
      adminKey.clear();
      setError('Contraseña incorrecta');
    }
  }

  if (status === 'checking') return <main className="page">Cargando…</main>;
  if (status === 'ok') return children;

  return (
    <main className="page page--narrow">
      <h2>Acceso de administrador</h2>
      <form className="card form" onSubmit={submit}>
        <label>
          Contraseña
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={!password}>
          Entrar
        </button>
      </form>
    </main>
  );
}
