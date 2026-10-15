import { useEffect, useState } from 'react';
import { db } from './firebase.js';
import { joinUrl } from './local.js';
import { subscribeAdmin } from './data/sessions.js';

/** Live admin view of a session (Firestore listeners), plus a `run(fn)` helper that reports errors. */
export function useAdminSession(sessionId) {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => subscribeAdmin(db, sessionId, setState, (e) => setError(e.message)), [sessionId]);

  const run = (fn) =>
    Promise.resolve()
      .then(fn)
      .then(() => setError(''))
      .catch((e) => setError(e.message));

  return { state, error, joinUrl: state ? joinUrl(state.session.code) : '', run };
}

/** Derived view of the current slide, using the session snapshot for polls. */
export function currentSlide(state) {
  const slides = state.presentation.slides;
  const index = slides.findIndex((s) => s.id === state.session.currentSlideId);
  const slide = slides[index];
  const poll = state.polls.find((p) => p.slideId === slide?.id);
  const shown =
    slide && poll
      ? { ...slide, title: poll.title, body: poll.body, question: poll.question, options: poll.options, style: poll.style }
      : slide;
  return { slides, index, slide, poll, shown };
}
