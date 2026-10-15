import { useEffect, useRef, useState } from 'react';
import { call, createSocket, joinUrl } from './api.js';

/** Live admin view of a session: state pushed by the server plus a `send(event, payload)` helper. */
export function useAdminSession(sessionId) {
  const socketRef = useRef(null);
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [url, setUrl] = useState('');

  useEffect(() => {
    const socket = createSocket({ admin: true });
    socketRef.current = socket;
    socket.on('connect', () => {
      setConnected(true);
      call(socket, 'admin:join', { sessionId })
        .then((s) => (setState(s), setError('')))
        .catch((e) => setError(e.message));
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('admin:state', setState);
    return () => socket.close();
  }, [sessionId]);

  const code = state?.session.code;
  useEffect(() => {
    if (code) joinUrl(code).then(setUrl);
  }, [code]);

  const send = (event, payload) =>
    call(socketRef.current, event, { sessionId, ...payload }).catch((e) => setError(e.message));

  return { state, error, connected, joinUrl: url, send };
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
