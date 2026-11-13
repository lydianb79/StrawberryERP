import { q, one } from '../db.js';
import { HttpError, round2, addDays } from '../util.js';
import { getSettings } from './settings.js';

export async function fiscalYearFor(conn, date) {
  const fy = await one('SELECT * FROM fiscal_years WHERE ? BETWEEN start_date AND end_date', [date], conn);
  if (!fy) throw new HttpError(400, `Für das Datum ${date} existiert kein Geschäftsjahr. Bitte zuerst anlegen.`);
  if (fy.status !== 'open') throw new HttpError(400, `Das Geschäftsjahr ${fy.name} ist abgeschlossen – Buchung nicht möglich.`);
  return fy;
}

export async function accountIdByNumber(conn, number) {
  const acc = await one('SELECT id FROM accounts WHERE number = ?', [number], conn);
  if (!acc) throw new HttpError(400, `Konto ${number} existiert nicht im Kontenplan.`);
  return acc.id;
}

/**
 * Bucht einen Journaleintrag (doppelte Buchhaltung).
 * lines: [{ account: '1100' | account_id: 5, debit, credit }]
 */
export async function postEntry(conn, { date, text, ref_type = 'manual', ref_id = null, user_id = null, lines }) {
  const fy = await fiscalYearFor(conn, date);
  const clean = [];
  for (const l of lines || []) {
    const debit = round2(l.debit), credit = round2(l.credit);
    if (debit < 0 || credit < 0) throw new HttpError(400, 'Soll/Haben dürfen nicht negativ sein.');
    if (!debit && !credit) continue;
    const account_id = l.account_id ? Number(l.account_id) : await accountIdByNumber(conn, l.account);
    clean.push({ account_id, debit, credit });
  }
  if (clean.length < 2) throw new HttpError(400, 'Eine Buchung benötigt mindestens zwei Zeilen mit Betrag.');
  const sumD = round2(clean.reduce((s, l) => s + l.debit, 0));
  const sumC = round2(clean.reduce((s, l) => s + l.credit, 0));
  if (sumD !== sumC) throw new HttpError(400, `Buchung nicht ausgeglichen (Soll ${sumD.toFixed(2)} / Haben ${sumC.toFixed(2)}).`);

  const res = await q(
    'INSERT INTO journal_entries (fiscal_year_id, date, text, ref_type, ref_id, created_by) VALUES (?,?,?,?,?,?)',
    [fy.id, date, String(text || '').slice(0, 255) || 'Buchung', ref_type, ref_id, user_id], conn,
  );
  await q('INSERT INTO journal_lines (entry_id, account_id, debit, credit) VALUES ?',
    [clean.map((l) => [res.insertId, l.account_id, l.debit, l.credit])], conn);
  return res.insertId;
}

/** Löscht automatisch erzeugte Buchungen zu einem Beleg (nur in offenen Geschäftsjahren). */
export async function deleteEntriesByRef(conn, ref_type, ref_id) {
  const rows = await q(
    `SELECT e.id, y.status, y.name FROM journal_entries e JOIN fiscal_years y ON y.id = e.fiscal_year_id
      WHERE e.ref_type = ? AND e.ref_id = ?`, [ref_type, ref_id], conn);
  const closed = rows.find((r) => r.status !== 'open');
  if (closed) throw new HttpError(400, `Die Buchung liegt im abgeschlossenen Geschäftsjahr ${closed.name} und kann nicht geändert werden.`);
  if (rows.length) await q('DELETE FROM journal_entries WHERE id IN (?)', [rows.map((r) => r.id)], conn);
}

/** Kontensalden eines Geschäftsjahres. balance = Soll − Haben. */
export async function yearBalances(conn, yearId, { excludeClosing = false } = {}) {
  return q(
    `SELECT a.id, a.number, a.name, a.type,
            COALESCE(SUM(x.debit), 0) AS debit, COALESCE(SUM(x.credit), 0) AS credit,
            COALESCE(SUM(x.debit), 0) - COALESCE(SUM(x.credit), 0) AS balance
       FROM accounts a
       LEFT JOIN (
         SELECT l.account_id, l.debit, l.credit
           FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
          WHERE e.fiscal_year_id = ? ${excludeClosing ? "AND e.ref_type <> 'closing'" : ''}
       ) x ON x.account_id = a.id
      GROUP BY a.id, a.number, a.name, a.type
      ORDER BY a.number`, [yearId], conn);
}

export async function incomeStatement(conn, yearId) {
  const rows = await yearBalances(conn, yearId, { excludeClosing: true });
  const revenue = rows.filter((r) => r.type === 'revenue' && r.balance)
    .map((r) => ({ number: r.number, name: r.name, amount: round2(-r.balance) }));
  const expense = rows.filter((r) => r.type === 'expense' && r.balance)
    .map((r) => ({ number: r.number, name: r.name, amount: round2(r.balance) }));
  const totalRevenue = round2(revenue.reduce((s, r) => s + r.amount, 0));
  const totalExpense = round2(expense.reduce((s, r) => s + r.amount, 0));
  return { revenue, expense, totalRevenue, totalExpense, result: round2(totalRevenue - totalExpense) };
}

export async function balanceSheet(conn, yearId) {
  const rows = await yearBalances(conn, yearId);
  const pickRows = (type, sign) => rows.filter((r) => r.type === type && r.balance)
    .map((r) => ({ number: r.number, name: r.name, amount: round2(sign * r.balance) }));
  const assets = pickRows('asset', 1);
  const liabilities = pickRows('liability', -1);
  const equity = pickRows('equity', -1);
  // Noch nicht abgeschlossenes Ergebnis (Erfolgskonten) als laufender Gewinn/Verlust im Eigenkapital.
  const openResult = round2(-rows.filter((r) => r.type === 'revenue' || r.type === 'expense')
    .reduce((s, r) => s + r.balance, 0));
  const sum = (list) => round2(list.reduce((s, r) => s + r.amount, 0));
  return {
    assets, liabilities, equity, openResult,
    totalAssets: sum(assets),
    totalLiabilities: sum(liabilities),
    totalEquity: round2(sum(equity) + openResult),
    totalLiabilitiesEquity: round2(sum(liabilities) + sum(equity) + openResult),
  };
}

/**
 * Jahresabschluss: Erfolgskonten über das Jahresergebnis abschliessen, Jahr sperren,
 * Folgejahr anlegen und Eröffnungsbilanz (Saldovortrag) buchen.
 */
export async function closeFiscalYear(conn, yearId, userId) {
  const fy = await one('SELECT * FROM fiscal_years WHERE id = ? FOR UPDATE', [yearId], conn);
  if (!fy) throw new HttpError(404, 'Geschäftsjahr nicht gefunden');
  if (fy.status !== 'open') throw new HttpError(400, 'Das Geschäftsjahr ist bereits abgeschlossen.');
  const earlier = await one("SELECT name FROM fiscal_years WHERE end_date < ? AND status = 'open' LIMIT 1", [fy.start_date], conn);
  if (earlier) throw new HttpError(400, `Zuerst muss das frühere Geschäftsjahr ${earlier.name} abgeschlossen werden.`);

  const { accounting } = await getSettings(conn);
  const resultAccId = await accountIdByNumber(conn, accounting.yearResult);
  const retainedAccId = await accountIdByNumber(conn, accounting.retainedEarnings);

  // 1) Erfolgskonten abschliessen
  const before = await yearBalances(conn, yearId);
  const closingLines = [];
  let net = 0; // Soll − Haben aller Erfolgskonten (negativ = Gewinn)
  for (const r of before) {
    if ((r.type !== 'revenue' && r.type !== 'expense') || !round2(r.balance)) continue;
    const b = round2(r.balance);
    net += b;
    closingLines.push(b > 0 ? { account_id: r.id, credit: b } : { account_id: r.id, debit: -b });
  }
  net = round2(net);
  const profit = -net;
  if (closingLines.length && net !== 0) {
    closingLines.push(profit > 0 ? { account_id: resultAccId, credit: profit } : { account_id: resultAccId, debit: -profit });
  }
  if (closingLines.length >= 2) {
    await postEntry(conn, {
      date: fy.end_date, text: `Jahresabschluss ${fy.name}: Abschluss Erfolgskonten`,
      ref_type: 'closing', ref_id: fy.id, user_id: userId, lines: closingLines,
    });
  }

  // 2) Jahr sperren
  await q("UPDATE fiscal_years SET status = 'closed', closed_at = NOW() WHERE id = ?", [fy.id], conn);

  // 3) Folgejahr ermitteln oder anlegen
  const nextStart = addDays(fy.end_date, 1);
  let next = await one('SELECT * FROM fiscal_years WHERE start_date = ?', [nextStart], conn);
  if (!next) {
    const [y, m, d] = nextStart.split('-').map(Number);
    const nextEnd = addDays(`${y + 1}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, -1);
    const baseName = nextStart.slice(0, 4) === nextEnd.slice(0, 4) ? nextStart.slice(0, 4) : `${nextStart.slice(0, 4)}/${nextEnd.slice(2, 4)}`;
    const taken = await one('SELECT id FROM fiscal_years WHERE name = ?', [baseName], conn);
    const name = taken ? `${baseName} (${nextStart})` : baseName;
    const res = await q('INSERT INTO fiscal_years (name, start_date, end_date) VALUES (?,?,?)', [name, nextStart, nextEnd], conn);
    next = { id: res.insertId, name, start_date: nextStart, end_date: nextEnd, status: 'open' };
  }
  if (next.status !== 'open') throw new HttpError(400, `Das Folgejahr ${next.name} ist bereits abgeschlossen.`);

  // 4) Eröffnungsbilanz: Bilanzkonten vortragen, Jahresergebnis in den Gewinnvortrag umbuchen
  const after = await yearBalances(conn, yearId);
  const carry = new Map();
  for (const r of after) {
    if (r.type === 'revenue' || r.type === 'expense') continue;
    const b = round2(r.balance);
    if (!b) continue;
    const target = r.id === resultAccId ? retainedAccId : r.id;
    carry.set(target, round2((carry.get(target) || 0) + b));
  }
  const openingLines = [...carry.entries()].filter(([, b]) => b)
    .map(([account_id, b]) => (b > 0 ? { account_id, debit: b } : { account_id, credit: -b }));
  await deleteOpening(conn, fy.id);
  if (openingLines.length >= 2) {
    await postEntry(conn, {
      date: next.start_date, text: `Eröffnungsbilanz ${next.name} (Saldovortrag aus ${fy.name})`,
      ref_type: 'opening', ref_id: fy.id, user_id: userId, lines: openingLines,
    });
  }
  return { closedYear: fy.name, nextYear: next.name, nextYearId: next.id, profit, carriedAccounts: openingLines.length };
}

async function deleteOpening(conn, fromYearId) {
  await q("DELETE FROM journal_entries WHERE ref_type = 'opening' AND ref_id = ?", [fromYearId], conn);
}

/** Abschluss rückgängig machen (nur solange das Folgejahr offen ist). */
export async function reopenFiscalYear(conn, yearId) {
  const fy = await one('SELECT * FROM fiscal_years WHERE id = ? FOR UPDATE', [yearId], conn);
  if (!fy) throw new HttpError(404, 'Geschäftsjahr nicht gefunden');
  if (fy.status !== 'closed') throw new HttpError(400, 'Das Geschäftsjahr ist nicht abgeschlossen.');
  const later = await one("SELECT name FROM fiscal_years WHERE start_date > ? AND status = 'closed' LIMIT 1", [fy.end_date], conn);
  if (later) throw new HttpError(400, `Das spätere Geschäftsjahr ${later.name} ist bereits abgeschlossen.`);
  await deleteOpening(conn, fy.id);
  await q("DELETE FROM journal_entries WHERE ref_type = 'closing' AND ref_id = ?", [fy.id], conn);
  await q("UPDATE fiscal_years SET status = 'open', closed_at = NULL WHERE id = ?", [fy.id], conn);
  return { reopened: fy.name };
}
