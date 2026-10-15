import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth, db } from '../firebase.js';
import { isAdmin } from '../data/evento.js';

const AdminContext = createContext(null);
export const useAdmin = () => useContext(AdminContext);

/** Requires a Firebase Auth user listed in simposio_leucemias_2026/admins before rendering admin pages. */
export default function AdminGate({ children }) {
  const [status, setStatus] = useState('checking'); // checking | ok | login | forbidden
  const [user, setUser] = useState(null);

  useEffect(
    () =>
      onAuthStateChanged(auth, async (u) => {
        setUser(u);
        if (!u || u.isAnonymous) return setStatus('login');
        setStatus((await isAdmin(db, u.uid)) ? 'ok' : 'forbidden');
      }),
    [],
  );

  if (status === 'checking') return <main className="page">Cargando…</main>;
  if (status === 'ok') {
    return <AdminContext.Provider value={{ user, logout: () => signOut(auth) }}>{children}</AdminContext.Provider>;
  }
  if (status === 'forbidden') {
    return (
      <main className="page page--narrow">
        <h2>Sin permisos de administrador</h2>
        <p>
          La cuenta <b>{user?.email}</b> no es administradora del simposio (UID: <code>{user?.uid}</code>).
        </p>
        <button onClick={() => signOut(auth)}>Cerrar sesión</button>
      </main>
    );
  }
  return <Login />;
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setSending(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch {
      setError('Correo o contraseña incorrectos');
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="page page--narrow">
      <h2>Administración del simposio</h2>
      <form className="card form" onSubmit={submit}>
        <label>
          Correo
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoFocus />
        </label>
        <label>
          Contraseña
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={!email || !password || sending}>
          Entrar
        </button>
      </form>
    </main>
  );
}
