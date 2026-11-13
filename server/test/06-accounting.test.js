import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admin, makeCustomer, makeProduct, item, accountId, balances, delta, near, currentYear, today, uniq, assertBalanced, assertNoChange } from './helpers.js';

test('manuelle Buchungen müssen ausgeglichen sein', async () => {
  const a = await admin();
  const date = today();
  await a.fails(400, 'POST', '/accounting/journal', { date, text: 'Schief', lines: [{ account: '1020', debit: 5 }, { account: '2800', credit: 4 }] });
  await a.fails(400, 'POST', '/accounting/journal', { date, text: 'Einzeilig', lines: [{ account: '1020', debit: 5 }] });
  await a.fails(400, 'POST', '/accounting/journal', { date, text: 'Unbekannt', lines: [{ account: '9999', debit: 5 }, { account: '2800', credit: 5 }] });
  await a.fails(400, 'POST', '/accounting/journal', { date: '1990-01-01', text: 'Kein Jahr', lines: [{ account: '1020', debit: 5 }, { account: '2800', credit: 5 }] });
  await a.fails(400, 'POST', '/accounting/journal', { date, text: '', lines: [{ account: '1020', debit: 5 }, { account: '2800', credit: 5 }] });
  const before = await balances(a);
  const { id } = await a.post('/accounting/journal', { date, text: 'Kapitaleinlage', lines: [{ account: '1020', debit: 1000 }, { account: '2800', credit: 1000 }] });
  near(delta(before, await balances(a), '1020'), 1000);
  await a.del(`/accounting/journal/${id}`);
  assertNoChange(before, await balances(a));
});

test('automatische Buchungen lassen sich nicht direkt löschen', async () => {
  const a = await admin();
  const c = await makeCustomer(a), p = await makeProduct(a, { is_stock_item: false });
  const inv = await a.post(`/documents/${(await a.post('/documents', { type: 'invoice', customer_id: c.id, items: [item(p)] })).id}/issue`);
  const year = await currentYear(a);
  const entry = (await a.get(`/accounting/journal?year_id=${year.id}`)).find((e) => e.ref_type === 'invoice' && e.ref_id === inv.id);
  assert.ok(entry, 'Rechnungsbuchung im Journal');
  await a.fails(400, 'DELETE', `/accounting/journal/${entry.id}`);
});

test('Erlöskonto pro Artikel und Kostenstelle des Belegs', async () => {
  const a = await admin();
  const cc = await a.post('/cost-centers', { code: uniq('K').slice(0, 18), name: 'Testprojekt', active: true });
  const c = await makeCustomer(a);
  const service = await makeProduct(a, { is_stock_item: false, sale_price: 200, revenue_account_id: await accountId(a, '3400') });
  const goods = await makeProduct(a, { is_stock_item: false, sale_price: 100 });
  const before = await balances(a);
  const year = await currentYear(a);
  const ccBefore = (await a.get(`/accounting/cost-center-report?year_id=${year.id}`)).rows.find((r) => r.id === cc.id);
  assert.equal(ccBefore, undefined);

  const draft = await a.post('/documents', { type: 'invoice', customer_id: c.id, cost_center_id: cc.id, items: [item(service), item(goods)] });
  const inv = await a.post(`/documents/${draft.id}/issue`);
  const now = await balances(a);
  near(delta(before, now, '3400'), -200, 'Dienstleistungserlös');
  near(delta(before, now, '3200'), -100, 'Standard-Erlöskonto');
  const row = (await a.get(`/accounting/cost-center-report?year_id=${year.id}`)).rows.find((r) => r.id === cc.id);
  near(row.revenue, 300); near(row.result, 300);

  // Storno spiegelt Konten und Kostenstelle
  await a.post(`/documents/${inv.id}/cancel`);
  assertNoChange(before, await balances(a));
  near((await a.get(`/accounting/cost-center-report?year_id=${year.id}`)).rows.find((r) => r.id === cc.id).revenue, 0);
  await assertBalanced(a);
});

test('Bilanz und Erfolgsrechnung stimmen überein', async () => {
  const a = await admin();
  const year = await currentYear(a);
  const bs = await a.get(`/accounting/balance-sheet?year_id=${year.id}`);
  const is = await a.get(`/accounting/income-statement?year_id=${year.id}`);
  near(bs.totalAssets, bs.totalLiabilitiesEquity);
  near(bs.openResult, is.result, 'laufendes Ergebnis der Bilanz = Ergebnis der Erfolgsrechnung');
  near(is.totalRevenue - is.totalExpense, is.result);
});

test('Reports liefern konsistente Summen', async () => {
  const a = await admin();
  const sales = await a.get('/reports/sales');
  near(sales.monthly.reduce((s, m) => s + m.net, 0), sales.totals.net, 'Monatssummen = Total');
  const open = await a.get('/reports/receivables');
  const dash = await a.get('/reports/dashboard');
  near(open.reduce((s, r) => s + r.base_open, 0), dash.finance.receivables.amount, 'Dashboard = Summe offene Posten');
  assert.ok(open.every((r) => ['current', 'd30', 'd60', 'd90'].includes(r.bucket)));
});
