# 🍓 StrawberryERP

Ein schlankes, webbasiertes ERP-System für KMU – von der Offerte bis zum Jahresabschluss.
Ausgelegt auf Schweizer Verhältnisse (CHF, MwSt-Sätze, Kontenrahmen KMU), Oberfläche auf Deutsch.

## Funktionen

| Bereich | Umfang |
|---|---|
| **Kundenverwaltung** | Kunden- und Lieferantenstamm, automatische Nummernvergabe, Zahlungsfristen, CSV-Export |
| **Lagerverwaltung** | Artikelstamm (Lagerartikel und Dienstleistungen), Wareneingang/-ausgang, Inventurkorrektur, Mindestbestand mit Nachbestell-Hinweis, lückenloses Bewegungsprotokoll |
| **Offerten** | Erstellen, PDF, Status (Entwurf → Gesendet → Akzeptiert/Abgelehnt), Umwandlung in Auftrag oder Rechnung |
| **Auftragsverwaltung** | Auftragsbestätigung als PDF, Auslieferung mit Lagerabgang, Umwandlung in Rechnung, Storno |
| **Rechnungsstellung** | Entwurf → Buchen (fortlaufende Nummer, Debitorenbuchung, Lagerabgang), Teil-/Vollzahlung, Storno mit Gegenbuchung |
| **Beleglayout** | Logo-Upload (PNG/JPEG), Position und Grösse, 3 Vorlagen, Akzentfarbe, Schrift, Adressfeld links/rechts, ein-/ausblendbare Spalten, Standardtexte mit Platzhaltern, **Live-Vorschau** |
| **Debitoren / Kreditoren** | Offene Posten, Fälligkeitsstruktur (0 / 1–30 / 31–60 / >60 Tage), Zahlungsein- und -ausgänge, Lieferantenrechnungen mit Vorsteuer |
| **Finanzbuchhaltung** | Doppelte Buchhaltung, automatische Buchungen aus Belegen, manuelle Buchungen, Kontenplan, Journal |
| **Bilanz und Erfolgsrechnung** | Pro Geschäftsjahr, druckbar |
| **Jahresabschluss** | Assistent mit Prüfungen; Abschluss der Erfolgskonten, Sperren des Jahres, Anlegen des Folgejahres, **Saldovortrag als Eröffnungsbilanz**, Gewinnvortrag; rückgängig machbar, solange das Folgejahr offen ist |
| **Reporting** | Dashboard mit Kennzahlen, Umsatz pro Monat, Top-Kunden/-Artikel, Fälligkeitslisten, Lagerbewertung, MwSt-Übersicht; CSV-Export aller Listen |
| **Administration** | Firmendaten, Nummernkreise, Standardkonten, Protokoll (Audit-Log) |
| **Benutzer & Rollen** | Benutzerverwaltung, rollenbasierter Zugriff mit 22 Einzelrechten; vordefinierte Rollen: Administrator, Buchhaltung, Verkauf, Lager, Nur Lesen |

## Technologie

- **Frontend:** React 18, React Router, Vite (Single-Page-App, keine externen CDNs/Fonts)
- **Backend:** Node.js 22, Express, PDFKit (Belege als PDF)
- **Datenbank:** MySQL 8 (InnoDB, Transaktionen, Fremdschlüssel)
- **Betrieb:** Docker Compose **oder** native Installation auf CentOS Stream 9/10 (systemd + nginx)

```
web/      React-Frontend (wird zu statischen Dateien gebaut)
server/   REST-API, Geschäftslogik, Schema (src/schema.sql), PDF-Erzeugung
deploy/   CentOS-Installationsskript, systemd-Unit, nginx-Konfiguration, Backup-Skript
```

## Schnellstart mit Docker (lokal oder auf dem Server)

```bash
cp .env.example .env        # Passwörter und JWT_SECRET setzen (openssl rand -base64 36)
docker compose up -d --build
```

Danach ist die Anwendung unter <http://localhost:8080> erreichbar.

- Der erste Administrator wird beim allerersten Start angelegt (`ADMIN_EMAIL` / `ADMIN_PASSWORD` aus der `.env`).
  Ist `ADMIN_PASSWORD` leer, steht ein Zufallspasswort im Log: `docker compose logs app | grep Initialpasswort`
- `SEED_DEMO=true` legt beim ersten Start Beispieldaten an (Kunden, Artikel, Belege, Buchungen) – nur zum Ausprobieren.

Auf CentOS funktioniert dasselbe mit Docker oder Podman (`dnf install podman podman-compose`).

## Installation auf CentOS (nativ, ohne Docker)

Voraussetzung: CentOS Stream 9 oder 10 (auch RHEL/Rocky/AlmaLinux), root-Zugriff, 2 GB RAM, Internetzugang für Paketquellen und npm.
Getestet auf CentOS Stream 10 (aarch64) mit Node.js 22.23 und MySQL 8.4; auf Stream 9 bisher nicht ausgeführt.

```bash
sudo dnf -y install git
git clone https://github.com/lydianb79/StrawberryERP.git
cd StrawberryERP
sudo bash deploy/install-centos.sh
```

Das Skript

- installiert Node.js 22, MySQL 8 und nginx aus den Paketquellen der Distribution,
- legt Datenbank und DB-Benutzer mit Zufallspasswort an; MySQL wird an `127.0.0.1` gebunden,
- legt den **dedizierten Systembenutzer `strawberry`** an (ohne Login-Shell, Home `/opt/strawberryerp`) – der Server läuft unter diesem Benutzer, nicht als root,
- baut das Frontend und installiert die Anwendung nach `/opt/strawberryerp`,
- richtet den gehärteten systemd-Dienst `strawberryerp` ein (lauscht nur auf `127.0.0.1:3000`),
- konfiguriert nginx als Reverse-Proxy auf Port 80 (inkl. SELinux-Freigabe) und öffnet HTTP/HTTPS in der Firewall.

Die Konfiguration liegt in `/etc/strawberryerp.env` (nur für root lesbar). Die Datenbank startet leer, ohne Beispieldaten.
Von aussen erreichbar sind danach nur nginx (80/443) und SSH.

```bash
journalctl -u strawberryerp | grep Initialpasswort   # Passwort des ersten Administrators
systemctl status strawberryerp                         # Dienststatus
journalctl -u strawberryerp -f                         # Log
```

**Update:** `git pull && sudo bash deploy/install-centos.sh` (idempotent; Daten bleiben erhalten).

**HTTPS:** `dnf install certbot python3-certbot-nginx && certbot --nginx -d erp.ihre-domain.ch`,
danach in `/etc/strawberryerp.env` `COOKIE_SECURE=true` setzen und `systemctl restart strawberryerp`.

**Datensicherung:** `deploy/backup.sh` erstellt komprimierte `mysqldump`-Sicherungen nach `/var/backups/strawberryerp` und löscht Stände, die älter als 30 Tage sind. Einrichtung als täglicher Cron-Job:

```bash
sudo install -m 700 deploy/backup.sh /opt/strawberryerp-backup.sh
echo '15 2 * * * root /opt/strawberryerp-backup.sh' | sudo tee /etc/cron.d/strawberryerp-backup
```

Mit Docker: `docker compose exec db sh -c 'mysqldump -ustrawberry -p"$MYSQL_PASSWORD" strawberryerp' | gzip > backup.sql.gz`

## Konfiguration (Umgebungsvariablen)

| Variable | Bedeutung |
|---|---|
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | MySQL-Verbindung |
| `JWT_SECRET` | Geheimnis für Sitzungs-Token (mind. 24 Zeichen, zufällig) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Erster Administrator (nur bei leerer Datenbank) |
| `SEED_DEMO` | `true` = Beispieldaten beim ersten Start |
| `COOKIE_SECURE` | `true`, sobald die Anwendung über HTTPS läuft |
| `HOST`, `PORT` | Bind-Adresse und Port des Servers (Standard `0.0.0.0:3000`) |

Das Datenbankschema wird beim Start automatisch angelegt (`server/src/schema.sql`), ebenso Rollen, Kontenplan und das laufende Geschäftsjahr.

## So arbeitet die Buchhaltung

Belege erzeugen automatisch Buchungen (Konten unter *Administration → Firma & Nummern* einstellbar):

| Vorgang | Soll | Haben |
|---|---|---|
| Rechnung buchen | 1100 Debitoren | 3200 Erlöse, 2200 Geschuldete MwSt |
| Zahlungseingang | 1020 Bank | 1100 Debitoren |
| Rechnung stornieren | 3200 Erlöse, 2200 MwSt | 1100 Debitoren |
| Lieferantenrechnung | Aufwandkonto, 1170 Vorsteuer | 2000 Kreditoren |
| Zahlung an Lieferant | 2000 Kreditoren | 1020 Bank |

**Jahresabschluss** (*Finanzen → Jahresabschluss*):

1. Erfolgskonten werden über 2979 «Jahresgewinn/-verlust» abgeschlossen.
2. Das Geschäftsjahr wird gesperrt (keine Buchungen, Zahlungen oder Belegänderungen mit Datum in diesem Jahr).
3. Das Folgejahr wird angelegt; Nummernkreise (`RE-2027-0001` …) beginnen neu.
4. Die Salden aller Bilanzkonten werden als Eröffnungsbilanz vorgetragen, das Ergebnis nach 2970 «Gewinnvortrag» umgebucht.
5. Offene Debitoren/Kreditoren, Stammdaten und Lagerbestände laufen unverändert weiter.

Der Lagerabgang wird beim Ausliefern des Auftrags gebucht – oder beim Buchen der Rechnung, falls nicht bereits über den Auftrag geliefert wurde.

## Sicherheit

- Passwörter mit bcrypt (Kostenfaktor 12), Sitzung als `HttpOnly`/`SameSite=Strict`-Cookie, Login-Rate-Limit
- Jede API-Route prüft die Berechtigung der Rolle serverseitig
- Ausschliesslich parametrisierte SQL-Abfragen; Security-Header via Helmet (CSP)
- Alle Änderungen werden im Protokoll festgehalten

## Erste Schritte nach der Installation

1. Anmelden und das Initialpasswort ändern (Schlüssel-Symbol oben rechts).
2. *Administration → Firma & Nummern*: Firmendaten, Bankverbindung, MwSt-Nr., Nummernkreise.
3. *Administration → Beleglayout*: Logo hochladen, Vorlage und Texte wählen.
4. *Administration → Benutzer / Rollen & Rechte*: Mitarbeitende anlegen.
5. Kunden, Lieferanten und Artikel erfassen; Anfangsbestände als Wareneingang buchen.
6. Eröffnungssalden (z.B. Bankguthaben, Eigenkapital) als manuelle Buchung im Journal erfassen.

## Bekannte Grenzen (Stand 1.0)

- Keine QR-Rechnung (Swiss QR-Bill) und kein E-Mail-Versand der Belege – PDFs werden heruntergeladen/gedruckt
- Eine Währung, ein Erlöskonto für alle Artikel, keine Kostenstellen
- Kein Wareneinkauf mit Bestellungen (Wareneingang wird direkt im Lager gebucht)
- Die MwSt-Übersicht ist eine Auswertungshilfe und ersetzt nicht die offizielle Abrechnung; das System ersetzt keine Treuhand-/Revisionsprüfung

## Entwicklung

Nach Code-Änderungen neu bauen und starten:

```bash
docker compose up -d --build
```

Das Frontend (`web/`) lässt sich auch mit `npm run dev` starten; der Vite-Server leitet `/api` an `localhost:3000` weiter.
