import { Router } from 'express';
import { q, one, tx } from '../db.js';
import { need, audit } from '../auth.js';
import { HttpError, h } from '../util.js';
import * as docs from '../services/documents.js';
import { getSettings, getLogo } from '../services/settings.js';
import { renderDocumentPdf } from '../services/pdf.js';

const r = Router();
const { TYPES } = docs;

const typeOf = async (id) => {
  const row = await one('SELECT type FROM documents WHERE id = ?', [id]);
  if (!row) throw new HttpError(404, 'Beleg nicht gefunden');
  return row.type;
};
const needFor = async (req, id, mode) => need(req, `${TYPES[await typeOf(id)].perm}.${mode}`);

r.get('/', h(async (req, res) => {
  const { type, status, q: search, customer_id } = req.query;
  if (!TYPES[type]) throw new HttpError(400, 'Parameter type fehlt');
  need(req, `${TYPES[type].perm}.read`);
  const where = ['d.type = ?'], params = [type];
  if (status) { where.push('d.status = ?'); params.push(status); }
  if (customer_id) { where.push('d.customer_id = ?'); params.push(customer_id); }
  if (search) { where.push('(d.number LIKE ? OR c.company LIKE ? OR d.reference LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  res.json(await q(
    `SELECT d.id, d.type, d.number, d.date, d.due_date, d.valid_until, d.status, d.reference, d.subtotal, d.total, d.paid_amount,
            d.customer_id, c.company AS customer_name,
            (d.type = 'invoice' AND d.status IN ('open','partial') AND d.due_date < CURDATE()) AS overdue
       FROM documents d JOIN customers c ON c.id = d.customer_id
      WHERE ${where.join(' AND ')} ORDER BY d.date DESC, d.id DESC LIMIT 1000`, params));
}));

r.get('/:id', h(async (req, res) => {
  await needFor(req, req.params.id, 'read');
  res.json(await docs.getDocument(undefined, req.params.id));
}));

r.post('/', h(async (req, res) => {
  const type = req.body?.type;
  if (!TYPES[type]) throw new HttpError(400, 'Unbekannter Belegtyp');
  need(req, `${TYPES[type].perm}.write`);
  const id = await tx((conn) => docs.createDocument(conn, req.user, req.body));
  await audit(req, 'create', type, id);
  res.status(201).json(await docs.getDocument(undefined, id));
}));

r.put('/:id', h(async (req, res) => {
  await needFor(req, req.params.id, 'write');
  await tx((conn) => docs.updateDocument(conn, req.params.id, req.body || {}));
  await audit(req, 'update', 'document', req.params.id);
  res.json(await docs.getDocument(undefined, req.params.id));
}));

r.delete('/:id', h(async (req, res) => {
  await needFor(req, req.params.id, 'write');
  const doc = await tx((conn) => docs.deleteDocument(conn, req.params.id));
  await audit(req, 'delete', doc.type, doc.id, doc.number);
  res.status(204).end();
}));

r.post('/:id/status', h(async (req, res) => {
  await needFor(req, req.params.id, 'write');
  await tx((conn) => docs.setStatus(conn, req.params.id, req.body?.status));
  await audit(req, 'status', 'document', req.params.id, req.body?.status);
  res.json(await docs.getDocument(undefined, req.params.id));
}));

r.post('/:id/convert', h(async (req, res) => {
  const to = req.body?.to;
  if (!TYPES[to]) throw new HttpError(400, 'Zieltyp fehlt');
  await needFor(req, req.params.id, 'read');
  need(req, `${TYPES[to].perm}.write`);
  const id = await tx((conn) => docs.convertDocument(conn, req.user, req.params.id, to));
  await audit(req, 'convert', to, id, `aus Beleg ${req.params.id}`);
  res.status(201).json(await docs.getDocument(undefined, id));
}));

r.post('/:id/deliver', h(async (req, res) => {
  need(req, 'orders.write');
  const doc = await tx((conn) => docs.deliverOrder(conn, req.user, req.params.id));
  await audit(req, 'deliver', 'order', doc.id, doc.number);
  res.json(await docs.getDocument(undefined, req.params.id));
}));

r.post('/:id/issue', h(async (req, res) => {
  need(req, 'invoices.write');
  const number = await tx((conn) => docs.issueInvoice(conn, req.user, req.params.id));
  await audit(req, 'issue', 'invoice', req.params.id, number);
  res.json(await docs.getDocument(undefined, req.params.id));
}));

r.post('/:id/cancel', h(async (req, res) => {
  need(req, 'invoices.write');
  const doc = await tx((conn) => docs.cancelInvoice(conn, req.user, req.params.id));
  await audit(req, 'cancel', 'invoice', doc.id, doc.number);
  res.json(await docs.getDocument(undefined, req.params.id));
}));

r.post('/:id/payments', h(async (req, res) => {
  need(req, 'receivables.write');
  await tx((conn) => docs.addInvoicePayment(conn, req.user, req.params.id, req.body || {}));
  await audit(req, 'payment', 'invoice', req.params.id, `Betrag ${req.body?.amount}`);
  res.status(201).json(await docs.getDocument(undefined, req.params.id));
}));

r.delete('/payments/:paymentId', h(async (req, res) => {
  need(req, 'receivables.write');
  const doc = await tx((conn) => docs.removeInvoicePayment(conn, req.params.paymentId));
  await audit(req, 'payment-delete', 'invoice', doc.id, doc.number);
  res.json(await docs.getDocument(undefined, doc.id));
}));

r.get('/:id/pdf', h(async (req, res) => {
  await needFor(req, req.params.id, 'read');
  const doc = await docs.getDocument(undefined, req.params.id);
  const customer = await one('SELECT * FROM customers WHERE id = ?', [doc.customer_id]);
  const settings = await getSettings();
  const filename = `${TYPES[doc.type].label}-${doc.number || 'Entwurf'}.pdf`.replace(/[^\w.\-]/g, '_');
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${filename}"`);
  renderDocumentPdf({ doc, items: doc.items, customer, settings, logo: await getLogo() }, res);
}));

export default r;
