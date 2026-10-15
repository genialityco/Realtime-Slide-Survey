import { useParams } from 'react-router-dom';
import SlideView from '../components/SlideView.jsx';
import QrCode from '../components/QrCode.jsx';
import { plural } from '../letter.js';
import { currentSlide, useAdminSession } from '../useAdminSession.js';

/** Projector view: only the current slide, results only when the presenter shows them. */
export default function Screen() {
  const { sessionId } = useParams();
  const { state, error, joinUrl } = useAdminSession(sessionId);

  if (!state) return <main className="screen screen--message">{error || 'Conectando…'}</main>;

  const { session } = state;
  const { shown, poll } = currentSlide(state);
  const live = session.status === 'live';

  const toggleFullscreen = () =>
    document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();

  return (
    <main className="screen" onDoubleClick={toggleFullscreen} title="Doble clic: pantalla completa">
      <div className="screen__stage">
        {shown && (
          <SlideView
            slide={shown}
            results={poll?.resultsVisible ? poll : null}
            footer={poll && !poll.resultsVisible && live ? <span>{plural(poll.total, 'respuesta')}</span> : null}
          />
        )}
        {live && session.showQr && (
          <div className="screen__qr">
            <QrCode value={joinUrl} size={360} />
            <div className="screen__qr-text">
              <div>Escanea para participar</div>
              <div className="screen__url">{joinUrl.replace(/^https?:\/\//, '')}</div>
              <div>
                Código <b>{session.code}</b>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
