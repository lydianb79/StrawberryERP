import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admin, makeCustomer, makeProduct, item, balances, delta, near, stockOf, assertBalanced, assertNoChange } from './helpers.js';

test('Offerte → Auftrag → Lieferung → Rechnung → Zahlung', async () => {
  const a = await admin();
  const c = await makeCustomer(a), p = await makeProduct(a, { stock: 10 });
  const before = await balances(a);

  const quote = await a.post('/documents', { type: 'quote', customer_id: c.id, items: [item(p, 2, { discount_pct: 10 })] });
  assert.match(quote.number, /^OF-\d{4}-\d{4}$/);
  near(quote.subtotal, 180); near(quote.vat_total, 14.58); near(quote.total, 194.58);
  assert.equal(quote.status, 'draft');
  assert.ok(quote.valid_until > quote.date, 'Gültigkeit wird vorbelegt');

  const order = await a.post(`/documents/${quote.id}/convert`, { to: 'order' });
  assert.equal(order.type, 'order');
  assert.equal(order.source.id, quote.id);
  assert.equal((await a.get(`/documents/${quote.id}`)).status, 'accepted');

  assert.equal((await a.post(`/documents/${order.id}/deliver`)).status, 'delivered');
  assert.equal(await stockOf(a, p.id), 8, 'Lagerabgang bei Lieferung');
  await a.fails(400, 'POST', `/documents/${order.id}/deliver`);

  const draft = await a.post(`/documents/${order.id}/convert`, { to: 'invoice' });
  assert.equal(draft.status, 'draft');
  assert.equal(draft.number, null, 'Rechnungsnummer erst beim Buchen');
  assert.equal((await a.get(`/documents/${order.id}`)).status, 'invoiced');
  assertNoChange(before, await balances(a), 'Entwurf bucht noch nichts');

  const invoice = await a.post(`/documents/${draft.id}/issue`);
  assert.match(invoice.number, /^RE-\d{4}-\d{4}$/);
  assert.equal(invoice.status, 'open');
  assert.equal(await stockOf(a, p.id), 8, 'kein doppelter Lagerabgang');
  let now = await balances(a);
  near(delta(before, now, '1100'), 194.58, 'Debitoren');
  near(delta(before, now, '3200'), -180, 'Erlös');
  near(delta(before, now, '2200'), -14.58, 'MwSt');

  await a.fails(400, 'PUT', `/documents/${invoice.id}`, { items: [] });
  await a.fails(400, 'DELETE', `/documents/${invoice.id}`);
  await a.fails(400, 'POST', `/documents/${invoice.id}/issue`);
  await a.fails(400, 'POST', `/documents/${invoice.id}/payments`, { amount: 500 });
  await a.fails(400, 'POST', `/documents/${invoice.id}/payments`, { amount: -5 });

  const partial = await a.post(`/documents/${invoice.id}/payments`, { amount: 100 });
  assert.equal(partial.status, 'partial');
  await a.fails(400, 'POST', `/documents/${invoice.id}/cancel`);
  const paid = await a.post(`/documents/${invoice.id}/payments`, { amount: 94.58 });
  assert.equal(paid.status, 'paid');
  now = await balances(a);
  near(delta(before, now, '1100'), 0, 'Debitor ausgeglichen');
  near(delta(before, now, '1020'), 194.58, 'Bank');

  const reopened = await a.del(`/documents/payments/${paid.payments.at(-1).id}`);
  assert.equal(reopened.status, 'partial');
  near(reopened.paid_amount, 100);
  near(delta(before, await balances(a), '1100'), 94.58, 'Debitor wieder offen');
  await assertBalanced(a);
});

test('Rechnungsnummern sind fortlaufend; Storno bucht alles zurück', async () => {
  const a = await admin();
  const c = await makeCustomer(a), p = await makeProduct(a, { stock: 5 });
  const mk = async () => a.post(`/documents/${(await a.post('/documents', { type: 'invoice', customer_id: c.id, items: [item(p, 2)] })).id}/issue`);
  const before = await balances(a);
  const first = await mk(), second = await mk();
  assert.equal(Number(second.number.slice(-4)), Number(first.number.slice(-4)) + 1);
  assert.equal(await stockOf(a, p.id), 1, 'direkte Rechnung bucht Lagerabgang');

  const cancelled = await a.post(`/documents/${second.id}/cancel`);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(await stockOf(a, p.id), 3, 'Storno bucht Lager zurück');
  const now = await balances(a);
  near(delta(before, now, '1100'), 216.2, 'nur die erste Rechnung bleibt offen');
  near(delta(before, now, '3200'), -200);
  await a.fails(400, 'POST', `/documents/${second.id}/payments`, { amount: 1 });
  await assertBalanced(a);
});

test('Rechnung ohne Positionen kann nicht gebucht werden; Entwurf ist löschbar', async () => {
  const a = await admin();
  const c = await makeCustomer(a);
  const empty = await a.post('/documents', { type: 'invoice', customer_id: c.id, items: [] });
  await a.fails(400, 'POST', `/documents/${empty.id}/issue`);
  await a.del(`/documents/${empty.id}`);
  await a.fails(404, 'GET', `/documents/${empty.id}`);
  await a.fails(400, 'POST', '/documents', { type: 'invoice', customer_id: 999999, items: [] });
});

test('gemischte MwSt-Sätze werden pro Satz gerechnet', async () => {
  const a = await admin();
  const c = await makeCustomer(a);
  const doc = await a.post('/documents', { type: 'quote', customer_id: c.id, items: [
    { description: 'Normalsatz', qty: 3, unit_price: 33.35, vat_rate: 8.1 },
    { description: 'Reduziert', qty: 1, unit_price: 58.5, vat_rate: 2.6 },
    { description: 'Befreit', qty: 1, unit_price: 10, vat_rate: 0 },
  ] });
  near(doc.subtotal, 168.55);
  assert.deepEqual(doc.vatLines.map((v) => [v.rate, v.vat]), [[8.1, 8.1], [2.6, 1.52]]);
  near(doc.total, 178.17);
});
