# 🍓 StrawberryERP

Ein schlankes, webbasiertes ERP-System für KMU – von der Offerte bis zum Jahresabschluss.
Ausgelegt auf Schweizer Verhältnisse (CHF, MwSt-Sätze, Kontenrahmen KMU), Oberfläche auf Deutsch.

## Funktionen

| Bereich | Umfang |
|---|---|
| **Kundenverwaltung** | Kunden- und Lieferantenstamm, automatische Nummernvergabe, Zahlungsfristen, CSV-Export |
| **Lagerverwaltung** | Artikelstamm (Lagerartikel und Dienstleistungen), Wareneingang/-ausgang, Inventurkorrektur, Mindestbestand mit Nachbestell-Hinweis, lückenloses Bewegungsprotokoll |
| **Offerten** | Erstellen, PDF, Status (Entwurf → Gesendet → Akzeptiert/Abgelehnt), Umwandlung in Auftrag oder Rechnung |
| **Auftragsverwaltung** | Auftragsbestätigung als PDF, Teillieferungen mit Lagerabgang, Teilrechnungen, Storno |
| **Rechnungsstellung** | Entwurf → Buchen (fortlaufende Nummer, Debitorenbuchung, Lagerabgang), Teil-/Vollzahlung, Storno mit Gegenbuchung |
| **Gutschriften** | Voll- und Teilgutschriften zu Rechnungen, automatische Verrechnung mit dem offenen Posten, Wiedereinlagerung, Auszahlung von Guthaben |
| **Abo-Rechnungen** | Wiederkehrende Rechnungen (monatlich bis jährlich) aus einer Vorlage, automatisch zum Termin erstellt – als Entwurf oder direkt gebucht |
| **Mahnwesen** | Mahnstufen mit Fristen, Texten und Gebühren, Mahnlauf, Mahnschreiben als PDF mit QR-Zahlteil, Versand per E-Mail |
| **Zahlungsabgleich** | Kontoauszüge camt.053/camt.054 einlesen, Zuordnung über QR-Referenz oder Rechnungsnummer, Duplikaterkennung |
| **QR-Rechnung** | Zahlteil mit Swiss QR Code direkt auf der Rechnung (CHF/EUR), QR-Referenz bei QR-IBAN, sonst Creditor Reference (RF…) |
| **E-Mail-Versand** | Offerten, Auftragsbestätigungen, Rechnungen und Bestellungen als PDF per SMTP versenden; Textvorlagen mit Platzhaltern |
| **Bestellwesen** | Bestellungen an Lieferanten mit PDF, Bestellvorschlag aus Mindestbeständen, Teil- und Vollwareneingang ins Lager, Lieferantenrechnung direkt aus der Bestellung |
| **Fremdwährungen** | Währungen mit Kursen (Abruf der EZB-Referenzkurse auf Knopfdruck oder täglich), Belege in Fremdwährung, Kursgewinne/-verluste bei Zahlung automatisch gebucht, Stichtagsbewertung offener Posten |
| **Preislisten** | Kundenspezifische Preise, Staffelpreise nach Menge, Kundenrabatt als Vorschlag auf Belegpositionen |
| **Mehrsprachige Belege** | Offerten, Rechnungen, Mahnungen usw. auf Deutsch, Französisch, Italienisch oder Englisch – je Kunde hinterlegt, pro Beleg wählbar |
| **Kostenstellen** | Zuordnung auf Belegen, Lieferantenrechnungen und manuellen Buchungen; Auswertung Ertrag/Aufwand/Ergebnis je Kostenstelle |
| **Beleglayout** | Logo-Upload (PNG/JPEG), Position und Grösse, 3 Vorlagen, Akzentfarbe, Schrift, Adressfeld links/rechts, ein-/ausblendbare Spalten, Standardtexte mit Platzhaltern, **Live-Vorschau** |
| **Debitoren / Kreditoren** | Offene Posten, Fälligkeitsstruktur (0 / 1–30 / 31–60 / >60 Tage), Zahlungsein- und -ausgänge, Lieferantenrechnungen mit Vorsteuer und Belegablage (PDF/Bild) |
| **Finanzbuchhaltung** | Doppelte Buchhaltung, automatische Buchungen aus Belegen, Erlöskonto pro Artikel, manuelle Buchungen, Kontenplan, Journal |
| **Bilanz und Erfolgsrechnung** | Pro Geschäftsjahr, druckbar |
| **MwSt-Abrechnung** | Nach vereinbartem oder vereinnahmtem Entgelt oder mit Saldosteuersatz, mit den Ziffern des ESTV-Formulars |
| **Jahresabschluss** | Abschlussarbeiten (Warenlager in die Bilanz, Bewertung Fremdwährungen), Assistent mit Prüfungen; Abschluss der Erfolgskonten, Sperren des Jahres, Anlegen des Folgejahres, **Saldovortrag als Eröffnungsbilanz**, Gewinnvortrag; rückgängig machbar, solange das Folgejahr offen ist |
| **Reporting** | Dashboard mit Kennzahlen, Umsatz pro Monat, Top-Kunden/-Artikel, Fälligkeitslisten, Lagerbewertung, MwSt-Übersicht; CSV-Export aller Listen |
| **Administration** | Firmendaten, Nummernkreise, Standardkonten, Währungen, E-Mail-Server, Protokoll (Audit-Log), System & Updates |
| **Benutzer & Rollen** | Benutzerverwaltung, rollenbasierter Zugriff mit 25 Einzelrechten, Zwei-Faktor-Anmeldung (TOTP), «Passwort vergessen» per E-Mail; vordefinierte Rollen: Administrator, Buchhaltung, Verkauf, Lager, Nur Lesen |

## Technologie

- **Frontend:** React 18, React Router, Vite (Single-Page-App, keine externen CDNs/Fonts)
- **Backend:** Node.js 22, Express, PDFKit (Belege als PDF), swissqrbill (QR-Zahlteil), Nodemailer (SMTP), fast-xml-parser (camt, Kurse)
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


**HTTPS:**

```bash
sudo bash deploy/enable-https.sh                                             # internes Netz: selbstsigniertes Zertifikat
sudo bash deploy/enable-https.sh --domain erp.firma.ch --email it@firma.ch   # öffentliche Domain: Let's Encrypt
```

Das Skript richtet das Zertifikat ein, leitet HTTP auf HTTPS um und stellt das Sitzungs-Cookie auf «nur verschlüsselt».
Beim selbstsignierten Zertifikat zeigt der Browser einmalig eine Warnung; das Skript gibt den Fingerabdruck zum Vergleichen aus.
Die HTTPS-Konfiguration bleibt bei Updates erhalten. Die Let's-Encrypt-Variante setzt voraus, dass die Domain auf den Server zeigt
und Port 80 aus dem Internet erreichbar ist.

**Datensicherung:** Die Installation richtet eine tägliche Sicherung ein (systemd-Timer `strawberryerp-backup.timer`, 02:15 Uhr;
verpasste Läufe werden nachgeholt). Die Sicherungen liegen komprimiert in `/var/backups/strawberryerp`, werden nach dem Schreiben
geprüft und nach 30 Tagen gelöscht.

```bash
systemctl list-timers strawberryerp-backup.timer    # nächster Lauf
sudo systemctl start strawberryerp-backup.service   # sofort sichern
journalctl -u strawberryerp-backup.service -n 20    # Ergebnis der letzten Läufe
```

Eine Sicherung auf demselben Server schützt nicht vor dessen Ausfall. Für eine Kopie an einen zweiten Ort in `/etc/strawberryerp.env`
`BACKUP_RSYNC_TARGET=benutzer@backupserver:/pfad/` setzen (SSH-Schlüssel für root vorausgesetzt) – jede Sicherung wird dann zusätzlich dorthin kopiert.

Wiederherstellen: `systemctl stop strawberryerp`, dann `gunzip -c DATEI.sql.gz | mysql -uroot strawberryerp`, danach `systemctl start strawberryerp`.

Mit Docker: `docker compose exec db sh -c 'mysqldump -ustrawberry -p"$MYSQL_PASSWORD" --no-tablespaces strawberryerp' | gzip > backup.sql.gz`

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
| `SCHEDULER` | `false` = keine Hintergrundaufgaben (Abo-Rechnungen erzeugen, Kurse aktualisieren) |

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
| Gutschrift | 3200 Erlöse, 2200 MwSt | 1100 Debitoren |
| Mahngebühr | 1100 Debitoren | 3890 Mahngebühren |
| Bestandesänderung Warenlager | 1200 Vorräte | 4800 Bestandesänderungen |

**Nichts wird gelöscht:** Buchungen, Zahlungen und Lieferantenrechnungen lassen sich nur stornieren. Dabei entsteht eine Gegenbuchung;
Original und Storno bleiben im Journal sichtbar und sind miteinander verknüpft. Eine Korrektur ist ein Storno mit anschliessender Neubuchung.

Erlöse werden auf das beim Artikel hinterlegte Erlöskonto gebucht (ohne Angabe: Standard-Erlöskonto) und tragen die Kostenstelle des Belegs.

**Fremdwährungen:** Die Buchhaltung läuft in der Basiswährung (Standard CHF). Belege in Fremdwährung werden zum Belegkurs gebucht;
bei der Zahlung wird der Kurs des Zahlungstags erfasst und die Differenz automatisch als Kursgewinn oder -verlust verbucht.
Kurse werden unter *Administration → Währungen* gepflegt und pro Beleg vorgeschlagen.

**Bestellwesen:** Bestellung erfassen (optional mit Bestellvorschlag aus Artikeln unter Mindestbestand) → auslösen → Wareneingang
(auch in Teilmengen) bucht das Lager und führt den Einstandspreis nach → Lieferantenrechnung aus der Bestellung erzeugt den Kreditor.

**Aufträge in Teilen:** Ein Auftrag kann in mehreren Schritten ausgeliefert und verrechnet werden; je Position zeigt er gelieferte und verrechnete
Mengen. Wird mehr verrechnet als geliefert, bucht die Teilrechnung die fehlende Menge aus dem Lager aus.

**Gutschriften:** Aus einer gebuchten Rechnung entsteht ein Gutschrift-Entwurf mit deren Positionen (Mengen anpassbar). Beim Buchen werden Erlös und
MwSt zurückgebucht, die Ware auf Wunsch wieder eingelagert und der Betrag mit der Rechnung verrechnet. Ist die Rechnung schon bezahlt, bleibt ein
Guthaben, das ausbezahlt werden kann.

**Mahnwesen** (*Finanzen → Debitoren → Mahnwesen*): Der Mahnlauf schlägt für überfällige Rechnungen die nächste Stufe vor, sobald deren Wartefrist
abgelaufen ist. Mahngebühren werden als Forderung verbucht und sind Teil des offenen Betrags.

**Zahlungsabgleich** (*Finanzen → Debitoren → Zahlungsabgleich*): Kontoauszug als camt.053- oder camt.054-Datei aus dem E-Banking hochladen. Eingänge
werden über die Zahlungsreferenz der QR-Rechnung oder die Rechnungsnummer im Mitteilungstext zugeordnet; vor dem Verbuchen sehen Sie jede Zuordnung.

**Abschlussarbeiten** (*Finanzen → Jahresabschluss*): «Warenlager in die Bilanz übernehmen» bucht die Differenz zwischen Lagerwert und Konto 1200.
«Fremdwährungsposten bewerten» bucht nicht realisierte Kursdifferenzen zum Stichtag und macht sie am Folgetag automatisch rückgängig.

**MwSt:** Die Methode (vereinbart, vereinnahmt, Saldosteuersatz) wird in den Firmendaten gewählt und lässt sich im Report umschalten.

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
- **Zwei-Faktor-Anmeldung** mit Authenticator-App (TOTP), pro Benutzer unter *Konto & Sicherheit* einzurichten; ein Administrator kann sie bei Geräteverlust zurücksetzen
- **Passwort vergessen:** Link per E-Mail, 60 Minuten und einmalig gültig. Voraussetzung ist ein eingerichteter E-Mail-Versand; die *Adresse der Anwendung* in den Firmendaten bestimmt den Link
- Passwortwechsel, Zurücksetzen und Deaktivieren beenden sofort alle bestehenden Sitzungen des Benutzers
- Jede API-Route prüft die Berechtigung der Rolle serverseitig
- Ausschliesslich parametrisierte SQL-Abfragen; Security-Header via Helmet (CSP)
- Buchungen und Zahlungen sind unveränderbar (Storno statt Löschen); alle Aktionen stehen im Protokoll

## Erste Schritte nach der Installation

1. Anmelden und das Initialpasswort ändern (Schlüssel-Symbol oben rechts).
2. *Administration → Firma & Nummern*: Firmendaten, Bankverbindung, MwSt-Nr., Nummernkreise.
3. *Administration → Beleglayout*: Logo hochladen, Vorlage und Texte wählen.
4. *Administration → Benutzer / Rollen & Rechte*: Mitarbeitende anlegen.
5. Kunden, Lieferanten und Artikel erfassen; Anfangsbestände als Wareneingang buchen.
   Mahnstufen unter *Debitoren → Mahnwesen* und die MwSt-Methode in den Firmendaten prüfen.
6. Eröffnungssalden (z.B. Bankguthaben, Eigenkapital) als manuelle Buchung im Journal erfassen.

## Bekannte Grenzen (Stand 1.2)

- Zahlungsabgleich nur für Zahlungseingänge; Zahlungsausgänge (pain.001) werden nicht erzeugt
- Abo-Rechnungen: Positionen einer Vorlage lassen sich nicht direkt bearbeiten (neues Abo aus angepasster Rechnung anlegen)
- Standardtexte und E-Mail-Vorlagen sind nur auf Deutsch anpassbar; für FR/IT/EN gelten mitgelieferte Belegtexte
- Keine Wiederherstellungscodes für die Zwei-Faktor-Anmeldung – verliert der einzige Administrator sein Gerät, muss der zweite Faktor in der Datenbank zurückgesetzt werden
- Gutschriften lassen sich nicht stornieren; eine verrechnete Gutschrift wird mit einer neuen Rechnung korrigiert
- Die MwSt-Auswertung ist eine Abrechnungshilfe und ersetzt nicht die offizielle Abrechnung; das System ersetzt keine Treuhand-/Revisionsprüfung

## Automatische Tests

```bash
docker compose -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from tests
docker compose -f docker-compose.test.yml down -v
```

Die Suite startet eine frische Wegwerf-Datenbank, die Anwendung und einen Mail-Fänger und prüft über die API:
Anmeldung, Rollenrechte, Zwei-Faktor-Anmeldung und Passwort-Reset, Stammdaten und Lager, den Belegfluss von der Offerte bis zur Zahlung,
Teillieferung und Teilrechnung, Gutschriften, Mahnwesen, Zahlungsabgleich, Abo-Rechnungen, Storno statt Löschen, Fremdwährungen,
Bestellwesen, Buchhaltung, MwSt-Methoden, PDF und QR-Rechnung, E-Mail-Versand sowie den Jahresabschluss mit Saldovortrag (57 Tests). Dazu kommen Unit-Tests der Rechenlogik (`server/test/unit.test.js`).
Nach jeder Buchung wird geprüft, dass die Bilanz ausgeglichen ist.

Die Oberfläche selbst (Klickwege im Browser) ist nicht automatisiert getestet.

## Entwicklung

Nach Code-Änderungen neu bauen und starten:

```bash
docker compose up -d --build
```

Das Frontend (`web/`) lässt sich auch mit `npm run dev` starten; der Vite-Server leitet `/api` an `localhost:3000` weiter.

E-Mail-Versand lokal testen: `docker compose --profile dev up -d` startet zusätzlich Mailpit (Postfach unter <http://localhost:8025>);
in der App als SMTP-Server `mailpit`, Port `1025`, ohne Anmeldung eintragen.

Schemaänderungen: neuen Eintrag mit der nächsten Versionsnummer in `server/src/migrations.js` anhängen – bestehende Einträge nie ändern.
