import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR || serverDir;

export const config = {
  port: Number(process.env.PORT) || 3001,
  dbFile: process.env.DB_FILE || path.join(dataDir, 'data.db'),
  /** Where admin uploads go (must be persistent in production). */
  uploadDir: process.env.MEDIA_DIR || path.join(dataDir, 'media'),
  /** Images shipped with the repo (1.jpg, 2.jpg), always served under /media. */
  bundledMediaDir: path.join(serverDir, 'media'),
  staticDir: path.join(serverDir, '..', 'client', 'dist'),
  adminPassword: process.env.ADMIN_PASSWORD || '',
  publicUrl: process.env.PUBLIC_URL || '',
  /** "simposio" creates the symposium presentation when the database has none. */
  seedOnEmpty: process.env.SEED_ON_EMPTY || '',
};
