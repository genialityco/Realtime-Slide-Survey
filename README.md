# Realtime Slide Survey

Presentaciones con diapositivas de encuesta, registro de asistentes por QR y votación en tiempo real.

- **Backend:** Node 20, Express, Socket.IO, SQLite (`better-sqlite3`) — [server/](server/)
- **Frontend:** React + Vite — [client/](client/)

No usa servicios externos (ni Firebase): todo se guarda en `server/data.db` y las imágenes en `server/media/`.

## Puesta en marcha

```bash
npm install
npm run seed:simposio        # crea la presentación del Simposio de Leucemias (una sola vez)

# desarrollo: API en :3001 + Vite en :5173
npm run dev

# producción: el servidor sirve la app en :3001
npm run build
npm start
```

Variables de entorno (todas opcionales; el servidor no lee `.env`, se definen en la terminal o en el hosting):

| Variable | Por defecto | Para qué |
|---|---|---|
| `ADMIN_PASSWORD` | *(vacío = panel abierto)* | Contraseña del panel de administración. **Obligatoria en el evento**: protege los datos de los asistentes |
| `PUBLIC_URL` | origen del navegador | URL pública que se codifica en el QR, p. ej. `https://encuestas.midominio.com` |
| `PORT` | `3001` | Puerto del servidor |
| `DATA_DIR` | `server/` | Carpeta de datos persistentes (base de datos e imágenes subidas) |
| `DB_FILE` | `$DATA_DIR/data.db` | Archivo SQLite |
| `MEDIA_DIR` | `$DATA_DIR/media` | Carpeta de imágenes subidas (las de `server/media` del repo se sirven siempre) |
| `SEED_ON_EMPTY` | *(vacío)* | `simposio`: crea la presentación del simposio si la base está vacía |
| `API_URL` | `http://localhost:3001` | Destino del proxy de Vite (solo desarrollo) |

PowerShell: `$env:ADMIN_PASSWORD="…"; $env:PUBLIC_URL="https://…"; npm start`

## Durante el evento

1. Abre `/` (te pide la contraseña), entra en la presentación y pulsa **▶ Iniciar sesión**.
2. En el panel del presentador pulsa **🖥 Abrir proyección** y lleva esa ventana al proyector (doble clic = pantalla completa).
3. **Mostrar QR en proyección**: el público escanea, se registra (nombre, cédula, correo y autorización de datos) y queda a la espera.
4. Avanza con **Siguiente →** o las flechas del teclado. En cada encuesta, el recuento en vivo solo lo ves tú;
   pulsa **Mostrar resultados** para que aparezca en la proyección y en los celulares.
5. Al terminar, **Finalizar sesión**. Descarga **Resultados (CSV)** y **Asistentes y respuestas (CSV)** desde el
   panel o desde `/sessions/:id`. Los resultados quedan guardados por sesión.

Si alguien cierra el navegador, al volver a escanear el QR y registrarse con la misma cédula recupera su sesión
(y sus votos ya emitidos).

## Rutas

| Ruta | Quién | Qué |
|---|---|---|
| `/` | admin | Lista/crea presentaciones |
| `/p/:id` | admin | Editor: diapositivas, duplicar, reordenar, imagen de fondo, historial de sesiones |
| `/present/:sessionId` | admin | Control en vivo: navegar, recuento, mostrar/ocultar resultados y QR, exportar, finalizar |
| `/screen/:sessionId` | admin | Vista de proyección |
| `/sessions/:sessionId` | admin | Resultados guardados y exportación CSV |
| `/join/:code` | público | Registro y votación (destino del QR) |

## Modelo de datos

```
presentations ─┬─ slides (id, position, title, body, question, options[], style, source_slide_id)
               └─ sessions (id, code, status live|ended, current_slide_id, show_qr)
                     ├─ attendees (id, name, cedula, email, consent_at)  UNIQUE(session_id, cedula)
                     └─ poll_instances (id, session_id, slide_id, snapshot de title/body/question/options/style, results_visible)
                           └─ votes (poll_instance_id, session_id, slide_id, option_id, participant_id → attendees.id)
```

- **Duplicar** (`POST /api/slides/:id/duplicate { position? }`) crea una diapositiva con id nuevo (y ids de opción
  nuevos) que copia título, caso, pregunta, opciones y estilo. Así se crean las “revotaciones”.
- Cada voto se identifica por `sessionId` + `slideId` + `pollInstanceId`: el original y la copia, o la misma
  presentación en dos sesiones, nunca comparten votos.
- Los `poll_instances` guardan una copia del contenido al presentarse: editar o eliminar la diapositiva después no
  altera los resultados históricos.
- Un voto por asistente y encuesta; no se puede cambiar.
- `style.backgroundImage` + `style.contentTop` (% superior reservado para la cabecera de la imagen).

## Eventos Socket.IO

| Evento (cliente → servidor) | Payload |
|---|---|
| `audience:join` | `{ code, attendeeId }` (tras `POST /api/join/:code/register`) |
| `vote` | `{ slideId, optionId }` |
| `admin:join` / `admin:end` | `{ sessionId }` (requiere `auth.adminKey`) |
| `admin:goto` | `{ sessionId, slideId }` |
| `admin:results` | `{ sessionId, slideId, visible }` |
| `admin:qr` | `{ sessionId, visible }` |

Servidor → cliente: `admin:state`, `state` (diapositiva actual para el público) y `results` (recuento en vivo,
solo si está visible).

## Despliegue

Producción en DigitalOcean (Droplet + Docker Compose + HTTPS con Caddy): ver [DEPLOY.md](DEPLOY.md).
