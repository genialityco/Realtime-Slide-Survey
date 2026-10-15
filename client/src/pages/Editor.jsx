import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import SlideView from '../components/SlideView.jsx';
import { plural } from '../letter.js';

export default function Editor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [presentation, setPresentation] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [p, s] = await Promise.all([api.getPresentation(id), api.listSessions(id)]);
    setPresentation(p);
    setSessions(s);
  }, [id]);

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  const run =
    (fn) =>
    async (...args) => {
      setError('');
      try {
        return await fn(...args);
      } catch (e) {
        setError(e.message);
      }
    };

  const slides = presentation?.slides ?? [];
  const selected = slides.find((s) => s.id === selectedId) ?? slides[0];

  const addSlide = run(async (type) => {
    const s = await api.addSlide(id, { type });
    await load();
    setSelectedId(s.id);
  });

  const duplicate = run(async (slide, position) => {
    const copy = await api.duplicateSlide(slide.id, position);
    await load();
    setSelectedId(copy.id);
  });

  const move = run(async (slide, position) => {
    setPresentation(await api.moveSlide(slide.id, position));
  });

  const remove = run(async (slide) => {
    if (!confirm('¿Eliminar esta diapositiva? Los resultados de sesiones pasadas se conservan.')) return;
    setPresentation(await api.deleteSlide(slide.id));
    setSelectedId(null);
  });

  const save = run(async (slide, patch) => {
    const updated = await api.updateSlide(slide.id, patch);
    setPresentation((p) => ({ ...p, slides: p.slides.map((s) => (s.id === updated.id ? updated : s)) }));
  });

  const rename = run(async (title) => {
    if (title !== presentation.title) setPresentation(await api.renamePresentation(id, title));
  });

  const start = run(async () => {
    const session = await api.startSession(id);
    navigate(`/present/${session.id}`);
  });

  if (!presentation) return <main className="page">{error || 'Cargando…'}</main>;

  return (
    <main className="page page--wide">
      <header className="toolbar">
        <Link to="/">← Inicio</Link>
        <input className="title-input" defaultValue={presentation.title} onBlur={(e) => rename(e.target.value)} />
        <button className="primary" onClick={start} disabled={!slides.length}>
          ▶ Iniciar sesión
        </button>
      </header>
      {error && <p className="error">{error}</p>}

      <div className="editor">
        <aside className="slide-list">
          {slides.map((s, i) => (
            <div
              key={s.id}
              className={`slide-thumb ${selected?.id === s.id ? 'is-selected' : ''}`}
              onClick={() => setSelectedId(s.id)}
            >
              <span className="slide-thumb__index">{i + 1}</span>
              <div className="slide-thumb__body">
                <span className="tag">{s.type === 'poll' ? 'Encuesta' : 'Contenido'}</span>
                {s.sourceSlideId && <span className="tag tag--copy">Copia</span>}
                <div className="slide-thumb__title">{s.title || s.question || '(solo imagen)'}</div>
              </div>
              <div className="slide-thumb__actions" onClick={(e) => e.stopPropagation()}>
                <button title="Subir" disabled={i === 0} onClick={() => move(s, i - 1)}>
                  ↑
                </button>
                <button title="Bajar" disabled={i === slides.length - 1} onClick={() => move(s, i + 1)}>
                  ↓
                </button>
              </div>
            </div>
          ))}
          <div className="row">
            <button onClick={() => addSlide('poll')}>+ Encuesta</button>
            <button onClick={() => addSlide('content')}>+ Contenido</button>
          </div>
        </aside>

        {selected && (
          <SlideEditor
            key={selected.id}
            slide={selected}
            index={slides.indexOf(selected)}
            count={slides.length}
            onSave={(patch) => save(selected, patch)}
            onDuplicate={(pos) => duplicate(selected, pos)}
            onDelete={() => remove(selected)}
          />
        )}
      </div>

      <section className="card">
        <h3>Sesiones</h3>
        <ul className="list">
          {sessions.map((s) => (
            <li key={s.id}>
              <span className={`badge badge--${s.status}`}>{s.status === 'live' ? 'En vivo' : 'Finalizada'}</span>
              <span>{new Date(s.startedAt).toLocaleString()}</span>
              <span className="muted">
                {plural(s.pollCount, 'encuesta')} · {plural(s.totalVotes, 'voto')}
              </span>
              <span className="spacer" />
              {s.status === 'live' && <Link to={`/present/${s.id}`}>Presentar</Link>}
              <Link to={`/sessions/${s.id}`}>Resultados</Link>
            </li>
          ))}
          {!sessions.length && <li className="muted">Todavía no se ha ejecutado esta presentación.</li>}
        </ul>
      </section>
    </main>
  );
}

function positionLabel(i, index, count) {
  if (i === index + 1) return `${i + 1} (después de esta)`;
  if (i === count) return `${i + 1} (al final)`;
  return String(i + 1);
}

function SlideEditor({ slide, index, count, onSave, onDuplicate, onDelete }) {
  const [draft, setDraft] = useState(slide);
  const [dupPosition, setDupPosition] = useState(index + 1);
  const dirty = JSON.stringify(draft) !== JSON.stringify(slide);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const setStyle = (patch) => set({ style: { ...draft.style, ...patch } });
  const setOption = (i, text) => set({ options: draft.options.map((o, j) => (j === i ? { ...o, text } : o)) });

  return (
    <section className="slide-editor">
      <SlideView slide={draft} />

      <div className="card form">
        {slide.type === 'poll' && (
          <label>
            Título (opcional)
            <input value={draft.title ?? ''} onChange={(e) => set({ title: e.target.value })} />
          </label>
        )}

        {slide.type === 'poll' && (
          <label>
            Caso clínico / contexto (opcional)
            <textarea rows={4} value={draft.body} onChange={(e) => set({ body: e.target.value })} />
          </label>
        )}

        <label>
          {slide.type === 'poll' ? 'Pregunta' : 'Título'}
          <input value={draft.question} onChange={(e) => set({ question: e.target.value })} />
        </label>

        {slide.type === 'content' && (
          <label>
            Texto
            <textarea rows={3} value={draft.body} onChange={(e) => set({ body: e.target.value })} />
          </label>
        )}

        {slide.type === 'poll' && (
          <fieldset>
            <legend>Opciones</legend>
            {draft.options.map((o, i) => (
              <div className="row" key={o.id ?? `new-${i}`}>
                <input value={o.text} onChange={(e) => setOption(i, e.target.value)} />
                <button
                  disabled={draft.options.length <= 2}
                  onClick={() => set({ options: draft.options.filter((_, j) => j !== i) })}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              disabled={draft.options.length >= 10}
              onClick={() => set({ options: [...draft.options, { text: `Opción ${draft.options.length + 1}` }] })}
            >
              + Opción
            </button>
          </fieldset>
        )}

        <fieldset className="row">
          <legend>Apariencia</legend>
          <label>
            Fondo
            <input type="color" value={draft.style.background} onChange={(e) => setStyle({ background: e.target.value })} />
          </label>
          <label>
            Texto
            <input type="color" value={draft.style.textColor} onChange={(e) => setStyle({ textColor: e.target.value })} />
          </label>
          <label>
            Acento
            <input type="color" value={draft.style.accent} onChange={(e) => setStyle({ accent: e.target.value })} />
          </label>
          {slide.type === 'poll' && (
            <label>
              Gráfica
              <select value={draft.style.chartType} onChange={(e) => setStyle({ chartType: e.target.value })}>
                <option value="bar">Barras</option>
                <option value="column">Columnas</option>
              </select>
            </label>
          )}
        </fieldset>

        <BackgroundImageField style={draft.style} onChange={setStyle} />

        <div className="row">
          <button className="primary" disabled={!dirty} onClick={() => onSave(draft)}>
            Guardar
          </button>
          <button disabled={!dirty} onClick={() => setDraft(slide)}>
            Descartar
          </button>
          <span className="spacer" />
          <button className="danger" onClick={onDelete}>
            Eliminar
          </button>
        </div>

        <div className="row duplicate">
          <span>Duplicar en posición</span>
          <select value={dupPosition} onChange={(e) => setDupPosition(Number(e.target.value))}>
            {Array.from({ length: count + 1 }, (_, i) => (
              <option key={i} value={i}>
                {positionLabel(i, index, count)}
              </option>
            ))}
          </select>
          <button
            disabled={dirty}
            title={dirty ? 'Guarda los cambios antes de duplicar' : ''}
            onClick={() => onDuplicate(dupPosition)}
          >
            ⧉ Duplicar
          </button>
        </div>
      </div>
    </section>
  );
}

function BackgroundImageField({ style, onChange }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  async function upload(file) {
    if (!file) return;
    setError('');
    setUploading(true);
    try {
      const { url } = await api.uploadImage(file);
      onChange({ backgroundImage: url });
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <fieldset>
      <legend>Imagen de fondo</legend>
      <div className="row">
        <input
          placeholder="/media/2.jpg o https://…"
          value={style.backgroundImage ?? ''}
          onChange={(e) => onChange({ backgroundImage: e.target.value })}
        />
        <label className="button">
          {uploading ? 'Subiendo…' : 'Subir imagen'}
          <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => upload(e.target.files[0])} />
        </label>
        {style.backgroundImage && <button onClick={() => onChange({ backgroundImage: '' })}>Quitar</button>}
      </div>
      {error && <p className="error">{error}</p>}
      <label>
        Espacio superior libre (para la cabecera de la imagen): {style.contentTop ?? 0}%
        <input
          type="range"
          min="0"
          max="50"
          value={style.contentTop ?? 0}
          onChange={(e) => onChange({ contentTop: Number(e.target.value) })}
        />
      </label>
      <label>
        Oscurecer imagen: {Math.round((style.overlay ?? 0) * 100)}%
        <input
          type="range"
          min="0"
          max="85"
          value={Math.round((style.overlay ?? 0) * 100)}
          onChange={(e) => onChange({ overlay: Number(e.target.value) / 100 })}
        />
      </label>
    </fieldset>
  );
}
