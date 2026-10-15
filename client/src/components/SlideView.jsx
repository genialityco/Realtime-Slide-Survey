import PollChart from './PollChart.jsx';
import { letter } from '../letter.js';

/**
 * Renders a slide with its own visual config.
 * - variant "stage": fixed 16:9 canvas whose text scales with its width (projector, editor, presenter).
 * - variant "mobile": full-width, auto height (audience phones).
 * For polls, pass `results` to show the chart instead of the options (or `renderOptions` to make them interactive).
 */
export default function SlideView({ slide, results, renderOptions, variant = 'stage', footer, hideBody = false }) {
  const style = slide.style || {};
  const contentTop = Number(style.contentTop) || 0;
  const hasText = Boolean(slide.title || slide.question || slide.body);
  const showBody = slide.body && !hideBody && !(variant === 'stage' && results && slide.type === 'poll');
  const image = style.backgroundImage ? `url("${style.backgroundImage}")` : undefined;
  // On phones only the header band of the image is shown; text flows below it on the plain colour.
  const banner = variant === 'mobile' && hasText && image && contentTop > 0;

  return (
    <div
      className={`slide slide--${variant} ${hasText ? '' : 'slide--image-only'}`}
      style={{
        backgroundColor: style.background,
        backgroundImage: banner ? undefined : image,
        color: style.textColor,
        '--accent': style.accent,
        '--content-top': contentTop,
        '--overlay': Number(style.overlay) || 0,
      }}
    >
      {banner && <div className="slide__banner" style={{ backgroundImage: image }} />}
      {hasText && (
        <div className="slide__content">
          {slide.title && <div className="slide__kicker">{slide.title}</div>}
          {showBody && <p className="slide__body">{slide.body}</p>}
          {slide.question && <h2 className="slide__question">{slide.question}</h2>}
          {slide.type === 'poll' &&
            (results ? (
              <PollChart results={results} chartType={style.chartType} />
            ) : renderOptions ? (
              renderOptions(slide.options)
            ) : (
              <ol className="slide__options">
                {slide.options.map((o, i) => (
                  <li key={o.id ?? i}>
                    <span className="letter">{letter(i)}</span>
                    <span>{o.text}</span>
                  </li>
                ))}
              </ol>
            ))}
          {footer && <div className="slide__footer">{footer}</div>}
        </div>
      )}
    </div>
  );
}
