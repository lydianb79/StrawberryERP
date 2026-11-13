import { one } from '../db.js';
import { HttpError, round2 } from '../util.js';
import { getSettings } from './settings.js';

export async function baseCurrency(conn) {
  return ((await getSettings(conn)).company.currency || 'CHF').toUpperCase();
}

/**
 * Ermittelt Währung und Kurs eines Belegs.
 * Kurs = Wert einer Einheit Fremdwährung in Basiswährung (z.B. 1 EUR = 0.95 CHF).
 */
export async function resolveCurrency(conn, requested, requestedRate, fallback) {
  const base = await baseCurrency(conn);
  const code = String(requested || fallback || base).toUpperCase();
  if (code === base) return { currency: base, exchange_rate: 1, base };
  const cur = await one('SELECT code, rate FROM currencies WHERE code = ?', [code], conn);
  if (!cur) throw new HttpError(400, `Die Währung ${code} ist nicht erfasst (Administration → Währungen).`);
  const rate = Number(requestedRate) > 0 ? Number(requestedRate) : cur.rate;
  if (!(rate > 0)) throw new HttpError(400, `Für ${code} ist kein gültiger Kurs hinterlegt.`);
  return { currency: code, exchange_rate: Math.round(rate * 1e6) / 1e6, base };
}

/** Betrag in Basiswährung. */
export const toBase = (amount, rate) => round2((Number(amount) || 0) * (Number(rate) || 1));

/**
 * Buchungszeilen für eine Zahlung in Fremdwährung.
 * openItemBase: Betrag, mit dem der offene Posten (zum Belegkurs) ausgebucht wird;
 * cashBase: tatsächlich geflossener Betrag (zum Zahlungskurs). Die Differenz ist Kursgewinn/-verlust.
 * side = 'receivable' (Geld kommt herein) oder 'payable' (Geld geht hinaus).
 */
export function fxLines(side, openItemBase, cashBase, accounting) {
  const diff = round2(side === 'receivable' ? cashBase - openItemBase : openItemBase - cashBase);
  if (!diff) return [];
  return diff > 0 ? [{ account: accounting.fxGain, credit: diff }] : [{ account: accounting.fxLoss, debit: -diff }];
}
