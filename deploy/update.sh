#!/usr/bin/env bash
# StrawberryERP – Update einer nativen CentOS-Installation auf ein Release.
#
#   sudo bash deploy/update.sh            # auf das neueste Release aktualisieren
#   sudo bash deploy/update.sh v1.2.0     # auf ein bestimmtes Release aktualisieren
#   sudo bash deploy/update.sh --check    # nur anzeigen, ob ein Update verfügbar ist
#
# Ablauf: Datenbank sichern → Release auschecken → neu bauen und Dienst neu starten →
# Funktionsprüfung. Schlägt die Prüfung fehl, werden die vorherige Version und die
# Datenbanksicherung automatisch wiederhergestellt.
set -euo pipefail

# Alles in einer Funktion: bash liest sie vollständig ein, bevor «git checkout» diese Datei austauscht.
main() {
  local APP_DIR=/opt/strawberryerp ENV_FILE=/etc/strawberryerp.env
  local REPO_DIR; REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  local CHECK_ONLY=0 TARGET=""
  for arg in "$@"; do
    case "$arg" in
      --check) CHECK_ONLY=1 ;;
      -h|--help) sed -n '2,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
      *) TARGET="$arg" ;;
    esac
  done

  [ "$(id -u)" -eq 0 ] || { echo "Bitte als root ausführen (sudo)." >&2; exit 1; }
  [ -f "$ENV_FILE" ] && [ -d "$APP_DIR/server" ] || { echo "Keine bestehende Installation gefunden – bitte zuerst deploy/install-centos.sh ausführen." >&2; exit 1; }
  cd "$REPO_DIR"

  local INSTALLED; INSTALLED="$(node -p "require('$APP_DIR/server/package.json').version" 2>/dev/null || echo unbekannt)"
  echo "==> Releases abrufen"
  git fetch --tags --quiet origin
  [ -n "$TARGET" ] || TARGET="$(git tag -l 'v*' --sort=-v:refname | head -1)"
  [ -n "$TARGET" ] || { echo "Es wurde noch kein Release veröffentlicht." >&2; exit 1; }
  git rev-parse -q --verify "refs/tags/$TARGET" >/dev/null || { echo "Das Release $TARGET existiert nicht. Verfügbar: $(git tag -l 'v*' --sort=-v:refname | head -5 | tr '\n' ' ')" >&2; exit 1; }

  echo "    installiert: $INSTALLED    Ziel: ${TARGET#v}"
  if [ "$INSTALLED" = "${TARGET#v}" ]; then
    echo "StrawberryERP ist bereits auf dem Stand $TARGET."
    exit 0
  fi
  if [ "$CHECK_ONLY" -eq 1 ]; then
    echo "Update verfügbar: $INSTALLED → ${TARGET#v}.   Ausführen mit:  sudo bash deploy/update.sh $TARGET"
    exit 0
  fi
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "Im Repository $REPO_DIR gibt es lokale Änderungen. Bitte zuerst sichern oder verwerfen (git status)." >&2
    exit 1
  fi

  # Rücksprungziel: das Release der installierten Version, sonst der aktuelle Stand des Repositorys
  local PREVIOUS; PREVIOUS="$(git rev-parse HEAD)"
  git rev-parse -q --verify "refs/tags/v$INSTALLED" >/dev/null && PREVIOUS="v$INSTALLED"

  echo "==> Datenbank sichern"
  local BACKUP; BACKUP="$(bash "$REPO_DIR/deploy/backup.sh" | sed -n 's/^Backup erstellt: //p')"
  [ -s "$BACKUP" ] || { echo "Die Datensicherung ist fehlgeschlagen – Update abgebrochen, es wurde nichts verändert." >&2; exit 1; }
  echo "    $BACKUP"

  echo "==> Release $TARGET installieren"
  git checkout --quiet "$TARGET"
  local OK=1
  bash deploy/install-centos.sh > /var/log/strawberryerp-update.log 2>&1 || OK=0
  if [ "$OK" -eq 1 ] && healthy; then
    echo
    echo "Update erfolgreich: StrawberryERP $(node -p "require('$APP_DIR/server/package.json').version") läuft."
    echo "Datensicherung vor dem Update: $BACKUP"
    exit 0
  fi

  echo
  echo "!! Die neue Version startet nicht – vorheriger Stand wird wiederhergestellt." >&2
  journalctl -u strawberryerp --no-pager -n 15 >&2 || true
  systemctl stop strawberryerp || true
  local DB; DB="$(grep '^DB_NAME=' "$ENV_FILE" | cut -d= -f2-)"
  mysql -uroot -e "DROP DATABASE IF EXISTS \`$DB\`; CREATE DATABASE \`$DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
  gunzip -c "$BACKUP" | mysql -uroot "$DB"
  git checkout --quiet "$PREVIOUS"
  bash deploy/install-centos.sh >> /var/log/strawberryerp-update.log 2>&1 || true
  if healthy; then
    echo "Die vorherige Version ($INSTALLED) läuft wieder, die Daten entsprechen dem Stand vor dem Update." >&2
  else
    echo "Auch die vorherige Version startet nicht. Bitte /var/log/strawberryerp-update.log und 'journalctl -u strawberryerp' prüfen." >&2
    echo "Die Datensicherung liegt unter $BACKUP." >&2
  fi
  exit 1
}

# Wartet, bis der Dienst antwortet (max. 60 Sekunden).
healthy() {
  local port; port="$(grep '^PORT=' /etc/strawberryerp.env | cut -d= -f2-)"
  for _ in $(seq 1 30); do
    if curl -fs -m 3 "http://127.0.0.1:${port:-3000}/api/health" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

main "$@"
