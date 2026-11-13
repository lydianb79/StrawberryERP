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
| **QR-Rechnung** | Zahlteil mit Swiss QR Code direkt auf der Rechnung (CHF/EUR), QR-Referenz bei QR-IBAN, sonst Creditor Reference (RF…) |
| **E-Mail-Versand** | Offerten, Auftragsbestätigungen, Rechnungen und Bestellungen als PDF per SMTP versenden; Textvorlagen mit Platzhaltern |
| **Bestellwesen** | Bestellungen an Lieferanten mit PDF, Bestellvorschlag aus Mindestbeständen, Teil- und Vollwareneingang ins Lager, Lieferantenrechnung direkt aus der Bestellung |
| **Fremdwährungen** | Währungen mit Kursen, Belege und Lieferantenrechnungen in Fremdwährung, Buchhaltung in Basiswährung, Kursgewinne/-verluste bei Zahlung automatisch gebucht |
| **Kostenstellen** | Zuordnung auf Belegen, Lieferantenrechnungen und manuellen Buchungen; Auswertung Ertrag/Aufwand/Ergebnis je Kostenstelle |
| **Beleglayout** | Logo-Upload (PNG/JPEG), Position und Grösse, 3 Vorlagen, Akzentfarbe, Schrift, Adressfeld links/rechts, ein-/ausblendbare Spalten, Standardtexte mit Platzhaltern, **Live-Vorschau** |
| **Debitoren / Kreditoren** | Offene Posten, Fälligkeitsstruktur (0 / 1–30 / 31–60 / >60 Tage), Zahlungsein- und -ausgänge, Lieferantenrechnungen mit Vorsteuer |
| **Finanzbuchhaltung** | Doppelte Buchhaltung, automatische Buchungen aus Belegen, Erlöskonto pro Artikel, manuelle Buchungen, Kontenplan, Journal |
| **Bilanz und Erfolgsrechnung** | Pro Geschäftsjahr, druckbar |
| **Jahresabschluss** | Assistent mit Prüfungen; Abschluss der Erfolgskonten, Sperren des Jahres, Anlegen des Folgejahres, **Saldovortrag als Eröffnungsbilanz**, Gewinnvortrag; rückgängig machbar, solange das Folgejahr offen ist |
| **Reporting** | Dashboard mit Kennzahlen, Umsatz pro Monat, Top-Kunden/-Artikel, Fälligkeitslisten, Lagerbewertung, MwSt-Übersicht; CSV-Export aller Listen |
| **Administration** | Firmendaten, Nummernkreise, Standardkonten, Währungen, E-Mail-Server, Protokoll (Audit-Log), System & Updates |
| **Benutzer & Rollen** | Benutzerverwaltung, rollenbasierter Zugriff mit 24 Einzelrechten; vordefinierte Rollen: Administrator, Buchhaltung, Verkauf, Lager, Nur Lesen |

## Technologie

- **Frontend:** React 18, React Router, Vite (Single-Page-App, keine externen CDNs/Fonts)
- **Backend:** Node.js 22, Express, PDFKit (Belege als PDF), swissqrbill (QR-Zahlteil), Nodemailer (SMTP)
- **Datenbank:** MySQL 8 (InnoDB, Transaktionen, Fremdschlüssel)
- **Betrieb:** Docker Compose **oder** native Installation auf CentOS Stream 9/10 (systemd + nginx)

```
web/      React-Frontend (wird zu statischen Dateien gebaut)
server/   REST-API, Geschäftslogik, Schema (src/schema.sql), PDF-Erzeugung
deploy/   CentOS-Installations- und Update-Skript, systemd-Unit, nginx-Konfiguration, Backup-Skript
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


**HTTPS:** `dnf install certbot python3-certbot-nginx && certbot --nginx -d erp.ihre-domain.ch`,
danach in `/etc/strawberryerp.env` `COOKIE_SECURE=true` setzen und `systemctl restart strawberryerp`.

**Datensicherung:** `deploy/backup.sh` erstellt komprimierte `mysqldump`-Sicherungen nach `/var/backups/strawberryerp` und löscht Stände, die älter als 30 Tage sind. Einrichtung als täglicher Cron-Job:

```bash
sudo install -m 700 deploy/backup.sh /opt/strawberryerp-backup.sh
echo '15 2 * * * root /opt/strawberryerp-backup.sh' | sudo tee /etc/cron.d/strawberryerp-backup
```

Mit Docker: `docker compose exec db sh -c 'mysqldump -ustrawberry -p"$MYSQL_PASSWORD" strawberryerp' | gzip > backup.sql.gz`

## Updates auf neue Releases

Unter *Administration → System & Updates* zeigt StrawberryERP die installierte Version und meldet, wenn auf GitHub ein neueres Release vorliegt
(abschaltbar mit `UPDATE_CHECK=false`; es werden dabei keine Daten übermittelt).

**CentOS (native Installation):**

```bash
cd /root/StrawberryERP          # das bei der Installation geklonte Repository
sudo bash deploy/update.sh      # neuestes Release; oder gezielt: deploy/update.sh v1.2.0
```

`deploy/update.sh --check` zeigt nur an, ob ein Update verfügbar ist. Das Skript

1. sichert die Datenbank (`/var/backups/strawberryerp`),
2. checkt das Release aus, baut die Anwendung neu und startet den Dienst,
3. prüft, ob der Dienst antwortet,
4. stellt bei einem Fehlstart automatisch die vorherige Version **und** die Datenbanksicherung wieder her.

Einmalig beim Wechsel von 1.0 (enthält das Update-Skript noch nicht): `git fetch --tags && git checkout v1.1.0 && sudo bash deploy/update.sh`

**Docker:**

```bash
docker compose exec db sh -c 'mysqldump -ustrawberry -p"$MYSQL_PASSWORD" --no-tablespaces strawberryerp' | gzip > backup-vor-update.sql.gz
git fetch --tags && git checkout v1.2.0
docker compose up -d --build
```

**Datenbankschema:** Änderungen werden als versionierte Migrationen ausgeliefert (`server/src/migrations.js`) und beim Start der neuen Version
automatisch und genau einmal ausgeführt; der Stand steht in der Tabelle `schema_migrations`. Ein manueller Eingriff ist nicht nötig.

## Konfiguration (Umgebungsvariablen)

| Variable | Bedeutung |
|---|---|
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | MySQL-Verbindung |
| `JWT_SECRET` | Geheimnis für Sitzungs-Token (mind. 24 Zeichen, zufällig) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Erster Administrator (nur bei leerer Datenbank) |
| `SEED_DEMO` | `true` = Beispieldaten beim ersten Start |
| `COOKIE_SECURE` | `true`, sobald die Anwendung über HTTPS läuft |
| `HOST`, `PORT` | Bind-Adresse und Port des Servers (Standard `0.0.0.0:3000`) |
| `UPDATE_CHECK` | `false` = keine Abfrage bei GitHub nach neuen Releases |

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
| Kursdifferenz bei Zahlung | 6940 Kursverluste | 6990 Kursgewinne |

Erlöse werden auf das beim Artikel hinterlegte Erlöskonto gebucht (ohne Angabe: Standard-Erlöskonto) und tragen die Kostenstelle des Belegs.

**Fremdwährungen:** Die Buchhaltung läuft in der Basiswährung (Standard CHF). Belege in Fremdwährung werden zum Belegkurs gebucht;
bei der Zahlung wird der Kurs des Zahlungstags erfasst und die Differenz automatisch als Kursgewinn oder -verlust verbucht.
Kurse werden unter *Administration → Währungen* gepflegt und pro Beleg vorgeschlagen.

**Bestellwesen:** Bestellung erfassen (optional mit Bestellvorschlag aus Artikeln unter Mindestbestand) → auslösen → Wareneingang
(auch in Teilmengen) bucht das Lager und führt den Einstandspreis nach → Lieferantenrechnung aus der Bestellung erzeugt den Kreditor.

**QR-Rechnung:** Sobald in den Firmendaten eine gültige CH/LI-IBAN hinterlegt ist, erhält jede gebuchte Rechnung in CHF oder EUR den
QR-Zahlteil (abschaltbar im Beleglayout). Mit einer QR-IBAN wird eine 27-stellige QR-Referenz erzeugt, sonst eine Creditor Reference.

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

## Bekannte Grenzen (Stand 1.1)

- Kein automatischer Abgleich von Zahlungseingängen (camt.053/054) – Zahlungen werden manuell erfasst
- Keine Neubewertung offener Fremdwährungsposten zum Stichtag; Kursdifferenzen entstehen bei der Zahlung
- Kurse werden manuell gepflegt (kein automatischer Kursabruf)
- Die MwSt-Übersicht ist eine Auswertungshilfe und ersetzt nicht die offizielle Abrechnung; das System ersetzt keine Treuhand-/Revisionsprüfung

## Entwicklung

Nach Code-Änderungen neu bauen und starten:

```bash
docker compose up -d --build
```

Das Frontend (`web/`) lässt sich auch mit `npm run dev` starten; der Vite-Server leitet `/api` an `localhost:3000` weiter.

E-Mail-Versand lokal testen: `docker compose --profile dev up -d` startet zusätzlich Mailpit (Postfach unter <http://localhost:8025>);
in der App als SMTP-Server `mailpit`, Port `1025`, ohne Anmeldung eintragen.

Schemaänderungen: neuen Eintrag mit der nächsten Versionsnummer in `server/src/migrations.js` anhängen – bestehende Einträge nie ändern.
