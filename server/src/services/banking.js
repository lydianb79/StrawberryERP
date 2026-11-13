import { XMLParser } from 'fast-xml-parser';
import { q } from '../db.js';
import { HttpError, round2 } from '../util.js';
import { openAmount } from './documents.js';

const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const text = (v) => (v == null ? '' : typeof v === 'object' ? String(v['#text'] ?? '') : String(v));
const norm = (s) => String(s || '').replace(/\s+/g, '').toUpperCase();

/**
 * Liest Zahlungseingänge aus einem Kontoauszug im ISO-20022-Format (camt.053 Kontoauszug oder camt.054 Sammelbuchungsauflösung).
 * Liefert eine Zeile pro Einzeltransaktion mit Gutschrift.
 */
export function parseCamt(xml) {
  if (typeof xml !== 'string' || !xml.includes('<')) throw new HttpError(400, 'Die Datei enthält kein XML.');
  let root;
  try {
    root = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', removeNSPrefix: true, parseTagValue: false, processEntities: true }).parse(xml);
  } catch {
    throw new HttpError(400, 'Die Datei konnte nicht gelesen werden (ungültiges XML).');
  }
  const doc = root?.Document;
  const container = doc?.BkToCstmrStmt || doc?.BkToCstmrDbtCdtNtfctn || doc?.BkToCstmrAcctRpt;
  if (!container) throw new HttpError(400, 'Kein camt.053/camt.054-Kontoauszug erkannt.');
  const out = [];
  for (const stmt of [...arr(container.Stmt), ...arr(container.Ntfctn), ...arr(container.Rpt)]) {
    const iban = text(stmt.Acct?.Id?.IBAN);
    for (const entry of arr(stmt.Ntry)) {
      if (text(entry.CdtDbtInd) !== 'CRDT' || text(entry.RvslInd) === 'true') continue;
      const date = text(entry.BookgDt?.Dt || entry.BookgDt?.DtTm || entry.ValDt?.Dt).slice(0, 10);
      const entryRef = text(entry.AcctSvcrRef) || text(entry.NtryRef);
      const details = arr(entry.NtryDtls).flatMap((d) => arr(d.TxDtls));
      const txs = details.length ? details : [null];
      txs.forEach((tx, i) => {
        const amt = tx?.Amt ?? tx?.AmtDtls?.TxAmt?.Amt ?? entry.Amt;
        const reference = text(tx?.RmtInf?.Strd && arr(tx.RmtInf.Strd)[0]?.CdtrRefInf?.Ref);
        const message = arr(tx?.RmtInf?.Ustrd).map(text).join(' ') || text(entry.AddtlNtryInf);
        const txRef = text(tx?.Refs?.AcctSvcrRef) || text(tx?.Refs?.EndToEndId);
        out.push({
          date, amount: round2(text(amt)), currency: (typeof amt === 'object' && amt['@Ccy']) || text(entry.Amt?.['@Ccy']) || '',
          reference: norm(reference), message: message.trim(), debtor: text(tx?.RltdPties?.Dbtr?.Nm || tx?.RltdPties?.Dbtr?.Pty?.Nm),
          bank_ref: `${entryRef || date}${txs.length > 1 || !txRef ? `#${i + 1}` : ''}${txRef && txRef !== 'NOTPROVIDED' ? `/${txRef}` : ''}`.slice(0, 80),
          account_iban: norm(iban),
        });
      });
    }
  }
  return out.filter((e) => e.amount > 0);
}

/** Ordnet Bankbuchungen offenen Rechnungen zu: zuerst über die Zahlungsreferenz, sonst über die Rechnungsnummer im Mitteilungstext. */
export async function matchEntries(conn, entries) {
  const open = await q(
    `SELECT d.id, d.number, d.total, d.paid_amount, d.dunning_fees, d.currency, d.payment_reference, c.company AS customer_name
       FROM documents d JOIN customers c ON c.id = d.customer_id WHERE d.type = 'invoice' AND d.status IN ('open','partial')`, [], conn);
  const refs = entries.map((e) => e.bank_ref).filter(Boolean);
  const booked = refs.length
    ? new Set((await q('SELECT bank_ref FROM payments WHERE bank_ref IN (?) AND reversed_at IS NULL', [refs], conn)).map((r) => r.bank_ref))
    : new Set();
  const used = new Map(); // bereits in dieser Datei zugeordneter Betrag je Rechnung
  return entries.map((e) => {
    if (booked.has(e.bank_ref)) return { ...e, state: 'duplicate', hint: 'Bereits verbucht' };
    let inv = e.reference && open.find((d) => norm(d.payment_reference) === e.reference);
    let by = 'Referenz';
    if (!inv) {
      const hay = norm(`${e.message} ${e.reference}`);
      inv = open.find((d) => d.number && hay.includes(norm(d.number)));
      by = 'Rechnungsnummer im Text';
    }
    if (!inv) return { ...e, state: 'unmatched', hint: 'Keine offene Rechnung gefunden' };
    const invOpen = round2(openAmount(inv) - (used.get(inv.id) || 0));
    const match = { invoice_id: inv.id, number: inv.number, customer_name: inv.customer_name, open_amount: invOpen, currency: inv.currency };
    if (e.currency && e.currency !== inv.currency) return { ...e, match, state: 'review', hint: `Währung weicht ab (Rechnung in ${inv.currency})` };
    if (invOpen <= 0) return { ...e, match, state: 'review', hint: 'Rechnung ist bereits ausgeglichen' };
    if (e.amount > invOpen + 0.005) return { ...e, match, state: 'review', hint: `Überzahlung: offen sind ${invOpen.toFixed(2)}` };
    used.set(inv.id, round2((used.get(inv.id) || 0) + e.amount));
    return { ...e, match, state: 'match', hint: Math.abs(e.amount - invOpen) < 0.005 ? `Zuordnung über ${by}` : `Teilzahlung, Zuordnung über ${by}` };
  });
}

/** Schlusssaldo (CLBD) eines camt.053-Kontoauszugs: Betrag mit Vorzeichen, Datum und IBAN. */
export function parseCamtBalance(xml) {
  if (typeof xml !== 'string' || !xml.includes('<')) throw new HttpError(400, 'Die Datei enthält kein XML.');
  let root;
  try {
    root = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', removeNSPrefix: true, parseTagValue: false }).parse(xml);
  } catch {
    throw new HttpError(400, 'Die Datei konnte nicht gelesen werden (ungültiges XML).');
  }
  const stmt = arr(root?.Document?.BkToCstmrStmt?.Stmt)[0];
  if (!stmt) throw new HttpError(400, 'Kein camt.053-Kontoauszug erkannt (nur dieser enthält Saldi).');
  const bal = arr(stmt.Bal).find((b) => text(b.Tp?.CdOrPrtry?.Cd) === 'CLBD') || arr(stmt.Bal).at(-1);
  if (!bal) throw new HttpError(400, 'Der Kontoauszug enthält keinen Schlusssaldo.');
  const amount = round2(text(bal.Amt)) * (text(bal.CdtDbtInd) === 'DBIT' ? -1 : 1);
  return { balance: amount, date: text(bal.Dt?.Dt || bal.Dt?.DtTm).slice(0, 10), currency: bal.Amt?.['@Ccy'] || '', iban: norm(text(stmt.Acct?.Id?.IBAN)) };
}
