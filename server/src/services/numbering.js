import { q, one } from '../db.js';
import { getSettings } from './settings.js';

/** Nächster Zählerwert. Muss innerhalb einer Transaktion aufgerufen werden (Zeilensperre). */
export async function nextNumber(conn, name, year = 0) {
  await q('INSERT IGNORE INTO counters (name, year, value) VALUES (?, ?, 0)', [name, year], conn);
  await q('UPDATE counters SET value = value + 1 WHERE name = ? AND year = ?', [name, year], conn);
  const row = await one('SELECT value FROM counters WHERE name = ? AND year = ?', [name, year], conn);
  return row.value;
}

/** Belegnummer, z.B. RE-2026-0001. Nummernkreise beginnen pro Jahr neu. */
export async function documentNumber(conn, type, date) {
  const { numbering } = await getSettings(conn);
  const prefix = numbering[`${type}Prefix`] || type.toUpperCase();
  const year = Number(String(date).slice(0, 4));
  const digits = Math.min(8, Math.max(3, Number(numbering.digits) || 4));
  const n = await nextNumber(conn, type, numbering.includeYear ? year : 0);
  const seq = String(n).padStart(digits, '0');
  return numbering.includeYear ? `${prefix}-${year}-${seq}` : `${prefix}-${seq}`;
}

export async function partnerNumber(conn, name, prefix) {
  const n = await nextNumber(conn, name, 0);
  return `${prefix}-${10000 + n}`;
}
