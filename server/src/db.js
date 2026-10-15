import Database from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS presentations (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Slides are soft-deleted so past sessions keep a valid reference to them.
CREATE TABLE IF NOT EXISTS slides (
  id                TEXT PRIMARY KEY,
  presentation_id   TEXT NOT NULL REFERENCES presentations(id),
  position          INTEGER NOT NULL,
  type              TEXT NOT NULL CHECK (type IN ('poll', 'content')),
  question          TEXT NOT NULL DEFAULT '',
  body              TEXT NOT NULL DEFAULT '',
  options           TEXT NOT NULL DEFAULT '[]',  -- JSON [{ id, text }]
  style             TEXT NOT NULL DEFAULT '{}',  -- JSON visual config
  source_slide_id   TEXT REFERENCES slides(id),  -- set when the slide is a duplicate
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_slides_presentation ON slides(presentation_id, position);

-- One run of a presentation. Results never cross session boundaries.
CREATE TABLE IF NOT EXISTS sessions (
  id                TEXT PRIMARY KEY,
  presentation_id   TEXT NOT NULL REFERENCES presentations(id),
  code              TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('live', 'ended')),
  current_slide_id  TEXT REFERENCES slides(id),
  started_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ended_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_presentation ON sessions(presentation_id);
CREATE INDEX IF NOT EXISTS idx_sessions_code ON sessions(code, status);

-- A poll slide as it ran in a given session. Question/options are snapshotted so
-- later edits to the slide do not rewrite historical results.
CREATE TABLE IF NOT EXISTS poll_instances (
  id               TEXT PRIMARY KEY,
  session_id       TEXT NOT NULL REFERENCES sessions(id),
  slide_id         TEXT NOT NULL REFERENCES slides(id),
  question         TEXT NOT NULL,
  options          TEXT NOT NULL,
  style            TEXT NOT NULL,
  results_visible  INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (session_id, slide_id)
);

-- People registered for a session (name, national id, email). Votes reference attendees.id.
CREATE TABLE IF NOT EXISTS attendees (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES sessions(id),
  name        TEXT NOT NULL,
  cedula      TEXT NOT NULL,
  email       TEXT NOT NULL,
  consent_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (session_id, cedula)
);

CREATE TABLE IF NOT EXISTS votes (
  id                TEXT PRIMARY KEY,
  poll_instance_id  TEXT NOT NULL REFERENCES poll_instances(id),
  session_id        TEXT NOT NULL REFERENCES sessions(id),
  slide_id          TEXT NOT NULL REFERENCES slides(id),
  option_id         TEXT NOT NULL,
  participant_id    TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (poll_instance_id, participant_id)
);
CREATE INDEX IF NOT EXISTS idx_votes_instance ON votes(poll_instance_id);
`;

export function openDb(file = process.env.DB_FILE || 'data.db') {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Additive column migrations for databases created by earlier versions. */
function migrate(db) {
  const addColumn = (table, column, ddl) => {
    const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
    if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  };
  addColumn('slides', 'title', "title TEXT NOT NULL DEFAULT ''");
  addColumn('poll_instances', 'title', "title TEXT NOT NULL DEFAULT ''");
  addColumn('poll_instances', 'body', "body TEXT NOT NULL DEFAULT ''");
  addColumn('sessions', 'show_qr', 'show_qr INTEGER NOT NULL DEFAULT 0');
}
