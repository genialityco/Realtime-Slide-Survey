import { useEffect, useRef, useState } from 'react';
import { db } from './firebase.js';
import { goToSlide, publishResults, subscribeAdmin } from './data/evento.js';
import { findIndex } from './simposio.js';

/** Live admin view of the event (Firestore listeners), plus `run(fn)` that reports errors. */
export function useEvento() {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => subscribeAdmin(db, setState, (e) => setError(e.message)), []);

  const run = (fn) =>
    Promise.resolve()
      .then(fn)
      .then(() => setError(''))
      .catch((e) => setError(e.message));

  return { state, error, run };
}

/** Current slide, its index and (for polls) the live tally. */
export function currentSlide(state) {
  const index = Math.max(0, findIndex(state.slides, state.evento.slideId));
  const slide = state.slides[index];
  const poll = state.polls.find((p) => p.slideId === slide.id) ?? null;
  return { index, slide, poll };
}

const sameCounts = (published, t) =>
  published && published.total === t.total && t.options.every((o) => (published.counts?.[o.id] ?? 0) === o.votes);

/**
 * The audience cannot read votes: while the current poll's results are visible, publish its counts to
 * `evento` (at most ~once per 700 ms, only when they changed). Used by both the presenter and projector.
 */
export function usePublishResults(state, run) {
  const timer = useRef(null);
  const latest = useRef(state);
  latest.current = state;

  useEffect(() => {
    if (!state || state.evento.status !== 'live' || !state.evento.resultsVisible || timer.current) return;
    const { poll } = currentSlide(state);
    if (!poll || sameCounts(state.evento.results, poll)) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      const s = latest.current;
      const p = s && currentSlide(s).poll;
      if (p && s.evento.resultsVisible) run(() => publishResults(db, s.evento, p));
    }, 700);
  });
  useEffect(() => () => clearTimeout(timer.current), []);
}

/** Keyboard / presentation-clicker navigation (arrows, PageUp/PageDown, space). */
export function useSlideKeys(state, run) {
  useEffect(() => {
    if (!state || state.evento.status !== 'live') return;
    const { index } = currentSlide(state);
    const go = (i) => state.slides[i] && run(() => goToSlide(db, state.evento, state.slides[i].id));
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) (e.preventDefault(), go(index + 1));
      if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) (e.preventDefault(), go(index - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
}
