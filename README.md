# 🍓 StrawberryERP

Ein schlankes, webbasiertes ERP-System für KMU – von der Offerte bis zum Jahresabschluss.
Ausgelegt auf Schweizer Verhältnisse (CHF, MwSt-Sätze, Kontenrahmen KMU), Oberfläche auf Deutsch.

## Funktionen

| Bereich | Umfang |
|---|---|
| **Kundenverwaltung** | Kunden- und Lieferantenstamm, automatische Nummernvergabe, Zahlungsfristen, CSV-Export |
| **Lagerverwaltung** | Artikelstamm (Lagerartikel und Dienstleistungen), mehrere Lagerorte mit Umlagerung, Chargen und Seriennummern (FIFO-Entnahme, Rückverfolgung), geführte Inventur, Bewertung nach letztem Einstandspreis oder gleitendem Durchschnitt, Mindestbestand, lückenloses Bewegungsprotokoll |
| **Projekte und Zeiterfassung** | Projekte mit Stundensatz und Budget, Arbeitszeit erfassen, offene Stunden in einen Rechnungsentwurf übernehmen |
| **Kontakte** | Mehrere Ansprechpersonen pro Kunde und Lieferant, Notizen und Aufgaben zu Kunden und Belegen, eigene Aufgaben auf dem Dashboard |
| **Lohn** | Mitarbeitende, monatlicher Lohnlauf mit einstellbaren Abzugssätzen, 13. Monatslohn (anteilig bei Ein- und Austritt), Lohnabrechnung als PDF, Verbuchung, Zahlungsdatei für die Auszahlung, Lohnausweis pro Jahr |
| **Offerten** | Erstellen, PDF, Status (Entwurf → Gesendet → Akzeptiert/Abgelehnt), Umwandlung in Auftrag oder Rechnung |
| **Auftragsverwaltung** | Auftragsbestätigung als PDF, Teillieferungen mit Lagerabgang, Teilrechnungen, Storno |
| **Rechnungsstellung** | Entwurf → Buchen (fortlaufende Nummer, Debitorenbuchung, Lagerabgang), Teil-/Vollzahlung, Storno mit Gegenbuchung |
| **Gutschriften** | Voll- und Teilgutschriften zu Rechnungen, automatische Verrechnung mit dem offenen Posten, Wiedereinlagerung, Auszahlung von Guthaben, Storno |
| **Abo-Rechnungen** | Wiederkehrende Rechnungen (monatlich bis jährlich) aus einer Vorlage, automatisch zum Termin erstellt – als Entwurf oder direkt gebucht |
| **Mahnwesen** | Mahnstufen mit Fristen, Texten, Gebühren und Verzugszins, Mahnlauf, Mahnschreiben als PDF mit QR-Zahlteil, Sammelmahnung pro Kunde, Versand per E-Mail |
| **Zahlungsabgleich** | Kontoauszüge camt.053/camt.054 einlesen, Zuordnung über QR-Referenz oder Rechnungsnummer, Duplikaterkennung |
| **Zahlungsdateien** | Lieferantenzahlungen und Löhne als pain.001-Datei für das E-Banking |
| **Bankabstimmung** | Buchsaldo gegen Kontoauszug, Buchungen als abgestimmt markieren, Schlusssaldo aus camt.053 übernehmen, Abstimmungen festhalten |
| **QR-Rechnung** | Zahlteil mit Swiss QR Code direkt auf der Rechnung (CHF/EUR), QR-Referenz bei QR-IBAN, sonst Creditor Reference (RF…) |
| **E-Mail-Versand** | Offerten, Auftragsbestätigungen, Rechnungen und Bestellungen als PDF per SMTP versenden; Textvorlagen mit Platzhaltern |
| **Bestellwesen** | Bestellungen an Lieferanten mit PDF, Bestellvorschlag aus Mindestbeständen, Teil- und Vollwareneingang ins Lager, Lieferantenrechnung direkt aus der Bestellung |
| **Fremdwährungen** | Währungen mit Kursen und Kursverlauf (Abruf der EZB-Referenzkurse auf Knopfdruck oder täglich; Belege erhalten den Kurs ihres Datums), Belege in Fremdwährung, Kursgewinne/-verluste bei Zahlung automatisch gebucht, Stichtagsbewertung offener Posten |
| **Preislisten** | Kundenspezifische Preise, Staffelpreise nach Menge, Kundenrabatt als Vorschlag auf Belegpositionen |
| **Mehrsprachige Belege** | Offerten, Rechnungen, Mahnungen usw. auf Deutsch, Französisch, Italienisch oder Englisch – je Kunde hinterlegt, pro Beleg wählbar |
| **Kostenstellen** | Zuordnung auf Belegen, Lieferantenrechnungen und manuellen Buchungen; Auswertung Ertrag/Aufwand/Ergebnis je Kostenstelle |
| **Beleglayout** | Logo-Upload (PNG/JPEG), Position und Grösse, 3 Vorlagen, Akzentfarbe, Schrift, Adressfeld links/rechts, ein-/ausblendbare Spalten, Standardtexte mit Platzhaltern, **Live-Vorschau** |
| **Debitoren / Kreditoren** | Offene Posten, Fälligkeitsstruktur (0 / 1–30 / 31–60 / >60 Tage), Zahlungsein- und -ausgänge, Lieferantenrechnungen mit Vorsteuer; Belegablage (PDF/Bild) für alle Belege |
| **Finanzbuchhaltung** | Doppelte Buchhaltung, automatische Buchungen aus Belegen, Erlöskonto pro Artikel, manuelle Buchungen, Kontenplan, Journal mit CSV-Export für den Treuhänder (Buchungszeilen oder Soll/Haben) |
| **Bilanz und Erfolgsrechnung** | Pro Geschäftsjahr, druckbar |
| **MwSt-Abrechnung** | Nach vereinbartem oder vereinnahmtem Entgelt oder mit Saldosteuersatz, mit den Ziffern des ESTV-Formulars |
| **Jahresabschluss** | Abschlussarbeiten (Warenlager in die Bilanz, Bewertung Fremdwährungen), Assistent mit Prüfungen; Abschluss der Erfolgskonten, Sperren des Jahres, Anlegen des Folgejahres, **Saldovortrag als Eröffnungsbilanz**, Gewinnvortrag; rückgängig machbar, solange das Folgejahr offen ist |
| **Reporting** | Dashboard mit Kennzahlen, Umsatz pro Monat, Top-Kunden/-Artikel, Fälligkeitslisten, Lagerbewertung, MwSt-Übersicht; CSV-Export aller Listen |
| **Administration** | Firmendaten, Nummernkreise, Standardkonten, Währungen, E-Mail-Server, Protokoll (Audit-Log), System & Updates |
| **Benutzer & Rollen** | Benutzerverwaltung, rollenbasierter Zugriff mit 30 Einzelrechten, Zwei-Faktor-Anmeldung (TOTP) mit Wiederherstellungscodes, «Passwort vergessen» per E-Mail; 14 vordefinierte Rollen und eine Übersicht «Wer darf was?» (siehe [Rollen und Module](#rollen-und-module)) |
| **Module** | Der Administrator legt fest, welche Bereiche verwendet werden; ausgeschaltete Module sind für alle ausgeblendet und gesperrt |

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

### Gültiges Zertifikat ohne Browserwarnung

Ein öffentlich anerkanntes Zertifikat braucht einen Domainnamen – für eine nackte IP-Adresse (z.B. `10.211.55.9`) stellt keine
Zertifizierungsstelle eines aus. Welcher Weg passt, hängt davon ab, wie der Server erreichbar ist:

| Situation | Weg |
|---|---|
| Test- oder Einzelplatzinstallation im internen Netz | Dem selbstsignierten Zertifikat auf den eigenen Geräten vertrauen |
| Server aus dem Internet erreichbar, eigene Domain | Let's Encrypt über `enable-https.sh --domain … --email …` |
| Server nur intern erreichbar, eigene Domain | Let's Encrypt mit DNS-Nachweis (von Hand, siehe unten) |
| Zertifikat bereits vorhanden (gekauft oder firmeneigene Zertifizierungsstelle) | Dateien ablegen und nginx neu laden |

**Dem selbstsignierten Zertifikat vertrauen (macOS):** Das von `enable-https.sh` erzeugte Zertifikat ist auf die IP-Adresse und den Hostnamen
des Servers ausgestellt. Es fehlt nur das Vertrauen auf dem Gerät, von dem aus zugegriffen wird:

```bash
scp root@SERVER:/etc/pki/tls/certs/strawberryerp.crt ~/Downloads/
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ~/Downloads/strawberryerp.crt
```

Danach zeigen Safari und Chrome keine Warnung mehr. Das gilt nur für Geräte, auf denen das Zertifikat so eingetragen wurde; vorher den
Fingerabdruck vergleichen, den `enable-https.sh` ausgegeben hat (`openssl x509 -in strawberryerp.crt -noout -fingerprint -sha256`).
Unter Windows: Zertifikat doppelklicken → «Zertifikat installieren» → «Lokaler Computer» → «Vertrauenswürdige Stammzertifizierungsstellen».

**Let's Encrypt für einen aus dem Internet erreichbaren Server:** Die Domain muss per DNS auf den Server zeigen und Port 80 offen sein.
Das Skript holt das Zertifikat und richtet die automatische Erneuerung ein:

```bash
sudo bash deploy/enable-https.sh --domain erp.ihre-firma.ch --email it@ihre-firma.ch
```

**Let's Encrypt für einen nur intern erreichbaren Server:** Mit einer eigenen Domain geht das über den DNS-Nachweis (DNS-01): Statt eines
Zugriffs von aussen wird ein TXT-Eintrag in der DNS-Zone geprüft, und `erp.ihre-firma.ch` zeigt intern auf die private IP. `enable-https.sh`
unterstützt das noch nicht; nötig ist certbot mit dem Plugin des DNS-Anbieters (z.B. `python3-certbot-dns-cloudflare`) oder der manuelle Modus
`certbot certonly --manual --preferred-challenges dns -d erp.ihre-firma.ch`, bei dem der Eintrag alle 90 Tage von Hand erneuert werden muss.
Das ausgestellte Zertifikat wird danach wie ein vorhandenes eingebunden.

**Vorhandenes Zertifikat einbinden:** Zertifikat samt Zwischenzertifikaten (Kette, PEM) und privaten Schlüssel an die Stellen legen,
auf die die nginx-Konfiguration verweist, dann nginx neu laden:

```bash
sudo install -m 644 fullchain.pem /etc/pki/tls/certs/strawberryerp.crt
sudo install -m 600 privkey.pem /etc/pki/tls/private/strawberryerp.key
sudo nginx -t && sudo systemctl reload nginx
```

Voraussetzung ist, dass `enable-https.sh` (ohne Domain) einmal gelaufen ist und die HTTPS-Konfiguration angelegt hat. Ein erneuter Aufruf
des Skripts ohne Domain würde die Dateien wieder durch ein selbstsigniertes Zertifikat ersetzen. Updates (`deploy/update.sh`) lassen
Zertifikat und Konfiguration unangetastet.

Nicht erprobt sind die Let's-Encrypt-Variante des Skripts und der DNS-Nachweis; das selbstsignierte Zertifikat und der Erhalt der
Konfiguration über Updates hinweg sind auf CentOS Stream 10 getestet.

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

**Überwachung:** Ein zweiter Timer (`strawberryerp-monitor.timer`) prüft alle fünf Minuten, ob die Anwendung antwortet, die Systemdienste laufen,
die letzte Datensicherung gelungen und nicht älter als 26 Stunden ist, genügend Speicherplatz frei ist und das TLS-Zertifikat nicht bald abläuft.
Bei einem Statuswechsel (Störung oder Behebung) geht eine E-Mail an alle Administratoren – oder an `MONITOR_EMAIL` in `/etc/strawberryerp.env`;
eine andauernde Störung wird einmal täglich erinnert. Voraussetzung ist ein eingerichteter E-Mail-Versand (*Administration → E-Mail*).
Der aktuelle Stand steht unter *Administration → System & Updates*.

```bash
sudo systemctl start strawberryerp-monitor.service && journalctl -u strawberryerp-monitor.service -n 12   # sofort prüfen
```

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
| `MONITOR_EMAIL` | Empfänger der Überwachungsmeldungen (Standard: alle Administratoren); `MONITOR_BACKUP_MAX_AGE_HOURS`, `MONITOR_DISK_LIMIT_PERCENT`, `MONITOR_CERT_DAYS` ändern die Schwellen |

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
| Verzugszins | 1100 Debitoren | 6950 Finanzertrag |
| Lohnlauf | 5000 Lohnaufwand, 5700 Sozialaufwand | 2270 Sozialversicherungen, 2275 Geschuldete Löhne |
| Lohnzahlung | 2275 Geschuldete Löhne | 1020 Bank |

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

**Lager:** Jede Bewegung gehört zu einem Lagerort; Belege buchen auf den ersten aktiven Lagerort, Umlagerungen erfolgen beim Artikel unter «Bestand».
Bei chargen- oder seriennummerngeführten Artikeln verlangt der Wareneingang eine Charge; Abgänge ohne Angabe entnehmen die älteste Charge zuerst.
Die geführte Inventur hält den Sollbestand fest, nimmt die Zählung auf und bucht beim Abschluss nur die Abweichungen.
Die Bewertungsmethode (letzter Einstandspreis oder gleitender Durchschnitt) wird in den Firmendaten gewählt.

**Projekte:** Zeiten werden mit dem Stundensatz des Projekts erfasst. «Abrechnen» übernimmt alle offenen, verrechenbaren Stunden in einen
Rechnungsentwurf; wird der Entwurf gelöscht, sind die Stunden wieder offen.

**Lohn** (*Lohn → Lohnläufe*): Ein Lauf rechnet je Person Monatslohn plus Zulage und gegebenenfalls 13. Monatslohn, zieht die prozentualen Beiträge und den BVG-Betrag ab und zählt
Spesen beitragsfrei dazu. Buchen erzeugt Lohn- und Sozialaufwand, «Als ausbezahlt buchen» den Bankabgang. Die vorbelegten Sätze sind Richtwerte und
müssen mit den Verfügungen der Ausgleichskasse und der Versicherer abgeglichen werden.

*13. Monatslohn:* Im Personalstamm wählbar – Auszahlung im Dezember oder je zur Hälfte im Juni und Dezember. Pro Monat entsteht ein Zwölftel des
Monatslohns, bei Ein- oder Austritt im Monat anteilig nach Tagen. Bei einem Austritt wird der aufgelaufene Anspruch im Austrittsmonat ausbezahlt.
Der Betrag ist beitragspflichtig und lässt sich im Entwurf des Lohnlaufs überschreiben. Eine monatliche Rückstellung wird nicht gebucht.

*Lohnausweis* (*Lohnläufe → Lohnausweise*): Jahreswerte je Person aus den **gebuchten** Lohnläufen, als PDF gegliedert nach den Buchstaben und
Ziffern des Formulars 11: Ziffer 1 Lohn inkl. 13. Monatslohn, Ziffer 3 Zulagen, Ziffer 8 Bruttolohn, Ziffer 9 AHV/IV/EO/ALV/NBUV, Ziffer 10 BVG,
Ziffer 11 Nettolohn, Ziffer 13 Spesen; F, G und Ziffer 15 kommen aus dem Personalstamm. Krankentaggeld-Abzüge gehören nicht in Ziffer 9 und werden
in den Bemerkungen ausgewiesen. Beträge in ganzen Franken.

**Zahlungsdateien:** Unter *Kreditoren* offene Rechnungen ankreuzen und «Zahlungsdatei» wählen; die pain.001-Datei wird im E-Banking hochgeladen.
Die Datei bucht nichts – die Zahlung wird danach wie gewohnt erfasst.

**Bankabstimmung** (*Finanzen → Bankabstimmung*): Buchungen, die auf dem Kontoauszug stehen, werden abgehakt. Der abgestimmte Saldo
(Buchsaldo abzüglich noch nicht abgehakter Buchungen) muss dem Saldo des Auszugs entsprechen.

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
- **Zwei-Faktor-Anmeldung** mit Authenticator-App (TOTP), pro Benutzer unter *Konto & Sicherheit* einzurichten. Beim Aktivieren werden zehn einmalig verwendbare Wiederherstellungscodes angezeigt; zusätzlich kann ein Administrator den zweiten Faktor zurücksetzen
- **Passwort vergessen:** Link per E-Mail, 60 Minuten und einmalig gültig. Voraussetzung ist ein eingerichteter E-Mail-Versand; die *Adresse der Anwendung* in den Firmendaten bestimmt den Link
- Passwortwechsel, Zurücksetzen und Deaktivieren beenden sofort alle bestehenden Sitzungen des Benutzers
- Jede API-Route prüft die Berechtigung der Rolle serverseitig; ausgeschaltete Module sind auch für Administratoren gesperrt
- Ausschliesslich parametrisierte SQL-Abfragen; Security-Header via Helmet (CSP)
- Buchungen und Zahlungen sind unveränderbar (Storno statt Löschen); alle Aktionen stehen im Protokoll

## Rollen und Module

**Rollen** bestimmen, was eine Person darf; jede Person hat genau eine Rolle. Unter *Administration → Rollen & Rechte* steht zu jeder Rolle,
wofür sie gedacht ist und auf welche Bereiche sie zugreift. Der Reiter **Übersicht: Wer darf was?** zeigt alle 30 Rechte mit Beschreibung
als Tabelle über alle Rollen. Wer etwas bearbeiten darf, darf es automatisch auch ansehen (in der Übersicht als blasses Häkchen).

| Rolle | Gedacht für |
|---|---|
| Administrator | Vollzugriff, nicht änderbar |
| Geschäftsleitung | Sieht alles inklusive Lohn und Auswertungen, ändert nichts |
| Buchhaltung | Ganze Finanzseite inklusive Jahresabschluss, ohne Lohn |
| Debitorenbuchhaltung | Zahlungseingänge, Mahnwesen, Zahlungsabgleich |
| Kreditorenbuchhaltung | Lieferantenrechnungen, Zahlungen, Zahlungsdateien |
| Verkauf | Kunden, Offerten, Aufträge, Rechnungen |
| Verkaufsleitung | Verkauf mit Auswertungen, Mahnwesen und Projektabrechnung |
| Einkauf | Lieferanten, Bestellungen, Wareneingang |
| Lager | Artikel, Lagerbewegungen, Inventur |
| Projektleitung | Projekte führen, Zeiten aller Personen, Stunden abrechnen |
| Zeiterfassung | Nur eigene Arbeitszeit buchen |
| Personal | Lohnabrechnung und Lohnausweise, sonst nichts |
| Treuhand | Externer Lesezugriff auf Buchhaltung und offene Posten, ohne Lohn |
| Nur Lesen | Alles ansehen, ohne Lohn und Administration |

Die vordefinierten Rollen lassen sich anpassen oder als Vorlage für eigene Rollen kopieren. Ein Update legt fehlende Rollen an,
verändert aber keine bestehenden.

**Module** bestimmen, was es in der Firma überhaupt gibt. Unter *Administration → Module* schaltet der Administrator Bereiche aus, die nicht
gebraucht werden: Offerten, Aufträge, Rechnungen, Debitoren, Artikel und Lager, Einkauf, Kreditoren, Projekte und Zeiterfassung,
Finanzbuchhaltung, Lohn, Auswertungen. Ein ausgeschaltetes Modul verschwindet für alle aus dem Menü – auch für Administratoren – und
ist serverseitig gesperrt; die Daten bleiben erhalten, und das Modul lässt sich jederzeit wieder einschalten. Kunden/Lieferanten und die
Administration sind immer aktiv.

## Erste Schritte nach der Installation

1. Anmelden und das Initialpasswort ändern (Schlüssel-Symbol oben rechts).
2. *Administration → Firma & Nummern*: Firmendaten, Bankverbindung, MwSt-Nr., Nummernkreise.
3. *Administration → Beleglayout*: Logo hochladen, Vorlage und Texte wählen.
4. *Administration → Module*: nicht benötigte Bereiche ausschalten. *Administration → Benutzer / Rollen & Rechte*: Mitarbeitende anlegen.
5. Kunden, Lieferanten und Artikel erfassen; Anfangsbestände als Wareneingang buchen.
   Mahnstufen unter *Debitoren → Mahnwesen* und die MwSt-Methode in den Firmendaten prüfen.
6. Eröffnungssalden (z.B. Bankguthaben, Eigenkapital) als manuelle Buchung im Journal erfassen.

## Bekannte Grenzen (Stand 1.5)

- **Lohn:** Monatslohnabrechnung ohne Quellensteuer, Kinderzulagen, Stundenlöhne und Lohnmeldung (ELM)
- **Lohnausweis:** dem Formular 11 nachgebildet, aber nicht das amtliche Formular mit Barcode; Gehaltsnebenleistungen (Ziffer 2), Pauschalspesen und Einkäufe in die Pensionskasse werden nicht geführt. Vor dem ersten Versand durch den Treuhänder prüfen lassen
- **Zahlungsdateien (pain.001):** nur IBAN-Zahlungen in CHF und EUR; nach den Swiss Payment Standards erzeugt, aber nicht mit einer Bank erprobt
- **Lagerorte:** Verkaufs- und Einkaufsbelege buchen auf den ersten aktiven Lagerort; die Wahl des Lagerorts pro Beleg fehlt
- **Chargen:** Abgänge aus Belegen folgen FIFO; eine gezielte Chargenwahl pro Belegposition fehlt. Seriennummern werden wie Chargen geführt
- **Bankabstimmung:** Abhaken von Hand; der Kontoauszug wird nicht automatisch Zeile für Zeile verglichen
- **Treuhänder-Export:** CSV in zwei Formaten, kein herstellerspezifisches Format (Abacus, Sage usw.)
- Standardtexte und E-Mail-Vorlagen sind nur auf Deutsch anpassbar; für FR/IT/EN gelten mitgelieferte Belegtexte
- Die MwSt-Auswertung ist eine Abrechnungshilfe und ersetzt nicht die offizielle Abrechnung; das System ersetzt keine Treuhand-/Revisionsprüfung

## Automatische Tests

```bash
docker compose -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from tests
docker compose -f docker-compose.test.yml down -v
```

Die Suite startet eine frische Wegwerf-Datenbank, die Anwendung und einen Mail-Fänger und prüft über die API alle Geschäftsabläufe:
Anmeldung, Rollenrechte, Module, Zwei-Faktor-Anmeldung mit Wiederherstellungscodes, Belegfluss, Teillieferung, Gutschriften samt Storno, Mahnwesen mit
Verzugszins und Sammelmahnung, Zahlungsabgleich, Zahlungsdateien, Abo-Rechnungen, Fremdwährungen und Kurshistorie, Bestellwesen, Lagerorte,
Chargen, Inventur, Projekte und Zeiterfassung, Kontakte, Bankabstimmung, Journal-Export, Lohn, Blättern in grossen Listen, PDF, E-Mail-Versand
und den Jahresabschluss. Dazu kommen Unit-Tests der Rechenlogik und der Überwachung (81 Tests). Nach jeder Buchung wird geprüft, dass die Bilanz ausgeglichen ist.

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
