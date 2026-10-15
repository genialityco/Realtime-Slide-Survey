# Realtime Slide Survey

Presentaciones con diapositivas de encuesta, registro de asistentes por QR y votación en tiempo real.
Funciona 100 % sobre **Firebase** (plan gratuito Spark), sin servidor propio:

| Pieza | Uso |
|---|---|
| **Firebase Hosting** | Sirve la app React (HTTPS, dominio `*.web.app`) e imágenes de `client/public/media` |
| **Cloud Firestore** | Datos y tiempo real: cada pantalla escucha sus documentos con `onSnapshot` |
| **Firebase Auth** | Admin con correo y contraseña; asistentes con sesión anónima (invisible para ellos) |
| **Reglas de Firestore** | [firestore.rules](firestore.rules): un voto por cédula, solo en la pregunta activa; cédulas y correos solo los lee el admin |

## Cómo funciona el tiempo real

```
Celular ──setDoc(voto)──▶ Firestore ──onSnapshot──▶ Panel del presentador (cuenta los votos)
                                                     │  «Mostrar resultados»: publica el recuento
Proyección / celulares ◀──onSnapshot── sessions/{id} y polls/{slideId}
```

- El presentador cambia de diapositiva → se actualiza `sessions/{id}.current` → todos los celulares cambian al instante.
- Cada voto es un documento propio (`votes/{cédula}`), así 100 votos simultáneos no compiten entre sí.
- El público no puede leer los votos (privacidad): el panel del presentador publica el recuento en
  `polls/{slideId}.results` cuando los resultados están visibles (como máximo ~1 vez por segundo).
  **Mantén abierta la pestaña del presentador** mientras los resultados estén visibles.

## Desarrollo local (emuladores, no toca el proyecto real)

```bash
npm install
npm run dev     # emuladores Auth+Firestore, admin de prueba y Vite en http://localhost:5173
npm test        # 13 pruebas de reglas y flujo completo contra el emulador
```

Admin local: `admin@example.com` / `admin123`. Interfaz de los emuladores: http://localhost:4000.
Requiere Java 11+ (para el emulador de Firestore).

## Publicar en Firebase

1. **Proyecto:** en https://console.firebase.google.com crea (o elige) un proyecto.
2. **Firestore:** *Build → Firestore Database → Crear base de datos* (modo producción, región `us-east1` o `southamerica-east1`).
3. **Auth:** *Build → Authentication → Comenzar* y activa **Correo/contraseña** y **Anónimo**.
4. **App web:** *Configuración del proyecto → Tus apps → Web* (`</>`). Copia la configuración en
   `client/.env.production.local` usando [client/.env.example](client/.env.example) como plantilla.
5. **Admin:** *Authentication → Agregar usuario* (tu correo y contraseña). Copia su **UID** y en
   *Firestore → Iniciar colección* crea `admins` → documento con ID = ese UID (campo `email`, opcional).
6. **Desplegar** (en tu computador):
   ```bash
   npx firebase login
   npx firebase use --add          # elige el proyecto
   npm run deploy                  # build + reglas de Firestore + Hosting
   ```
7. Abre `https://<proyecto>.web.app`, entra con tu cuenta de admin y pulsa **Crear desde plantilla**
   (Simposio de Leucemias).

No se necesita ninguna cuenta de servicio (`service-account.json`) ni plan de pago.

## Durante el evento

1. En la presentación pulsa **▶ Iniciar sesión** → panel del presentador.
2. **🖥 Abrir proyección** y lleva esa ventana al proyector (doble clic = pantalla completa).
3. **Mostrar QR en proyección**: el público escanea, se registra (nombre, cédula, correo, autorización de datos).
4. Avanza con **Siguiente →** o las flechas. **Mostrar resultados** para que aparezcan en proyección y celulares.
5. **Finalizar sesión** y descarga los CSV (**Resultados** y **Asistentes y respuestas**). Todo queda guardado
   por sesión; una nueva sesión empieza de cero.

Si alguien cambia de celular, al registrarse con la misma cédula recupera su registro y sus votos.

## Rutas

| Ruta | Quién | Qué |
|---|---|---|
| `/` | admin | Presentaciones y plantillas |
| `/p/:id` | admin | Editor: diapositivas, duplicar, reordenar, fondo, historial de sesiones |
| `/present/:sessionId` | admin | Control en vivo |
| `/screen/:sessionId` | admin | Vista de proyección |
| `/sessions/:sessionId` | admin | Resultados guardados y CSV |
| `/join/:code` | público | Registro y votación (destino del QR) |

## Modelo de datos (Firestore)

```
admins/{uid}
presentations/{pid}
  └─ slides/{slideId}          position, type, title, body, question, options[], style, sourceSlideId, deleted
sessions/{sessionId}           code, status live|ended, currentSlideId, current (lo que ve el público), showQr
  ├─ attendees/{cédula}        name, email, uid, consent        (solo admin)
  └─ polls/{slideId}           pollInstanceId + copia de la pregunta, resultsVisible, results publicados
       └─ votes/{cédula}       optionId, uid                    (solo admin; cada quien lee el suyo)
```

- **Duplicar** crea una diapositiva con id nuevo (e ids de opción nuevos) que copia título, caso, pregunta,
  opciones y estilo; así se arman las revotaciones.
- Cada voto queda identificado por `sessionId` + `slideId` + `pollInstanceId`; original y copia, o dos
  sesiones de la misma presentación, nunca comparten votos.
- La primera vez que se muestra una encuesta en una sesión se guarda una copia de su contenido: editar o
  eliminar la diapositiva después no altera los resultados.
