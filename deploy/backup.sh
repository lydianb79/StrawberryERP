#!/usr/bin/env bash
# Tägliche Datensicherung der StrawberryERP-Datenbank (native Installation).
# Cron-Beispiel:   15 2 * * * root /opt/strawberryerp-backup.sh
set -euo pipefail
ENV_FILE=/etc/strawberryerp.env
BACKUP_DIR=${BACKUP_DIR:-/var/backups/strawberryerp}
KEEP_DAYS=${KEEP_DAYS:-30}

get() { grep "^$1=" "$ENV_FILE" | cut -d= -f2-; }
mkdir -p "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR"
FILE="$BACKUP_DIR/strawberryerp-$(date +%F-%H%M).sql.gz"
MYSQL_PWD="$(get DB_PASSWORD)" mysqldump --single-transaction --no-tablespaces -h 127.0.0.1 -u "$(get DB_USER)" "$(get DB_NAME)" | gzip > "$FILE"
find "$BACKUP_DIR" -name 'strawberryerp-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
echo "Backup erstellt: $FILE"
