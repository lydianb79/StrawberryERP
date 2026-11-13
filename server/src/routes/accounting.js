import { Router } from 'express';
import { q, one, tx } from '../db.js';
import { can, audit } from '../auth.js';
import { HttpError, h, needDate, round2 } from '../util.js';
import { crudRouter } from '../crud.js';
import * as ledger from '../services/ledger.js';

const r = Router();

// ---------- Kontenplan ----------
r.use('/accounts', crudRouter({
  table: 'accounts', entity: 'account', perm: 'accounting',
  fields: { number: 's', name: 's', type: 's', active: 'b' }, required: ['number', 'name', 'type'],
  search: ['number', 'name'], orderBy: 'number',
}));

// ---------- Geschäftsjahre ----------
r.get('/fiscal-years', can('accounting.read', 'reports.read'), h(async (_req, res) => {
  res.json(await q(
    `SELECT y.*, (SELECT COUNT(*) FROM journal_entries e WHERE e.fiscal_year_id = y.id) AS entry_count
       FROM fiscal_years y ORDER BY y.start_date DESC`));
}));

r.post('/fiscal-years', can('accounting.close'), h(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const start = needDate(req.body?.start_date, 'Beginn'), end = needDate(req.body?.end_date, 'Ende');
  if (!name) throw new HttpError(400, 'Bezeichnung fehlt.');
  if (end <= start) throw new HttpError(400, 'Das Ende muss nach dem Beginn liegen.');
  const overlap = await one('SELECT name FROM fiscal_years WHERE start_date <= ? AND end_date >= ?', [end, start]);
  if (overlap) throw new HttpError(400, `Der Zeitraum überschneidet sich mit dem Geschäftsjahr ${overlap.name}.`);
  const result = await q('INSERT INTO fiscal_years (name, start_date, end_date) VALUES (?,?,?)', [name, start, end]);
  await audit(req, 'create', 'fiscal_year', result.insertId, name);
  res.status(201).json({ id: result.insertId });
}));

/** Vorschau/Prüfungen vor dem Jahresabschluss. */
r.get('/fiscal-years/:id/close-preview', can('accounting.read'), h(async (req, res) => {
  const fy = await one('SELECT * FROM fiscal_years WHERE id = ?', [req.params.id]);
  if (!fy) throw new HttpError(404, 'Geschäftsjahr nicht gefunden');
  const income = await ledger.incomeStatement(undefined, fy.id);
  const balance = await ledger.balanceSheet(undefined, fy.id);
  const drafts = await one("SELECT COUNT(*) AS n FROM documents WHERE type = 'invoice' AND status = 'draft' AND date BETWEEN ? AND ?", [fy.start_date, fy.end_date]);
  const openOrders = await one("SELECT COUNT(*) AS n FROM documents WHERE type = 'order' AND status IN ('open','delivered') AND date BETWEEN ? AND ?", [fy.start_date, fy.end_date]);
  const receivables = await one("SELECT COUNT(*) AS n, COALESCE(SUM(total - paid_amount), 0) AS amount FROM documents WHERE type = 'invoice' AND status IN ('open','partial') AND date <= ?", [fy.end_date]);
  const payables = await one("SELECT COUNT(*) AS n, COALESCE(SUM(total - paid_amount), 0) AS amount FROM supplier_invoices WHERE status <> 'paid' AND date <= ?", [fy.end_date]);
  const earlier = await one("SELECT name FROM fiscal_years WHERE end_date < ? AND status = 'open' LIMIT 1", [fy.start_date]);
  res.json({
    year: fy, result: income.result, totalRevenue: income.totalRevenue, totalExpense: income.totalExpense,
    totalAssets: balance.totalAssets, balanced: round2(balance.totalAssets - balance.totalLiabilitiesEquity) === 0,
    draftInvoices: drafts.n, openOrders: openOrders.n, receivables, payables, blockingYear: earlier?.name || null,
  });
}));

r.post('/fiscal-years/:id/close', can('accounting.close'), h(async (req, res) => {
  const result = await tx((conn) => ledger.closeFiscalYear(conn, req.params.id, req.user.id));
  await audit(req, 'year-close', 'fiscal_year', req.params.id, `${result.closedYear}: Ergebnis ${result.profit.toFixed(2)}`);
  res.json(result);
}));

r.post('/fiscal-years/:id/reopen', can('accounting.close'), h(async (req, res) => {
  const result = await tx((conn) => ledger.reopenFiscalYear(conn, req.params.id));
  await audit(req, 'year-reopen', 'fiscal_year', req.params.id, result.reopened);
  res.json(result);
}));

// ---------- Journal ----------
r.get('/journal', can('accounting.read'), h(async (req, res) => {
  const where = [], params = [];
  if (req.query.year_id) { where.push('e.fiscal_year_id = ?'); params.push(req.query.year_id); }
  if (req.query.q) { where.push('e.text LIKE ?'); params.push(`%${req.query.q}%`); }
  if (req.query.account_id) {
    where.push('EXISTS (SELECT 1 FROM journal_lines x WHERE x.entry_id = e.id AND x.account_id = ?)');
    params.push(req.query.account_id);
  }
  const entries = await q(
    `SELECT e.*, u.name AS user_name FROM journal_entries e LEFT JOIN users u ON u.id = e.created_by
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY e.date DESC, e.id DESC LIMIT 500`, params);
  if (entries.length) {
    const lines = await q(
      `SELECT l.*, a.number AS account_number, a.name AS account_name, cc.code AS cost_center_code
         FROM journal_lines l JOIN accounts a ON a.id = l.account_id LEFT JOIN cost_centers cc ON cc.id = l.cost_center_id
        WHERE l.entry_id IN (?) ORDER BY l.id`, [entries.map((e) => e.id)]);
    const byEntry = Map.groupBy(lines, (l) => l.entry_id);
    for (const e of entries) e.lines = byEntry.get(e.id) || [];
  }
  res.json(entries);
}));

r.post('/journal', can('accounting.write'), h(async (req, res) => {
  const { date, text, lines } = req.body || {};
  needDate(date, 'Buchungsdatum');
  if (!String(text || '').trim()) throw new HttpError(400, 'Buchungstext fehlt.');
  const id = await tx((conn) => ledger.postEntry(conn, { date, text, ref_type: 'manual', user_id: req.user.id, lines }));
  await audit(req, 'create', 'journal_entry', id, text);
  res.status(201).json({ id });
}));

r.delete('/journal/:id', can('accounting.write'), h(async (req, res) => {
  await tx(async (conn) => {
    const e = await one(
      `SELECT e.*, y.status FROM journal_entries e JOIN fiscal_years y ON y.id = e.fiscal_year_id WHERE e.id = ? FOR UPDATE`, [req.params.id], conn);
    if (!e) throw new HttpError(404, 'Buchung nicht gefunden');
    if (e.ref_type !== 'manual') throw new HttpError(400, 'Automatische Buchungen können nur über den zugehörigen Beleg geändert werden.');
    if (e.status !== 'open') throw new HttpError(400, 'Das Geschäftsjahr ist abgeschlossen.');
    await q('DELETE FROM journal_entries WHERE id = ?', [e.id], conn);
  });
  await audit(req, 'delete', 'journal_entry', req.params.id);
  res.status(204).end();
}));

// ---------- Auswertungen ----------
async function yearOr404(id) {
  const fy = await one('SELECT * FROM fiscal_years WHERE id = ?', [id]);
  if (!fy) throw new HttpError(404, 'Geschäftsjahr nicht gefunden');
  return fy;
}

r.get('/balance-sheet', can('accounting.read'), h(async (req, res) => {
  const year = await yearOr404(req.query.year_id);
  res.json({ year, ...(await ledger.balanceSheet(undefined, year.id)) });
}));

r.get('/income-statement', can('accounting.read'), h(async (req, res) => {
  const year = await yearOr404(req.query.year_id);
  res.json({ year, ...(await ledger.incomeStatement(undefined, year.id)) });
}));

r.get('/trial-balance', can('accounting.read'), h(async (req, res) => {
  const year = await yearOr404(req.query.year_id);
  const rows = await ledger.yearBalances(undefined, year.id);
  res.json({ year, rows: rows.filter((x) => x.debit || x.credit) });
}));

/** Kostenstellenrechnung: Ertrag, Aufwand und Ergebnis je Kostenstelle. */
r.get('/cost-center-report', can('accounting.read', 'reports.read'), h(async (req, res) => {
  const year = await yearOr404(req.query.year_id);
  const rows = await q(
    `SELECT cc.id, COALESCE(cc.code, '–') AS code, COALESCE(cc.name, 'Ohne Kostenstelle') AS name,
            SUM(CASE WHEN a.type = 'revenue' THEN l.credit - l.debit ELSE 0 END) AS revenue,
            SUM(CASE WHEN a.type = 'expense' THEN l.debit - l.credit ELSE 0 END) AS expense
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
       LEFT JOIN cost_centers cc ON cc.id = l.cost_center_id
      WHERE e.fiscal_year_id = ? AND e.ref_type <> 'closing' AND a.type IN ('revenue', 'expense')
      GROUP BY cc.id, cc.code, cc.name ORDER BY (cc.id IS NULL), cc.code`, [year.id]);
  for (const row of rows) row.result = round2(row.revenue - row.expense);
  res.json({ year, rows });
}));

/** Kontoauszug */
r.get('/accounts/:id/ledger', can('accounting.read'), h(async (req, res) => {
  const year = await yearOr404(req.query.year_id);
  const account = await one('SELECT * FROM accounts WHERE id = ?', [req.params.id]);
  if (!account) throw new HttpError(404, 'Konto nicht gefunden');
  const rows = await q(
    `SELECT e.id AS entry_id, e.date, e.text, e.ref_type, l.debit, l.credit
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
      WHERE l.account_id = ? AND e.fiscal_year_id = ? ORDER BY e.date, e.id, l.id`, [account.id, year.id]);
  let balance = 0;
  for (const row of rows) { balance = round2(balance + row.debit - row.credit); row.balance = balance; }
  res.json({ year, account, rows });
}));

export default r;
