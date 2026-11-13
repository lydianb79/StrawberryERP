// Version 1.3: Zahlungsdateien, Sammelmahnung, Projekte/Zeiterfassung, Lagerorte/Inventur, Kontakte, Bankabstimmung,
// Treuhänder-Export, Lohn, Kurshistorie, Überwachung
import { Router } from 'express';
import fs from 'node:fs';
import { PassThrough } from 'node:stream';
import { q, one, tx } from '../db.js';
import { can, audit, has } from '../auth.js';
import { HttpError, h, today, round2, isDate, needDate } from '../util.js';
import { crudRouter } from '../crud.js';
import { getSettings } from '../services/settings.js';
import { buildPain001 } from '../services/pain001.js';
import * as dunning from '../services/dunning.js';
import * as stock from '../services/stock.js';
import * as payroll from '../services/payroll.js';
import * as docs from '../services/documents.js';
import { accountBalance } from '../services/closingwork.js';
import { nextNumber } from '../services/numbering.js';
import { renderDocumentPdf } from '../services/pdf.js';
import { sendMail, fillTemplate, isMailConfigured } from '../services/mail.js';
import { parseCamtBalance } from '../services/banking.js';

const r = Router();

function pdfBuffer(data) {
  const stream = new PassThrough();
  const chunks = [];
  const done = new Promise((resolve, reject) => {
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
  renderDocumentPdf({ doc: data.doc, items: data.items, customer: data.partner, settings: data.settings, logo: data.logo }, stream);
  return done;
}
const sendPdf = (res, buffer, filename) => res.set('Content-Type', 'application/pdf').set('Content-Disposition', `inline; filename="${filename}"`).send(buffer);

// ---------- Zahlungsdatei für Lieferantenrechnungen (pain.001) ----------
r.post('/payables-payment-file', can('payables.write'), h(async (req, res) => {
  const ids = [...new Set((req.body?.invoice_ids || []).map(Number))];
  if (!ids.length) throw new HttpError(400, 'Bitte mindestens eine Rechnung auswählen.');
  const date = isDate(req.body?.date) ? req.body.date : today();
  const bills = await q(
    `SELECT si.*, s.company, s.street, s.zip, s.city, s.country, s.iban FROM supplier_invoices si JOIN suppliers s ON s.id = si.supplier_id
      WHERE si.id IN (?) AND si.status IN ('open','partial')`, [ids]);
  if (bills.length !== ids.length) throw new HttpError(400, 'Mindestens eine der gewählten Rechnungen ist nicht mehr offen.');
  const { company } = await getSettings();
  const file = buildPain001({ name: company.name, iban: company.iban, bic: company.bic }, bills.map((b) => ({
    id: b.id, name: b.company, street: b.street, zip: b.zip, city: b.city, country: b.country, iban: b.iban,
    amount: round2(b.total - b.paid_amount), currency: b.currency, message: `Rechnung ${b.number}`, endToEnd: `SI${b.id}`,
  })), { date });
  await q('UPDATE supplier_invoices SET payment_exported_at = NOW() WHERE id IN (?)', [ids]);
  await audit(req, 'payment-file', 'supplier_invoice', null, `${file.count} Zahlungen, Total ${file.total.toFixed(2)}, ${file.msgId}`);
  res.json({ ...file, filename: `Zahlungen-${date}-${file.msgId}.xml` });
}));

// ---------- Sammelmahnung ----------
r.get('/dunning-collective', can('receivables.read'), h(async (_req, res) => res.json(await dunning.collectiveCandidates())));
r.get('/dunning-collective/:customerId/pdf', can('receivables.read'), h(async (req, res) => {
  const data = await dunning.collectiveDocument(undefined, req.params.customerId);
  sendPdf(res, await pdfBuffer(data), data.filename);
}));
r.get('/dunning-collective/:customerId/mail', can('receivables.read'), h(async (req, res) => {
  const data = await dunning.collectiveDocument(undefined, req.params.customerId);
  const { mail, company } = data.settings;
  const tpl = { ...data.doc, number: `${data.invoices} Rechnungen`, title: data.title };
  res.json({ configured: await isMailConfigured(), to: data.partner.email || '',
    subject: fillTemplate(mail.dunningSubject, tpl, company), message: fillTemplate(mail.dunningBody, tpl, company) });
}));
r.post('/dunning-collective/:customerId/send', can('receivables.write'), h(async (req, res) => {
  const data = await dunning.collectiveDocument(undefined, req.params.customerId);
  const recipients = await sendMail(undefined, { to: req.body?.to, cc: req.body?.cc, subject: req.body?.subject, text: req.body?.message,
    attachments: [{ filename: data.filename, content: await pdfBuffer(data), contentType: 'application/pdf' }] });
  await audit(req, 'send-mail', 'dunning', req.params.customerId, `${data.title} ${data.partner.company} an ${recipients.join(', ')}`);
  res.status(204).end();
}));

// ---------- Projekte und Zeiterfassung ----------
r.use('/projects', crudRouter({
  table: 'projects', entity: 'project', perm: 'projects',
  fields: { number: 's', name: 's', customer_id: 'i', status: 's', hourly_rate: 'n', budget_hours: 'i', cost_center_id: 'i', notes: 's' },
  required: ['name'], search: ['number', 'name'], orderBy: "status, number DESC", filters: ['status', 'customer_id'],
  autoNumber: { field: 'number', generate: async (conn) => `P-${String(await nextNumber(conn, 'project', 0)).padStart(4, '0')}` },
  validate: (d) => { if (d.status !== undefined && !['open', 'closed'].includes(d.status)) d.status = 'open'; },
}));

r.get('/project-overview', can('projects.read'), h(async (_req, res) => {
  res.json(await q(
    `SELECT p.*, c.company AS customer_name,
            COALESCE(SUM(t.hours), 0) AS hours,
            COALESCE(SUM(CASE WHEN t.billable = 1 AND t.invoiced_document_id IS NULL THEN t.hours ELSE 0 END), 0) AS open_hours,
            COALESCE(SUM(CASE WHEN t.billable = 1 AND t.invoiced_document_id IS NULL THEN t.hours * t.rate ELSE 0 END), 0) AS open_amount,
            COALESCE(SUM(CASE WHEN t.invoiced_document_id IS NOT NULL THEN t.hours * t.rate ELSE 0 END), 0) AS invoiced_amount
       FROM projects p LEFT JOIN customers c ON c.id = p.customer_id LEFT JOIN time_entries t ON t.project_id = p.id
      GROUP BY p.id ORDER BY p.status, p.number DESC`));
}));

const mayAll = (req) => has(req.user, 'projects.write');

r.get('/time-entries', can('time.write', 'projects.read'), h(async (req, res) => {
  const where = [], params = [];
  // Ohne Projektrecht sieht jede Person nur die eigenen Zeiten
  if (!has(req.user, 'projects.read') || req.query.mine === '1') { where.push('t.user_id = ?'); params.push(req.user.id); }
  if (req.query.project_id) { where.push('t.project_id = ?'); params.push(req.query.project_id); }
  if (isDate(req.query.from)) { where.push('t.date >= ?'); params.push(req.query.from); }
  if (isDate(req.query.to)) { where.push('t.date <= ?'); params.push(req.query.to); }
  if (req.query.open === '1') where.push('t.billable = 1 AND t.invoiced_document_id IS NULL');
  res.json(await q(
    `SELECT t.*, p.number AS project_number, p.name AS project_name, u.name AS user_name, d.number AS invoice_number
       FROM time_entries t JOIN projects p ON p.id = t.project_id JOIN users u ON u.id = t.user_id LEFT JOIN documents d ON d.id = t.invoiced_document_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY t.date DESC, t.id DESC LIMIT 1000`, params));
}));

async function timeData(req, current) {
  const b = req.body || {};
  const project = await one('SELECT * FROM projects WHERE id = ?', [b.project_id ?? current?.project_id]);
  if (!project) throw new HttpError(400, 'Bitte ein Projekt wählen.');
  if (project.status !== 'open') throw new HttpError(400, 'Auf abgeschlossene Projekte kann keine Zeit erfasst werden.');
  const hours = Math.round(Number(b.hours) * 100) / 100;
  if (!(hours > 0) || hours > 24) throw new HttpError(400, 'Bitte eine Stundenzahl zwischen 0 und 24 angeben.');
  return { project_id: project.id, date: needDate(b.date || today(), 'Datum'), hours, description: String(b.description || '').slice(0, 500) || null,
    billable: b.billable === false ? 0 : 1, rate: b.rate !== undefined && b.rate !== '' && mayAll(req) ? round2(b.rate) : current?.rate ?? project.hourly_rate };
}

r.post('/time-entries', can('time.write'), h(async (req, res) => {
  const data = await timeData(req);
  const user_id = mayAll(req) && req.body?.user_id ? Number(req.body.user_id) : req.user.id;
  const result = await q('INSERT INTO time_entries SET ?', [{ ...data, user_id }]);
  res.status(201).json({ id: result.insertId });
}));

async function ownEntry(req) {
  const e = await one('SELECT * FROM time_entries WHERE id = ?', [req.params.id]);
  if (!e) throw new HttpError(404, 'Zeiteintrag nicht gefunden');
  if (e.user_id !== req.user.id && !mayAll(req)) throw new HttpError(403, 'Sie können nur eigene Zeiten ändern.');
  if (e.invoiced_document_id) throw new HttpError(400, 'Dieser Eintrag wurde bereits verrechnet.');
  return e;
}
r.put('/time-entries/:id', can('time.write'), h(async (req, res) => {
  const e = await ownEntry(req);
  await q('UPDATE time_entries SET ? WHERE id = ?', [await timeData(req, e), e.id]);
  res.status(204).end();
}));
r.delete('/time-entries/:id', can('time.write'), h(async (req, res) => {
  const e = await ownEntry(req);
  await q('DELETE FROM time_entries WHERE id = ?', [e.id]);
  res.status(204).end();
}));

/** Offene, verrechenbare Stunden eines Projekts in einen Rechnungsentwurf übernehmen. */
r.post('/projects/:id/invoice', can('projects.write'), h(async (req, res) => {
  if (!has(req.user, 'invoices.write')) throw new HttpError(403, 'Keine Berechtigung, Rechnungen zu erstellen.');
  const id = await tx(async (conn) => {
    const project = await one('SELECT * FROM projects WHERE id = ? FOR UPDATE', [req.params.id], conn);
    if (!project) throw new HttpError(404, 'Projekt nicht gefunden');
    if (!project.customer_id) throw new HttpError(400, 'Dem Projekt ist kein Kunde zugeordnet.');
    const to = isDate(req.body?.to) ? req.body.to : today();
    const entries = await q(
      `SELECT t.*, u.name AS user_name FROM time_entries t JOIN users u ON u.id = t.user_id
        WHERE t.project_id = ? AND t.billable = 1 AND t.invoiced_document_id IS NULL AND t.date <= ? ORDER BY t.date, t.id FOR UPDATE`, [project.id, to], conn);
    if (!entries.length) throw new HttpError(400, 'Es gibt keine offenen, verrechenbaren Stunden.');
    const { company } = await getSettings(conn);
    const fmt = (d) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
    const docId = await docs.createDocument(conn, req.user, {
      type: 'invoice', customer_id: project.customer_id, cost_center_id: project.cost_center_id, reference: `Projekt ${project.number} ${project.name}`,
      items: entries.map((e) => ({ description: `${fmt(e.date)} ${e.user_name}${e.description ? `: ${e.description}` : ''}`, qty: e.hours, unit: 'Std',
        unit_price: e.rate, vat_rate: company.default_vat })),
    });
    await q('UPDATE time_entries SET invoiced_document_id = ? WHERE id IN (?)', [docId, entries.map((e) => e.id)], conn);
    return docId;
  });
  await audit(req, 'project-invoice', 'project', req.params.id, `Rechnungsentwurf ${id}`);
  res.status(201).json({ document_id: id });
}));

// ---------- Lager: Bestand je Lagerort, Chargen, Umlagerung, Inventur ----------
r.get('/inventory/stock', can('inventory.read'), h(async (req, res) => {
  const [warehouses, batches] = await Promise.all([
    q(`SELECT w.id, w.code, w.name, COALESCE(ps.qty, 0) AS qty FROM warehouses w
         LEFT JOIN product_stock ps ON ps.warehouse_id = w.id AND ps.product_id = ? WHERE w.active = 1 OR ps.qty <> 0 ORDER BY w.id`, [req.query.product_id]),
    q(`SELECT b.id, b.batch, b.qty, b.expiry, b.warehouse_id, w.code AS warehouse_code FROM product_batches b JOIN warehouses w ON w.id = b.warehouse_id
        WHERE b.product_id = ? AND b.qty <> 0 ORDER BY b.id`, [req.query.product_id]),
  ]);
  res.json({ warehouses, batches });
}));

r.post('/inventory/transfer', can('inventory.write'), h(async (req, res) => {
  await tx((conn) => stock.transferStock(conn, { ...req.body, user_id: req.user.id }));
  await audit(req, 'stock-transfer', 'product', req.body?.product_id, `Menge ${req.body?.qty}`);
  res.status(204).end();
}));

r.get('/stocktakes', can('inventory.read'), h(async (_req, res) => {
  res.json(await q(
    `SELECT s.*, w.code AS warehouse_code, w.name AS warehouse_name, COUNT(i.id) AS positions, SUM(i.counted_qty IS NOT NULL) AS counted
       FROM stocktakes s JOIN warehouses w ON w.id = s.warehouse_id LEFT JOIN stocktake_items i ON i.stocktake_id = s.id
      GROUP BY s.id ORDER BY s.id DESC`));
}));
r.post('/stocktakes', can('inventory.write'), h(async (req, res) => {
  const id = await tx((conn) => stock.createStocktake(conn, req.user, { warehouse_id: req.body?.warehouse_id, date: needDate(req.body?.date || today(), 'Datum'), note: req.body?.note }));
  await audit(req, 'create', 'stocktake', id);
  res.status(201).json(await stock.getStocktake(undefined, id));
}));
r.get('/stocktakes/:id', can('inventory.read'), h(async (req, res) => res.json(await stock.getStocktake(undefined, req.params.id))));
r.put('/stocktakes/:id', can('inventory.write'), h(async (req, res) => {
  await tx((conn) => stock.saveCounts(conn, req.params.id, req.body?.items));
  res.json(await stock.getStocktake(undefined, req.params.id));
}));
r.post('/stocktakes/:id/post', can('inventory.write'), h(async (req, res) => {
  const result = await tx(async (conn) => {
    if (Array.isArray(req.body?.items)) await stock.saveCounts(conn, req.params.id, req.body.items);
    return stock.postStocktake(conn, req.user, req.params.id);
  });
  await audit(req, 'stocktake-post', 'stocktake', req.params.id, `${result.corrections} Korrekturen`);
  res.json(result);
}));
r.delete('/stocktakes/:id', can('inventory.write'), h(async (req, res) => {
  const result = await q("DELETE FROM stocktakes WHERE id = ? AND status = 'open'", [req.params.id]);
  if (!result.affectedRows) throw new HttpError(400, 'Nur offene Inventuren können verworfen werden.');
  res.status(204).end();
}));

// ---------- Kontakte, Notizen und Aufgaben ----------
r.get('/contacts', can('customers.read', 'suppliers.read'), h(async (req, res) => {
  const col = req.query.supplier_id ? 'supplier_id' : 'customer_id';
  res.json(await q(`SELECT * FROM contacts WHERE ${col} = ? ORDER BY is_primary DESC, name`, [req.query.supplier_id || req.query.customer_id]));
}));
const contactData = (b) => {
  if (!String(b.name || '').trim()) throw new HttpError(400, 'Bitte einen Namen angeben.');
  const s = (v, n) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, n));
  return { name: s(b.name, 160), role: s(b.role, 120), email: s(b.email, 190), phone: s(b.phone, 60), mobile: s(b.mobile, 60), is_primary: b.is_primary ? 1 : 0, notes: s(b.notes, 2000) };
};
const contactPerm = (b) => (b.supplier_id ? 'suppliers.write' : 'customers.write');
r.post('/contacts', h(async (req, res) => {
  const b = req.body || {};
  if (!has(req.user, contactPerm(b))) throw new HttpError(403, 'Keine Berechtigung für diese Aktion');
  if (!b.customer_id && !b.supplier_id) throw new HttpError(400, 'Kunde oder Lieferant fehlt.');
  const result = await q('INSERT INTO contacts SET ?', [{ ...contactData(b), customer_id: b.customer_id || null, supplier_id: b.customer_id ? null : b.supplier_id }]);
  res.status(201).json({ id: result.insertId });
}));
r.put('/contacts/:id', h(async (req, res) => {
  const c = await one('SELECT * FROM contacts WHERE id = ?', [req.params.id]);
  if (!c) throw new HttpError(404, 'Kontakt nicht gefunden');
  if (!has(req.user, contactPerm(c))) throw new HttpError(403, 'Keine Berechtigung für diese Aktion');
  await q('UPDATE contacts SET ? WHERE id = ?', [contactData(req.body || {}), c.id]);
  res.status(204).end();
}));
r.delete('/contacts/:id', h(async (req, res) => {
  const c = await one('SELECT * FROM contacts WHERE id = ?', [req.params.id]);
  if (!c) throw new HttpError(404, 'Kontakt nicht gefunden');
  if (!has(req.user, contactPerm(c))) throw new HttpError(403, 'Keine Berechtigung für diese Aktion');
  await q('DELETE FROM contacts WHERE id = ?', [c.id]);
  res.status(204).end();
}));

const CRM_READ = ['customers.read', 'quotes.read', 'orders.read', 'invoices.read'];
r.get('/crm', can(...CRM_READ), h(async (req, res) => {
  const where = [], params = [];
  if (req.query.customer_id) { where.push('i.customer_id = ?'); params.push(req.query.customer_id); }
  if (req.query.document_id) { where.push('i.document_id = ?'); params.push(req.query.document_id); }
  if (req.query.mine === '1') { where.push("i.kind = 'task' AND i.done_at IS NULL AND (i.assigned_to = ? OR (i.assigned_to IS NULL AND i.created_by = ?))"); params.push(req.user.id, req.user.id); }
  if (!where.length) throw new HttpError(400, 'Filter fehlt');
  res.json(await q(
    `SELECT i.*, u.name AS created_name, a.name AS assigned_name, c.company AS customer_name, d.number AS document_number, d.type AS document_type
       FROM crm_items i LEFT JOIN users u ON u.id = i.created_by LEFT JOIN users a ON a.id = i.assigned_to
       LEFT JOIN customers c ON c.id = i.customer_id LEFT JOIN documents d ON d.id = i.document_id
      WHERE ${where.join(' AND ')} ORDER BY (i.done_at IS NOT NULL), COALESCE(i.due_date, '9999-12-31'), i.id DESC LIMIT 300`, params));
}));
r.post('/crm', can(...CRM_READ), h(async (req, res) => {
  const b = req.body || {};
  if (!String(b.text || '').trim()) throw new HttpError(400, 'Bitte einen Text eingeben.');
  let customer_id = b.customer_id || null;
  if (b.document_id) customer_id = (await one('SELECT customer_id FROM documents WHERE id = ?', [b.document_id]))?.customer_id ?? customer_id;
  if (!customer_id && !b.document_id) throw new HttpError(400, 'Kunde oder Beleg fehlt.');
  const result = await q('INSERT INTO crm_items SET ?', [{ customer_id, document_id: b.document_id || null, kind: b.kind === 'task' ? 'task' : 'note',
    text: String(b.text).trim().slice(0, 4000), due_date: isDate(b.due_date) ? b.due_date : null, assigned_to: b.assigned_to || null, created_by: req.user.id }]);
  res.status(201).json({ id: result.insertId });
}));
r.put('/crm/:id', can(...CRM_READ), h(async (req, res) => {
  const b = req.body || {};
  const data = {};
  if ('done' in b) data.done_at = b.done ? new Date() : null;
  if ('text' in b && String(b.text).trim()) data.text = String(b.text).trim().slice(0, 4000);
  if ('due_date' in b) data.due_date = isDate(b.due_date) ? b.due_date : null;
  if ('assigned_to' in b) data.assigned_to = b.assigned_to || null;
  if (Object.keys(data).length) await q('UPDATE crm_items SET ? WHERE id = ?', [data, req.params.id]);
  res.status(204).end();
}));
r.delete('/crm/:id', can(...CRM_READ), h(async (req, res) => {
  const item = await one('SELECT created_by FROM crm_items WHERE id = ?', [req.params.id]);
  if (!item) throw new HttpError(404, 'Eintrag nicht gefunden');
  if (item.created_by !== req.user.id && !has(req.user, 'customers.write')) throw new HttpError(403, 'Nur eigene Einträge können gelöscht werden.');
  await q('DELETE FROM crm_items WHERE id = ?', [req.params.id]);
  res.status(204).end();
}));

// ---------- Bankabstimmung ----------
r.get('/reconcile', can('accounting.read'), h(async (req, res) => {
  const account = await one("SELECT * FROM accounts WHERE id = ? AND type = 'asset'", [req.query.account_id]);
  if (!account) throw new HttpError(400, 'Bitte ein Bank- oder Kassenkonto wählen.');
  const date = isDate(req.query.date) ? req.query.date : today();
  const lines = await q(
    `SELECT l.id, e.date, e.text, e.ref_type, l.debit, l.credit, l.reconciled_at FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
       JOIN fiscal_years y ON y.id = e.fiscal_year_id
      WHERE l.account_id = ? AND e.date <= ? AND e.ref_type <> 'opening' AND (l.reconciled_at IS NULL OR ? BETWEEN y.start_date AND y.end_date)
      ORDER BY e.date DESC, l.id DESC LIMIT 1000`, [account.id, date, date]);
  const bookBalance = await accountBalance(undefined, account.id, date);
  const open = round2(lines.filter((l) => !l.reconciled_at).reduce((s, l) => s + l.debit - l.credit, 0));
  const history = await q(
    `SELECT b.*, u.name AS user_name FROM bank_reconciliations b LEFT JOIN users u ON u.id = b.created_by WHERE b.account_id = ? ORDER BY b.date DESC, b.id DESC LIMIT 12`, [account.id]);
  res.json({ account, date, bookBalance, openItems: open, reconciledBalance: round2(bookBalance - open), lines, history });
}));

r.post('/reconcile/mark', can('accounting.write'), h(async (req, res) => {
  const ids = (req.body?.line_ids || []).map(Number).filter(Boolean);
  if (ids.length) await q('UPDATE journal_lines SET reconciled_at = ? WHERE id IN (?)', [req.body?.reconciled === false ? null : new Date(), ids]);
  res.status(204).end();
}));

/** Abstimmung festhalten: Saldo laut Kontoauszug gegenüber Buchsaldo abzüglich noch nicht abgestimmter Buchungen. */
r.post('/reconcile', can('accounting.write'), h(async (req, res) => {
  const b = req.body || {};
  const account = await one("SELECT * FROM accounts WHERE id = ? AND type = 'asset'", [b.account_id]);
  if (!account) throw new HttpError(400, 'Bitte ein Bank- oder Kassenkonto wählen.');
  const date = needDate(b.date, 'Datum');
  if (b.statement_balance === '' || b.statement_balance == null || !Number.isFinite(Number(b.statement_balance))) throw new HttpError(400, 'Bitte den Saldo laut Kontoauszug angeben.');
  const bookBalance = await accountBalance(undefined, account.id, date);
  const open = await one(
    `SELECT COALESCE(SUM(l.debit - l.credit), 0) AS amount FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
      WHERE l.account_id = ? AND e.date <= ? AND e.ref_type <> 'opening' AND l.reconciled_at IS NULL`, [account.id, date]);
  const difference = round2(Number(b.statement_balance) - (bookBalance - open.amount));
  const result = await q('INSERT INTO bank_reconciliations (account_id, date, statement_balance, book_balance, open_items, note, created_by) VALUES (?,?,?,?,?,?,?)',
    [account.id, date, round2(b.statement_balance), bookBalance, round2(open.amount), b.note ? String(b.note).slice(0, 255) : null, req.user.id]);
  await audit(req, 'reconcile', 'account', account.id, `${account.number} per ${date}: Differenz ${difference.toFixed(2)}`);
  res.status(201).json({ id: result.insertId, bookBalance, openItems: round2(open.amount), difference });
}));

/** Schlusssaldo aus einem camt.053-Kontoauszug lesen (zum Vorbelegen der Abstimmung). */
r.post('/reconcile/statement', can('accounting.read'), h(async (req, res) => res.json(parseCamtBalance(req.body?.xml))));

// ---------- Treuhänder-Export des Journals ----------
r.get('/journal-export', can('accounting.read'), h(async (req, res) => {
  const year = await one('SELECT * FROM fiscal_years WHERE id = ?', [req.query.year_id]);
  if (!year) throw new HttpError(404, 'Geschäftsjahr nicht gefunden');
  const rows = await q(
    `SELECT e.id, e.date, e.text, e.ref_type, a.number AS account, a.name AS account_name, l.debit, l.credit, cc.code AS cost_center
       FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id JOIN accounts a ON a.id = l.account_id
       LEFT JOIN cost_centers cc ON cc.id = l.cost_center_id WHERE e.fiscal_year_id = ? ORDER BY e.date, e.id, l.id`, [year.id]);
  const esc = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const d = (s) => `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;
  const lines = [];
  if (req.query.format === 'pairs') {
    // Soll/Haben-Format: eine Zeile je Buchungssatz; Sammelbuchungen mit leerem Gegenkonto (wie es z.B. Banana erwartet)
    lines.push(['Datum', 'Beleg', 'Beschreibung', 'KtSoll', 'KtHaben', 'Betrag', 'KS1'].join(';'));
    const byEntry = Map.groupBy(rows, (x) => x.id);
    for (const list of byEntry.values()) {
      const debit = list.filter((x) => x.debit), credit = list.filter((x) => x.credit);
      if (debit.length === 1 && credit.length === 1) {
        lines.push([d(list[0].date), list[0].id, esc(list[0].text), debit[0].account, credit[0].account, debit[0].debit.toFixed(2), esc(debit[0].cost_center || credit[0].cost_center || '')].join(';'));
      } else {
        for (const x of debit) lines.push([d(x.date), x.id, esc(x.text), x.account, '', x.debit.toFixed(2), esc(x.cost_center || '')].join(';'));
        for (const x of credit) lines.push([d(x.date), x.id, esc(x.text), '', x.account, x.credit.toFixed(2), esc(x.cost_center || '')].join(';'));
      }
    }
  } else {
    lines.push(['Datum', 'Buchung', 'Text', 'Art', 'Konto', 'Kontobezeichnung', 'Soll', 'Haben', 'Kostenstelle'].join(';'));
    for (const x of rows) lines.push([d(x.date), x.id, esc(x.text), x.ref_type, x.account, esc(x.account_name), x.debit.toFixed(2), x.credit.toFixed(2), esc(x.cost_center || '')].join(';'));
  }
  await audit(req, 'journal-export', 'fiscal_year', year.id, `${req.query.format === 'pairs' ? 'Soll/Haben' : 'Buchungszeilen'}, ${rows.length} Zeilen`);
  res.set('Content-Type', 'text/csv; charset=utf-8')
    .set('Content-Disposition', `attachment; filename="Journal-${year.name.replace(/[^\w-]/g, '_')}-${req.query.format === 'pairs' ? 'Soll-Haben' : 'Zeilen'}.csv"`)
    .send(`﻿${lines.join('\r\n')}\r\n`);
}));

// ---------- Lohn ----------
r.use('/employees', crudRouter({
  table: 'employees', entity: 'employee', perm: 'payroll',
  fields: { number: 's', name: 's', street: 's', zip: 's', city: 's', ahv_no: 's', birth_date: 's', entry_date: 's', exit_date: 's',
    monthly_gross: 'n', bvg_employee: 'n', bvg_employer: 'n', iban: 's', cost_center_id: 'i', active: 'b' },
  required: ['name'], search: ['number', 'name'], orderBy: 'name',
  autoNumber: { field: 'number', generate: async (conn) => `M-${String(await nextNumber(conn, 'employee', 0)).padStart(3, '0')}` },
}));

r.get('/payroll', can('payroll.read'), h(async (_req, res) => res.json(await payroll.listRuns())));
r.get('/payroll/:id', can('payroll.read'), h(async (req, res) => res.json(await payroll.getRun(undefined, req.params.id))));
r.post('/payroll', can('payroll.write'), h(async (req, res) => {
  const id = await tx((conn) => payroll.createRun(conn, req.user, req.body?.period));
  await audit(req, 'create', 'payroll', id, req.body?.period);
  res.status(201).json(await payroll.getRun(undefined, id));
}));
r.put('/payslips/:id', can('payroll.write'), h(async (req, res) => {
  const runId = await tx((conn) => payroll.updateSlip(conn, req.params.id, req.body || {}));
  res.json(await payroll.getRun(undefined, runId));
}));
r.post('/payroll/:id/post', can('payroll.write'), h(async (req, res) => {
  await tx((conn) => payroll.postRun(conn, req.user, req.params.id));
  await audit(req, 'payroll-post', 'payroll', req.params.id);
  res.json(await payroll.getRun(undefined, req.params.id));
}));
r.post('/payroll/:id/pay', can('payroll.write'), h(async (req, res) => {
  await tx((conn) => payroll.payRun(conn, req.user, req.params.id, req.body || {}));
  await audit(req, 'payroll-pay', 'payroll', req.params.id);
  res.json(await payroll.getRun(undefined, req.params.id));
}));
r.delete('/payroll/:id', can('payroll.write'), h(async (req, res) => {
  const result = await tx((conn) => payroll.cancelRun(conn, req.user, req.params.id));
  await audit(req, result === 'deleted' ? 'delete' : 'storno', 'payroll', req.params.id);
  res.json({ result });
}));
r.get('/payslips/:id/pdf', can('payroll.read'), h(async (req, res) => {
  const data = await payroll.payslipDocument(undefined, req.params.id);
  sendPdf(res, await pdfBuffer(data), data.filename);
}));
/** Zahlungsdatei für die Nettolöhne eines gebuchten Lohnlaufs. */
r.post('/payroll/:id/payment-file', can('payroll.write'), h(async (req, res) => {
  const run = await payroll.getRun(undefined, req.params.id);
  if (run.status === 'draft') throw new HttpError(400, 'Bitte den Lohnlauf zuerst buchen.');
  const { company } = await getSettings();
  const employees = await q('SELECT * FROM employees WHERE id IN (?)', [run.slips.map((s) => s.employee_id)]);
  const file = buildPain001({ name: company.name, iban: company.iban, bic: company.bic }, run.slips.filter((s) => s.net > 0).map((s) => {
    const e = employees.find((x) => x.id === s.employee_id);
    return { id: s.id, name: e.name, street: e.street, zip: e.zip, city: e.city, country: 'CH', iban: e.iban, amount: s.net,
      currency: company.currency || 'CHF', message: `Lohn ${payroll.periodLabel(run.period)}`, endToEnd: `PS${s.id}` };
  }), { date: isDate(req.body?.date) ? req.body.date : today(), salary: true });
  await audit(req, 'payment-file', 'payroll', run.id, `${file.count} Löhne, Total ${file.total.toFixed(2)}`);
  res.json({ ...file, filename: `Loehne-${run.period}.xml` });
}));

// ---------- Kurshistorie ----------
r.get('/currency-history', h(async (req, res) => {
  res.json(await q('SELECT date, rate, source FROM currency_rates WHERE code = ? ORDER BY date DESC LIMIT 400', [String(req.query.code || '').toUpperCase()]));
}));

// ---------- Überwachung ----------
const STATUS_DIR = process.env.STATUS_DIR || '/var/lib/strawberryerp';
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(`${STATUS_DIR}/${file}`, 'utf8')); } catch { return null; } };
r.get('/monitor', can('admin.settings'), (_req, res) => {
  const monitor = readJson('monitor-status.json');
  if (monitor) delete monitor.mailConfig; // enthält den SMTP-Zugang als Rückfall – verlässt den Server nicht
  res.json({ backup: readJson('backup-status.json'), monitor, configured: fs.existsSync(STATUS_DIR) });
});

export default r;
