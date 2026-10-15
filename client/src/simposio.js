// The symposium: fixed slides and the Firestore namespace everything lives under.

/** Root collection, exclusive to this event. Holds two documents: `evento` and `admins`. */
export const ROOT = 'simposio_leucemias_2026';

export const TITLE = 'Simposio de Leucemias Agudas y Crónicas';

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

const opts = (...texts) => texts.map((text, i) => ({ id: String.fromCharCode(65 + i), text }));

const caso1 = {
  title: '1. Contrapunteo: Manejo del SMD de bajo riesgo con anemia refractaria',
  body:
    'Mujer de 74 años con SMD con mutación de SF3B1 y sideroblastos en anillo, IPSS-M bajo, cariotipo normal. ' +
    'Hemoglobina 8,4 g/dL, neutrófilos y plaquetas normales, eritropoyetina sérica 180 U/L. ' +
    'Ha requerido 3 unidades de glóbulos rojos en las últimas 16 semanas. ECOG 1, sin comorbilidades relevantes.',
  question: '¿Cuál sería su conducta inicial en esta paciente?',
  options: opts(
    'Soporte transfusional y vigilancia, con quelación según carga de hierro.',
    'Agente estimulante de la eritropoyesis (AEE) de entrada; luspatercept si hay falla.',
    'Luspatercept de entrada.',
    'Otra conducta.',
  ),
};

const caso2 = {
  title: '2. Contrapunteo: SMD de alto riesgo, ¿quién y cuándo va a trasplante alogénico?',
  body:
    'Hombre de 61 años con SMD con exceso de blastos (12 % de blastos en médula ósea), cariotipo normal, ' +
    'mutaciones en ASXL1 y RUNX1, IPSS-M alto. ECOG 1, HCT-CI 2. Tiene un hermano HLA idéntico disponible.',
  question: '¿Cuál sería su conducta en este paciente?',
  options: opts(
    'Trasplante alogénico inmediato, sin citorreducción previa.',
    'Hipometilantes (2 a 4 ciclos) como puente y luego trasplante alogénico.',
    'Quimioterapia intensiva tipo inducción y luego trasplante alogénico.',
    'Hipometilantes continuos; trasplante solo ante progresión o pérdida de respuesta.',
  ),
};

/**
 * Slide ids are stable: votes are stored per (sessionId, slideId), so the initial vote and the re-vote of a
 * case are independent polls with the same content. Keep ids and option letters in sync with firestore.rules.
 */
export const SLIDES = [
  { id: 'portada', type: 'content', title: '', question: '', body: '', style: coverStyle },
  { id: 'p1-inicial', type: 'poll', ...caso1, title: `${caso1.title} · Votación inicial`, style: pollStyle },
  { id: 'p1-revotacion', type: 'poll', ...caso1, title: `${caso1.title} · Revotación`, style: pollStyle },
  { id: 'p2-inicial', type: 'poll', ...caso2, title: `${caso2.title} · Votación inicial`, style: pollStyle },
  { id: 'p2-revotacion', type: 'poll', ...caso2, title: `${caso2.title} · Revotación`, style: pollStyle },
  {
    id: 'p3-1',
    type: 'poll',
    title: 'Pregunta 3.1',
    body: '',
    question:
      '¿Está usted de acuerdo en participar en el grupo colombiano mielodisplasia de ACHO, ' +
      'entendiendo que su compromiso sería con las actividades del grupo?',
    options: opts('Sí.', 'No.', 'Me gustaría recibir más información.'),
    style: pollStyle,
  },
  {
    id: 'p3-2',
    type: 'poll',
    title: 'Pregunta 3.2',
    body: '',
    question: '¿Considera usted que en Colombia los pacientes con mielodisplasia tienen infradiagnóstico?',
    options: opts('Sí, de manera importante.', 'Sí, en grado moderado.', 'No.', 'No tengo una opinión formada.'),
    style: pollStyle,
  },
];

export const POLLS = SLIDES.filter((s) => s.type === 'poll');
export const slideById = (id) => SLIDES.find((s) => s.id === id) ?? null;
export const slideIndex = (id) => SLIDES.findIndex((s) => s.id === id);
