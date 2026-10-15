# Encuesta en vivo · Simposio de Leucemias Agudas y Crónicas

App exclusiva para el simposio (16 y 17 de octubre de 2026): las 7 diapositivas están en
[client/src/simposio.js](client/src/simposio.js) — portada (1.jpg) y 6 preguntas sobre 2.jpg, con votación
inicial y revotación de los dos contrapunteos.

Publicada en **https://simposio-leucemias.web.app** (admin: **/admin**, proyección: **/proyeccion**).

Corre sobre **Firebase**, proyecto `lenovo-experiences`, y todo vive en una sola colección:
**`simposio_leucemias_2026`**.

## Cómo funciona

- **QR → `/`**: el asistente se registra **una sola vez** (nombre, cédula, correo, autorización de datos). Queda
  ligado al celular (usuario anónimo de Firebase): si sale y vuelve, entra directo.
- **Sincronización**: el celular escucha un único documento, `simposio_leucemias_2026/evento`, que dice qué
  diapositiva se está proyectando. Al cambiar de diapositiva, el celular cambia de inmediato y la pregunta
  anterior se cierra (las reglas rechazan votos de preguntas que ya no están en pantalla).
- **Proyección (`/proyeccion`)**: se controla con flechas, AvPág/RePág o un **puntero de presentación**. El panel
  (`/admin`) muestra el recuento en vivo, el QR y los botones de mostrar/ocultar resultados.
- **Resultados**: un voto por persona y pregunta; la revotación es una pregunta independiente. Cada **sesión**
  («Ensayo», «Día 1», …) guarda sus votos por separado; los asistentes registrados se conservan entre sesiones.
  Exportación CSV desde el panel.
- Mientras los resultados estén visibles, el panel o la proyección publican el recuento para los celulares
  (los celulares no pueden leer votos ajenos): mantén abierta al menos una de esas dos pantallas.

## Datos (Firestore)

```
simposio_leucemias_2026/
  admins                        { uids: [...] }        quién administra
  evento                        estado en vivo: sessionId, slideId, showQr, resultsVisible, results
  evento/asistentes/{cédula}    nombre, correo, uid     (solo admins)
  evento/dispositivos/{uid}     { cedula, nombre }      (registro de cada celular)
  evento/sesiones/{sessionId}   label, status, fechas
  evento/sesiones/{sessionId}/votos/{slideId}__{cédula}   { opcion }   pollInstanceId = sessionId:slideId
```

## Reglas de Firestore (proyecto compartido)

Las reglas de `lenovo-experiences` **no se modificaron**: hoy son abiertas para todo el proyecto
(`allow read, write: if true`), incluida esta colección. Por eso la app hace sus propias comprobaciones
(votar solo la pregunta proyectada, una vez, con una opción válida) dentro de transacciones. Eso protege frente a
usuarios normales, no frente a alguien que manipule Firestore a propósito, y los datos personales son legibles
por cualquiera que conozca el proyecto.

[firestore.simposio-protegido.rules](firestore.simposio-protegido.rules) es una versión lista para aplicar que deja
el resto del proyecto exactamente igual y protege solo `simposio_leucemias_2026` (probada en `npm test`).
No se despliega automáticamente: `firebase.json` no incluye Firestore.

## Netlify (alternativa)

[netlify.toml](netlify.toml) ya está listo: en Netlify conecta el repo y define las variables `VITE_FIREBASE_*`
(ver [client/.env.example](client/.env.example)). Firestore y Auth siguen siendo los de Firebase.

## Desarrollo y pruebas

```bash
npm install
npm run dev     # emuladores + Vite: http://localhost:5173 (público) y /admin (admin@example.com / admin123)
npm test        # 10 pruebas: flujo con reglas abiertas (como producción) y con las reglas protegidas
```

## Despliegue

Configuración web del proyecto en `client/.env.production.local` (plantilla: [client/.env.example](client/.env.example)).

```bash
npx firebase login
npm run deploy  # build + hosting:simposio (sitio simposio-leucemias; no toca el sitio ni las reglas de Lenovo)
```

Admins: usuario de Firebase Auth (correo/contraseña) cuyo UID esté en `simposio_leucemias_2026/admins.uids`.

## Durante el evento

1. `/admin` → nombre de la sesión (p. ej. «Día 1») → **Iniciar**. El QR aparece en la proyección.
2. **Abrir proyección** → llevarla al proyector (doble clic = pantalla completa).
3. Avanzar con el puntero; **Mostrar resultados** cuando corresponda.
4. **Finalizar sesión** y descargar los CSV.
