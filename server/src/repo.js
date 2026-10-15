import { customAlphabet, nanoid } from 'nanoid';

const joinCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const DEFAULT_STYLE = Object.freeze({
  background: '#1e1b4b',
  textColor: '#ffffff',
  accent: '#f59e0b',
  chartType: 'bar', // 'bar' (horizontal) | 'column'
  backgroundImage: '', // URL, e.g. /media/2.jpg
  overlay: 0, // 0..0.85 darkening layer between the image and the text
  contentTop: 0, // % of slide height kept clear at the top (e.g. a header baked into the image)
});

const MAX_OPTIONS = 10;

function parseSlide(row) {
  if (!row) return null;
  return {
    id: row.id,
    presentationId: row.presentation_id,
    position: row.position,
    type: row.type,
    title: row.title,
    question: row.question,
    body: row.body,
    options: JSON.parse(row.options),
    style: JSON.parse(row.style),
    sourceSlideId: row.source_slide_id,
    createdAt: row.created_at,
  };
}

function parseSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    presentationId: row.presentation_id,
    code: row.code,
    status: row.status,
    currentSlideId: row.current_slide_id,
    showQr: !!row.show_qr,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

function parseInstance(row) {
  if (!row) return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    slideId: row.slide_id,
    title: row.title,
    body: row.body,
    question: row.question,
    options: JSON.parse(row.options),
    style: JSON.parse(row.style),
    resultsVisible: !!row.results_visible,
    createdAt: row.created_at,
  };
}

function normalizeOptions(options, { keepIds = true } = {}) {
  if (!Array.isArray(options)) throw new AppError(400, 'options must be an array');
  const out = options
    .map((o) => (typeof o === 'string' ? { text: o } : o))
    .map((o) => ({
      id: keepIds && typeof o.id === 'string' && o.id ? o.id : nanoid(8),
      text: String(o.text ?? '').trim(),
    }))
    .filter((o) => o.text);
  if (out.length > MAX_OPTIONS) throw new AppError(400, `at most ${MAX_OPTIONS} options`);
  return out;
}

function normalizeStyle(style) {
  const s = { ...DEFAULT_STYLE, ...(style && typeof style === 'object' ? style : {}) };
  if (!['bar', 'column'].includes(s.chartType)) s.chartType = DEFAULT_STYLE.chartType;
  const image = String(s.backgroundImage ?? '').trim();
  if (image && !/^(\/|https?:\/\/)[\w\-./:%?=&~+]*$/.test(image)) {
    throw new AppError(400, 'invalid background image URL');
  }
  const overlay = Number(s.overlay);
  const contentTop = Number(s.contentTop);
  return {
    background: String(s.background),
    textColor: String(s.textColor),
    accent: String(s.accent),
    chartType: s.chartType,
    backgroundImage: image,
    overlay: Number.isFinite(overlay) ? Math.max(0, Math.min(0.85, overlay)) : 0,
    contentTop: Number.isFinite(contentTop) ? Math.max(0, Math.min(50, contentTop)) : 0,
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function normalizeAttendee({ name, cedula, email, consent } = {}) {
  const out = {
    name: String(name ?? '').trim().replace(/\s+/g, ' '),
    cedula: String(cedula ?? '').replace(/[\s.\-]/g, ''),
    email: String(email ?? '').trim().toLowerCase(),
  };
  if (out.name.length < 3 || out.name.length > 120) throw new AppError(400, 'Escribe tu nombre completo.');
  if (!/^\d{5,15}$/.test(out.cedula)) throw new AppError(400, 'La cédula debe tener solo números (5 a 15 dígitos).');
  if (!EMAIL_RE.test(out.email) || out.email.length > 160) throw new AppError(400, 'El correo no es válido.');
  if (consent !== true) throw new AppError(400, 'Debes autorizar el tratamiento de tus datos personales.');
  return out;
}

/** A, B, C… for option index i. */
export const letter = (i) => String.fromCharCode(65 + i);

export function createRepo(db) {
  const q = {
    insertPresentation: db.prepare('INSERT INTO presentations (id, title) VALUES (?, ?)'),
    getPresentation: db.prepare('SELECT * FROM presentations WHERE id = ?'),
    listPresentations: db.prepare('SELECT * FROM presentations ORDER BY created_at DESC'),
    renamePresentation: db.prepare('UPDATE presentations SET title = ? WHERE id = ?'),

    listSlides: db.prepare(
      'SELECT * FROM slides WHERE presentation_id = ? AND deleted_at IS NULL ORDER BY position, created_at',
    ),
    getSlide: db.prepare('SELECT * FROM slides WHERE id = ?'),
    insertSlide: db.prepare(`
      INSERT INTO slides (id, presentation_id, position, type, title, question, body, options, style, source_slide_id)
      VALUES (@id, @presentationId, @position, @type, @title, @question, @body, @options, @style, @sourceSlideId)`),
    updateSlide: db.prepare(`
      UPDATE slides SET title = @title, question = @question, body = @body, options = @options, style = @style
      WHERE id = @id`),
    setSlidePosition: db.prepare('UPDATE slides SET position = ? WHERE id = ?'),
    softDeleteSlide: db.prepare(
      "UPDATE slides SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
    ),

    insertSession: db.prepare(
      "INSERT INTO sessions (id, presentation_id, code, status, current_slide_id) VALUES (?, ?, ?, 'live', ?)",
    ),
    getSession: db.prepare('SELECT * FROM sessions WHERE id = ?'),
    getLiveSessionByCode: db.prepare("SELECT * FROM sessions WHERE code = ? AND status = 'live'"),
    listSessions: db.prepare('SELECT * FROM sessions WHERE presentation_id = ? ORDER BY started_at DESC'),
    setCurrentSlide: db.prepare('UPDATE sessions SET current_slide_id = ? WHERE id = ?'),
    setShowQr: db.prepare('UPDATE sessions SET show_qr = ? WHERE id = ?'),
    endSession: db.prepare(
      "UPDATE sessions SET status = 'ended', ended_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
    ),

    getInstance: db.prepare('SELECT * FROM poll_instances WHERE session_id = ? AND slide_id = ?'),
    getInstanceById: db.prepare('SELECT * FROM poll_instances WHERE id = ?'),
    listInstances: db.prepare('SELECT * FROM poll_instances WHERE session_id = ? ORDER BY created_at'),
    insertInstance: db.prepare(`
      INSERT INTO poll_instances (id, session_id, slide_id, title, body, question, options, style)
      VALUES (@id, @sessionId, @slideId, @title, @body, @question, @options, @style)`),
    setResultsVisible: db.prepare('UPDATE poll_instances SET results_visible = ? WHERE id = ?'),

    insertVote: db.prepare(`
      INSERT INTO votes (id, poll_instance_id, session_id, slide_id, option_id, participant_id)
      VALUES (@id, @pollInstanceId, @sessionId, @slideId, @optionId, @participantId)
      ON CONFLICT (poll_instance_id, participant_id) DO NOTHING`),
    getVote: db.prepare('SELECT option_id FROM votes WHERE poll_instance_id = ? AND participant_id = ?'),
    countVotes: db.prepare(
      'SELECT option_id, COUNT(*) AS n FROM votes WHERE poll_instance_id = ? GROUP BY option_id',
    ),
    sessionVotes: db.prepare('SELECT poll_instance_id, participant_id, option_id FROM votes WHERE session_id = ?'),

    insertAttendee: db.prepare(`
      INSERT INTO attendees (id, session_id, name, cedula, email, consent_at)
      VALUES (@id, @sessionId, @name, @cedula, @email, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT (session_id, cedula) DO UPDATE SET name = excluded.name, email = excluded.email`),
    getAttendeeByCedula: db.prepare('SELECT * FROM attendees WHERE session_id = ? AND cedula = ?'),
    getAttendee: db.prepare('SELECT * FROM attendees WHERE id = ? AND session_id = ?'),
    listAttendees: db.prepare('SELECT * FROM attendees WHERE session_id = ? ORDER BY created_at'),
    countAttendees: db.prepare('SELECT COUNT(*) AS n FROM attendees WHERE session_id = ?'),
  };

  function requirePresentation(id) {
    const row = q.getPresentation.get(id);
    if (!row) throw new AppError(404, 'presentation not found');
    return row;
  }

  function requireSlide(id) {
    const row = q.getSlide.get(id);
    if (!row || row.deleted_at) throw new AppError(404, 'slide not found');
    return row;
  }

  function requireSession(id) {
    const row = parseSession(q.getSession.get(id));
    if (!row) throw new AppError(404, 'session not found');
    return row;
  }

  function requireLive(session) {
    if (session.status !== 'live') throw new AppError(409, 'session has ended');
  }

  /** Rewrites positions 0..n-1 following `orderedIds`. */
  function writeOrder(orderedIds) {
    orderedIds.forEach((id, i) => q.setSlidePosition.run(i, id));
  }

  function clampIndex(position, length) {
    if (position === undefined || position === null) return length;
    const n = Number(position);
    if (!Number.isInteger(n)) throw new AppError(400, 'position must be an integer');
    return Math.max(0, Math.min(n, length));
  }

  /** Inserts a slide row at `position` (0-based, defaults to the end) and reindexes. */
  const insertSlideAt = db.transaction((presentationId, data, position) => {
    const ids = q.listSlides.all(presentationId).map((s) => s.id);
    const index = clampIndex(position, ids.length);
    const id = nanoid(12);
    q.insertSlide.run({ ...data, id, presentationId, position: index });
    ids.splice(index, 0, id);
    writeOrder(ids);
    return id;
  });

  function validateSlideInput(type, input) {
    const title = String(input.title ?? '').trim();
    const question = String(input.question ?? '').trim();
    const options = type === 'poll' ? normalizeOptions(input.options ?? []) : [];
    if (type === 'poll' && options.length < 2) {
      throw new AppError(400, 'a poll needs at least 2 options');
    }
    return {
      title,
      question,
      body: String(input.body ?? ''),
      options: JSON.stringify(options),
      style: JSON.stringify(normalizeStyle(input.style)),
    };
  }

  function counts(instance) {
    const byOption = Object.fromEntries(q.countVotes.all(instance.id).map((r) => [r.option_id, r.n]));
    const options = instance.options.map((o) => ({ ...o, votes: byOption[o.id] ?? 0 }));
    return {
      sessionId: instance.sessionId,
      slideId: instance.slideId,
      pollInstanceId: instance.id,
      total: options.reduce((sum, o) => sum + o.votes, 0),
      options,
    };
  }

  /** Lazily creates the per-session poll instance, snapshotting the slide content. */
  const ensureInstance = db.transaction((sessionId, slideId) => {
    const existing = parseInstance(q.getInstance.get(sessionId, slideId));
    if (existing) return existing;
    const slide = parseSlide(requireSlide(slideId));
    if (slide.type !== 'poll') return null;
    q.insertInstance.run({
      id: nanoid(12),
      sessionId,
      slideId,
      title: slide.title,
      body: slide.body,
      question: slide.question,
      options: JSON.stringify(slide.options),
      style: JSON.stringify(slide.style),
    });
    return parseInstance(q.getInstance.get(sessionId, slideId));
  });

  const repo = {
    // ── Presentations ────────────────────────────────────────────────────────
    createPresentation(title) {
      const id = nanoid(12);
      q.insertPresentation.run(id, String(title || 'Untitled presentation').trim());
      return repo.getPresentation(id);
    },

    listPresentations() {
      return q.listPresentations.all().map((p) => ({ id: p.id, title: p.title, createdAt: p.created_at }));
    },

    getPresentation(id) {
      const p = requirePresentation(id);
      return {
        id: p.id,
        title: p.title,
        createdAt: p.created_at,
        slides: q.listSlides.all(id).map(parseSlide),
      };
    },

    renamePresentation(id, title) {
      requirePresentation(id);
      q.renamePresentation.run(String(title).trim(), id);
      return repo.getPresentation(id);
    },

    // ── Slides ───────────────────────────────────────────────────────────────
    addSlide(presentationId, input = {}) {
      requirePresentation(presentationId);
      const type = input.type === 'content' ? 'content' : 'poll';
      const defaults =
        type === 'poll'
          ? { question: 'Nueva pregunta', options: ['Opción A', 'Opción B'] }
          : { question: 'Título', body: '' };
      const data = validateSlideInput(type, { ...defaults, ...input });
      const id = insertSlideAt(presentationId, { ...data, type, sourceSlideId: null }, input.position);
      return parseSlide(q.getSlide.get(id));
    },

    updateSlide(id, input = {}) {
      const current = parseSlide(requireSlide(id));
      const merged = {
        title: input.title ?? current.title,
        question: input.question ?? current.question,
        body: input.body ?? current.body,
        options: input.options ?? current.options,
        style: { ...current.style, ...(input.style ?? {}) },
      };
      q.updateSlide.run({ id, ...validateSlideInput(current.type, merged) });
      return parseSlide(q.getSlide.get(id));
    },

    /**
     * Copies question, options and visual config into a brand-new slide with its own id.
     * Option ids are regenerated too, so nothing is shared with the original.
     * `position` is the 0-based index for the copy; defaults to right after the original.
     */
    duplicateSlide(id, position) {
      const original = parseSlide(requireSlide(id));
      const data = {
        type: original.type,
        title: original.title,
        question: original.question,
        body: original.body,
        options: JSON.stringify(normalizeOptions(original.options, { keepIds: false })),
        style: JSON.stringify(original.style),
        sourceSlideId: original.id,
      };
      const ids = q.listSlides.all(original.presentationId).map((s) => s.id);
      const target = position ?? ids.indexOf(original.id) + 1;
      const newId = insertSlideAt(original.presentationId, data, target);
      return parseSlide(q.getSlide.get(newId));
    },

    moveSlide: db.transaction((id, position) => {
      const slide = requireSlide(id);
      const ids = q.listSlides.all(slide.presentation_id).map((s) => s.id).filter((x) => x !== id);
      ids.splice(clampIndex(position, ids.length), 0, id);
      writeOrder(ids);
      return repo.getPresentation(slide.presentation_id);
    }),

    deleteSlide: db.transaction((id) => {
      const slide = requireSlide(id);
      q.softDeleteSlide.run(id);
      writeOrder(q.listSlides.all(slide.presentation_id).map((s) => s.id));
      return repo.getPresentation(slide.presentation_id);
    }),

    // ── Sessions ─────────────────────────────────────────────────────────────
    startSession(presentationId) {
      requirePresentation(presentationId);
      const first = q.listSlides.all(presentationId)[0];
      const id = nanoid(12);
      let code;
      do code = joinCode();
      while (q.getLiveSessionByCode.get(code));
      q.insertSession.run(id, presentationId, code, first?.id ?? null);
      return requireSession(id);
    },

    getSession: requireSession,

    getLiveSessionByCode(code) {
      const s = parseSession(q.getLiveSessionByCode.get(String(code).toUpperCase()));
      if (!s) throw new AppError(404, 'no live session with that code');
      return s;
    },

    listSessions(presentationId) {
      requirePresentation(presentationId);
      return q.listSessions.all(presentationId).map((row) => {
        const s = parseSession(row);
        const instances = q.listInstances.all(s.id).map(parseInstance);
        const totalVotes = instances.reduce((sum, i) => sum + counts(i).total, 0);
        return { ...s, pollCount: instances.length, totalVotes };
      });
    },

    goToSlide(sessionId, slideId) {
      const session = requireSession(sessionId);
      requireLive(session);
      const slide = requireSlide(slideId);
      if (slide.presentation_id !== session.presentationId) {
        throw new AppError(400, 'slide does not belong to this presentation');
      }
      q.setCurrentSlide.run(slideId, sessionId);
      ensureInstance(sessionId, slideId);
      return requireSession(sessionId);
    },

    setShowQr(sessionId, visible) {
      requireLive(requireSession(sessionId));
      q.setShowQr.run(visible ? 1 : 0, sessionId);
      return requireSession(sessionId);
    },

    endSession(sessionId) {
      const session = requireSession(sessionId);
      requireLive(session);
      q.endSession.run(sessionId);
      return requireSession(sessionId);
    },

    // ── Attendees ────────────────────────────────────────────────────────────
    /** Registers (or re-identifies, by cédula) a person for a live session. */
    registerAttendee(sessionId, input) {
      requireLive(requireSession(sessionId));
      const data = normalizeAttendee(input);
      q.insertAttendee.run({ id: nanoid(14), sessionId, ...data });
      const row = q.getAttendeeByCedula.get(sessionId, data.cedula);
      return { id: row.id, name: row.name };
    },

    getAttendee(sessionId, attendeeId) {
      const row = attendeeId && q.getAttendee.get(String(attendeeId), sessionId);
      return row ? { id: row.id, name: row.name } : null;
    },

    attendeeCount: (sessionId) => q.countAttendees.get(sessionId).n,

    // ── Polls ────────────────────────────────────────────────────────────────
    ensureInstance,

    setResultsVisible(sessionId, slideId, visible) {
      const session = requireSession(sessionId);
      requireLive(session);
      const instance = ensureInstance(sessionId, slideId);
      if (!instance) throw new AppError(400, 'slide is not a poll');
      q.setResultsVisible.run(visible ? 1 : 0, instance.id);
      return parseInstance(q.getInstanceById.get(instance.id));
    },

    vote({ sessionId, slideId, optionId, participantId }) {
      const session = requireSession(sessionId);
      requireLive(session);
      if (!repo.getAttendee(sessionId, participantId)) throw new AppError(403, 'Regístrate antes de votar.');
      if (session.currentSlideId !== slideId) throw new AppError(409, 'this poll is not active');
      const instance = ensureInstance(sessionId, slideId);
      if (!instance) throw new AppError(400, 'slide is not a poll');
      if (!instance.options.some((o) => o.id === optionId)) throw new AppError(400, 'unknown option');
      const { changes } = q.insertVote.run({
        id: nanoid(14),
        pollInstanceId: instance.id,
        sessionId,
        slideId,
        optionId,
        participantId: String(participantId),
      });
      if (!changes) throw new AppError(409, 'already voted');
      return counts(instance);
    },

    myVote(sessionId, slideId, participantId) {
      const instance = parseInstance(q.getInstance.get(sessionId, slideId));
      if (!instance || !participantId) return null;
      return q.getVote.get(instance.id, String(participantId))?.option_id ?? null;
    },

    results(sessionId, slideId) {
      const instance = parseInstance(q.getInstance.get(sessionId, slideId));
      return instance ? counts(instance) : null;
    },

    /** Full, persisted results of one session: one entry per poll instance. */
    sessionReport(sessionId) {
      const session = requireSession(sessionId);
      const presentation = requirePresentation(session.presentationId);
      const slides = new Map(
        db
          .prepare('SELECT id, position, deleted_at FROM slides WHERE presentation_id = ?')
          .all(session.presentationId)
          .map((s) => [s.id, s]),
      );
      const polls = q
        .listInstances.all(sessionId)
        .map(parseInstance)
        .map((i) => ({
          ...counts(i),
          title: i.title,
          body: i.body,
          question: i.question,
          style: i.style,
          resultsVisible: i.resultsVisible,
          slidePosition: slides.get(i.slideId)?.position ?? null,
          slideDeleted: !!slides.get(i.slideId)?.deleted_at,
        }))
        .sort((a, b) => (a.slidePosition ?? 1e9) - (b.slidePosition ?? 1e9));
      return {
        session,
        presentation: { id: presentation.id, title: presentation.title },
        attendeeCount: repo.attendeeCount(sessionId),
        polls,
      };
    },

    /** Report plus attendees and a lookup of each attendee's answer per poll instance. */
    sessionExport(sessionId) {
      const report = repo.sessionReport(sessionId);
      const attendees = q.listAttendees.all(sessionId).map((a) => ({
        id: a.id,
        name: a.name,
        cedula: a.cedula,
        email: a.email,
        registeredAt: a.created_at,
      }));
      const votes = new Map();
      for (const v of q.sessionVotes.all(sessionId)) votes.set(`${v.poll_instance_id}:${v.participant_id}`, v.option_id);
      return { ...report, attendees, voteOf: (pollInstanceId, attendeeId) => votes.get(`${pollInstanceId}:${attendeeId}`) };
    },
  };

  return repo;
}
