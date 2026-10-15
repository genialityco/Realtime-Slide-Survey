import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase.js';

const AdminContext = createContext(null);
export const useAdmin = () => useContext(AdminContext);

/** Requires a Firebase Auth user listed in admins/{uid} before rendering admin pages. */
export default function AdminGate({ children }) {
  const [status, setStatus] = useState('checking'); // checking | ok | login | forbidden
  const [user, setUser] = useState(null);

  useEffect(
    () =>
      onAuthStateChanged(auth, async (u) => {
        setUser(u);
        if (!u || u.isAnonymous) return setStatus('login');
        const snap = await getDoc(doc(db, 'admins', u.uid)).catch(() => null);
        setStatus(snap?.exists() ? 'ok' : 'forbidden');
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
          La cuenta <b>{user?.email}</b> no está en la colección <code>admins</code> de Firestore (UID:{' '}
          <code>{user?.uid}</code>).
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
      <h2>Acceso de administrador</h2>
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
