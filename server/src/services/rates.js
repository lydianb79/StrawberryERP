import { XMLParser } from 'fast-xml-parser';
import { q } from '../db.js';
import { HttpError } from '../util.js';
import { baseCurrency } from './currency.js';

const SOURCE = process.env.RATES_URL || 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';

/** Liest die Referenzkurse der EZB (Angabe: 1 EUR = x Fremdwährung). */
export function parseEcb(xml) {
  const root = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', removeNSPrefix: true }).parse(xml);
  const day = root?.Envelope?.Cube?.Cube;
  const list = Array.isArray(day?.Cube) ? day.Cube : [];
  const perEur = new Map([['EUR', 1]]);
  for (const c of list) if (c['@currency'] && Number(c['@rate']) > 0) perEur.set(c['@currency'], Number(c['@rate']));
  if (perEur.size < 2) throw new Error('Keine Kurse in der Antwort gefunden');
  return { date: day['@time'] || null, perEur };
}

/** Kurs einer Währung in Basiswährung: 1 Einheit = x Basiswährung. */
export function crossRate(perEur, code, base) {
  if (!perEur.has(code) || !perEur.has(base)) return null;
  return Math.round((perEur.get(base) / perEur.get(code)) * 1e6) / 1e6;
}

/** Aktualisiert die Kurse aller aktiven Fremdwährungen aus den EZB-Referenzkursen. */
export async function refreshRates(conn) {
  let parsed;
  try {
    const res = await fetch(SOURCE, { headers: { 'User-Agent': 'StrawberryERP-rates' }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    parsed = parseEcb(await res.text());
  } catch (err) {
    throw new HttpError(502, `Kurse konnten nicht abgerufen werden: ${err.message}`);
  }
  const base = await baseCurrency(conn);
  const updated = [], skipped = [];
  for (const cur of await q('SELECT id, code FROM currencies WHERE active = 1', [], conn)) {
    if (cur.code === base) continue;
    const rate = crossRate(parsed.perEur, cur.code, base);
    if (!rate) { skipped.push(cur.code); continue; }
    await q('UPDATE currencies SET rate = ? WHERE id = ?', [rate, cur.id], conn);
    await q('INSERT INTO currency_rates (code, date, rate, source) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE rate = VALUES(rate), source = VALUES(source)',
      [cur.code, parsed.date || new Date().toISOString().slice(0, 10), rate, 'EZB'], conn);
    updated.push({ code: cur.code, rate });
  }
  return { date: parsed.date, base, updated, skipped, source: 'Europäische Zentralbank (Referenzkurse)' };
}
