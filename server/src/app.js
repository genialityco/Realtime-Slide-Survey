import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import { nanoid } from 'nanoid';
import { createRepo, AppError } from './repo.js';
import { attendeesCsv, resultsCsv } from './export.js';

const adminRoom = (sessionId) => `admin:${sessionId}`;
const audienceRoom = (sessionId) => `audience:${sessionId}`;

const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ staticDir?: string, mediaDir?: string, bundledMediaDir?: string, adminPassword?: string, publicUrl?: string }} options
 */
export function createServer(db, { staticDir, mediaDir, bundledMediaDir, adminPassword, publicUrl } = {}) {
  const repo = createRepo(db);
  const app = express();
  app.use(cors());
  app.use(express.json());

  // ── Admin access ───────────────────────────────────────────────────────────
  // With no password configured everything is open (local development).
  const digest = (s) => crypto.createHash('sha256').update(String(s ?? '')).digest();
  const isAdminKey = (key) => !adminPassword || crypto.timingSafeEqual(digest(key), digest(adminPassword));
  const requireAdmin = (req, _res, next) =>
    isAdminKey(req.get('x-admin-key')) ? next() : next(new AppError(401, 'Contraseña de administrador requerida'));

  const route = (fn) => (req, res, next) => {
    try {
      const out = fn(req, res);
      if (out !== undefined && out !== res) res.json(out);
    } catch (err) {
      next(err);
    }
  };

  // ── Public endpoints (audience) ────────────────────────────────────────────
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/config', (_req, res) => res.json({ publicUrl: publicUrl || null, adminProtected: !!adminPassword }));
  app.get('/api/admin/check', requireAdmin, (_req, res) => res.json({ ok: true }));

  app.get(
    '/api/join/:code',
    route((req) => {
      const s = repo.getLiveSessionByCode(req.params.code);
      const p = repo.getPresentation(s.presentationId);
      return { sessionId: s.id, code: s.code, title: p.title, cover: p.slides[0]?.style.backgroundImage || null };
    }),
  );
  app.post(
    '/api/join/:code/register',
    route((req, res) => {
      const s = repo.getLiveSessionByCode(req.params.code);
      const attendee = repo.registerAttendee(s.id, req.body);
      scheduleAdminBroadcast(s.id);
      res.status(201).json({ sessionId: s.id, attendee });
    }),
  );

  if (mediaDir) {
    fs.mkdirSync(mediaDir, { recursive: true });
    app.use('/media', express.static(mediaDir, { maxAge: '7d' }));
  }
  if (bundledMediaDir && bundledMediaDir !== mediaDir) {
    app.use('/media', express.static(bundledMediaDir, { maxAge: '7d' }));
  }

  // ── Admin endpoints ────────────────────────────────────────────────────────
  app.use('/api', requireAdmin);

  app.get('/api/presentations', route(() => repo.listPresentations()));
  app.post('/api/presentations', route((req, res) => res.status(201).json(repo.createPresentation(req.body.title))));
  app.get('/api/presentations/:id', route((req) => repo.getPresentation(req.params.id)));
  app.patch('/api/presentations/:id', route((req) => repo.renamePresentation(req.params.id, req.body.title)));

  app.post(
    '/api/presentations/:id/slides',
    route((req, res) => res.status(201).json(repo.addSlide(req.params.id, req.body))),
  );
  app.patch('/api/slides/:id', route((req) => repo.updateSlide(req.params.id, req.body)));
  app.delete('/api/slides/:id', route((req) => repo.deleteSlide(req.params.id)));
  app.post(
    '/api/slides/:id/duplicate',
    route((req, res) => res.status(201).json(repo.duplicateSlide(req.params.id, req.body?.position))),
  );
  app.post('/api/slides/:id/move', route((req) => repo.moveSlide(req.params.id, req.body.position)));

  app.post(
    '/api/media',
    express.raw({ type: Object.keys(IMAGE_TYPES), limit: '15mb' }),
    route((req, res) => {
      const ext = IMAGE_TYPES[req.get('content-type')];
      if (!mediaDir || !ext || !Buffer.isBuffer(req.body) || !req.body.length) {
        throw new AppError(400, 'Sube una imagen JPG, PNG, WEBP o GIF');
      }
      const name = `${nanoid(10)}${ext}`;
      fs.writeFileSync(path.join(mediaDir, name), req.body);
      res.status(201).json({ url: `/media/${name}` });
    }),
  );

  app.post(
    '/api/presentations/:id/sessions',
    route((req, res) => {
      const session = repo.startSession(req.params.id);
      if (session.currentSlideId) repo.goToSlide(session.id, session.currentSlideId);
      res.status(201).json(repo.getSession(session.id));
    }),
  );
  app.get('/api/presentations/:id/sessions', route((req) => repo.listSessions(req.params.id)));
  app.get('/api/sessions/:id', route((req) => repo.getSession(req.params.id)));
  app.get('/api/sessions/:id/report', route((req) => repo.sessionReport(req.params.id)));

  const sendCsv = (res, filename, body) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(body);
  };
  app.get(
    '/api/sessions/:id/export/results.csv',
    route((req, res) => sendCsv(res, `resultados-${req.params.id}.csv`, resultsCsv(repo.sessionReport(req.params.id)))),
  );
  app.get(
    '/api/sessions/:id/export/attendees.csv',
    route((req, res) => sendCsv(res, `asistentes-${req.params.id}.csv`, attendeesCsv(repo.sessionExport(req.params.id)))),
  );

  if (staticDir && fs.existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get(/^\/(?!api|socket\.io|media).*/, (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));
  }

  app.use((err, _req, res, _next) => {
    const status = err instanceof AppError ? err.status : err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message });
  });

  // ── Realtime ───────────────────────────────────────────────────────────────
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*' } });

  /** Part of the audience state that is the same for everyone in the session. */
  function sharedAudienceState(sessionId) {
    const session = repo.getSession(sessionId);
    const base = { sessionId, status: session.status, slide: null, poll: null };
    if (session.status !== 'live' || !session.currentSlideId) return base;

    const slide = repo.getPresentation(session.presentationId).slides.find((s) => s.id === session.currentSlideId);
    if (!slide) return base;
    if (slide.type !== 'poll') {
      const { id, type, title, question, body, style } = slide;
      return { ...base, slide: { id, type, title, question, body, style } };
    }
    const instance = repo.ensureInstance(sessionId, slide.id);
    return {
      ...base,
      slide: {
        id: slide.id,
        type: 'poll',
        title: instance.title,
        body: instance.body,
        question: instance.question,
        options: instance.options,
        style: instance.style,
      },
      poll: {
        pollInstanceId: instance.id,
        resultsVisible: instance.resultsVisible,
        results: instance.resultsVisible ? repo.results(sessionId, slide.id) : null,
      },
    };
  }

  const personalize = (shared, sessionId, attendeeId) =>
    shared.poll
      ? { ...shared, poll: { ...shared.poll, myVote: repo.myVote(sessionId, shared.slide.id, attendeeId) } }
      : shared;

  function adminState(sessionId) {
    const session = repo.getSession(sessionId);
    const presentation = repo.getPresentation(session.presentationId);
    const report = repo.sessionReport(sessionId);
    const connected = io.sockets.adapter.rooms.get(audienceRoom(sessionId))?.size ?? 0;
    return { session, presentation, polls: report.polls, attendeeCount: report.attendeeCount, connected };
  }

  async function broadcastAudience(sessionId) {
    const shared = sharedAudienceState(sessionId);
    const sockets = await io.in(audienceRoom(sessionId)).fetchSockets();
    for (const s of sockets) s.emit('state', personalize(shared, sessionId, s.data.attendeeId));
  }

  function broadcastAdmin(sessionId) {
    clearTimeout(adminTimers.get(sessionId));
    adminTimers.delete(sessionId);
    io.to(adminRoom(sessionId)).emit('admin:state', adminState(sessionId));
  }

  // With ~100 people voting at once, coalesce admin refreshes to a few per second.
  const adminTimers = new Map();
  function scheduleAdminBroadcast(sessionId) {
    if (adminTimers.has(sessionId)) return;
    adminTimers.set(
      sessionId,
      setTimeout(() => {
        adminTimers.delete(sessionId);
        try {
          broadcastAdmin(sessionId);
        } catch (err) {
          console.error(err);
        }
      }, 250),
    );
  }

  // Same idea for the audience's live chart when results are visible.
  const resultTimers = new Map();
  function scheduleResultsBroadcast(sessionId, slideId) {
    const key = `${sessionId}:${slideId}`;
    if (resultTimers.has(key)) return;
    resultTimers.set(
      key,
      setTimeout(() => {
        resultTimers.delete(key);
        const results = repo.results(sessionId, slideId);
        if (results) io.to(audienceRoom(sessionId)).emit('results', results);
      }, 250),
    );
  }

  async function broadcastAll(sessionId) {
    broadcastAdmin(sessionId);
    await broadcastAudience(sessionId);
  }

  /** Wraps a socket handler: (payload, ack) with errors returned through the ack. */
  const handler = (fn) => async (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      reply({ ok: true, data: await fn(payload ?? {}) });
    } catch (err) {
      if (!(err instanceof AppError)) console.error(err);
      reply({ ok: false, error: err.message, status: err.status });
    }
  };

  io.on('connection', (socket) => {
    socket.data.isAdmin = isAdminKey(socket.handshake.auth?.adminKey);
    const adminOnly =
      (fn) =>
      (...args) => {
        if (!socket.data.isAdmin) throw new AppError(401, 'Contraseña de administrador requerida');
        return fn(...args);
      };

    socket.on(
      'audience:join',
      handler(({ code, attendeeId }) => {
        const session = repo.getLiveSessionByCode(code);
        const attendee = repo.getAttendee(session.id, attendeeId);
        if (!attendee) throw new AppError(403, 'not_registered');
        socket.data.attendeeId = attendee.id;
        socket.data.sessionId = session.id;
        socket.join(audienceRoom(session.id));
        scheduleAdminBroadcast(session.id);
        return { attendee, state: personalize(sharedAudienceState(session.id), session.id, attendee.id) };
      }),
    );

    socket.on(
      'vote',
      handler(({ slideId, optionId }) => {
        const sessionId = socket.data.sessionId;
        if (!sessionId) throw new AppError(400, 'Únete a la sesión primero');
        repo.vote({ sessionId, slideId, optionId, participantId: socket.data.attendeeId });
        scheduleAdminBroadcast(sessionId);
        const instance = repo.ensureInstance(sessionId, slideId);
        if (instance.resultsVisible) scheduleResultsBroadcast(sessionId, slideId);
        return { myVote: optionId, results: instance.resultsVisible ? repo.results(sessionId, slideId) : null };
      }),
    );

    socket.on(
      'admin:join',
      handler(
        adminOnly(({ sessionId }) => {
          repo.getSession(sessionId);
          socket.join(adminRoom(sessionId));
          return adminState(sessionId);
        }),
      ),
    );

    socket.on(
      'admin:goto',
      handler(
        adminOnly(async ({ sessionId, slideId }) => {
          repo.goToSlide(sessionId, slideId);
          await broadcastAll(sessionId);
        }),
      ),
    );

    socket.on(
      'admin:results',
      handler(
        adminOnly(async ({ sessionId, slideId, visible }) => {
          repo.setResultsVisible(sessionId, slideId, visible);
          await broadcastAll(sessionId);
        }),
      ),
    );

    socket.on(
      'admin:qr',
      handler(
        adminOnly(({ sessionId, visible }) => {
          repo.setShowQr(sessionId, visible);
          broadcastAdmin(sessionId);
        }),
      ),
    );

    socket.on(
      'admin:end',
      handler(
        adminOnly(async ({ sessionId }) => {
          repo.endSession(sessionId);
          await broadcastAll(sessionId);
        }),
      ),
    );

    socket.on('disconnect', () => {
      if (socket.data.sessionId) scheduleAdminBroadcast(socket.data.sessionId);
    });
  });

  return { app, server, io, repo };
}
