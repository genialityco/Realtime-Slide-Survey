import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { onSnapshot } from 'firebase/firestore';
import { db } from '../firebase.js';
import { eventoRef } from '../data/evento.js';
import { restoreDefaults, savePresentacion, subscribePresentacion } from '../data/presentacion.js';
import { uploadImage } from '../data/imagenes.js';
import { MAX_OPTIONS, MIN_OPTIONS, normalizeSlides, randomId, validImageUrl } from '../data/model.js';
import { BACKGROUNDS, CHART_TYPES, IMAGE_POSITIONS, POLL_STYLE } from '../simposio.js';
import SlideView from '../components/SlideView.jsx';
import { letter } from '../letter.js';

const SAMPLE_VOTES = [14, 9, 5, 3, 2, 2, 1, 1, 1, 1];
const sampleResults = (slide) => {
  const options = slide.options.map((o, i) => ({ ...o, votes: SAMPLE_VOTES[i] ?? 1 }));
  return { total: options.reduce((n, o) => n + o.votes, 0), options };
};

const newSlide = (type, style) => ({
  id: randomId(10),
  type,
  title: '',
  body: '',
  question: type === 'poll' ? 'Nueva pregunta' : 'Nuevo título',
  options: type === 'poll' ? [{ id: randomId(6), text: 'Opción 1' }, { id: randomId(6), text: 'Opción 2' }] : [],
  style: { ...POLL_STYLE, ...style },
  image: null,
});

export default function Editor() {
  const [saved, setSaved] = useState(null); // { slides, imagenes } as stored
  const [slides, setSlides] = useState(null);
  const [imagenes, setImagenes] = useState([]);
  const [selected, setSelected] = useState(0);
  const [preview, setPreview] = useState('stage'); // stage | mobile | results
  const [evento, setEvento] = useState(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const loaded = useRef(false);

  useEffect(
    () =>
      subscribePresentacion(
        db,
        (p) => {
          setSaved(p);
          if (!loaded.current) {
            loaded.current = true;
            setSlides(p.slides);
            setImagenes(p.imagenes);
          }
        },
        (e) => setError(e.message),
      ),
    [],
  );
  useEffect(() => onSnapshot(eventoRef(db), (s) => setEvento(s.exists() ? s.data() : null)), []);

  const dirty = useMemo(
    () => saved && slides && JSON.stringify({ slides, imagenes }) !== JSON.stringify({ slides: saved.slides, imagenes: saved.imagenes }),
    [saved, slides, imagenes],
  );

  useEffect(() => {
    const warn = (e) => dirty && (e.preventDefault(), (e.returnValue = ''));
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (!slides) return <main className="page">{error || 'Cargando…'}</main>;

  const index = Math.min(selected, slides.length - 1);
  const slide = slides[index];
  const live = evento?.status === 'live';

  const updateSlide = (patch) => setSlides((all) => all.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  const updateStyle = (patch) => updateSlide({ style: { ...slide.style, ...patch } });
  const move = (from, to) => {
    if (to < 0 || to >= slides.length) return;
    const next = [...slides];
    next.splice(to, 0, next.splice(from, 1)[0]);
    setSlides(next);
    setSelected(to);
  };
  const insert = (s, at = index + 1) => {
    const next = [...slides];
    next.splice(at, 0, s);
    setSlides(next);
    setSelected(at);
  };
  const duplicate = () =>
    insert({
      ...structuredClone(slide),
      id: randomId(10),
      options: slide.options.map((o) => ({ ...o, id: randomId(6) })),
    });
  const remove = () => {
    if (slides.length === 1) return setError('La presentación necesita al menos una diapositiva.');
    if (!confirm(`¿Eliminar la diapositiva ${index + 1}? Los resultados ya guardados de sesiones anteriores no se pierden.`)) return;
    setSlides(slides.filter((_, i) => i !== index));
    setSelected(Math.max(0, index - 1));
  };

  async function save() {
    setError('');
    setStatus('Guardando…');
    try {
      normalizeSlides(slides); // validate before writing
      const clean = await savePresentacion(db, slides, { imagenes, evento });
      setSlides(clean);
      setStatus('Guardado ✓');
      setTimeout(() => setStatus(''), 2500);
    } catch (e) {
      setStatus('');
      setError(e.message);
    }
  }

  return (
    <main className="page page--wide editor-page">
      <header className="toolbar editor-toolbar">
        <Link to="/admin">← Panel</Link>
        <strong>Editor de diapositivas</strong>
        {live && <span className="badge badge--live">Sesión en vivo: los cambios se ven al guardar</span>}
        <span className="spacer" />
        <span className={dirty ? 'warn small' : 'muted small'}>{status || (dirty ? 'Cambios sin guardar' : 'Sin cambios')}</span>
        <button
          disabled={!dirty}
          onClick={() => {
            setSlides(saved.slides);
            setImagenes(saved.imagenes);
          }}
        >
          Descartar
        </button>
        <button className="primary" disabled={!dirty} onClick={save}>
          Guardar
        </button>
      </header>
      {error && <p className="error">{error}</p>}

      <div className="editor">
        <aside className="slide-list">
          {slides.map((s, i) => (
            <div key={s.id} className={`slide-thumb ${i === index ? 'is-selected' : ''}`} onClick={() => setSelected(i)}>
              <span className="slide-thumb__index">{i + 1}</span>
              <div className="slide-thumb__body">
                <span className="tag">{s.type === 'poll' ? `Encuesta · ${s.options.length} opciones` : 'Contenido'}</span>
                <div className="slide-thumb__title">{s.title || s.question || '(solo imagen)'}</div>
              </div>
              <div className="slide-thumb__actions" onClick={(e) => e.stopPropagation()}>
                <button title="Subir" disabled={i === 0} onClick={() => move(i, i - 1)}>
                  ↑
                </button>
                <button title="Bajar" disabled={i === slides.length - 1} onClick={() => move(i, i + 1)}>
                  ↓
                </button>
              </div>
            </div>
          ))}
          <div className="row">
            <button onClick={() => insert(newSlide('poll', slide.style), slides.length)}>+ Encuesta</button>
            <button onClick={() => insert(newSlide('content', slide.style), slides.length)}>+ Contenido</button>
          </div>
          <button
            className="danger small-btn"
            onClick={() =>
              confirm('¿Restaurar las 7 diapositivas originales del simposio? Se reemplaza la presentación actual.') &&
              restoreDefaults(db, evento)
                .then((clean) => (setSlides(clean), setSelected(0)))
                .catch((e) => setError(e.message))
            }
          >
            Restaurar presentación original
          </button>
        </aside>

        <section className="editor-main">
          <div className="row editor-tabs">
            {[
              ['stage', 'Proyección'],
              ['mobile', 'Celular'],
              ['results', 'Resultados (ejemplo)'],
            ].map(([id, label]) => (
              <button key={id} className={preview === id ? 'primary' : ''} onClick={() => setPreview(id)}>
                {label}
              </button>
            ))}
            <span className="spacer" />
            <span className="muted small">
              Diapositiva {index + 1} de {slides.length}
            </span>
            <button onClick={duplicate}>⧉ Duplicar</button>
            <button className="danger" onClick={remove}>
              Eliminar
            </button>
          </div>

          <div className={`editor-preview editor-preview--${preview}`}>
            {preview === 'mobile' ? (
              <div className="phone-frame">
                <SlideView variant="mobile" slide={slide} />
              </div>
            ) : (
              <SlideView
                slide={slide}
                results={preview === 'results' && slide.type === 'poll' ? sampleResults(slide) : null}
              />
            )}
          </div>

          <SlideForm
            slide={slide}
            imagenes={imagenes}
            setImagenes={setImagenes}
            updateSlide={updateSlide}
            updateStyle={updateStyle}
            applyDesignToAll={() =>
              confirm('¿Aplicar el fondo, colores y tamaño de texto de esta diapositiva a todas las demás?') &&
              setSlides(
                slides.map((s) => ({
                  ...s,
                  style: { ...slide.style, chartType: s.style.chartType },
                })),
              )
            }
            setError={setError}
          />
        </section>
      </div>
    </main>
  );
}

function SlideForm({ slide, imagenes, setImagenes, updateSlide, updateStyle, applyDesignToAll, setError }) {
  const style = slide.style;
  const isPoll = slide.type === 'poll';
  const setOption = (i, text) => updateSlide({ options: slide.options.map((o, j) => (j === i ? { ...o, text } : o)) });
  const moveOption = (from, to) => {
    if (to < 0 || to >= slide.options.length) return;
    const options = [...slide.options];
    options.splice(to, 0, options.splice(from, 1)[0]);
    updateSlide({ options });
  };

  const addToGallery = (img) =>
    setImagenes((list) => (list.some((x) => x.url === img.url) ? list : [...list, img]));

  return (
    <div className="editor-form">
      <fieldset className="card">
        <legend>Contenido</legend>
        <label>
          Tipo
          <select
            value={slide.type}
            onChange={(e) => {
              const type = e.target.value;
              const options =
                type === 'poll' && slide.options.length < MIN_OPTIONS
                  ? [{ id: randomId(6), text: 'Opción 1' }, { id: randomId(6), text: 'Opción 2' }]
                  : slide.options;
              updateSlide({ type, options });
            }}
          >
            <option value="poll">Encuesta (se vota en el celular)</option>
            <option value="content">Contenido (solo se muestra)</option>
          </select>
        </label>
        <label>
          Título superior (opcional)
          <input value={slide.title} onChange={(e) => updateSlide({ title: e.target.value })} />
        </label>
        <label>
          {isPoll ? 'Caso clínico / texto (opcional)' : 'Texto'}
          <textarea rows={4} value={slide.body} onChange={(e) => updateSlide({ body: e.target.value })} />
        </label>
        <label>
          {isPoll ? 'Pregunta' : 'Título principal'}
          <input value={slide.question} onChange={(e) => updateSlide({ question: e.target.value })} />
        </label>
      </fieldset>

      {isPoll && (
        <fieldset className="card">
          <legend>Opciones de respuesta</legend>
          {slide.options.map((o, i) => (
            <div className="row option-row" key={o.id}>
              <span className="letter" style={{ '--accent': style.accent }}>
                {letter(i)}
              </span>
              <input value={o.text} onChange={(e) => setOption(i, e.target.value)} />
              <button title="Subir" disabled={i === 0} onClick={() => moveOption(i, i - 1)}>
                ↑
              </button>
              <button title="Bajar" disabled={i === slide.options.length - 1} onClick={() => moveOption(i, i + 1)}>
                ↓
              </button>
              <button
                title="Quitar"
                disabled={slide.options.length <= MIN_OPTIONS}
                onClick={() => updateSlide({ options: slide.options.filter((_, j) => j !== i) })}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            disabled={slide.options.length >= MAX_OPTIONS}
            onClick={() => updateSlide({ options: [...slide.options, { id: randomId(6), text: `Opción ${slide.options.length + 1}` }] })}
          >
            + Agregar opción
          </button>
          <p className="muted small">
            Entre {MIN_OPTIONS} y {MAX_OPTIONS} opciones; las letras se asignan por orden. Si cambias opciones durante una
            sesión en curso, los votos de opciones eliminadas dejan de contarse.
          </p>

          <div className="chart-picker">
            <span>Gráfico de resultados</span>
            <div className="row">
              {CHART_TYPES.map((c) => (
                <button
                  key={c.id}
                  className={style.chartType === c.id ? 'primary' : ''}
                  onClick={() => updateStyle({ chartType: c.id })}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        </fieldset>
      )}

      <fieldset className="card">
        <legend>Diseño</legend>
        <span>Fondo</span>
        <div className="bg-picker">
          {[...BACKGROUNDS, ...imagenes.map((img) => ({ url: img.url, label: img.name, contentTop: null }))].map((bg) => (
            <button
              key={bg.url}
              className={`bg-option ${style.backgroundImage === bg.url ? 'is-selected' : ''}`}
              title={bg.label}
              onClick={() =>
                updateStyle({ backgroundImage: bg.url, ...(bg.contentTop !== null ? { contentTop: bg.contentTop } : {}) })
              }
            >
              <img src={bg.url} alt={bg.label} />
            </button>
          ))}
          <button
            className={`bg-option bg-option--none ${style.backgroundImage ? '' : 'is-selected'}`}
            onClick={() => updateStyle({ backgroundImage: '', contentTop: 0 })}
          >
            Sin imagen
          </button>
          <UploadButton
            label="Subir fondo…"
            onUploaded={(img) => {
              addToGallery(img);
              updateStyle({ backgroundImage: img.url });
            }}
            setError={setError}
          />
        </div>

        <div className="row">
          <label className="inline">
            Fondo
            <input type="color" value={style.background} onChange={(e) => updateStyle({ background: e.target.value })} />
          </label>
          <label className="inline">
            Texto
            <input type="color" value={style.textColor} onChange={(e) => updateStyle({ textColor: e.target.value })} />
          </label>
          <label className="inline">
            Acento
            <input type="color" value={style.accent} onChange={(e) => updateStyle({ accent: e.target.value })} />
          </label>
        </div>
        <Range
          label="Tamaño del texto"
          value={Math.round((style.textScale ?? 1) * 100)}
          min={60}
          max={160}
          unit="%"
          onChange={(v) => updateStyle({ textScale: v / 100 })}
        />
        <Range
          label="Espacio superior libre (cabecera de la imagen)"
          value={style.contentTop ?? 0}
          min={0}
          max={50}
          unit="%"
          onChange={(v) => updateStyle({ contentTop: v })}
        />
        <Range
          label="Oscurecer fondo"
          value={Math.round((style.overlay ?? 0) * 100)}
          min={0}
          max={85}
          unit="%"
          onChange={(v) => updateStyle({ overlay: v / 100 })}
        />
        <button onClick={applyDesignToAll}>Aplicar este diseño a todas las diapositivas</button>
      </fieldset>

      <fieldset className="card">
        <legend>Imagen en la diapositiva</legend>
        {slide.image ? (
          <>
            <div className="row">
              <img className="image-thumb" src={slide.image.url} alt="" />
              <label className="inline">
                Posición
                <select
                  value={slide.image.position}
                  onChange={(e) => updateSlide({ image: { ...slide.image, position: e.target.value } })}
                >
                  {IMAGE_POSITIONS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <button className="danger" onClick={() => updateSlide({ image: null })}>
                Quitar imagen
              </button>
            </div>
            <Range
              label="Tamaño de la imagen"
              value={slide.image.size}
              min={15}
              max={60}
              unit="% del ancho"
              onChange={(v) => updateSlide({ image: { ...slide.image, size: v } })}
            />
          </>
        ) : (
          <div className="row">
            <UploadButton
              label="Subir imagen…"
              onUploaded={(img) => {
                addToGallery(img);
                updateSlide({ image: { url: img.url, position: 'right', size: 35 } });
              }}
              setError={setError}
            />
            {imagenes.length > 0 && (
              <select
                value=""
                onChange={(e) => e.target.value && updateSlide({ image: { url: e.target.value, position: 'right', size: 35 } })}
              >
                <option value="">Usar una imagen ya subida…</option>
                {imagenes.map((img) => (
                  <option key={img.url} value={img.url}>
                    {img.name}
                  </option>
                ))}
              </select>
            )}
            <UrlInput onSubmit={(url) => updateSlide({ image: { url, position: 'right', size: 35 } })} setError={setError} />
          </div>
        )}
      </fieldset>
    </div>
  );
}

function Range({ label, value, min, max, unit, onChange }) {
  return (
    <label>
      {label}: {value}
      {unit}
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function UploadButton({ label, onUploaded, setError }) {
  const [busy, setBusy] = useState(false);
  return (
    <label className={`button ${busy ? 'is-busy' : ''}`}>
      {busy ? 'Subiendo…' : label}
      <input
        type="file"
        accept="image/*"
        hidden
        disabled={busy}
        onChange={async (e) => {
          const file = e.target.files[0];
          e.target.value = '';
          if (!file) return;
          setError('');
          setBusy(true);
          try {
            onUploaded(await uploadImage(file));
          } catch (err) {
            setError(err.message);
          } finally {
            setBusy(false);
          }
        }}
      />
    </label>
  );
}

function UrlInput({ onSubmit, setError }) {
  const [url, setUrl] = useState('');
  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault();
        if (!validImageUrl(url)) return setError('La URL de la imagen no es válida (debe empezar por https:// o /).');
        onSubmit(url.trim());
        setUrl('');
      }}
    >
      <input placeholder="o pega una URL https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
      <button disabled={!url}>Usar</button>
    </form>
  );
}
