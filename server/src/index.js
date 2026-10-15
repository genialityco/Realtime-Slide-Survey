import { config } from './config.js';
import { openDb } from './db.js';
import { createServer } from './app.js';
import { seedSimposio } from './seed-simposio.js';

const db = openDb(config.dbFile);
const { server, repo } = createServer(db, {
  staticDir: config.staticDir,
  mediaDir: config.uploadDir,
  bundledMediaDir: config.bundledMediaDir,
  adminPassword: config.adminPassword,
  publicUrl: config.publicUrl,
});

if (config.seedOnEmpty === 'simposio' && repo.listPresentations().length === 0) {
  const p = seedSimposio(repo);
  console.log(`Base de datos vacía: creada la presentación "${p.title}"`);
}

if (!config.adminPassword) {
  console.warn('⚠ ADMIN_PASSWORD no está definido: el panel de administración está abierto a cualquiera.');
}
server.listen(config.port, () =>
  console.log(`Realtime Slide Survey en http://localhost:${config.port} (datos: ${config.dbFile})`),
);
