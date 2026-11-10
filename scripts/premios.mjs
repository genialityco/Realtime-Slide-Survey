// Premios Geniality on the published app, without deploying code: uploads the images to Firebase Storage
// and writes the slides (simposio_leucemias_2026/presentacion), then keeps the «winner» slides up to date
// from the votes. Uses the public web config (client/.env.production.local); the project's rules are open.
//
//   node scripts/premios.mjs subir                 backs up the current slides and uploads the Premios ones
//   node scripts/premios.mjs ganadores             writes the winners of the current (or last) session once
//   node scripts/premios.mjs ganadores --watch     …and keeps them updated while votes come in (Ctrl+C ends)
//   node scripts/premios.mjs restaurar <archivo>   puts a backup back (e.g. the symposium slides)
//
// Options: --fotos <carpeta> (default D:/Escritorio/Imagenes/empresa), --forzar (upload during a live session).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase/app';
import { collection, doc, getDoc, getDocs, getFirestore, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';
import { CATEGORIAS } from './premios/contenido.mjs';

const ROOT = 'simposio_leucemias_2026'; // the namespace the published app reads
const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, 'premios');
const BACKUPS = join(ASSETS, 'respaldos');
const STORAGE_DIR = `${ROOT}/imagenes/premios`;

const args = process.argv.slice(2);
const command = args[0];
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const FOTOS = option('fotos', 'D:/Escritorio/Imagenes/empresa');

// ── Firebase ───────────────────────────────────────────────────────────────

const envFile = join(HERE, '..', 'client', '.env.production.local');
const env = Object.fromEntries(
  readFileSync(envFile, 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^VITE_\w+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  appId: env.VITE_FIREBASE_APP_ID,
});
const db = getFirestore(app);
const storage = getStorage(app);
const presentacionRef = doc(db, ROOT, 'presentacion');
const eventoRef = doc(db, ROOT, 'evento');

/** Uploads bytes to Storage (once: an existing file at that path is reused) and returns its URL. */
async function upload(name, bytes, contentType, { reuse = true } = {}) {
  const r = ref(storage, `${STORAGE_DIR}/${name}`);
  if (reuse) {
    try {
      return await getDownloadURL(r);
    } catch {
      /* not uploaded yet */
    }
  }
  await uploadBytes(r, bytes, { contentType, cacheControl: 'public, max-age=31536000' });
  return getDownloadURL(r);
}

// ── Team photos and composed images (SVG with the PNG photos embedded) ─────

const NAMES = { juanc: 'Juan C', juanf: 'Juan F' };
const PHOTO_W = 357;
const PHOTO_H = 483;

/** The team, in file order: «Recurso 16stefanny nombre.png» → { id: 'stefanny', text: 'Stefanny', png }. */
function loadTeam() {
  if (!existsSync(FOTOS)) throw new Error(`No existe la carpeta de fotos: ${FOTOS}`);
  const team = readdirSync(FOTOS)
    .map((file) => ({ file, m: file.match(/^\D*(\d+)\s*([a-z]+)\b.*\.png$/i) }))
    .filter(({ m }) => m)
    .sort((a, b) => Number(a.m[1]) - Number(b.m[1]))
    .map(({ file, m }) => {
      const id = m[2].toLowerCase();
      return {
        id,
        text: NAMES[id] ?? id[0].toUpperCase() + id.slice(1),
        png: readFileSync(join(FOTOS, file)).toString('base64'),
      };
    });
  if (team.length < 2 || team.length > 10) throw new Error(`Se necesitan entre 2 y 10 fotos PNG en ${FOTOS} (hay ${team.length})`);
  return team;
}

const photo = (p, x, y) =>
  `<image x="${x}" y="${y}" width="${PHOTO_W}" height="${PHOTO_H}" href="data:image/png;base64,${p.png}"/>`;

/** 3-column grid of every photo with the option letter (A, B, C…) on each, as the poll shows them. */
function gridSvg(team) {
  const cols = 3;
  const gap = 24;
  const rows = Math.ceil(team.length / cols);
  const w = cols * PHOTO_W + (cols - 1) * gap;
  const h = rows * PHOTO_H + (rows - 1) * gap;
  const cells = team.map((p, i) => {
    const x = (i % cols) * (PHOTO_W + gap);
    const y = Math.floor(i / cols) * (PHOTO_H + gap);
    const letter = String.fromCharCode(65 + i);
    return `${photo(p, x, y)}<circle cx="${x + 46}" cy="${y + 46}" r="40" fill="#38bdf8"/><text x="${x + 46}" y="${y + 47}" text-anchor="middle" dominant-baseline="central" font-family="Arial, sans-serif" font-weight="700" font-size="46" fill="#0a1226">${letter}</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${cells.join('')}</svg>`;
}

/** The winner(s) side by side. */
function winnersSvg(winners) {
  const gap = 40;
  const w = winners.length * PHOTO_W + (winners.length - 1) * gap;
  const cells = winners.map((p, i) => photo(p, i * (PHOTO_W + gap), 0));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${PHOTO_H}" width="${w}" height="${PHOTO_H}">${cells.join('')}</svg>`;
}

const svgBytes = (svg) => new TextEncoder().encode(svg);

// ── Slides ─────────────────────────────────────────────────────────────────

const STYLE = {
  background: '#0a1226',
  textColor: '#ffffff',
  accent: '#38bdf8',
  chartType: 'bar',
  backgroundImage: '', // set to the uploaded background
  overlay: 0,
  contentTop: 0,
  textScale: 1,
  textAlign: 'left',
};

const pollId = (i) => `premio-${i + 1}`;
const winnerId = (i) => `premio-${i + 1}-ganador`;

/** Winner slide: before any vote «¿Quién será?», then the photo(s) of the most voted person(s). */
function winnerSlide(i, style, result) {
  const [, , kicker, titulo, descripcion] = CATEGORIAS[i];
  const base = {
    id: winnerId(i),
    type: 'content',
    title: `🏆 ${kicker} · ${titulo}`,
    options: [],
    style: { ...style, textScale: 1.35, contentTop: 14 },
  };
  if (!result?.winners.length) {
    return { ...base, body: descripcion, question: '¿Quién será? 🥁', image: null };
  }
  const { winners, votes } = result;
  const names = winners.map((w) => w.text);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} y ${names.at(-1)}` : names[0];
  const count = `${votes} ${votes === 1 ? 'voto' : 'votos'}${winners.length > 1 ? ' cada uno' : ''}`;
  return {
    ...base,
    body: `${descripcion}\n\n**${winners.length > 1 ? '¡Empate! ' : ''}${count}**`,
    question: `¡${list}!`,
    image: { url: result.url, position: 'left', size: Math.min(60, 30 + 14 * (winners.length - 1)) },
  };
}

async function buildSlides(team, urls) {
  const style = { ...STYLE, backgroundImage: urls.fondo };
  const imageOnly = (id, url) => ({
    id,
    type: 'content',
    title: '',
    body: '',
    question: '',
    options: [],
    style: { ...style, backgroundImage: url },
    image: null,
  });
  return [
    imageOnly('premios-portada', urls.portada),
    ...CATEGORIAS.flatMap(([titulo, texto], i) => [
      {
        id: pollId(i),
        type: 'poll',
        title: 'Categoría oficial',
        body: texto,
        question: titulo,
        options: team.map(({ id, text }) => ({ id, text })),
        style,
        image: { url: urls.grid, position: 'right', size: 42 },
      },
      winnerSlide(i, style, null),
    ]),
    imageOnly('premios-cierre', urls.cierre),
  ];
}

const optionIdsOf = (slides) => Object.fromEntries(slides.map((s) => [s.id, s.options.map((o) => o.id)]));

// ── Commands ───────────────────────────────────────────────────────────────

async function subir() {
  const evento = (await getDoc(eventoRef)).data();
  if (evento?.status === 'live' && !flag('forzar')) {
    throw new Error(`Hay una sesión en vivo («${evento.sessionLabel}»). Finalízala en /admin o usa --forzar.`);
  }

  // 1. Backup of the current slides (local file + a copy in Firestore).
  const current = (await getDoc(presentacionRef)).data();
  if (current?.slides?.length) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const { updatedAt, ...data } = current;
    mkdirSync(BACKUPS, { recursive: true });
    const file = join(BACKUPS, `presentacion-${stamp}.json`);
    writeFileSync(file, JSON.stringify(data, null, 2));
    await setDoc(doc(db, ROOT, `presentacion_respaldo_${stamp}`), { ...data, respaldadoEn: serverTimestamp() });
    console.log(`Respaldo de las ${current.slides.length} diapositivas actuales: ${file}`);
  }

  // 2. Images.
  const team = loadTeam();
  console.log(`Equipo (${team.length}): ${team.map((p, i) => `${String.fromCharCode(65 + i)}. ${p.text}`).join(', ')}`);
  const jpg = (name) => readFileSync(join(ASSETS, name));
  const urls = {
    fondo: await upload('fondo.jpg', jpg('fondo.jpg'), 'image/jpeg', { reuse: false }),
    portada: await upload('portada.jpg', jpg('portada.jpg'), 'image/jpeg', { reuse: false }),
    cierre: await upload('cierre.jpg', jpg('cierre.jpg'), 'image/jpeg', { reuse: false }),
    grid: await upload(`opciones-${team.map((p) => p.id).join('-')}.svg`, svgBytes(gridSvg(team)), 'image/svg+xml', {
      reuse: false,
    }),
  };
  console.log('Imágenes subidas a Storage.');

  // 3. Slides.
  const slides = await buildSlides(team, urls);
  await setDoc(presentacionRef, {
    slides,
    optionIds: optionIdsOf(slides),
    imagenes: [
      { url: urls.fondo, name: 'Fondo Premios Geniality' },
      { url: urls.portada, name: 'Portada Premios Geniality' },
      { url: urls.cierre, name: 'Cierre Premios Geniality' },
    ],
    updatedAt: serverTimestamp(),
  });
  console.log(`Listo: ${slides.length} diapositivas (portada, ${CATEGORIAS.length} categorías + sus ganadores, cierre).`);
}

/** Tallies the votes of the session and writes every winner slide (only when something changed). */
async function writeWinners(team, votes, uploaded) {
  const data = (await getDoc(presentacionRef)).data();
  const slides = data?.slides ?? [];
  if (!slides.some((s) => s.id === winnerId(0))) throw new Error('La presentación no es la de los premios: corre primero «subir».');
  const byPhoto = Object.fromEntries(team.map((p) => [p.id, p]));
  const summary = [];
  const next = [];
  for (const s of slides) {
    const i = CATEGORIAS.findIndex((_, j) => winnerId(j) === s.id);
    if (i < 0) {
      next.push(s);
      continue;
    }
    const poll = slides.find((x) => x.id === pollId(i));
    const counts = {};
    for (const v of votes) if (v.slideId === pollId(i)) counts[v.opcion] = (counts[v.opcion] ?? 0) + 1;
    const max = Math.max(0, ...Object.values(counts));
    const winners = max ? (poll?.options ?? []).filter((o) => counts[o.id] === max).map((o) => byPhoto[o.id] ?? o) : [];
    let result = null;
    if (winners.length) {
      const key = winners.map((w) => w.id).join('-');
      uploaded[key] ??= await upload(`ganador-${key}.svg`, svgBytes(winnersSvg(winners)), 'image/svg+xml');
      result = { winners, votes: max, url: uploaded[key] };
    }
    next.push(winnerSlide(i, s.style, result));
    summary.push(`${i + 1}. ${CATEGORIAS[i][3]}: ${winners.length ? `${winners.map((w) => w.text).join(' = ')} (${max})` : '—'}`);
  }
  if (JSON.stringify(next) !== JSON.stringify(slides)) {
    await updateDoc(presentacionRef, { slides: next, updatedAt: serverTimestamp() });
    console.log(`\n[${new Date().toLocaleTimeString('es-CO')}] Ganadores actualizados:\n  ${summary.join('\n  ')}`);
  }
}

async function ganadores() {
  const evento = (await getDoc(eventoRef)).data();
  const sid = option('sesion', evento?.sessionId);
  if (!sid) throw new Error('No hay ninguna sesión. Inicia una en /admin.');
  console.log(`Sesión: ${evento?.sessionLabel ?? sid} (${sid}, ${evento?.status === 'live' ? 'en vivo' : 'finalizada'})`);
  const team = loadTeam();
  const uploaded = {};
  const votos = collection(db, ROOT, 'evento', 'sesiones', sid, 'votos');
  if (!flag('watch')) {
    const snap = await getDocs(votos);
    await writeWinners(team, snap.docs.map((d) => d.data()), uploaded);
    console.log(`${snap.size} votos contados.`);
    return process.exit(0);
  }
  console.log('Escuchando votos… (Ctrl+C para terminar)');
  let timer = null;
  let busy = Promise.resolve();
  onSnapshot(
    votos,
    (snap) => {
      clearTimeout(timer);
      const votes = snap.docs.map((d) => d.data());
      timer = setTimeout(() => {
        busy = busy.then(() => writeWinners(team, votes, uploaded)).catch((e) => console.error('Error:', e.message));
      }, 1500);
    },
    (e) => console.error('Error:', e.message),
  );
  onSnapshot(eventoRef, (s) => {
    if (s.data()?.sessionId !== sid) {
      console.log('\nSe inició otra sesión: vuelve a correr el script para seguirla.');
      process.exit(0);
    }
  });
}

async function restaurar() {
  const file = args[1];
  if (!file || !existsSync(file)) throw new Error('Indica el archivo de respaldo (scripts/premios/respaldos/…json)');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  await setDoc(presentacionRef, { ...data, updatedAt: serverTimestamp() });
  console.log(`Restauradas ${data.slides.length} diapositivas desde ${basename(file)}.`);
}

const commands = { subir, ganadores, restaurar };
if (command === 'muestra') {
  // Preview only: writes the composed images locally (no Firebase writes).
  const team = loadTeam();
  writeFileSync(join(ASSETS, 'muestra-opciones.svg'), gridSvg(team));
  writeFileSync(join(ASSETS, 'muestra-empate.svg'), winnersSvg(team.slice(1, 3)));
  console.log('Escritas muestra-opciones.svg y muestra-empate.svg en scripts/premios/');
  process.exit(0);
}
if (!commands[command]) {
  console.log('Uso: node scripts/premios.mjs subir | ganadores [--watch] | restaurar <archivo>');
  process.exit(1);
}
commands[command]()
  .then(() => command !== 'ganadores' && process.exit(0))
  .catch((e) => {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  });
