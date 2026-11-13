import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admin, makeSupplier, makeProduct, accountId, balances, delta, near, stockOf, assertBalanced, uniq, assertNoChange } from './helpers.js';

test('Bestellung → Wareneingang in Teilmengen → Lieferantenrechnung → Zahlung', async () => {
  const a = await admin();
  const s = await makeSupplier(a), p = await makeProduct(a, { purchase_price: 60 });
  const before = await balances(a);
  const po = await a.post('/documents', { type: 'purchase', supplier_id: s.id, due_date: '2030-01-15',
    items: [{ product_id: p.id, description: p.name, qty: 10, unit: 'Stk', unit_price: 50, vat_rate: 8.1 }] });
  assert.match(po.number, /^BE-\d{4}-\d{4}$/);
  assert.equal(po.status, 'draft');
  assert.equal(po.partner_name, s.company);
  near(po.total, 540.5);
  const itemId = po.items[0].id;

  await a.fails(400, 'POST', `/documents/${po.id}/receive`);
  await a.fails(400, 'POST', `/documents/${po.id}/bill`, { number: 'X', expense_account_id: await accountId(a, '4200') });
  assert.equal((await a.post(`/documents/${po.id}/status`, { status: 'ordered' })).status, 'ordered');
  await a.fails(400, 'PUT', `/documents/${po.id}`, { items: [] });

  const part = await a.post(`/documents/${po.id}/receive`, { items: [{ item_id: itemId, qty: 4 }] });
  assert.equal(part.status, 'partly');
  assert.equal(part.items[0].qty_received, 4);
  assert.equal(await stockOf(a, p.id), 4);
  await a.fails(400, 'POST', `/documents/${po.id}/receive`, { items: [{ item_id: itemId, qty: 7 }] });

  const full = await a.post(`/documents/${po.id}/receive`);
  assert.equal(full.status, 'received');
  assert.equal(await stockOf(a, p.id), 10);
  assert.equal((await a.get(`/products/${p.id}`)).purchase_price, 50, 'Einstandspreis nachgeführt');
  await a.fails(400, 'POST', `/documents/${po.id}/receive`);
  assertNoChange(before, await balances(a), 'Bestellung und Wareneingang buchen nichts in der Fibu');

  const billNo = uniq('LR');
  const withBill = await a.post(`/documents/${po.id}/bill`, { number: billNo, expense_account_id: await accountId(a, '4200') });
  assert.equal(withBill.bills.length, 1);
  const now = await balances(a);
  near(delta(before, now, '2000'), -540.5, 'Kreditor');
  near(delta(before, now, '4200'), 500, 'Aufwand');
  near(delta(before, now, '1170'), 40.5, 'Vorsteuer');

  const bill = (await a.get('/payables?open=1')).find((b) => b.number === billNo);
  assert.equal(bill.purchase_order_number, po.number);
  await a.fails(400, 'POST', `/payables/${bill.id}/payments`, { amount: 9999 });
  assert.equal((await a.post(`/payables/${bill.id}/payments`, { amount: 540.5 })).status, 'paid');
  near(delta(before, await balances(a), '2000'), 0);
  await a.fails(400, 'PUT', `/payables/${bill.id}`, { supplier_id: s.id, number: billNo, expense_account_id: bill.expense_account_id, net: 1, vat: 0 });
  await assertBalanced(a);
});

test('Bestellung: Storno und Abschluss mit Restmenge', async () => {
  const a = await admin();
  const s = await makeSupplier(a), p = await makeProduct(a);
  const mk = () => a.post('/documents', { type: 'purchase', supplier_id: s.id, items: [{ product_id: p.id, description: p.name, qty: 5, unit_price: 10, vat_rate: 8.1 }] });
  const one = await mk();
  await a.fails(400, 'POST', `/documents/${one.id}/status`, { status: 'received' });
  await a.post(`/documents/${one.id}/status`, { status: 'ordered' });
  assert.equal((await a.post(`/documents/${one.id}/status`, { status: 'cancelled' })).status, 'cancelled');
  await a.fails(400, 'POST', `/documents/${one.id}/receive`);

  const two = await mk();
  await a.post(`/documents/${two.id}/status`, { status: 'ordered' });
  await a.post(`/documents/${two.id}/receive`, { items: [{ item_id: two.items[0].id, qty: 2 }] });
  await a.fails(400, 'POST', `/documents/${two.id}/status`, { status: 'cancelled' });
  assert.equal((await a.post(`/documents/${two.id}/status`, { status: 'received' })).status, 'received');
  assert.equal(await stockOf(a, p.id), 2);
  const empty = await a.post('/documents', { type: 'purchase', supplier_id: s.id, items: [] });
  await a.fails(400, 'POST', `/documents/${empty.id}/status`, { status: 'ordered' });
});
