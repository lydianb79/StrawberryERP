import { Router } from 'express';
import { q, one, tx } from '../db.js';
import { can, audit } from '../auth.js';
import { HttpError, h } from '../util.js';
import * as svc from '../services/payables.js';

const r = Router();

const SELECT = `SELECT si.*, s.company AS supplier_name, a.number AS account_number, a.name AS account_name,
                       ROUND(si.total * si.exchange_rate, 2) AS base_total, ROUND((si.total - si.paid_amount) * si.exchange_rate, 2) AS base_open,
                       po.number AS purchase_order_number,
                       (si.status IN ('open','partial') AND si.due_date < CURDATE()) AS overdue,
                       (SELECT COUNT(*) FROM attachments t WHERE t.entity = 'supplier_invoice' AND t.entity_id = si.id) AS attachment_count
                  FROM supplier_invoices si JOIN suppliers s ON s.id = si.supplier_id JOIN accounts a ON a.id = si.expense_account_id
                  LEFT JOIN documents po ON po.id = si.purchase_order_id`;

async function detail(id) {
  const si = await one(`${SELECT} WHERE si.id = ?`, [id]);
  if (!si) throw new HttpError(404, 'Lieferantenrechnung nicht gefunden');
  si.payments = await q(
    `SELECT p.*, a.number AS account_number, a.name AS account_name FROM payments p JOIN accounts a ON a.id = p.account_id
      WHERE p.supplier_invoice_id = ? ORDER BY p.date, p.id`, [id]);
  return si;
}

r.get('/', can('payables.read'), h(async (req, res) => {
  const where = [], params = [];
  if (req.query.open === '1') where.push("si.status IN ('open','partial')");
  if (req.query.q) { where.push('(si.number LIKE ? OR s.company LIKE ? OR si.description LIKE ?)'); params.push(...Array(3).fill(`%${req.query.q}%`)); }
  res.json(await q(`${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY si.date DESC, si.id DESC LIMIT 1000`, params));
}));

r.get('/:id', can('payables.read'), h(async (req, res) => res.json(await detail(req.params.id))));

r.post('/', can('payables.write'), h(async (req, res) => {
  const id = await tx((conn) => svc.createSupplierInvoice(conn, req.user, req.body || {}));
  await audit(req, 'create', 'supplier_invoice', id, req.body?.number);
  res.status(201).json(await detail(id));
}));

r.put('/:id', can('payables.write'), h(async (req, res) => {
  await tx((conn) => svc.updateSupplierInvoice(conn, req.user, req.params.id, req.body || {}));
  await audit(req, 'update', 'supplier_invoice', req.params.id);
  res.json(await detail(req.params.id));
}));

r.delete('/:id', can('payables.write'), h(async (req, res) => {
  const si = await tx((conn) => svc.cancelSupplierInvoice(conn, req.user, req.params.id));
  await audit(req, 'cancel', 'supplier_invoice', si.id, si.number);
  res.status(204).end();
}));

r.post('/:id/payments', can('payables.write'), h(async (req, res) => {
  await tx((conn) => svc.addSupplierPayment(conn, req.user, req.params.id, req.body || {}));
  await audit(req, 'payment', 'supplier_invoice', req.params.id, `Betrag ${req.body?.amount}`);
  res.status(201).json(await detail(req.params.id));
}));

r.delete('/payments/:paymentId', can('payables.write'), h(async (req, res) => {
  const si = await tx((conn) => svc.reverseSupplierPayment(conn, req.user, req.params.paymentId));
  await audit(req, 'payment-storno', 'supplier_invoice', si.id, si.number);
  res.json(await detail(si.id));
}));

export default r;
