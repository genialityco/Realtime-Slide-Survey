import { useEffect, useState } from 'react';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { auth, db } from '../firebase.js';
import { myRegistration, register, subscribe, vote } from '../data/publico.js';
import { registrationCache } from '../local.js';
import { SLIDES, TITLE } from '../simposio.js';
import SlideView from '../components/SlideView.jsx';
import { letter } from '../letter.js';

/** Anonymous Firebase user (invisible to the person); it persists on the phone, so it identifies the device. */
function useAnonymousUser() {
  const [user, setUser] = useState(null);
  const [error, setError] = useState('');
  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        if (u) return setUser(u);
        signInAnonymously(auth).catch(() => setError('No se pudo conectar. Revisa tu conexión a internet.'));
      }),
    [],
  );
  return { user, error };
}

export default function Audience() {
  const { user, error: authError } = useAnonymousUser();
  const [registration, setRegistration] = useState(undefined); // undefined = checking, null = needs the form
  const [error, setError] = useState('');

  // Registration is asked once per phone: the cache shows the live view instantly; Firestore confirms it.
  useEffect(() => {
    if (!user) return;
    const cached = registrationCache.get(user.uid);
    if (cached) setRegistration(cached);
    myRegistration(db, user.uid)
      .then((r) => {
        if (r) registrationCache.set(user.uid, r);
        else registrationCache.clear();
        setRegistration(r);
      })
      .catch((e) => (cached ? null : setError(e.message)));
  }, [user]);

  if (authError || error) {
    return (
      <main className="page page--narrow audience">
        <p className="error">{authError || error}</p>
        <button onClick={() => location.reload()}>Reintentar</button>
      </main>
    );
  }
  if (!user || registration === undefined) return <main className="page page--narrow audience">Cargando…</main>;

  if (!registration) {
    return (
      <Registration
        uid={user.uid}
        onDone={(r) => {
          registrationCache.set(user.uid, r);
          setRegistration(r);
        }}
      />
    );
  }
  return <Live uid={user.uid} registration={registration} />;
}

function Registration({ uid, onDone }) {
  const [form, setForm] = useState({ nombre: '', cedula: '', correo: '', consentimiento: false });
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  async function submit(e) {
    e.preventDefault();
    setError('');
    setSending(true);
    try {
      onDone(await register(db, uid, form));
    } catch (err) {
      setError(err.message);
      setSending(false);
    }
  }

  return (
    <main className="page page--narrow audience">
      <img className="audience__banner" src={SLIDES[0].style.backgroundImage} alt={TITLE} />
      <h2>Encuesta en vivo</h2>
      <p className="muted">Regístrate una sola vez para participar en las votaciones del simposio.</p>
      <form className="card form" onSubmit={submit}>
        <label>
          Nombre completo
          <input value={form.nombre} onChange={(e) => set({ nombre: e.target.value })} autoComplete="name" required />
        </label>
        <label>
          Cédula
          <input
            value={form.cedula}
            onChange={(e) => set({ cedula: e.target.value })}
            inputMode="numeric"
            pattern="[0-9 .\-]{5,20}"
            required
          />
        </label>
        <label>
          Correo electrónico
          <input
            type="email"
            value={form.correo}
            onChange={(e) => set({ correo: e.target.value })}
            autoComplete="email"
            required
          />
        </label>
        <label className="consent">
          <input
            type="checkbox"
            checked={form.consentimiento}
            onChange={(e) => set({ consentimiento: e.target.checked })}
            required
          />
          <span>
            Autorizo el tratamiento de mis datos personales (nombre, cédula y correo) para el registro de asistencia y
            el análisis de las respuestas de este evento, conforme a la Ley 1581 de 2012.
          </span>
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary big" disabled={sending || !form.consentimiento}>
          {sending ? 'Enviando…' : 'Registrarme y continuar'}
        </button>
      </form>
    </main>
  );
}

function Live({ uid, registration }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => subscribe(db, registration.cedula, setState, (e) => setError(e.message)), [registration.cedula]);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => (window.removeEventListener('online', up), window.removeEventListener('offline', down));
  }, []);

  // New slide on the projector → start at the top, drop any message from the previous question.
  const slideId = state?.slide?.id;
  useEffect(() => {
    window.scrollTo({ top: 0 });
    setError('');
  }, [slideId]);

  async function choose(opcion) {
    setError('');
    setSending(true);
    try {
      await vote(db, uid, state.sessionId, state.slide.id, registration.cedula, opcion);
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  const header = (
    <header className="audience__header">
      <span>Hola, {registration.nombre.split(' ')[0]}</span>
      {!online && <span className="badge">Sin conexión…</span>}
    </header>
  );

  if (!state) return <main className="page page--narrow audience">{header}Conectando…</main>;

  const { slide } = state;
  if (!slide || slide.type !== 'poll') {
    return (
      <main className="page page--narrow audience">
        {header}
        <img className="audience__banner" src={SLIDES[0].style.backgroundImage} alt={TITLE} />
        <p className="waiting">
          {state.status === 'ended'
            ? '¡Gracias por participar!'
            : 'Estás registrado. Las preguntas aparecerán aquí automáticamente cuando se proyecten.'}
        </p>
      </main>
    );
  }

  const myIndex = state.myVote ? slide.options.findIndex((o) => o.id === state.myVote) : -1;
  const yourAnswer =
    myIndex >= 0 ? (
      <p className="voted">
        ✓ Tu respuesta: <b>{letter(myIndex)}.</b> {slide.options[myIndex].text}
      </p>
    ) : null;
  const buttons = (
    <div className="vote-options">
      {slide.options.map((o, i) => (
        <button key={o.id} disabled={sending || !state.myVoteLoaded} onClick={() => choose(o.id)}>
          <span className="letter">{letter(i)}</span>
          <span>{o.text}</span>
        </button>
      ))}
    </div>
  );

  return (
    <main className="page page--narrow audience" key={slide.id}>
      {header}
      {error && <p className="error">{error}</p>}
      <div className="fade-in">
        <SlideView
          variant="mobile"
          slide={slide}
          results={state.results}
          renderOptions={() => yourAnswer ?? buttons}
          footer={state.results ? yourAnswer : null}
        />
        {state.results && myIndex < 0 && buttons}
      </div>
    </main>
  );
}
