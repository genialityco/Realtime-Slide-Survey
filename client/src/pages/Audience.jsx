import { useEffect, useState } from 'react';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { auth, db } from '../firebase.js';
import { subscribe, vote } from '../data/publico.js';
import SlideView from '../components/SlideView.jsx';
import { letter } from '../letter.js';
import { Rich } from '../rich.jsx';

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
  const { user, error } = useAnonymousUser();

  if (error) {
    return (
      <main className="page page--narrow audience">
        <p className="error">{error}</p>
        <button onClick={() => location.reload()}>Reintentar</button>
      </main>
    );
  }
  if (!user) return <main className="page page--narrow audience">Cargando…</main>;
  // Anonymous survey: the phone's anonymous uid is the voter key (one vote per phone and question).
  return <Live uid={user.uid} />;
}

function Live({ uid }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => subscribe(db, uid, setState, (e) => setError(e.message)), [uid]);

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
      await vote(db, uid, state.sessionId, state.slide.id, uid, opcion);
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  const header = (
    <header className="audience__header">
      <span>Encuesta anónima</span>
      {!online && <span className="badge">Sin conexión…</span>}
    </header>
  );

  if (!state) return <main className="page page--narrow audience">{header}Conectando…</main>;

  const { slide } = state;
  if (!slide || slide.type !== 'poll') {
    const shown = slide ?? state.cover;
    return (
      <main className="page page--narrow audience" key={shown?.id ?? 'none'}>
        {header}
        {shown && (
          <div className="fade-in">
            <SlideView variant="mobile" slide={shown} />
          </div>
        )}
        <p className="waiting">
          {state.status === 'ended'
            ? '¡Gracias por participar!'
            : 'Las preguntas aparecerán aquí automáticamente cuando se proyecten.'}
        </p>
      </main>
    );
  }

  const myIndex = state.myVote ? slide.options.findIndex((o) => o.id === state.myVote) : -1;
  const yourAnswer =
    myIndex >= 0 ? (
      <p className="voted">
        ✓ Tu respuesta: <b>{letter(myIndex)}.</b> <Rich text={slide.options[myIndex].text} />
      </p>
    ) : null;
  const buttons = (
    <div className="vote-options">
      {slide.options.map((o, i) => (
        <button key={o.id} disabled={sending || !state.myVoteLoaded} onClick={() => choose(o.id)}>
          <span className="letter">{letter(i)}</span>
          <span>
            <Rich text={o.text} />
          </span>
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
