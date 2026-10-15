import { useState } from 'react';
import SlideView from '../components/SlideView.jsx';
import QrCode from '../components/QrCode.jsx';
import { db } from '../firebase.js';
import { setShowQr } from '../data/evento.js';
import { plural } from '../letter.js';
import { joinUrl } from '../local.js';
import { SLIDES } from '../simposio.js';
import { currentSlide, useEvento, usePublishResults, useSlideKeys } from '../useAdminSession.js';

const CONTROLS_KEY = 'rss.proyeccion.controles';

/**
 * Projector view. Shows the current slide (results only when shown), the QR in the bottom-right corner
 * and small controls there. Drives the event with arrows / PageUp / PageDown / space (presentation clicker).
 * Double click toggles fullscreen.
 */
export default function Screen() {
  const { state, error, run } = useEvento();
  usePublishResults(state, run);
  useSlideKeys(state, run);
  const [controls, setControls] = useState(() => {
    try {
      return localStorage.getItem(CONTROLS_KEY) !== 'off';
    } catch {
      return true;
    }
  });

  if (!state) return <main className="screen screen--message">{error || 'Conectando…'}</main>;

  const { evento } = state;
  const live = evento.status === 'live';
  const { slide, poll } = live ? currentSlide(state) : { slide: SLIDES[0], poll: null };
  const url = joinUrl();
  const qrVisible = live && evento.showQr;

  const showControls = (on) => {
    setControls(on);
    try {
      localStorage.setItem(CONTROLS_KEY, on ? 'on' : 'off');
    } catch {
      /* ignore */
    }
  };
  // Buttons never keep focus, so a clicker's Space/Enter keeps moving slides instead of pressing them.
  const button = (label, onClick, extra = '') => (
    <button
      className={`screen__btn ${extra}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.currentTarget.blur();
        onClick();
      }}
    >
      {label}
    </button>
  );

  const toggleFullscreen = () =>
    document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();

  return (
    <main className="screen" onDoubleClick={toggleFullscreen} title="Doble clic: pantalla completa">
      <div className={`screen__stage ${qrVisible ? 'screen__stage--qr' : ''}`}>
        <SlideView
          slide={slide}
          results={poll && evento.resultsVisible ? poll : null}
          footer={poll && !evento.resultsVisible && !qrVisible ? <span>{plural(poll.total, 'respuesta')}</span> : null}
        />

        <div className="screen__corner" onDoubleClick={(e) => e.stopPropagation()}>
          {qrVisible && (
            <div className="screen__qr-card">
              <QrCode value={url} size={300} />
              <div className="screen__qr-caption">Escanea para participar</div>
              <div className="screen__qr-url">{url.replace(/^https?:\/\//, '').replace(/\/$/, '')}</div>
            </div>
          )}
          {live && controls && (
            <div className="screen__controls">
              {button(evento.showQr ? 'Ocultar QR' : 'Mostrar QR', () => run(() => setShowQr(db, !evento.showQr)))}
              {button('Ocultar todo', () => {
                if (evento.showQr) run(() => setShowQr(db, false));
                showControls(false);
              })}
            </div>
          )}
          {live && !controls && button('Mostrar controles', () => showControls(true), 'screen__btn--ghost')}
        </div>

        {error && <div className="screen__error">{error}</div>}
      </div>
    </main>
  );
}
