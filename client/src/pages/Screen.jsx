import SlideView from '../components/SlideView.jsx';
import QrCode from '../components/QrCode.jsx';
import { plural } from '../letter.js';
import { joinUrl } from '../local.js';
import { SLIDES } from '../simposio.js';
import { currentSlide, useEvento, usePublishResults, useSlideKeys } from '../useAdminSession.js';

/**
 * Projector view: only the current slide, the QR in the bottom-right corner when enabled and the results
 * when shown — all controlled from /admin. Arrows / PageUp / PageDown / space (presentation clicker) still
 * change slides here. Double click toggles fullscreen.
 */
export default function Screen() {
  const { state, error, run } = useEvento();
  usePublishResults(state, run);
  useSlideKeys(state, run);

  if (!state) return <main className="screen screen--message">{error || 'Conectando…'}</main>;

  const { evento } = state;
  const live = evento.status === 'live';
  const { slide, poll } = live ? currentSlide(state) : { slide: SLIDES[0], poll: null };
  const url = joinUrl();
  const qrVisible = live && evento.showQr;

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
        {qrVisible && (
          <div className="screen__corner">
            <div className="screen__qr-card">
              <QrCode value={url} size={300} />
              <div className="screen__qr-caption">Escanea para participar</div>
              <div className="screen__qr-url">{url.replace(/^https?:\/\//, '').replace(/\/$/, '')}</div>
            </div>
          </div>
        )}
        {error && <div className="screen__error">{error}</div>}
      </div>
    </main>
  );
}
