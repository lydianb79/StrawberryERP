// Mahnwesen, Zahlungsabgleich, Abo-Rechnungen, Belegablage, Preislisten, Abschlussarbeiten, Kursabruf
import { Router } from 'express';
import express from 'express';
import { q, one, tx } from '../db.js';
import { can, audit, has } from '../auth.js';
import { HttpError, h, today, round2 } from '../util.js';
import * as dunning from '../services/dunning.js';
import * as banking from '../services/banking.js';
import * as recurring from '../services/recurring.js';
import * as closing from '../services/closingwork.js';
import * as docs from '../services/documents.js';
import { refreshRates } from '../services/rates.js';
import { renderDocumentPdf } from '../services/pdf.js';
import { sendMail, fillTemplate, isMailConfigured } from '../services/mail.js';
import { getSettings } from '../services/settings.js';
import { PassThrough } from 'node:stream';

const r = Router();

// ---------- Mahnwesen ----------
r.get('/dunning/proposals', can('receivables.read'), h(async (_req, res) => res.json(await dunning.proposals())));
r.get('/dunning', can('receivables.read'), h(async (_req, res) => res.json(await dunning.listNotices())));

r.post('/dunning/run', can('receivables.write'), h(async (req, res) => {
  const created = await tx((conn) => dunning.createNotices(conn, req.user, req.body?.invoice_ids));
  await audit(req, 'dunning-run', 'invoice', null, created.map((c) => `${c.number} Stufe ${c.level}`).join(', '));
  res.status(201).json(created);
}));

async function noticePdf(id) {
  const data = await dunning.noticeDocument(undefined, id);
  const stream = new PassThrough();
  const chunks = [];
  const done = new Promise((resolve, reject) => {
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
  renderDocumentPdf({ doc: data.doc, items: data.items, customer: data.partner, settings: data.settings, logo: data.logo }, stream);
  return { ...data, buffer: await done };
}

r.get('/dunning/:id/pdf', can('receivables.read'), h(async (req, res) => {
  const { buffer, filename } = await noticePdf(req.params.id);
  res.set('Content-Type', 'application/pdf').set('Content-Disposition', `inline; filename="${filename}"`).send(buffer);
}));

r.get('/dunning/:id/mail', can('receivables.read'), h(async (req, res) => {
  const data = await dunning.noticeDocument(undefined, req.params.id);
  const { mail, company } = data.settings;
  const tpl = { ...data.doc, number: data.invoice.number, title: data.title };
  res.json({ configured: await isMailConfigured(), to: data.partner.email || '',
    subject: fillTemplate(mail.dunningSubject, tpl, company), message: fillTemplate(mail.dunningBody, tpl, company) });
}));

r.post('/dunning/:id/send', can('receivables.write'), h(async (req, res) => {
  const { buffer, filename, invoice, title } = await noticePdf(req.params.id);
  const recipients = await sendMail(undefined, { to: req.body?.to, cc: req.body?.cc, subject: req.body?.subject, text: req.body?.message,
    attachments: [{ filename, content: buffer, contentType: 'application/pdf' }] });
  await q('UPDATE dunning_notices SET sent_at = NOW() WHERE id = ?', [req.params.id]);
  await audit(req, 'send-mail', 'dunning', req.params.id, `${title} ${invoice.number} an ${recipients.join(', ')}`);
  res.status(204).end();
}));

// ---------- Zahlungsabgleich (camt.053 / camt.054) ----------
r.post('/banking/preview', can('banking.import'), express.text({ type: '*/*', limit: '12mb' }), h(async (req, res) => {
  const xml = typeof req.body === 'string' ? req.body : req.body?.xml;
  const entries = banking.parseCamt(xml);
  res.json({ entries: await banking.matchEntries(undefined, entries) });
}));

r.post('/banking/book', can('banking.import'), h(async (req, res) => {
  const list = Array.isArray(req.body?.entries) ? req.body.entries : [];
  if (!list.length) throw new HttpError(400, 'Keine Zahlungen ausgewählt.');
  const booked = [], errors = [];
  for (const e of list) {
    try {
      await tx((conn) => docs.addPayment(conn, req.user, e.invoice_id, {
        amount: e.amount, date: e.date, account_id: req.body.account_id, bank_ref: e.bank_ref, exchange_rate: e.exchange_rate,
        note: `Kontoauszug${e.debtor ? ` – ${String(e.debtor).slice(0, 80)}` : ''}`,
      }));
      booked.push(e.bank_ref);
    } catch (err) {
      errors.push({ bank_ref: e.bank_ref, error: err.message });
    }
  }
  await audit(req, 'bank-import', 'payment', null, `${booked.length} Zahlungen verbucht, ${errors.length} Fehler`);
  res.json({ booked: booked.length, errors });
}));

// ---------- Abo-Rechnungen ----------
r.get('/recurring', can('invoices.read'), h(async (_req, res) => res.json(await recurring.list())));

r.post('/recurring', can('invoices.write'), h(async (req, res) => {
  const id = await tx((conn) => recurring.createFromInvoice(conn, req.body?.invoice_id, req.body || {}));
  await audit(req, 'create', 'recurring', id, req.body?.name);
  res.status(201).json({ id });
}));

r.put('/recurring/:id', can('invoices.write'), h(async (req, res) => {
  const b = req.body || {};
  if (!recurring.PERIODS[b.period]) throw new HttpError(400, 'Bitte einen Rhythmus wählen.');
  const result = await q('UPDATE recurring_invoices SET name = ?, period = ?, next_date = ?, end_date = ?, auto_issue = ?, active = ? WHERE id = ?',
    [String(b.name || '').slice(0, 160) || 'Abo', b.period, b.next_date, b.end_date || null, b.auto_issue ? 1 : 0, b.active ? 1 : 0, req.params.id]);
  if (!result.affectedRows) throw new HttpError(404, 'Abo nicht gefunden');
  await audit(req, 'update', 'recurring', req.params.id);
  res.status(204).end();
}));

r.delete('/recurring/:id', can('invoices.write'), h(async (req, res) => {
  await q('DELETE FROM recurring_invoices WHERE id = ?', [req.params.id]);
  await audit(req, 'delete', 'recurring', req.params.id);
  res.status(204).end();
}));

r.post('/recurring/run', can('invoices.write'), h(async (req, res) => {
  const result = await recurring.runDue(req.user, { onlyId: req.body?.id || null });
  await audit(req, 'recurring-run', 'recurring', req.body?.id || null, `${result.created.length} Rechnungen erstellt`);
  res.json(result);
}));

// ---------- Belegablage ----------
const ENTITIES = { supplier_invoice: 'payables', document: null };
const MIME = { 'application/pdf': [0x25, 0x50, 0x44, 0x46], 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/jpeg': [0xff, 0xd8] };

async function attachmentPerm(req, entity, id, mode) {
  if (!(entity in ENTITIES)) throw new HttpError(400, 'Unbekannter Belegtyp');
  let perm = ENTITIES[entity];
  if (entity === 'document') {
    const d = await one('SELECT type FROM documents WHERE id = ?', [id]);
    if (!d) throw new HttpError(404, 'Beleg nicht gefunden');
    perm = docs.TYPES[d.type].perm;
  }
  if (!has(req.user, `${perm}.${mode}`)) throw new HttpError(403, 'Keine Berechtigung für diese Aktion');
}

r.get('/attachments', h(async (req, res) => {
  await attachmentPerm(req, req.query.entity, req.query.entity_id, 'read');
  res.json(await q(
    `SELECT a.id, a.filename, a.mime, a.size, a.created_at, u.name AS user_name FROM attachments a LEFT JOIN users u ON u.id = a.uploaded_by
      WHERE a.entity = ? AND a.entity_id = ? ORDER BY a.id`, [req.query.entity, req.query.entity_id]));
}));

r.post('/attachments', express.json({ limit: '12mb' }), h(async (req, res) => {
  const { entity, entity_id, filename, dataUrl } = req.body || {};
  await attachmentPerm(req, entity, entity_id, 'write');
  const m = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m || !MIME[m[1]]) throw new HttpError(400, 'Erlaubt sind PDF-, PNG- und JPEG-Dateien.');
  const buffer = Buffer.from(m[2], 'base64');
  if (buffer.length > 8 * 1024 * 1024) throw new HttpError(400, 'Die Datei darf höchstens 8 MB gross sein.');
  if (!MIME[m[1]].every((b, i) => buffer[i] === b)) throw new HttpError(400, 'Der Dateiinhalt passt nicht zum Dateityp.');
  const name = String(filename || 'Beleg').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 190);
  const result = await q('INSERT INTO attachments (entity, entity_id, filename, mime, size, data, uploaded_by) VALUES (?,?,?,?,?,?,?)',
    [entity, entity_id, name, m[1], buffer.length, buffer, req.user.id]);
  await audit(req, 'attach', entity, entity_id, name);
  res.status(201).json({ id: result.insertId });
}));

r.get('/attachments/:id', h(async (req, res) => {
  const a = await one('SELECT * FROM attachments WHERE id = ?', [req.params.id]);
  if (!a) throw new HttpError(404, 'Datei nicht gefunden');
  await attachmentPerm(req, a.entity, a.entity_id, 'read');
  res.set('Content-Type', a.mime).set('X-Content-Type-Options', 'nosniff')
    .set('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(a.filename)}`).send(a.data);
}));

r.delete('/attachments/:id', h(async (req, res) => {
  const a = await one('SELECT id, entity, entity_id, filename FROM attachments WHERE id = ?', [req.params.id]);
  if (!a) throw new HttpError(404, 'Datei nicht gefunden');
  await attachmentPerm(req, a.entity, a.entity_id, 'write');
  await q('DELETE FROM attachments WHERE id = ?', [a.id]);
  await audit(req, 'attachment-delete', a.entity, a.entity_id, a.filename);
  res.status(204).end();
}));

// ---------- Preislisten (kundenspezifische Preise, Staffelpreise) ----------
r.get('/prices', can('inventory.read', 'quotes.read', 'orders.read', 'invoices.read'), h(async (req, res) => {
  res.json(await q(
    `SELECT pp.*, c.company AS customer_name FROM product_prices pp LEFT JOIN customers c ON c.id = pp.customer_id
      WHERE pp.product_id = ? ORDER BY (pp.customer_id IS NULL) DESC, c.company, pp.min_qty`, [req.query.product_id]));
}));

r.post('/prices', can('inventory.write'), h(async (req, res) => {
  const { product_id, customer_id, min_qty, price } = req.body || {};
  if (!(Number(price) >= 0) || price === '' || price == null) throw new HttpError(400, 'Bitte einen Preis angeben.');
  const minQty = min_qty === undefined || min_qty === null || min_qty === '' ? 1 : Number(min_qty);
  if (!(minQty > 0)) throw new HttpError(400, 'Die Mindestmenge muss grösser als 0 sein.');
  const result = await q('INSERT INTO product_prices (product_id, customer_id, min_qty, price) VALUES (?,?,?,?)',
    [product_id, customer_id || null, minQty, round2(price)]);
  await audit(req, 'create', 'price', result.insertId, `Artikel ${product_id}`);
  res.status(201).json({ id: result.insertId });
}));

r.delete('/prices/:id', can('inventory.write'), h(async (req, res) => {
  await q('DELETE FROM product_prices WHERE id = ?', [req.params.id]);
  await audit(req, 'delete', 'price', req.params.id);
  res.status(204).end();
}));

// ---------- Abschlussarbeiten ----------
r.get('/closing/stock', can('accounting.read'), h(async (req, res) => res.json(await closing.stockValuation(undefined, req.query.date || today()))));
r.post('/closing/stock', can('accounting.write'), h(async (req, res) => {
  const result = await tx((conn) => closing.postStockValuation(conn, req.user, req.body?.date || today()));
  await audit(req, 'stock-valuation', 'journal_entry', result.entryId, `Differenz ${result.difference.toFixed(2)}`);
  res.status(201).json(result);
}));
r.get('/closing/fx', can('accounting.read'), h(async (_req, res) => res.json(await closing.fxValuation())));
r.post('/closing/fx', can('accounting.write'), h(async (req, res) => {
  const result = await tx((conn) => closing.postFxValuation(conn, req.user, req.body?.date || today()));
  await audit(req, 'fx-valuation', 'journal_entry', result.entryId, `Differenz ${result.total.toFixed(2)}`);
  res.status(201).json(result);
}));

// ---------- Kursabruf ----------
r.post('/currencies-refresh', can('admin.settings'), h(async (req, res) => {
  const result = await refreshRates();
  await audit(req, 'rates-refresh', 'currency', null, result.updated.map((u) => `${u.code} ${u.rate}`).join(', '));
  res.json(result);
}));

r.get('/dunning-settings', can('receivables.read'), h(async (_req, res) => res.json((await getSettings()).dunning)));

export default r;
