#!/bin/sh
# Copia consistente de la base de datos (API de backup de SQLite) a deploy/backups/ en el Droplet.
# Uso (desde la carpeta del proyecto): sh deploy/backup.sh
set -e
cd "$(dirname "$0")/.."
stamp=$(date +%Y%m%d-%H%M%S)
mkdir -p deploy/backups
docker compose exec -T app node -e "require('better-sqlite3')('/data/data.db').backup('/data/backup.db').then(() => console.log('ok'))"
docker compose cp app:/data/backup.db "deploy/backups/data-$stamp.db"
docker compose exec -T app rm /data/backup.db
echo "Respaldo guardado en deploy/backups/data-$stamp.db"
