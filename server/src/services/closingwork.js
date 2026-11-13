// Abschlussarbeiten: Lagerbestand in die Bilanz übernehmen und offene Fremdwährungsposten zum Stichtagskurs bewerten.
import { q, one } from '../db.js';
import { HttpError, round2, addDays, needDate } from '../util.js';
import { getSettings } from './settings.js';
import { postEntry, reverseEntry, accountIdByNumber } from './ledger.js';

async function accountBalance(conn, accountId, date) {
  const row = await one(
    `SELECT COALESCE(SUM(l.debit - l.credit), 0) AS balance FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
       JOIN fiscal_years y ON y.id = e.fiscal_year_id WHERE l.account_id = ? AND ? BETWEEN y.start_date AND y.end_date AND e.date <= ?`,
    [accountId, date, date], conn);
  return round2(row.balance);
}

/** Vergleicht den Lagerwert laut Lagerbuchhaltung mit dem Bilanzkonto Vorräte. */
export async function stockValuation(conn, date) {
  const { accounting } = await getSettings(conn);
  const inventoryId = await accountIdByNumber(conn, accounting.inventory);
  const stock = await one('SELECT COALESCE(SUM(stock_qty * purchase_price), 0) AS value FROM products WHERE is_stock_item = 1 AND active = 1', [], conn);
  const booked = await accountBalance(conn, inventoryId, date);
  const value = round2(stock.value);
  return { date, stockValue: value, booked, difference: round2(value - booked), account: accounting.inventory, changeAccount: accounting.inventoryChange };
}

/** Bucht die Bestandesänderung, sodass das Konto Vorräte dem Lagerwert entspricht. */
export async function postStockValuation(conn, user, date) {
  needDate(date, 'Stichtag');
  const v = await stockValuation(conn, date);
  if (!v.difference) throw new HttpError(400, 'Der gebuchte Bestand entspricht bereits dem Lagerwert.');
  const amount = Math.abs(v.difference);
  const id = await postEntry(conn, {
    date, text: `Bestandesänderung Warenlager per ${date}`, ref_type: 'stock_valuation', user_id: user?.id,
    lines: v.difference > 0
      ? [{ account: v.account, debit: amount }, { account: v.changeAccount, credit: amount }]
      : [{ account: v.changeAccount, debit: amount }, { account: v.account, credit: amount }],
  });
  return { ...v, entryId: id };
}

/** Offene Fremdwährungsposten: gebuchter Wert (Belegkurs) gegenüber Wert zum aktuellen Kurs. */
export async function fxValuation(conn) {
  const rates = new Map((await q('SELECT code, rate FROM currencies', [], conn)).map((c) => [c.code, c.rate]));
  const receivables = await q(
    `SELECT d.id, d.number, c.company AS partner, d.currency, d.exchange_rate, (d.total + d.dunning_fees - d.paid_amount) AS open_amount
       FROM documents d JOIN customers c ON c.id = d.customer_id
      WHERE d.type = 'invoice' AND d.status IN ('open','partial') AND d.exchange_rate <> 1`, [], conn);
  const payables = await q(
    `SELECT si.id, si.number, s.company AS partner, si.currency, si.exchange_rate, (si.total - si.paid_amount) AS open_amount
       FROM supplier_invoices si JOIN suppliers s ON s.id = si.supplier_id
      WHERE si.status IN ('open','partial') AND si.exchange_rate <> 1`, [], conn);
  const value = (rows, sign) => rows.map((r) => {
    const rate = rates.get(r.currency) ?? r.exchange_rate;
    const booked = round2(r.open_amount * r.exchange_rate), current = round2(r.open_amount * rate);
    return { ...r, rate, booked, current, difference: round2(sign * (current - booked)) };
  });
  const rec = value(receivables, 1), pay = value(payables, -1);
  const sum = (list) => round2(list.reduce((s, r) => s + r.difference, 0));
  return { receivables: rec, payables: pay, receivablesDiff: sum(rec), payablesDiff: sum(pay), total: round2(sum(rec) + sum(pay)) };
}

/**
 * Bucht die Stichtagsbewertung (nicht realisierte Kursdifferenzen). Die Bewertung wird am Folgetag automatisch
 * zurückgebucht – liegt dieser in einem noch nicht angelegten Geschäftsjahr, erledigt das der Jahresabschluss.
 */
export async function postFxValuation(conn, user, date) {
  needDate(date, 'Stichtag');
  const v = await fxValuation(conn);
  if (!v.receivablesDiff && !v.payablesDiff) throw new HttpError(400, 'Es gibt keine Kursdifferenzen auf offenen Fremdwährungsposten.');
  const { accounting } = await getSettings(conn);
  const lines = [];
  const add = (account, amount) => { if (amount > 0) lines.push({ account, debit: amount }); else if (amount < 0) lines.push({ account, credit: -amount }); };
  add(accounting.receivables, v.receivablesDiff);   // höherer Kurs → Forderung mehr wert
  add(accounting.payables, v.payablesDiff);         // höherer Kurs → Schuld grösser (Differenz ist bereits negativ)
  const total = v.total;
  if (total > 0) lines.push({ account: accounting.fxGain, credit: total });
  else if (total < 0) lines.push({ account: accounting.fxLoss, debit: -total });
  const id = await postEntry(conn, { date, text: `Bewertung Fremdwährungen per ${date}`, ref_type: 'fx_valuation', user_id: user?.id, lines });
  const reversed = await reversePendingFxValuations(conn, user?.id);
  return { ...v, entryId: id, reversedNextDay: reversed > 0 };
}

/** Bucht noch offene Bewertungen am Tag nach dem Stichtag zurück, sobald dafür ein offenes Geschäftsjahr existiert. */
export async function reversePendingFxValuations(conn, userId) {
  const pending = await q("SELECT * FROM journal_entries WHERE ref_type = 'fx_valuation' AND reversed_by IS NULL", [], conn);
  let n = 0;
  for (const e of pending) {
    const next = addDays(e.date, 1);
    const fy = await one("SELECT id FROM fiscal_years WHERE ? BETWEEN start_date AND end_date AND status = 'open'", [next], conn);
    if (!fy) continue;
    await reverseEntry(conn, e, { user_id: userId, date: next, text: `Rückbuchung ${e.text}` });
    n += 1;
  }
  return n;
}
