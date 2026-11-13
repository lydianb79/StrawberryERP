import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admin, makeCustomer, makeSupplier, accountId, balances, delta, near, assertBalanced, uniq } from './helpers.js';

const line = (amount) => [{ description: 'Leistung', qty: 1, unit_price: amount, vat_rate: 0 }];

test('Fremdwährungsrechnung: Buchung zum Belegkurs, Kursgewinn und -verlust bei Zahlung', async () => {
  const a = await admin();
  const c = await makeCustomer(a, { currency: 'EUR' });
  const before = await balances(a);
  const draft = await a.post('/documents', { type: 'invoice', customer_id: c.id, exchange_rate: 0.95, items: line(1000) });
  assert.equal(draft.currency, 'EUR', 'Währung des Kunden wird übernommen');
  const inv = await a.post(`/documents/${draft.id}/issue`);
  near(delta(before, await balances(a), '1100'), 950, 'Debitor in Basiswährung');

  await a.post(`/documents/${inv.id}/payments`, { amount: 400, exchange_rate: 1.0 });
  let now = await balances(a);
  near(delta(before, now, '1020'), 400, 'Bank zum Zahlungskurs');
  near(delta(before, now, '1100'), 570, 'Debitor zum Belegkurs ausgebucht');
  near(delta(before, now, '6990'), -20, 'Kursgewinn');

  const paid = await a.post(`/documents/${inv.id}/payments`, { amount: 600, exchange_rate: 0.9 });
  assert.equal(paid.status, 'paid');
  now = await balances(a);
  near(delta(before, now, '1020'), 940);
  near(delta(before, now, '1100'), 0, 'Debitor vollständig ausgeglichen');
  near(delta(before, now, '6940'), 30, 'Kursverlust');
  await assertBalanced(a);
});

test('Teilzahlungen in Fremdwährung hinterlassen keine Rundungsreste', async () => {
  const a = await admin();
  const c = await makeCustomer(a, { currency: 'EUR' });
  const before = await balances(a);
  const draft = await a.post('/documents', { type: 'invoice', customer_id: c.id, exchange_rate: 0.9512, items: line(333.33) });
  const inv = await a.post(`/documents/${draft.id}/issue`);
  for (const amount of [111.11, 111.11, 111.11]) await a.post(`/documents/${inv.id}/payments`, { amount });
  assert.equal((await a.get(`/documents/${inv.id}`)).status, 'paid');
  near(delta(before, await balances(a), '1100'), 0, 'Debitor exakt null');
  await assertBalanced(a);
});

test('ohne Kursangabe gilt der hinterlegte Kurs; unbekannte Währung wird abgelehnt', async () => {
  const a = await admin();
  const c = await makeCustomer(a);
  const eur = (await a.get('/currencies')).find((x) => x.code === 'EUR');
  const doc = await a.post('/documents', { type: 'quote', customer_id: c.id, currency: 'EUR', items: line(10) });
  assert.equal(doc.exchange_rate, eur.rate);
  const chf = await a.post('/documents', { type: 'quote', customer_id: c.id, items: line(10) });
  assert.equal(chf.currency, 'CHF');
  assert.equal(chf.exchange_rate, 1);
  await a.fails(400, 'POST', '/documents', { type: 'quote', customer_id: c.id, currency: 'XXX', items: line(10) });
});

test('Lieferantenrechnung in Fremdwährung mit Kursdifferenz', async () => {
  const a = await admin();
  const s = await makeSupplier(a, { currency: 'EUR' });
  const before = await balances(a);
  const bill = await a.post('/payables', { supplier_id: s.id, number: uniq('EU'), expense_account_id: await accountId(a, '6500'), net: 1000, vat: 0, exchange_rate: 0.95 });
  assert.equal(bill.currency, 'EUR');
  near(bill.base_total, 950);
  near(delta(before, await balances(a), '2000'), -950, 'Kreditor in Basiswährung');
  const paid = await a.post(`/payables/${bill.id}/payments`, { amount: 1000, exchange_rate: 0.9 });
  assert.equal(paid.status, 'paid');
  const now = await balances(a);
  near(delta(before, now, '2000'), 0);
  near(delta(before, now, '1020'), -900);
  near(delta(before, now, '6990'), -50, 'günstigerer Kurs = Kursgewinn');
  await assertBalanced(a);
});
