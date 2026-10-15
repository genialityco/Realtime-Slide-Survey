import SlideView from '../components/SlideView.jsx';
import QrCode from '../components/QrCode.jsx';
import { plural } from '../letter.js';
import { joinUrl } from '../local.js';
import { SLIDES } from '../simposio.js';
import { currentSlide, useEvento, usePublishResults, useSlideKeys } from '../useAdminSession.js';

/**
 * Projector view. Shows the current slide (results only when shown) and can drive the event itself:
 * arrows / PageUp / PageDown / space, i.e. a presentation clicker. Double click toggles fullscreen.
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

  const toggleFullscreen = () =>
    document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();

  return (
    <main className="screen" onDoubleClick={toggleFullscreen} title="Doble clic: pantalla completa">
      <div className="screen__stage">
        <SlideView
          slide={slide}
          results={poll && evento.resultsVisible ? poll : null}
          footer={poll && !evento.resultsVisible ? <span>{plural(poll.total, 'respuesta')}</span> : null}
        />
        {live && evento.showQr && (
          <div className="screen__qr">
            <QrCode value={url} size={360} />
            <div className="screen__qr-text">
              <div>Escanea para participar</div>
              <div className="screen__url">{url.replace(/^https?:\/\//, '')}</div>
            </div>
          </div>
        )}
        {error && <div className="screen__error">{error}</div>}
      </div>
    </main>
  );
}
