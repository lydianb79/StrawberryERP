// Läuft zuletzt: schliesst das laufende Geschäftsjahr ab und öffnet es am Ende wieder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admin, makeCustomer, makeProduct, item, currentYear, today, near } from './helpers.js';

test('Jahresabschluss: sperren, vortragen, wieder öffnen', async () => {
  const a = await admin();
  const c = await makeCustomer(a), p = await makeProduct(a, { is_stock_item: false, sale_price: 500 });
  const open = await a.post(`/documents/${(await a.post('/documents', { type: 'invoice', customer_id: c.id, items: [item(p)] })).id}/issue`);
  const draft = await a.post('/documents', { type: 'invoice', customer_id: c.id, items: [item(p)] });
  const entry = { date: today(), text: 'Nach Abschluss', lines: [{ account: '1000', debit: 10 }, { account: '1020', credit: 10 }] };

  const year = await currentYear(a);
  const before = await a.get(`/accounting/balance-sheet?year_id=${year.id}`);
  const income = await a.get(`/accounting/income-statement?year_id=${year.id}`);
  const preview = await a.get(`/accounting/fiscal-years/${year.id}/close-preview`);
  near(preview.result, income.result);
  assert.equal(preview.balanced, true);
  assert.ok(preview.draftInvoices >= 1, 'Vorschau warnt vor Rechnungsentwürfen');

  const result = await a.post(`/accounting/fiscal-years/${year.id}/close`);
  near(result.profit, income.result, 'Jahresergebnis');
  await a.fails(400, 'POST', `/accounting/fiscal-years/${year.id}/close`);

  // Das abgeschlossene Jahr ist gesperrt
  await a.fails(400, 'POST', '/accounting/journal', entry);
  await a.fails(400, 'POST', `/documents/${draft.id}/issue`);
  await a.fails(400, 'POST', `/documents/${open.id}/payments`, { amount: 10 });
  await a.fails(400, 'POST', `/documents/${open.id}/cancel`);

  // Bilanz des abgeschlossenen Jahres: Ergebnis steht im Eigenkapital, Erfolgsrechnung bleibt lesbar
  const closed = await a.get(`/accounting/balance-sheet?year_id=${year.id}`);
  near(closed.openResult, 0);
  near(closed.totalAssets, before.totalAssets);
  near(closed.totalAssets, closed.totalLiabilitiesEquity);
  near((await a.get(`/accounting/income-statement?year_id=${year.id}`)).result, income.result);

  // Folgejahr: Eröffnungsbilanz entspricht der Schlussbilanz, Ergebnis im Gewinnvortrag
  const years = await a.get('/accounting/fiscal-years');
  const next = years.find((y) => y.id === result.nextYearId);
  assert.equal(next.status, 'open');
  assert.ok(next.start_date > year.end_date);
  const opening = await a.get(`/accounting/balance-sheet?year_id=${next.id}`);
  near(opening.totalAssets, closed.totalAssets, 'Aktiven vorgetragen');
  near(opening.totalLiabilitiesEquity, closed.totalLiabilitiesEquity, 'Passiven vorgetragen');
  near(opening.openResult, 0);
  const sum = (list, numbers) => list.filter((r) => numbers.includes(r.number)).reduce((s, r) => s + r.amount, 0);
  near(sum(opening.equity, ['2970', '2979']), sum(closed.equity, ['2970', '2979']), 'Ergebnis in den Gewinnvortrag umgebucht');
  assert.equal(opening.equity.some((r) => r.number === '2979'), false);
  // Offene Posten laufen weiter
  assert.ok((await a.get('/reports/receivables')).some((r) => r.id === open.id));

  // Wieder öffnen stellt den Ausgangszustand her
  await a.post(`/accounting/fiscal-years/${year.id}/reopen`);
  await a.fails(400, 'POST', `/accounting/fiscal-years/${year.id}/reopen`);
  const reopened = await a.get(`/accounting/balance-sheet?year_id=${year.id}`);
  near(reopened.openResult, before.openResult);
  near(reopened.totalAssets, before.totalAssets);
  assert.equal((await a.get('/accounting/fiscal-years')).find((y) => y.id === next.id).entry_count, 0, 'Eröffnungsbuchung entfernt');
  const { id } = await a.post('/accounting/journal', entry);
  await a.del(`/accounting/journal/${id}`);
  assert.equal((await a.post(`/documents/${draft.id}/issue`)).status, 'open');
});

test('Geschäftsjahre dürfen sich nicht überschneiden', async () => {
  const a = await admin();
  const year = await currentYear(a);
  await a.fails(400, 'POST', '/accounting/fiscal-years', { name: 'Überlappung', start_date: year.start_date, end_date: year.end_date });
  await a.fails(400, 'POST', '/accounting/fiscal-years', { name: 'Verkehrt', start_date: '2090-12-31', end_date: '2090-01-01' });
});
