import { Router } from 'express';
import { q, tx } from '../db.js';
import { can, audit } from '../auth.js';
import { HttpError, h } from '../util.js';
import { crudRouter } from '../crud.js';
import { partnerNumber } from '../services/numbering.js';
import { moveStock } from '../services/stock.js';

const partnerFields = {
  number: 's', company: 's', contact_name: 's', email: 's', phone: 's', street: 's', zip: 's', city: 's',
  country: 's', vat_no: 's', payment_terms_days: 'n', notes: 's', active: 'b',
};
const partnerSearch = ['company', 'number', 'contact_name', 'city', 'email'];

export const customers = crudRouter({
  table: 'customers', entity: 'customer', perm: 'customers', fields: partnerFields, required: ['company'],
  search: partnerSearch, orderBy: 'company',
  autoNumber: { field: 'number', generate: (conn) => partnerNumber(conn, 'customer', 'K') },
});

export const suppliers = crudRouter({
  table: 'suppliers', entity: 'supplier', perm: 'suppliers', fields: { ...partnerFields, iban: 's' }, required: ['company'],
  search: partnerSearch, orderBy: 'company',
  autoNumber: { field: 'number', generate: (conn) => partnerNumber(conn, 'supplier', 'L') },
});

// ---------- Artikel & Lager ----------
export const products = Router();

products.get('/movements', can('inventory.read'), h(async (req, res) => {
  const where = req.query.product_id ? 'WHERE m.product_id = ?' : '';
  res.json(await q(
    `SELECT m.*, p.sku, p.name AS product_name, p.unit, u.name AS user_name
       FROM stock_movements m JOIN products p ON p.id = m.product_id LEFT JOIN users u ON u.id = m.user_id
       ${where} ORDER BY m.id DESC LIMIT 500`, req.query.product_id ? [req.query.product_id] : []));
}));

products.post('/:id/movements', can('inventory.write'), h(async (req, res) => {
  const { type, reference, note } = req.body || {};
  const qty = Number(req.body?.qty);
  if (!['in', 'out', 'adjust'].includes(type)) throw new HttpError(400, 'Ungültige Bewegungsart');
  if (!Number.isFinite(qty) || (type !== 'adjust' && qty <= 0)) throw new HttpError(400, 'Bitte eine gültige Menge angeben.');
  const balance = await tx(async (conn) => {
    let delta = type === 'in' ? qty : -qty;
    if (type === 'adjust') {
      // Inventurkorrektur: qty ist der neue Soll-Bestand
      const [p] = await q('SELECT stock_qty FROM products WHERE id = ? FOR UPDATE', [req.params.id], conn);
      if (!p) throw new HttpError(404, 'Artikel nicht gefunden');
      if (qty < 0) throw new HttpError(400, 'Der Bestand darf nicht negativ sein.');
      delta = qty - p.stock_qty;
      if (!delta) throw new HttpError(400, 'Der Bestand entspricht bereits diesem Wert.');
    }
    return moveStock(conn, { product_id: Number(req.params.id), delta, type, reference, note, user_id: req.user.id, strict: true });
  });
  await audit(req, 'stock-' + type, 'product', req.params.id, `Menge ${qty}`);
  res.status(201).json({ stock_qty: balance });
}));

products.use(crudRouter({
  table: 'products', entity: 'product', perm: 'inventory',
  fields: { sku: 's', name: 's', description: 's', unit: 's', sale_price: 'n', purchase_price: 'n', vat_rate: 'n',
    is_stock_item: 'b', min_stock: 'n', location: 's', active: 'b' },
  required: ['sku', 'name'], search: ['sku', 'name', 'description'], orderBy: 'sku',
}));
