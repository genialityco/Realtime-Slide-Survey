// Creates the "Simposio de Leucemias Agudas y Crónicas" presentation.
// CLI: npm run seed:simposio   (same DB as the server: DATA_DIR / DB_FILE)
// The server also calls seedSimposio() on an empty database when SEED_ON_EMPTY=simposio.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { openDb } from './db.js';
import { createRepo } from './repo.js';

// Colours sampled from 2.jpg: dark teal headings, light teal accents.
const pollStyle = {
  background: '#ffffff',
  textColor: '#123f47',
  accent: '#2aa3b3',
  chartType: 'bar',
  backgroundImage: '/media/2.jpg',
  overlay: 0,
  contentTop: 19,
};

const coverStyle = { ...pollStyle, background: '#123f47', backgroundImage: '/media/1.jpg', contentTop: 0 };

export function seedSimposio(repo) {
  const p = repo.createPresentation('Simposio de Leucemias Agudas y Crónicas — Encuestas');

  repo.addSlide(p.id, { type: 'content', question: '', body: '', style: coverStyle });

  /** Adds the initial-vote slide, duplicates it for the re-vote and relabels both titles. */
  function voteAndRevote({ title, body, question, options }) {
    const initial = repo.addSlide(p.id, { title: `${title} · Votación inicial`, body, question, options, style: pollStyle });
    const revote = repo.duplicateSlide(initial.id);
    repo.updateSlide(revote.id, { title: `${title} · Revotación` });
  }

  voteAndRevote({
    title: '1. Contrapunteo: Manejo del SMD de bajo riesgo con anemia refractaria',
    body:
      'Mujer de 74 años con SMD con mutación de SF3B1 y sideroblastos en anillo, IPSS-M bajo, cariotipo normal. ' +
      'Hemoglobina 8,4 g/dL, neutrófilos y plaquetas normales, eritropoyetina sérica 180 U/L. ' +
      'Ha requerido 3 unidades de glóbulos rojos en las últimas 16 semanas. ECOG 1, sin comorbilidades relevantes.',
    question: '¿Cuál sería su conducta inicial en esta paciente?',
    options: [
      'Soporte transfusional y vigilancia, con quelación según carga de hierro.',
      'Agente estimulante de la eritropoyesis (AEE) de entrada; luspatercept si hay falla.',
      'Luspatercept de entrada.',
      'Otra conducta.',
    ],
  });

  voteAndRevote({
    title: '2. Contrapunteo: SMD de alto riesgo, ¿quién y cuándo va a trasplante alogénico?',
    body:
      'Hombre de 61 años con SMD con exceso de blastos (12 % de blastos en médula ósea), cariotipo normal, ' +
      'mutaciones en ASXL1 y RUNX1, IPSS-M alto. ECOG 1, HCT-CI 2. Tiene un hermano HLA idéntico disponible.',
    question: '¿Cuál sería su conducta en este paciente?',
    options: [
      'Trasplante alogénico inmediato, sin citorreducción previa.',
      'Hipometilantes (2 a 4 ciclos) como puente y luego trasplante alogénico.',
      'Quimioterapia intensiva tipo inducción y luego trasplante alogénico.',
      'Hipometilantes continuos; trasplante solo ante progresión o pérdida de respuesta.',
    ],
  });

  repo.addSlide(p.id, {
    title: 'Pregunta 3.1',
    question:
      '¿Está usted de acuerdo en participar en el grupo colombiano mielodisplasia de ACHO, ' +
      'entendiendo que su compromiso sería con las actividades del grupo?',
    options: ['Sí.', 'No.', 'Me gustaría recibir más información.'],
    style: pollStyle,
  });

  repo.addSlide(p.id, {
    title: 'Pregunta 3.2',
    question: '¿Considera usted que en Colombia los pacientes con mielodisplasia tienen infradiagnóstico?',
    options: ['Sí, de manera importante.', 'Sí, en grado moderado.', 'No.', 'No tengo una opinión formada.'],
    style: pollStyle,
  });

  return repo.getPresentation(p.id);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const created = seedSimposio(createRepo(openDb(config.dbFile)));
  console.log(`Presentación creada: ${created.title} (${created.id})`);
  for (const s of created.slides) console.log(`  ${s.position + 1}. [${s.type}] ${s.title || s.question || '(portada)'}`);
}
