// Überwachung der Installation – wird alle fünf Minuten vom systemd-Timer strawberryerp-monitor.timer gestartet.
// Prüft Dienst, Datenbank, Datensicherung, Speicherplatz und TLS-Zertifikat und meldet Statuswechsel per E-Mail.
//   node src/monitor.js            prüfen, Status speichern, bei Änderungen benachrichtigen
//   node src/monitor.js --dry-run  nur prüfen und ausgeben
import fs from 'node:fs';
import path from 'node:path';
import tls from 'node:tls';
import { execFileSync } from 'node:child_process';
import nodemailer from 'nodemailer';

const STATUS_DIR = process.env.STATUS_DIR || '/var/lib/strawberryerp';
const STATE_FILE = path.join(STATUS_DIR, 'monitor-status.json');
const PORT = process.env.PORT || 3000;
const DRY = process.argv.includes('--dry-run');
const hours = (ms) => Math.round(ms / 360000) / 10;

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

/** Die einzelnen Prüfungen: jede liefert { ok, detail } oder null, wenn sie auf diesem System nicht anwendbar ist. */
export const checks = {
  async service() {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(8000) });
      const body = await res.json().catch(() => ({}));
      return res.ok ? { ok: true, detail: `Version ${body.version || '?'}` } : { ok: false, detail: `Dienst antwortet mit Status ${res.status} (${body.status || 'unbekannt'})` };
    } catch (err) {
      return { ok: false, detail: `Dienst nicht erreichbar: ${err.cause?.code || err.message}` };
    }
  },
  backup({ now = Date.now(), status = readJson(path.join(STATUS_DIR, 'backup-status.json')), maxAgeHours = Number(process.env.MONITOR_BACKUP_MAX_AGE_HOURS) || 26 } = {}) {
    if (!status) return { ok: false, detail: 'Es wurde noch keine Datensicherung protokolliert.' };
    if (!status.ok) return { ok: false, detail: `Letzte Datensicherung fehlgeschlagen (${status.time}): ${status.message || 'unbekannter Fehler'}` };
    const age = hours(now - new Date(status.time).getTime());
    return age > maxAgeHours ? { ok: false, detail: `Letzte erfolgreiche Datensicherung ist ${age} Stunden alt.` } : { ok: true, detail: `vor ${age} Stunden, ${status.size || '?'} Bytes` };
  },
  disk({ paths = ['/', '/var/lib/mysql'], limit = Number(process.env.MONITOR_DISK_LIMIT_PERCENT) || 90, statfs = fs.statfsSync } = {}) {
    let worst = null;
    for (const p of paths) {
      try {
        const s = statfs(p);
        const used = Math.round((1 - s.bavail / s.blocks) * 100);
        if (!worst || used > worst.used) worst = { path: p, used };
      } catch { /* Pfad existiert hier nicht */ }
    }
    if (!worst) return null;
    return worst.used >= limit ? { ok: false, detail: `Speicherplatz auf ${worst.path} zu ${worst.used} % belegt.` } : { ok: true, detail: `${worst.path} zu ${worst.used} % belegt` };
  },
  units({ run = (unit) => execFileSync('systemctl', ['is-active', unit], { encoding: 'utf8' }).trim() } = {}) {
    const bad = [];
    for (const unit of ['mysqld', 'nginx', 'strawberryerp-backup.timer']) {
      try { if (run(unit) !== 'active') bad.push(unit); } catch (err) {
        if (err.code === 'ENOENT') return null; // kein systemd (z.B. im Container)
        bad.push(unit);
      }
    }
    return bad.length ? { ok: false, detail: `Nicht aktiv: ${bad.join(', ')}` } : { ok: true, detail: 'mysqld, nginx, Sicherungs-Timer aktiv' };
  },
  certificate({ now = Date.now(), days = Number(process.env.MONITOR_CERT_DAYS) || 21 } = {}) {
    return new Promise((resolve) => {
      const socket = tls.connect({ host: '127.0.0.1', port: 443, rejectUnauthorized: false, timeout: 5000 }, () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (!cert?.valid_to) return resolve(null);
        const left = Math.floor((new Date(cert.valid_to).getTime() - now) / 86400000);
        return resolve(left < days ? { ok: false, detail: `TLS-Zertifikat läuft in ${left} Tagen ab (${cert.valid_to}).` } : { ok: true, detail: `gültig noch ${left} Tage` });
      });
      socket.on('error', () => resolve(null));   // kein HTTPS eingerichtet
      socket.on('timeout', () => { socket.destroy(); resolve(null); });
    });
  },
};

const LABELS = { service: 'Anwendung', backup: 'Datensicherung', disk: 'Speicherplatz', units: 'Systemdienste', certificate: 'TLS-Zertifikat' };

export async function runChecks() {
  const out = {};
  for (const [name, fn] of Object.entries(checks)) {
    try { out[name] = await fn(); } catch (err) { out[name] = { ok: false, detail: `Prüfung fehlgeschlagen: ${err.message}` }; }
    if (out[name] === null) delete out[name];
  }
  return out;
}

/** Vergleicht mit dem letzten Lauf: neue Störungen und behobene Störungen. Offene Störungen werden täglich erinnert. */
export function diff(previous, current, now = Date.now()) {
  const failing = Object.entries(current).filter(([, c]) => !c.ok).map(([k]) => k);
  const before = previous?.failing || [];
  const started = failing.filter((k) => !before.includes(k));
  const resolved = before.filter((k) => !failing.includes(k) && current[k]);
  const remind = failing.length > 0 && !started.length && now - (previous?.notifiedAt || 0) > 24 * 3600 * 1000;
  return { failing, started, resolved, notify: started.length > 0 || resolved.length > 0 || remind, remind };
}

/** Empfänger und SMTP-Zugang: aus der Datenbank, mit Rückgriff auf den zuletzt gespeicherten Stand (falls die Datenbank steht). */
async function mailConfig(cached) {
  try {
    const { q, pool } = await import('./db.js');
    const { getSettings } = await import('./services/settings.js');
    const { mail, company } = await getSettings();
    const admins = await q("SELECT DISTINCT u.email FROM users u JOIN role_permissions p ON p.role_id = u.role_id AND p.permission = '*' WHERE u.active = 1");
    await pool.end();
    return { mail, company: company.name, recipients: (process.env.MONITOR_EMAIL || '').split(/[,;\s]+/).filter(Boolean).concat(process.env.MONITOR_EMAIL ? [] : admins.map((a) => a.email)) };
  } catch {
    return cached || null;
  }
}

async function main() {
  const current = await runChecks();
  const previous = readJson(STATE_FILE);
  const d = diff(previous, current);
  const lines = Object.entries(current).map(([k, c]) => `${c.ok ? 'OK     ' : 'STÖRUNG'}  ${LABELS[k]}: ${c.detail}`);
  console.log(lines.join('\n'));
  if (DRY) return;

  const config = await mailConfig(previous?.mailConfig);
  let notifiedAt = previous?.notifiedAt || 0, mailError = null;
  if (d.notify && config?.mail?.host && config.mail.fromAddress && config.recipients.length) {
    const host = (await import('node:os')).hostname();
    const subject = d.failing.length
      ? `StrawberryERP: Störung auf ${host} – ${d.failing.map((k) => LABELS[k]).join(', ')}`
      : `StrawberryERP: Störung behoben auf ${host}`;
    const text = [`Überwachung von StrawberryERP (${config.company}) auf ${host}, ${new Date().toLocaleString('de-CH')}`, '',
      d.started.length ? `Neu gestört: ${d.started.map((k) => LABELS[k]).join(', ')}` : null,
      d.resolved.length ? `Behoben: ${d.resolved.map((k) => LABELS[k]).join(', ')}` : null,
      d.remind ? 'Erinnerung: Die Störung besteht weiterhin.' : null, '', ...lines].filter((l) => l !== null).join('\n');
    try {
      await nodemailer.createTransport({ host: config.mail.host, port: Number(config.mail.port) || 587, secure: !!config.mail.secure,
        auth: config.mail.user ? { user: config.mail.user, pass: config.mail.password } : undefined, connectionTimeout: 10000 })
        .sendMail({ from: config.mail.fromAddress, to: config.recipients, subject, text });
      notifiedAt = Date.now();
      console.log(`Benachrichtigung gesendet an ${config.recipients.join(', ')}`);
    } catch (err) {
      mailError = err.message;
      console.error(`Benachrichtigung fehlgeschlagen: ${err.message}`);
    }
  } else if (d.notify) {
    mailError = 'Keine Benachrichtigung möglich: E-Mail-Versand nicht eingerichtet oder kein Empfänger.';
    console.error(mailError);
  }
  fs.mkdirSync(STATUS_DIR, { recursive: true });
  // Die Datei liegt in einem nur für den Dienstbenutzer lesbaren Verzeichnis – sie enthält den SMTP-Zugang als Rückfall.
  fs.writeFileSync(STATE_FILE, JSON.stringify({ time: new Date().toISOString(), checks: current, failing: d.failing, notifiedAt, mailError,
    recipients: config?.recipients || [], mailConfig: config }, null, 1), { mode: 0o600 });
  process.exitCode = d.failing.length ? 2 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((err) => { console.error(err); process.exitCode = 1; });
