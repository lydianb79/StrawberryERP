#!/usr/bin/env bash
# StrawberryERP – native Installation auf CentOS Stream 9/10 (auch RHEL, Rocky, AlmaLinux).
# Installiert Node.js 22, MySQL 8, nginx; richtet Datenbank, systemd-Dienst und Reverse-Proxy ein.
# Aufruf (als root, aus dem geklonten Repository):   sudo bash deploy/install-centos.sh
# Das Skript ist idempotent und kann für Updates erneut ausgeführt werden.
set -euo pipefail

APP_DIR=/opt/strawberryerp
APP_USER=strawberry
ENV_FILE=/etc/strawberryerp.env
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

[ "$(id -u)" -eq 0 ] || { echo "Bitte als root ausführen (sudo)." >&2; exit 1; }

echo "==> Pakete installieren"
dnf -y module enable nodejs:22 2>/dev/null || true   # CentOS Stream 9: Modul-Stream; Stream 10: Standard
dnf -y install nodejs npm mysql-server nginx rsync openssl policycoreutils-python-utils firewalld

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Node.js >= 22 wird benötigt (gefunden: $(node -v)). Bitte Node 22 installieren, z.B. 'dnf module reset nodejs && dnf module enable nodejs:22'." >&2
  exit 1
fi

echo "==> MySQL starten"
systemctl enable --now mysqld

echo "==> Konfiguration ($ENV_FILE)"
if [ ! -f "$ENV_FILE" ]; then
  umask 077
  cat > "$ENV_FILE" <<ENV
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=strawberryerp
DB_USER=strawberry
DB_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=
SEED_DEMO=false
COOKIE_SECURE=false
TZ=Europe/Zurich
ENV
  echo "    neu erzeugt (Zufallspasswörter). ADMIN_EMAIL bei Bedarf vor dem ersten Start anpassen."
fi
chmod 600 "$ENV_FILE"
DB_PASSWORD="$(grep '^DB_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)"

echo "==> Datenbank und DB-Benutzer anlegen"
# Frisch installiertes MySQL erlaubt root-Zugriff über den Unix-Socket ohne Passwort.
mysql -uroot <<SQL
CREATE DATABASE IF NOT EXISTS strawberryerp CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'strawberry'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
CREATE USER IF NOT EXISTS 'strawberry'@'127.0.0.1' IDENTIFIED BY '${DB_PASSWORD}';
ALTER USER 'strawberry'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
ALTER USER 'strawberry'@'127.0.0.1' IDENTIFIED BY '${DB_PASSWORD}';
GRANT ALL PRIVILEGES ON strawberryerp.* TO 'strawberry'@'localhost';
GRANT ALL PRIVILEGES ON strawberryerp.* TO 'strawberry'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL

echo "==> Anwendung nach $APP_DIR kopieren und bauen"
id "$APP_USER" &>/dev/null || useradd --system --home-dir "$APP_DIR" --shell /sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR"
rsync -a --delete --exclude node_modules --exclude dist --exclude .git --exclude .env "$SRC_DIR/server" "$SRC_DIR/web" "$APP_DIR/"
(cd "$APP_DIR/web" && npm ci --no-audit --no-fund && npm run build)
(cd "$APP_DIR/server" && npm ci --omit=dev --no-audit --no-fund)
rm -rf "$APP_DIR/server/public" && cp -r "$APP_DIR/web/dist" "$APP_DIR/server/public"
rm -rf "$APP_DIR/web/node_modules"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

echo "==> systemd-Dienst"
install -m 644 "$SRC_DIR/deploy/strawberryerp.service" /etc/systemd/system/strawberryerp.service
systemctl daemon-reload
systemctl enable strawberryerp
systemctl restart strawberryerp

echo "==> nginx (Reverse-Proxy)"
install -m 644 "$SRC_DIR/deploy/nginx-strawberryerp.conf" /etc/nginx/conf.d/strawberryerp.conf
setsebool -P httpd_can_network_connect 1 || true      # SELinux: nginx darf auf Port 3000 weiterleiten
nginx -t
systemctl enable --now nginx
systemctl reload nginx

echo "==> Firewall"
systemctl enable --now firewalld
firewall-cmd --permanent --add-service=http --add-service=https
firewall-cmd --reload

sleep 4
echo
echo "Fertig. StrawberryERP ist erreichbar unter:  http://$(hostname -I | awk '{print $1}')/"
echo "Anmeldung: $(grep '^ADMIN_EMAIL=' "$ENV_FILE" | cut -d= -f2-)"
echo "Initialpasswort (nur nach der Erstinstallation):"
echo "    journalctl -u strawberryerp | grep Initialpasswort"
echo "Nächste Schritte: Passwort ändern, HTTPS einrichten (siehe README), danach COOKIE_SECURE=true setzen."
