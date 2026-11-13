#!/usr/bin/env bash
# StrawberryERP – HTTPS für eine native CentOS-Installation einrichten.
#
#   sudo bash deploy/enable-https.sh                                   # selbstsigniertes Zertifikat (internes Netz, IP-Adresse)
#   sudo bash deploy/enable-https.sh --domain erp.firma.ch --email it@firma.ch   # Let's-Encrypt-Zertifikat (öffentlich erreichbare Domain)
#
# In beiden Fällen leitet HTTP danach auf HTTPS um und das Sitzungs-Cookie wird nur noch verschlüsselt übertragen.
# Die nginx-Konfiguration bleibt bei späteren Updates erhalten.
set -euo pipefail

ENV_FILE=/etc/strawberryerp.env
CONF=/etc/nginx/conf.d/strawberryerp.conf
CRT=/etc/pki/tls/certs/strawberryerp.crt
KEY=/etc/pki/tls/private/strawberryerp.key
DOMAIN="" EMAIL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --email) EMAIL="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,9p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unbekannte Option: $1" >&2; exit 1 ;;
  esac
done
[ "$(id -u)" -eq 0 ] || { echo "Bitte als root ausführen (sudo)." >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "Keine Installation gefunden – bitte zuerst deploy/install-centos.sh ausführen." >&2; exit 1; }
PORT="$(grep '^PORT=' "$ENV_FILE" | cut -d= -f2-)"; PORT="${PORT:-3000}"

proxy_block() {
  cat <<NGINX
    client_max_body_size 5m;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }
NGINX
}

if [ -n "$DOMAIN" ]; then
  [ -n "$EMAIL" ] || { echo "Für Let's Encrypt wird --email benötigt (Benachrichtigung vor Ablauf)." >&2; exit 1; }
  echo "==> Let's-Encrypt-Zertifikat für $DOMAIN"
  dnf -y install epel-release
  dnf -y install certbot python3-certbot-nginx
  # Schritt 1: HTTP-Konfiguration mit dem Domainnamen, damit certbot den Server findet
  cat > "$CONF" <<NGINX
# StrawberryERP (HTTPS über Let's Encrypt – von deploy/enable-https.sh verwaltet)
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
$(proxy_block)
}
NGINX
  nginx -t && systemctl reload nginx
  # Schritt 2: certbot holt das Zertifikat, ergänzt den TLS-Server und die Umleitung und richtet die Erneuerung ein
  certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --non-interactive --redirect
  systemctl enable --now certbot-renew.timer 2>/dev/null || true
  URL="https://${DOMAIN}/"
else
  IP="$(hostname -I | awk '{print $1}')"
  HOST="$(hostname -f 2>/dev/null || hostname)"
  echo "==> Selbstsigniertes Zertifikat für $IP / $HOST (gültig 825 Tage)"
  umask 077
  openssl req -x509 -newkey rsa:2048 -sha256 -days 825 -nodes -keyout "$KEY" -out "$CRT" \
    -subj "/CN=${HOST}/O=StrawberryERP" -addext "subjectAltName=IP:${IP},DNS:${HOST},DNS:localhost" 2>/dev/null
  chmod 644 "$CRT"; chmod 600 "$KEY"
  restorecon "$CRT" "$KEY" 2>/dev/null || true
  cat > "$CONF" <<NGINX
# StrawberryERP (HTTPS mit selbstsigniertem Zertifikat – von deploy/enable-https.sh verwaltet)
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    http2 on;
    server_name _;

    ssl_certificate ${CRT};
    ssl_certificate_key ${KEY};
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

$(proxy_block)
}
NGINX
  nginx -t && systemctl reload nginx
  URL="https://${IP}/"
fi

firewall-cmd --permanent --add-service=https >/dev/null 2>&1 && firewall-cmd --reload >/dev/null 2>&1 || true

echo "==> Sitzungs-Cookie nur noch über HTTPS"
if grep -q '^COOKIE_SECURE=' "$ENV_FILE"; then sed -i 's/^COOKIE_SECURE=.*/COOKIE_SECURE=true/' "$ENV_FILE"; else echo 'COOKIE_SECURE=true' >> "$ENV_FILE"; fi
systemctl restart strawberryerp

echo
echo "Fertig. StrawberryERP ist erreichbar unter:  $URL"
if [ -z "$DOMAIN" ]; then
  echo "Das Zertifikat ist selbstsigniert: Der Browser zeigt beim ersten Aufruf eine Warnung, die einmalig bestätigt werden muss."
  echo "Fingerabdruck zum Vergleichen:  $(openssl x509 -in "$CRT" -noout -fingerprint -sha256 | cut -d= -f2)"
  echo "Für ein Zertifikat ohne Warnung: Domain einrichten und das Skript mit --domain und --email erneut ausführen."
fi
