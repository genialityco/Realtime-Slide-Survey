# Despliegue en DigitalOcean (Droplet + Docker)

Se usa un **Droplet** (no App Platform) porque la app guarda los datos en SQLite y App Platform no tiene disco
persistente. Docker Compose levanta dos contenedores: la app y **Caddy**, que obtiene el certificado HTTPS solo.

Costo: Droplet Basic de 1 GB (~US$6/mes); alcanza de sobra para 100 asistentes.

## 1. Crear el Droplet

1. DigitalOcean → **Create → Droplets**.
2. Región: **New York** (la más cercana a Colombia).
3. Imagen: pestaña **Marketplace → “Docker on Ubuntu”** (trae Docker y Docker Compose).
4. Tamaño: **Basic → Regular → 1 GB / 1 CPU**.
5. Autenticación: tu llave SSH (recomendado) o contraseña.
6. Crear y copiar la **IP pública** (p. ej. `164.92.10.20`).

## 2. Dominio

- **Con dominio propio:** en tu DNS crea un registro **A** `encuestas.tudominio.com → IP del Droplet`.
- **Sin dominio:** usa la IP con guiones + `sslip.io`, p. ej. `164-92-10-20.sslip.io` (no hay que configurar nada).

## 3. Instalar la app

```bash
ssh root@IP_DEL_DROPLET

ufw allow 80 && ufw allow 443          # abrir HTTP/HTTPS
git clone https://github.com/genialityco/Realtime-Slide-Survey.git /opt/encuestas
cd /opt/encuestas
cp .env.example .env
nano .env                               # DOMAIN y ADMIN_PASSWORD
docker compose up -d --build            # la primera vez tarda unos minutos
```

Comprobar:

```bash
docker compose ps                       # app "healthy", caddy "running"
docker compose logs app                 # "Base de datos vacía: creada la presentación ..."
curl https://TU_DOMINIO/api/health      # {"ok":true}
```

Abre `https://TU_DOMINIO`, entra con `ADMIN_PASSWORD`: la presentación del simposio ya está creada
(`SEED_ON_EMPTY=simposio` la crea solo si la base está vacía; nunca duplica ni borra nada).

## 4. Actualizar a una nueva versión

```bash
cd /opt/encuestas && git pull && docker compose up -d --build
```

Los datos viven en el volumen Docker `app-data` y se conservan entre actualizaciones.
**No** ejecutes `docker compose down -v` (la `-v` borra los volúmenes y con ellos los resultados).

## 5. Respaldos

- Durante/después del evento: descarga los CSV desde el panel (**Resultados** y **Asistentes y respuestas**).
- Copia completa de la base: `sh deploy/backup.sh` → queda en `deploy/backups/` en el Droplet. Para traerla a tu PC:
  `scp root@IP:/opt/encuestas/deploy/backups/*.db .`
- Opcional: activar **Backups** del Droplet en DigitalOcean (+20 %).

## Antes del evento (checklist)

- [ ] Abrir `https://TU_DOMINIO` y entrar con la contraseña.
- [ ] Iniciar una sesión de prueba, escanear el QR con 2–3 celulares **con datos móviles** (no la Wi-Fi de la oficina),
      registrarse y votar.
- [ ] Probar “Mostrar resultados” y la vista de proyección en el computador del proyector.
- [ ] Finalizar esa sesión de prueba. El día del evento, iniciar una **nueva** sesión: los resultados no se mezclan.
