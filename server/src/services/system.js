import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { one } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')).version;

const REPO = process.env.UPDATE_REPO || 'lydianb79/StrawberryERP';
const CACHE_MS = 6 * 60 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000; // fehlgeschlagene Prüfungen werden bald wiederholt, nicht sechs Stunden lang angezeigt
// Grosszügiges Zeitlimit: In manchen Netzen (z.B. virtuelle Maschinen) dauert allein die Namensauflösung mehrere Sekunden.
const TIMEOUT_MS = Number(process.env.UPDATE_CHECK_TIMEOUT_MS) || 20000;
let cache = { at: 0, value: null };

const parse = (v) => String(v || '').replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
export function isNewer(candidate, current) {
  const a = parse(candidate), b = parse(current);
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  return false;
}

/** Fragt das neueste Release auf GitHub ab (abschaltbar mit UPDATE_CHECK=false). Es werden keine Daten übermittelt. */
async function latestRelease(force) {
  if (process.env.UPDATE_CHECK === 'false') return { disabled: true };
  if (!force && cache.value && Date.now() - cache.at < (cache.value.error ? RETRY_MS : CACHE_MS)) return cache.value;
  let value;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'StrawberryERP-update-check' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`GitHub antwortet mit Status ${res.status}`);
    const data = await res.json();
    value = { tag: data.tag_name, name: data.name, url: data.html_url, published_at: data.published_at, notes: String(data.body || '').slice(0, 4000) };
  } catch (err) {
    const reason = err.name === 'TimeoutError' ? `GitHub hat innert ${TIMEOUT_MS / 1000} Sekunden nicht geantwortet` : err.cause?.code || err.message;
    value = { error: `Versionsprüfung nicht möglich: ${reason}. Bitte später erneut prüfen; die installierte Version ist davon nicht betroffen.` };
  }
  cache = { at: Date.now(), value };
  return value;
}

export async function systemInfo(force = false) {
  const schema = await one('SELECT MAX(version) AS v FROM schema_migrations');
  const db = await one('SELECT VERSION() AS v');
  const latest = await latestRelease(force);
  return {
    version: VERSION, schemaVersion: schema.v, node: process.version, database: db.v, repo: REPO,
    latest, updateAvailable: !!latest.tag && isNewer(latest.tag, VERSION),
    checkedAt: cache.at ? new Date(cache.at).toISOString() : null,
  };
}
