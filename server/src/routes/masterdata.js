import { Router } from 'express';
import { q, tx } from '../db.js';
import { can, audit } from '../auth.js';
import { HttpError, h } from '../util.js';
import { crudRouter } from '../crud.js';
import { partnerNumber } from '../services/numbering.js';
import { moveStock, defaultWarehouse } from '../services/stock.js';
import { today } from '../util.js';

const partnerFields = {
  number: 's', company: 's', contact_name: 's', email: 's', phone: 's', street: 's', zip: 's', city: 's',
  country: 's', vat_no: 's', payment_terms_days: 'n', notes: 's', active: 'b', currency: 's', language: 's',
};
const partnerSearch = ['company', 'number', 'contact_name', 'city', 'email'];

export const customers = crudRouter({
  table: 'customers', entity: 'customer', perm: 'customers', fields: { ...partnerFields, discount_pct: 'n' }, required: ['company'],
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
  const where = [], params = [];
  if (req.query.product_id) { where.push('m.product_id = ?'); params.push(req.query.product_id); }
  if (req.query.warehouse_id) { where.push('m.warehouse_id = ?'); params.push(req.query.warehouse_id); }
  if (req.query.batch) { where.push('m.batch = ?'); params.push(req.query.batch); }
  res.json(await q(
    `SELECT m.*, p.sku, p.name AS product_name, p.unit, u.name AS user_name, w.code AS warehouse_code
       FROM stock_movements m JOIN products p ON p.id = m.product_id LEFT JOIN users u ON u.id = m.user_id
       LEFT JOIN warehouses w ON w.id = m.warehouse_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY m.id DESC LIMIT 500`, params));
}));

products.post('/:id/movements', can('inventory.write'), h(async (req, res) => {
  const { type, reference, note, batch, unit_cost, expiry } = req.body || {};
  const qty = Number(req.body?.qty);
  if (!['in', 'out', 'adjust'].includes(type)) throw new HttpError(400, 'Ungültige Bewegungsart');
  if (!Number.isFinite(qty) || (type !== 'adjust' && qty <= 0)) throw new HttpError(400, 'Bitte eine gültige Menge angeben.');
  const balance = await tx(async (conn) => {
    const warehouse_id = req.body?.warehouse_id ? Number(req.body.warehouse_id) : await defaultWarehouse(conn);
    let delta = type === 'in' ? qty : -qty;
    if (type === 'adjust') {
      // Inventurkorrektur: qty ist der neue Soll-Bestand
      const [p] = await q('SELECT id FROM products WHERE id = ? FOR UPDATE', [req.params.id], conn);
      if (!p) throw new HttpError(404, 'Artikel nicht gefunden');
      if (qty < 0) throw new HttpError(400, 'Der Bestand darf nicht negativ sein.');
      // Korrektur bezieht sich auf den Bestand am gewählten Lagerort (bzw. der gewählten Charge)
      const [cur] = batch
        ? await q('SELECT qty FROM product_batches WHERE product_id = ? AND warehouse_id = ? AND batch = ?', [req.params.id, warehouse_id, batch], conn)
        : await q('SELECT qty FROM product_stock WHERE product_id = ? AND warehouse_id = ?', [req.params.id, warehouse_id], conn);
      delta = Math.round((qty - (cur?.qty ?? 0)) * 1000) / 1000;
      if (!delta) throw new HttpError(400, 'Der Bestand entspricht bereits diesem Wert.');
    }
    return moveStock(conn, { product_id: Number(req.params.id), delta, type, reference, note, user_id: req.user.id, strict: type !== 'adjust' || !!batch || delta > 0,
      warehouse_id, batch, unit_cost: type === 'in' ? unit_cost : null, expiry });
  });
  await audit(req, 'stock-' + type, 'product', req.params.id, `Menge ${qty}`);
  res.status(201).json({ stock_qty: balance });
}));

products.use(crudRouter({
  table: 'products', entity: 'product', perm: 'inventory',
  fields: { sku: 's', name: 's', description: 's', unit: 's', sale_price: 'n', purchase_price: 'n', vat_rate: 'n',
    is_stock_item: 'b', min_stock: 'n', location: 's', active: 'b', revenue_account_id: 'i', supplier_id: 'i', tracking: 's' },
  required: ['sku', 'name'], search: ['sku', 'name', 'description'], orderBy: 'sku',
  validate: (data) => { if (data.tracking !== undefined && !['none', 'batch', 'serial'].includes(data.tracking)) data.tracking = 'none'; },
}));

// ---------- Währungen & Kostenstellen ----------
export const currencies = crudRouter({
  table: 'currencies', entity: 'currency', perm: 'admin.settings', readPerm: null,
  fields: { code: 's', name: 's', rate: 'n', active: 'b' }, required: ['code', 'name'], orderBy: 'code',
  validate: (data) => {
    if (data.code !== undefined) {
      data.code = String(data.code).toUpperCase();
      if (!/^[A-Z]{3}$/.test(data.code)) throw new HttpError(400, 'Der Währungscode besteht aus drei Buchstaben (z.B. EUR).');
    }
    if (data.rate !== undefined && !(data.rate > 0)) throw new HttpError(400, 'Der Kurs muss grösser als 0 sein.');
  },
  // Jede Kursänderung wird mit Datum festgehalten (Kurshistorie)
  afterSave: (row) => q('INSERT INTO currency_rates (code, date, rate, source) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE rate = VALUES(rate), source = VALUES(source)',
    [row.code, today(), row.rate, 'manuell']),
});

export const costCenters = crudRouter({
  table: 'cost_centers', entity: 'cost_center', perm: 'accounting',
  fields: { code: 's', name: 's', active: 'b' }, required: ['code', 'name'], search: ['code', 'name'], orderBy: 'code',
});

export const warehouses = crudRouter({
  table: 'warehouses', entity: 'warehouse', perm: 'inventory',
  fields: { code: 's', name: 's', active: 'b' }, required: ['code', 'name'], search: ['code', 'name'], orderBy: 'id',
});
