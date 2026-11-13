#!/usr/bin/env bash
# Datensicherung der StrawberryERP-Datenbank (native Installation).
# Wird vom Installationsskript als täglicher systemd-Timer eingerichtet (strawberryerp-backup.timer)
# und vor jedem Update von deploy/update.sh aufgerufen.
#
# Optional in /etc/strawberryerp.env:
#   BACKUP_DIR=/var/backups/strawberryerp     Zielverzeichnis
#   BACKUP_KEEP_DAYS=30                       ältere Sicherungen werden gelöscht
#   BACKUP_RSYNC_TARGET=user@host:/pfad/      zusätzliche Kopie an einen zweiten Ort (rsync über SSH oder lokaler Pfad)
set -euo pipefail
ENV_FILE=/etc/strawberryerp.env

get() { grep "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true; }
BACKUP_DIR="${BACKUP_DIR:-$(get BACKUP_DIR)}"; BACKUP_DIR="${BACKUP_DIR:-/var/backups/strawberryerp}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-$(get BACKUP_KEEP_DAYS)}"; KEEP_DAYS="${KEEP_DAYS:-30}"
RSYNC_TARGET="${BACKUP_RSYNC_TARGET:-$(get BACKUP_RSYNC_TARGET)}"

mkdir -p "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR"
FILE="$BACKUP_DIR/strawberryerp-$(date +%F-%H%M%S).sql.gz"
MYSQL_PWD="$(get DB_PASSWORD)" mysqldump --single-transaction --no-tablespaces --routines \
  -h 127.0.0.1 -u "$(get DB_USER)" "$(get DB_NAME)" | gzip > "$FILE.tmp"

# Sicherung prüfen: lesbares Archiv, das mit dem Abschlussvermerk von mysqldump endet
gzip -t "$FILE.tmp"
if ! gunzip -c "$FILE.tmp" | tail -1 | grep -q 'Dump completed'; then
  rm -f "$FILE.tmp"
  echo "Die Datensicherung ist unvollständig und wurde verworfen." >&2
  exit 1
fi
mv "$FILE.tmp" "$FILE"
chmod 600 "$FILE"
find "$BACKUP_DIR" -name 'strawberryerp-*.sql.gz' -mtime +"$KEEP_DAYS" -delete

if [ -n "$RSYNC_TARGET" ]; then
  rsync -a --timeout=60 "$FILE" "$RSYNC_TARGET" || { echo "Kopie nach $RSYNC_TARGET fehlgeschlagen." >&2; exit 1; }
  echo "Kopie abgelegt: $RSYNC_TARGET"
fi
echo "Backup erstellt: $FILE"
