import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, attendeeStore, call, createSocket } from '../api.js';
import SlideView from '../components/SlideView.jsx';
import { letter } from '../letter.js';

export default function Audience() {
  const { code } = useParams();
  const [info, setInfo] = useState(null); // { sessionId, title }
  const [attendee, setAttendee] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!code) return;
    setError('');
    api
      .joinInfo(code)
      .then((i) => {
        setInfo(i);
        setAttendee(attendeeStore.get(i.sessionId));
      })
      .catch(() => setError('El código no es válido o la sesión ya terminó.'));
  }, [code]);

  if (!code) return <CodeForm />;
  if (error) {
    return (
      <main className="page page--narrow audience">
        <p className="error">{error}</p>
        <CodeForm />
      </main>
    );
  }
  if (!info) return <main className="page page--narrow audience">Cargando…</main>;

  if (!attendee) {
    return (
      <Registration
        code={code}
        title={info.title}
        cover={info.cover}
        onDone={(a) => {
          attendeeStore.set(info.sessionId, a);
          setAttendee(a);
        }}
      />
    );
  }

  return (
    <Live
      code={code}
      attendee={attendee}
      onUnregistered={() => {
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

function Registration({ code, title, cover, onDone }) {
  const [form, setForm] = useState({ name: '', cedula: '', email: '', consent: false });
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  async function submit(e) {
    e.preventDefault();
    setError('');
    setSending(true);
    try {
      const { attendee } = await api.register(code, form);
      onDone(attendee);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="page page--narrow audience">
      {cover && <img className="audience__banner" src={cover} alt="" />}
      <h2>{title}</h2>
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

function Live({ code, attendee, onUnregistered }) {
  const socketRef = useRef(null);
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [connected, setConnected] = useState(true);

  useEffect(() => {
    const socket = createSocket();
    socketRef.current = socket;
    const join = () =>
      call(socket, 'audience:join', { code, attendeeId: attendee.id })
        .then((r) => {
          setState(r.state);
          setError('');
        })
        .catch((e) => (e.message === 'not_registered' ? onUnregistered() : setError(e.message)));
    socket.on('connect', () => {
      setConnected(true);
      join();
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('state', setState);
    socket.on('results', (results) =>
      setState((s) =>
        s?.poll?.pollInstanceId === results.pollInstanceId ? { ...s, poll: { ...s.poll, results } } : s,
      ),
    );
    return () => socket.close();
  }, [code, attendee.id]);

  async function vote(optionId) {
    setError('');
    setSending(true);
    try {
      const r = await call(socketRef.current, 'vote', { slideId: state.slide.id, optionId });
      setState((s) => ({ ...s, poll: { ...s.poll, myVote: r.myVote, results: r.results ?? s.poll.results } }));
    } catch (e) {
      setError(e.message === 'already voted' ? 'Ya registraste tu voto en esta pregunta.' : e.message);
    } finally {
      setSending(false);
    }
  }

  const header = (
    <header className="audience__header">
      <span>Hola, {attendee.name.split(' ')[0]}</span>
      {!connected && <span className="badge">Reconectando…</span>}
    </header>
  );

  if (!state) {
    return (
      <main className="page page--narrow audience">
        {header}
        {error || 'Conectando…'}
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
      {slide && slide.type === 'poll' && (
        <SlideView
          variant="mobile"
          slide={slide}
          results={poll.resultsVisible ? poll.results : null}
          renderOptions={(options) =>
            myIndex >= 0 ? (
              <p className="voted">
                ✓ Tu respuesta: <b>{letter(myIndex)}.</b> {options[myIndex].text}
              </p>
            ) : (
              <div className="vote-options">
                {options.map((o, i) => (
                  <button key={o.id} disabled={sending} onClick={() => vote(o.id)}>
                    <span className="letter">{letter(i)}</span>
                    <span>{o.text}</span>
                  </button>
                ))}
              </div>
            )
          }
          footer={
            poll.resultsVisible && myIndex >= 0 ? (
              <p className="voted">
                ✓ Tu respuesta: <b>{letter(myIndex)}.</b> {slide.options[myIndex].text}
              </p>
            ) : null
          }
        />
      )}
      {poll?.resultsVisible && myIndex < 0 && (
        <div className="vote-options">
          {slide.options.map((o, i) => (
            <button key={o.id} disabled={sending} onClick={() => vote(o.id)}>
              <span className="letter">{letter(i)}</span>
              <span>{o.text}</span>
            </button>
          ))}
        </div>
      )}
    </main>
  );
}
