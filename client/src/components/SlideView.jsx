import { useLayoutEffect, useRef } from 'react';
import PollChart from './PollChart.jsx';
import { letter } from '../letter.js';

/**
 * Renders a slide with its own visual config.
 * - variant "stage": fixed 16:9 canvas whose text scales with its width (projector, editor, presenter).
 * - variant "mobile": full-width, auto height (audience phones).
 * For polls, pass `results` to show the chart instead of the options (or `renderOptions` to make them interactive).
 */
export default function SlideView({ slide, results, renderOptions, variant = 'stage', footer, hideBody = false }) {
  const rootRef = useRef(null);
  const contentRef = useRef(null);
  useAutoFit(variant === 'stage', rootRef, contentRef, [slide, results, footer, hideBody]);
  const style = slide.style || {};
  const contentTop = Number(style.contentTop) || 0;
  const picture = slide.image?.url ? slide.image : null;
  const hasText = Boolean(slide.title || slide.question || slide.body || slide.type === 'poll');
  const hasContent = hasText || picture;
  const showBody = slide.body && !hideBody && !(variant === 'stage' && results && slide.type === 'poll');
  const image = style.backgroundImage ? `url("${style.backgroundImage}")` : undefined;
  // On phones only the header band of the image is shown; text flows below it on the plain colour.
  const banner = variant === 'mobile' && hasContent && image && contentTop > 0;
  const position = picture ? (variant === 'mobile' ? 'top' : picture.position) : null;

  return (
    <div
      ref={rootRef}
      className={`slide slide--${variant} ${hasContent ? '' : 'slide--image-only'}`}
      style={{
        backgroundColor: style.background,
        backgroundImage: banner ? undefined : image,
        color: style.textColor,
        '--accent': style.accent,
        '--slide-bg': style.background,
        '--content-top': contentTop,
        '--overlay': Number(style.overlay) || 0,
        '--text-scale': Number(style.textScale) || 1,
        '--image-size': picture ? `${picture.size}%` : undefined,
      }}
    >
      {banner && <div className="slide__banner" style={{ backgroundImage: image }} />}
      {hasContent && (
        <div className="slide__content" ref={contentRef}>
          <div className={`slide__layout ${position ? `slide__layout--${position}` : ''}`}>
            {picture && <img className="slide__picture" src={picture.url} alt="" />}
            {hasText && (
              <div className="slide__text">
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
              </div>
            )}
          </div>
          {footer && <div className="slide__footer">{footer}</div>}
        </div>
      )}
    </div>
  );
}

/**
 * Stage slides have a fixed 16:9 box: when the content does not fit (long texts, many options, big text size,
 * an image…), shrink everything proportionally (--fit) until it does. Re-runs when the slide is resized.
 */
function useAutoFit(enabled, rootRef, contentRef, deps) {
  useLayoutEffect(() => {
    const root = rootRef.current;
    const content = contentRef.current;
    if (!enabled || !root || !content) return;
    const fit = () => {
      let f = 1;
      root.style.setProperty('--fit', '1');
      while (content.scrollHeight > content.clientHeight + 1 && f > 0.4) {
        f = Math.round((f - 0.04) * 100) / 100;
        root.style.setProperty('--fit', String(f));
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(root);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);
}
