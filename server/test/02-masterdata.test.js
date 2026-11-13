import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admin, makeCustomer, makeProduct, item, uniq, stockOf } from './helpers.js';

test('Kunden erhalten fortlaufende Nummern', async () => {
  const a = await admin();
  const c1 = await makeCustomer(a), c2 = await makeCustomer(a);
  assert.match(c1.number, /^K-\d+$/);
  assert.equal(Number(c2.number.slice(2)), Number(c1.number.slice(2)) + 1);
  await a.fails(400, 'POST', '/customers', { company: '' });
});

test('doppelte Artikelnummern werden abgelehnt', async () => {
  const a = await admin();
  const p = await makeProduct(a);
  await a.fails(409, 'POST', '/products', { sku: p.sku, name: 'Doppelt' });
});

test('verwendete Stammdaten lassen sich nicht löschen', async () => {
  const a = await admin();
  const c = await makeCustomer(a), p = await makeProduct(a);
  await a.post('/documents', { type: 'quote', customer_id: c.id, items: [item(p)] });
  await a.fails(409, 'DELETE', `/customers/${c.id}`);
  await a.fails(409, 'DELETE', `/products/${p.id}`);
  const unused = await makeCustomer(a);
  await a.del(`/customers/${unused.id}`);
});

test('Lagerbuchungen: Eingang, Ausgang, Inventur', async () => {
  const a = await admin();
  const p = await makeProduct(a, { stock: 10 });
  await a.post(`/products/${p.id}/movements`, { type: 'out', qty: 3 });
  assert.equal(await stockOf(a, p.id), 7);
  await a.fails(400, 'POST', `/products/${p.id}/movements`, { type: 'out', qty: 99 });
  await a.post(`/products/${p.id}/movements`, { type: 'adjust', qty: 5 });
  assert.equal(await stockOf(a, p.id), 5);
  const moves = await a.get(`/products/movements?product_id=${p.id}`);
  assert.deepEqual(moves.map((m) => m.qty), [-2, -3, 10]);
  const service = await makeProduct(a, { is_stock_item: false });
  await a.fails(400, 'POST', `/products/${service.id}/movements`, { type: 'in', qty: 1 });
});

test('Währungen: Code und Kurs werden geprüft', async () => {
  const a = await admin();
  await a.fails(400, 'POST', '/currencies', { code: 'EURO', name: 'Falsch', rate: 1 });
  await a.fails(400, 'POST', '/currencies', { code: uniq('X').slice(0, 3), name: 'Null', rate: 0 });
});
