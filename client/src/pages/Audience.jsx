import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { auth, db } from '../firebase.js';
import { castVote, findLiveSession, registerAttendee, subscribeAudience } from '../data/audience.js';
import { attendeeStore } from '../local.js';
import SlideView from '../components/SlideView.jsx';
import { letter } from '../letter.js';

/** Signs the visitor in anonymously (invisible to them) so the rules can tie votes to a device. */
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
  const { code } = useParams();
  const { user, error: authError } = useAnonymousUser();
  const [info, setInfo] = useState(null); // { sessionId, title, cover }
  const [attendee, setAttendee] = useState(null); // { cedula, name }
  const [error, setError] = useState('');

  useEffect(() => {
    if (!code || !user) return;
    setError('');
    findLiveSession(db, code)
      .then((i) => {
        setInfo(i);
        setAttendee(attendeeStore.get(i.sessionId));
      })
      .catch((e) => setError(e.message));
  }, [code, user]);

  if (!code) return <CodeForm />;
  if (authError || error) {
    return (
      <main className="page page--narrow audience">
        <p className="error">{authError || error}</p>
        <CodeForm />
      </main>
    );
  }
  if (!user || !info) return <main className="page page--narrow audience">Cargando…</main>;

  if (!attendee) {
    return (
      <Registration
        info={info}
        uid={user.uid}
        onDone={(a) => {
          attendeeStore.set(info.sessionId, a);
          setAttendee(a);
        }}
      />
    );
  }

  return (
    <Live
      sessionId={info.sessionId}
      uid={user.uid}
      attendee={attendee}
      onReset={() => {
        attendeeStore.clear(info.sessionId);
        setAttendee(null);
      }}
    />
  );
}

function CodeForm() {
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  return (
    <main className="page page--narrow audience">
      <h2>Unirse a la encuesta</h2>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          navigate(`/join/${input.trim().toUpperCase()}`);
        }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Código" autoFocus />
        <button disabled={!input.trim()}>Entrar</button>
      </form>
    </main>
  );
}

function Registration({ info, uid, onDone }) {
  const [form, setForm] = useState({ name: '', cedula: '', email: '', consent: false });
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  async function submit(e) {
    e.preventDefault();
    setError('');
    setSending(true);
    try {
      onDone(await registerAttendee(db, uid, info.sessionId, form));
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="page page--narrow audience">
      {info.cover && <img className="audience__banner" src={info.cover} alt="" />}
      <h2>{info.title}</h2>
      <p className="muted">Regístrate para participar en las votaciones.</p>
      <form className="card form" onSubmit={submit}>
        <label>
          Nombre completo
          <input value={form.name} onChange={(e) => set({ name: e.target.value })} autoComplete="name" required />
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
            value={form.email}
            onChange={(e) => set({ email: e.target.value })}
            autoComplete="email"
            required
          />
        </label>
        <label className="consent">
          <input type="checkbox" checked={form.consent} onChange={(e) => set({ consent: e.target.checked })} required />
          <span>
            Autorizo el tratamiento de mis datos personales (nombre, cédula y correo) para el registro de asistencia y
            el análisis de las respuestas de este evento, conforme a la Ley 1581 de 2012.
          </span>
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary big" disabled={sending || !form.consent}>
          {sending ? 'Enviando…' : 'Registrarme y continuar'}
        </button>
      </form>
    </main>
  );
}

function Live({ sessionId, uid, attendee, onReset }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(
    () =>
      subscribeAudience(db, sessionId, attendee.cedula, setState, (e) =>
        setError(e.code === 'permission-denied' ? 'Tu registro ya no es válido en este dispositivo.' : e.message),
      ),
    [sessionId, attendee.cedula],
  );

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => (window.removeEventListener('online', up), window.removeEventListener('offline', down));
  }, []);

  async function vote(optionId) {
    setError('');
    setSending(true);
    try {
      await castVote(db, uid, sessionId, state.slide.id, attendee.cedula, optionId);
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  const header = (
    <header className="audience__header">
      <span>Hola, {attendee.name.split(' ')[0]}</span>
      {!online && <span className="badge">Sin conexión…</span>}
    </header>
  );

  if (!state) {
    return (
      <main className="page page--narrow audience">
        {header}
        {error ? (
          <>
            <p className="error">{error}</p>
            <button onClick={onReset}>Registrarme de nuevo</button>
          </>
        ) : (
          'Conectando…'
        )}
      </main>
    );
  }

  if (state.status === 'ended') {
    return (
      <main className="page page--narrow audience">
        {header}
        <h2>La sesión ha finalizado</h2>
        <p>¡Gracias por participar!</p>
      </main>
    );
  }

  const { slide, poll } = state;
  const myIndex = poll?.myVote ? slide.options.findIndex((o) => o.id === poll.myVote) : -1;
  const yourAnswer =
    myIndex >= 0 ? (
      <p className="voted">
        ✓ Tu respuesta: <b>{letter(myIndex)}.</b> {slide.options[myIndex].text}
      </p>
    ) : null;
  const voteButtons = (options) => (
    <div className="vote-options">
      {options.map((o, i) => (
        <button key={o.id} disabled={sending} onClick={() => vote(o.id)}>
          <span className="letter">{letter(i)}</span>
          <span>{o.text}</span>
        </button>
      ))}
    </div>
  );

  return (
    <main className="page page--narrow audience">
      {header}
      {error && <p className="error">{error}</p>}
      {!slide && <p>Esperando a que comience la presentación…</p>}
      {slide && slide.type !== 'poll' && (
        <>
          <SlideView variant="mobile" slide={slide} />
          <p className="waiting">Espera la siguiente pregunta…</p>
        </>
      )}
      {slide && slide.type === 'poll' && !poll && <p>Cargando pregunta…</p>}
      {slide && slide.type === 'poll' && poll && (
        <SlideView
          variant="mobile"
          slide={slide}
          results={poll.resultsVisible ? poll.results : null}
          renderOptions={(options) => yourAnswer ?? voteButtons(options)}
          footer={poll.resultsVisible ? yourAnswer : null}
        />
      )}
      {poll?.resultsVisible && poll.results && myIndex < 0 && voteButtons(slide.options)}
    </main>
  );
}
