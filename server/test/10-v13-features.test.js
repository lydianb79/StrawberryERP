// Tests für Version 1.3: Zahlungsdateien, Gutschrift-Storno, Abo-Vorlagen, Verzugszins, Sammelmahnung, Projekte/Zeit,
// Lagerorte/Chargen/Inventur/Durchschnittspreis, Kontakte, Bankabstimmung, Treuhänder-Export, Lohn, grosse Listen, Kurshistorie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { XMLParser } from 'fast-xml-parser';
import { admin, login, makeCustomer, makeSupplier, makeProduct, item, accountId, balances, delta, near, stockOf, assertBalanced, assertNoChange,
  currentYear, today, uniq } from './helpers.js';

const isPdf = (r) => r.type.includes('application/pdf') && r.data.subarray(0, 5).toString() === '%PDF-';
const issued = async (a, c, items, extra = {}) =>
  a.post(`/documents/${(await a.post('/documents', { type: 'invoice', customer_id: c.id, items, ...extra })).id}/issue`);
const daysAgo = (n) => { const d = new Date(Date.now() - n * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const xml = (s) => new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', parseTagValue: false }).parse(s);

test('Zahlungsdatei pain.001 für Lieferantenrechnungen', async () => {
  const a = await admin();
  await a.put('/settings/company', { iban: 'CH93 0076 2011 6238 5295 7', name: 'Testfirma & Söhne AG' });
  const good = await makeSupplier(a, { company: 'Müller & Co <Zürich>', iban: 'CH56 0483 5012 3456 7800 9' });
  const noIban = await makeSupplier(a);
  const acc = await accountId(a, '6500');
  const b1 = await a.post('/payables', { supplier_id: good.id, number: uniq('P'), expense_account_id: acc, net: 100, vat: 8.1 });
  const b2 = await a.post('/payables', { supplier_id: good.id, number: uniq('P'), expense_account_id: acc, net: 250, vat: 0 });
  const b3 = await a.post('/payables', { supplier_id: noIban.id, number: uniq('P'), expense_account_id: acc, net: 10, vat: 0 });
  await a.fails(400, 'POST', '/payables-payment-file', { invoice_ids: [] });
  assert.match(await a.fails(400, 'POST', '/payables-payment-file', { invoice_ids: [b3.id] }), /IBAN/);

  const file = await a.post('/payables-payment-file', { invoice_ids: [b1.id, b2.id], date: '2030-01-15' });
  assert.equal(file.count, 2);
  near(file.total, 358.1);
  const doc = xml(file.xml).Document;
  assert.equal(doc['@xmlns'], 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.09');
  const init = doc.CstmrCdtTrfInitn;
  assert.equal(init.GrpHdr.NbOfTxs, '2');
  assert.equal(init.GrpHdr.CtrlSum, '358.10');
  assert.equal(init.PmtInf.DbtrAcct.Id.IBAN, 'CH9300762011623852957');
  assert.equal(init.PmtInf.ReqdExctnDt.Dt, '2030-01-15');
  const txs = init.PmtInf.CdtTrfTxInf;
  assert.deepEqual(txs.map((t) => t.Amt.InstdAmt['#text']), ['108.10', '250.00']);
  assert.equal(txs[0].CdtrAcct.Id.IBAN, 'CH5604835012345678009');
  assert.equal(txs[0].Cdtr.Nm, 'Mueller Co Zuerich', 'Sonderzeichen werden für die Bank bereinigt');
  assert.ok(txs[0].RmtInf.Ustrd.includes(b1.number));
  assert.ok((await a.get(`/payables/${b1.id}`)).payment_exported_at, 'Export wird an der Rechnung vermerkt');
  assert.equal((await a.get(`/payables/${b1.id}`)).status, 'open', 'die Datei bucht noch keine Zahlung');
  // Bezahlte Rechnungen kommen nicht in eine Zahlungsdatei
  await a.post(`/payables/${b2.id}/payments`, { amount: 250 });
  await a.fails(400, 'POST', '/payables-payment-file', { invoice_ids: [b2.id] });
});

test('Gutschrift stornieren nimmt Buchung, Lager und Verrechnung zurück', async () => {
  const a = await admin();
  const c = await makeCustomer(a), p = await makeProduct(a, { stock: 10 });
  const inv = await issued(a, c, [item(p, 4)]);
  const before = await balances(a);
  const draft = await a.post(`/documents/${inv.id}/convert`, { to: 'credit' });
  const credit = await a.post(`/documents/${draft.id}/issue`);
  assert.equal(await stockOf(a, p.id), 10);
  assert.equal((await a.get(`/documents/${inv.id}`)).status, 'paid');

  const cancelled = await a.post(`/documents/${credit.id}/cancel`);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(await stockOf(a, p.id), 6, 'Wiedereinlagerung rückgängig');
  const again = await a.get(`/documents/${inv.id}`);
  assert.equal(again.status, 'open');
  near(again.open_amount, inv.total);
  assert.ok(again.payments[0].reversed_at, 'Verrechnung bleibt als storniert sichtbar');
  assertNoChange(before, await balances(a), 'Gutschrift und Storno heben sich auf');
  await a.fails(400, 'POST', `/documents/${credit.id}/cancel`);

  // Mit Auszahlung: erst die Auszahlung stornieren
  await a.post(`/documents/${inv.id}/payments`, { amount: inv.total });
  const c2 = await a.post(`/documents/${(await a.post(`/documents/${inv.id}/convert`, { to: 'credit' })).id}/issue`, { restock: false });
  const refunded = await a.post(`/documents/${c2.id}/payments`, { amount: 100 });
  await a.fails(400, 'POST', `/documents/${c2.id}/cancel`);
  await a.del(`/documents/payments/${refunded.payments[0].id}`);
  assert.equal((await a.post(`/documents/${c2.id}/cancel`)).status, 'cancelled');
  await assertBalanced(a);
});

test('Abo-Vorlage: Positionen und Texte direkt bearbeiten', async () => {
  const a = await admin();
  const c = await makeCustomer(a), p = await makeProduct(a, { is_stock_item: false, sale_price: 100 });
  const inv = await issued(a, c, [item(p, 1)]);
  const { id } = await a.post('/recurring', { invoice_id: inv.id, name: uniq('Abo'), period: 'monthly', next_date: daysAgo(1) });
  const tpl = await a.get(`/recurring/${id}`);
  assert.equal(tpl.template.items.length, 1);
  await a.fails(400, 'PUT', `/recurring/${id}`, { ...tpl, items: [] });
  await a.put(`/recurring/${id}`, { name: tpl.name, period: 'quarterly', next_date: daysAgo(1), active: true, auto_issue: false, reference: 'Neu',
    items: [{ description: 'Wartung Basis', qty: 2, unit: 'Mt', unit_price: 150, vat_rate: 8.1 }, { description: 'Zusatz', qty: 1, unit_price: 50, vat_rate: 8.1 }] });
  const run = await a.post('/recurring/run', { id });
  const created = await a.get(`/documents/${run.created[0].document_id}`);
  assert.equal(created.status, 'draft');
  assert.equal(created.reference, 'Neu');
  near(created.subtotal, 350);
  assert.deepEqual(created.items.map((i) => i.description), ['Wartung Basis', 'Zusatz']);
  const next = (await a.get('/recurring')).find((r) => r.id === id);
  assert.equal(next.period, 'quarterly');
  near(next.total, 378.35);
});

test('Mahnwesen: Verzugszins und Sammelmahnung', async () => {
  const a = await admin();
  const c = await makeCustomer(a, { email: 'kunde@example.com' }), p = await makeProduct(a, { is_stock_item: false, sale_price: 1000 });
  const i1 = await issued(a, c, [item(p, 1)], { date: daysAgo(120), due_date: daysAgo(73) });   // 1081, 73 Tage überfällig
  const i2 = await issued(a, c, [item(p, 2)], { date: daysAgo(60), due_date: daysAgo(30) });
  const settings = (await a.get('/settings')).dunning;
  const original = structuredClone(settings);
  // Zins schon auf der ersten Stufe, keine Wartefrist
  settings.interestRate = 5;
  settings.levels.forEach((l) => { l.days = 0; l.interest = true; l.fee = 0; });
  await a.put('/settings/dunning', settings);
  const before = await balances(a);
  const prop = (await a.get('/dunning/proposals')).find((x) => x.id === i1.id);
  near(prop.next_interest, 10.81, '1081 × 5 % × 73/365');
  const [n] = await a.post('/dunning/run', { invoice_ids: [i1.id] });
  near(n.interest, 10.81);
  const now = await balances(a);
  near(delta(before, now, '1100'), 10.81, 'Zins als Forderung');
  near(delta(before, now, '6950'), -10.81, 'Zins als Finanzertrag');
  near((await a.get(`/documents/${i1.id}`)).open_amount, 1091.81);
  assert.ok(isPdf(await a.req('GET', `/dunning/${n.id}/pdf`)));
  // Zweite Stufe am selben Tag: kein weiterer Zins (0 Tage seit der letzten Mahnung)
  const [n2] = await a.post('/dunning/run', { invoice_ids: [i1.id] });
  assert.equal(n2.interest, 0);

  const list = await a.get('/dunning-collective');
  const row = list.find((x) => x.id === c.id);
  assert.equal(row.invoices, 2);
  near(row.base_open, 1091.81 + 2162);
  assert.ok(isPdf(await a.req('GET', `/dunning-collective/${c.id}/pdf`)));
  const mail = await a.get(`/dunning-collective/${c.id}/mail`);
  assert.equal(mail.to, 'kunde@example.com');
  const other = await makeCustomer(a);
  await a.fails(400, 'GET', `/dunning-collective/${other.id}/pdf`);
  await a.put('/settings/dunning', original);
  for (const inv of [i1, i2]) await a.post(`/documents/${inv.id}/payments`, { amount: (await a.get(`/documents/${inv.id}`)).open_amount });
  await assertBalanced(a);
});

test('Projekte und Zeiterfassung: erfassen, auswerten, verrechnen', async () => {
  const a = await admin();
  const c = await makeCustomer(a);
  const project = await a.post('/projects', { name: uniq('Projekt'), customer_id: c.id, hourly_rate: 150, status: 'open' });
  assert.match(project.number, /^P-\d{4}$/);
  await a.fails(400, 'POST', '/time-entries', { project_id: project.id, hours: 0 });
  await a.fails(400, 'POST', '/time-entries', { project_id: project.id, hours: 25 });
  const e1 = await a.post('/time-entries', { project_id: project.id, date: daysAgo(2), hours: 2.5, description: 'Analyse' });
  await a.post('/time-entries', { project_id: project.id, date: daysAgo(1), hours: 4, description: 'Umsetzung' });
  await a.post('/time-entries', { project_id: project.id, date: daysAgo(1), hours: 1, description: 'Intern', billable: false });
  let ov = (await a.get('/project-overview')).find((x) => x.id === project.id);
  assert.equal(ov.hours, 7.5);
  assert.equal(ov.open_hours, 6.5);
  near(ov.open_amount, 975);

  const { document_id } = await a.post(`/projects/${project.id}/invoice`);
  const inv = await a.get(`/documents/${document_id}`);
  assert.equal(inv.status, 'draft');
  assert.equal(inv.items.length, 2, 'nur verrechenbare Stunden');
  near(inv.subtotal, 975);
  assert.ok(inv.items[0].description.includes('Analyse'));
  await a.fails(400, 'POST', `/projects/${project.id}/invoice`);
  await a.fails(400, 'PUT', `/time-entries/${e1.id}`, { project_id: project.id, hours: 3 });
  ov = (await a.get('/project-overview')).find((x) => x.id === project.id);
  assert.equal(ov.open_hours, 0);
  near(ov.invoiced_amount, 975);
  // Entwurf löschen gibt die Stunden wieder frei
  await a.del(`/documents/${document_id}`);
  assert.equal((await a.get('/project-overview')).find((x) => x.id === project.id).open_hours, 6.5);

  // Mitarbeitende ohne Projektrecht sehen und ändern nur die eigenen Zeiten
  const role = await a.post('/roles', { name: uniq('Zeit'), permissions: ['time.write'] });
  const email = `${uniq('zeit')}@example.com`;
  await a.post('/users', { name: 'Zoe Zeit', email, password: 'ein-langes-testpasswort', role_id: role.id });
  const u = await login(email, 'ein-langes-testpasswort');
  await u.post('/time-entries', { project_id: project.id, hours: 1, rate: 999 });
  const mine = await u.get('/time-entries');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].rate, 150, 'eigener Stundensatz kann nicht gesetzt werden');
  await u.fails(403, 'PUT', `/time-entries/${e1.id}`, { project_id: project.id, hours: 9 });
  await u.fails(403, 'GET', '/project-overview');
  await a.put(`/projects/${project.id}`, { status: 'closed' });
  await u.fails(400, 'POST', '/time-entries', { project_id: project.id, hours: 1 });
});

test('Lager: mehrere Lagerorte und Umlagerung', async () => {
  const a = await admin();
  const main = (await a.get('/warehouses'))[0];
  const second = await a.post('/warehouses', { code: uniq('W').slice(0, 12), name: 'Aussenlager', active: true });
  const p = await makeProduct(a, { stock: 10 });
  await a.post(`/products/${p.id}/movements`, { type: 'in', qty: 5, warehouse_id: second.id });
  assert.equal(await stockOf(a, p.id), 15, 'Gesamtbestand über alle Lagerorte');
  let s = await a.get(`/inventory/stock?product_id=${p.id}`);
  assert.equal(s.warehouses.find((w) => w.id === main.id).qty, 10);
  assert.equal(s.warehouses.find((w) => w.id === second.id).qty, 5);
  await a.fails(400, 'POST', `/products/${p.id}/movements`, { type: 'out', qty: 6, warehouse_id: second.id });
  await a.fails(400, 'POST', '/inventory/transfer', { product_id: p.id, from: main.id, to: main.id, qty: 1 });
  await a.fails(400, 'POST', '/inventory/transfer', { product_id: p.id, from: second.id, to: main.id, qty: 9 });
  await a.post('/inventory/transfer', { product_id: p.id, from: main.id, to: second.id, qty: 4 });
  s = await a.get(`/inventory/stock?product_id=${p.id}`);
  assert.deepEqual([s.warehouses.find((w) => w.id === main.id).qty, s.warehouses.find((w) => w.id === second.id).qty], [6, 9]);
  assert.equal(await stockOf(a, p.id), 15, 'Umlagerung ändert den Gesamtbestand nicht');
  // Inventurkorrektur wirkt auf den gewählten Lagerort
  await a.post(`/products/${p.id}/movements`, { type: 'adjust', qty: 7, warehouse_id: second.id });
  assert.equal(await stockOf(a, p.id), 13);
});

test('Lager: Chargen mit FIFO-Entnahme und Rückverfolgung', async () => {
  const a = await admin();
  const c = await makeCustomer(a);
  const p = await makeProduct(a, { tracking: 'batch' });
  await a.fails(400, 'POST', `/products/${p.id}/movements`, { type: 'in', qty: 5 });
  await a.post(`/products/${p.id}/movements`, { type: 'in', qty: 5, batch: 'LOT-A', expiry: '2031-06-30' });
  await a.post(`/products/${p.id}/movements`, { type: 'in', qty: 5, batch: 'LOT-B' });
  // Rechnung über 7 Stück: älteste Charge zuerst
  await issued(a, c, [item(p, 7)]);
  const s = await a.get(`/inventory/stock?product_id=${p.id}`);
  assert.deepEqual(s.batches.map((b) => [b.batch, b.qty]), [['LOT-B', 3]]);
  const moves = await a.get(`/products/movements?product_id=${p.id}`);
  assert.deepEqual(moves.filter((m) => m.qty < 0).map((m) => [m.batch, m.qty]).sort(), [['LOT-A', -5], ['LOT-B', -2]]);
  assert.equal((await a.get(`/products/movements?batch=LOT-A`)).length, 2, 'Rückverfolgung über die Charge');
  await a.post(`/products/${p.id}/movements`, { type: 'out', qty: 1, batch: 'LOT-B' });
  await a.fails(400, 'POST', `/products/${p.id}/movements`, { type: 'out', qty: 5, batch: 'LOT-B' });
  assert.equal(await stockOf(a, p.id), 2);
});

test('Lager: gleitender Durchschnittspreis und Bewertungsmethode', async () => {
  const a = await admin();
  const s = await makeSupplier(a);
  const p = await makeProduct(a, { purchase_price: 10 });
  await a.post(`/products/${p.id}/movements`, { type: 'in', qty: 10, unit_cost: 10 });
  const po = await a.post('/documents', { type: 'purchase', supplier_id: s.id, items: [{ product_id: p.id, description: 'x', qty: 10, unit_price: 20, vat_rate: 0 }] });
  await a.post(`/documents/${po.id}/status`, { status: 'ordered' });
  await a.post(`/documents/${po.id}/receive`);
  const prod = await a.get(`/products/${p.id}`);
  assert.equal(prod.purchase_price, 20, 'letzter Einstandspreis');
  assert.equal(prod.avg_cost, 15, 'Durchschnitt aus 10 × 10 und 10 × 20');
  const value = async () => (await a.get('/reports/stock')).find((x) => x.id === p.id).stock_value;
  await a.put('/settings/company', { stock_valuation: 'last' });
  near(await value(), 400);
  await a.put('/settings/company', { stock_valuation: 'average' });
  near(await value(), 300);
  assert.equal((await a.get('/closing/stock')).method, 'average');
  await a.put('/settings/company', { stock_valuation: 'last' });
});

test('Lager: geführte Inventur bucht nur die Differenzen', async () => {
  const a = await admin();
  const wh = await a.post('/warehouses', { code: uniq('I').slice(0, 12), name: 'Inventurlager', active: true });
  const p1 = await makeProduct(a), p2 = await makeProduct(a), p3 = await makeProduct(a);
  for (const [p, qty] of [[p1, 10], [p2, 5], [p3, 8]]) await a.post(`/products/${p.id}/movements`, { type: 'in', qty, warehouse_id: wh.id });
  const st = await a.post('/stocktakes', { warehouse_id: wh.id });
  assert.match(st.number, /^INV-\d{4}$/);
  await a.fails(400, 'POST', '/stocktakes', { warehouse_id: wh.id });
  const row = (p) => st.items.find((i) => i.product_id === p.id);
  assert.equal(row(p1).expected_qty, 10);
  await a.fails(400, 'POST', `/stocktakes/${st.id}/post`);
  // Bewegung während der Zählung: massgebend ist der Bestand beim Abschluss
  await a.post(`/products/${p2.id}/movements`, { type: 'out', qty: 1, warehouse_id: wh.id });
  const result = await a.post(`/stocktakes/${st.id}/post`, { items: [
    { id: row(p1).id, counted_qty: 9 }, { id: row(p2).id, counted_qty: 4 }, { id: row(p3).id, counted_qty: '' }] });
  assert.equal(result.counted, 2);
  assert.equal(result.corrections, 1, 'nur p1 weicht ab; p2 stimmt nach dem Abgang, p3 wurde nicht gezählt');
  assert.deepEqual([await stockOf(a, p1.id), await stockOf(a, p2.id), await stockOf(a, p3.id)], [9, 4, 8]);
  assert.equal((await a.get(`/stocktakes/${st.id}`)).status, 'posted');
  await a.fails(400, 'PUT', `/stocktakes/${st.id}`, { items: [] });
  await a.fails(400, 'DELETE', `/stocktakes/${st.id}`);
});

test('Kontakte, Notizen und Aufgaben', async () => {
  const a = await admin();
  const c = await makeCustomer(a);
  await a.fails(400, 'POST', '/contacts', { customer_id: c.id, name: '' });
  const { id } = await a.post('/contacts', { customer_id: c.id, name: 'Petra Muster', role: 'Einkauf', email: 'petra@example.com', is_primary: true });
  await a.post('/contacts', { customer_id: c.id, name: 'Anna Zweit' });
  assert.deepEqual((await a.get(`/contacts?customer_id=${c.id}`)).map((x) => x.name), ['Petra Muster', 'Anna Zweit']);
  await a.put(`/contacts/${id}`, { name: 'Petra Muster-Meier', role: 'Leitung Einkauf' });

  const quote = await a.post('/documents', { type: 'quote', customer_id: c.id, items: [{ description: 'x', qty: 1, unit_price: 1, vat_rate: 0 }] });
  await a.post('/crm', { document_id: quote.id, kind: 'note', text: 'Kunde wünscht Lieferung im März.' });
  const task = await a.post('/crm', { document_id: quote.id, kind: 'task', text: 'Nachfassen', due_date: today(), assigned_to: a.user.id });
  await a.fails(400, 'POST', '/crm', { customer_id: c.id, text: ' ' });
  assert.equal((await a.get(`/crm?document_id=${quote.id}`)).length, 2);
  assert.equal((await a.get(`/crm?customer_id=${c.id}`)).length, 2, 'Einträge zum Beleg erscheinen auch beim Kunden');
  assert.ok((await a.get('/crm?mine=1')).some((x) => x.id === task.id));
  await a.put(`/crm/${task.id}`, { done: true });
  assert.equal((await a.get('/crm?mine=1')).some((x) => x.id === task.id), false, 'erledigte Aufgaben verschwinden aus der Liste');
  await a.del(`/contacts/${id}`);
});

test('Bankabstimmung: Buchsaldo, offene Posten, Differenz', async () => {
  const a = await admin();
  const bank = await accountId(a, '1020');
  const date = today();
  const r0 = await a.get(`/reconcile?account_id=${bank}&date=${date}`);
  await a.post('/reconcile/mark', { line_ids: r0.lines.filter((l) => !l.reconciled_at).map((l) => l.id) });
  const r1 = await a.get(`/reconcile?account_id=${bank}&date=${date}`);
  near(r1.openItems, 0);
  near(r1.reconciledBalance, r1.bookBalance);
  // Neue Buchung auf dem Bankkonto, die die Bank noch nicht zeigt
  const text = uniq('Bankspesen');
  await a.post('/accounting/journal', { date, text, lines: [{ account: '6900', debit: 12.5 }, { account: '1020', credit: 12.5 }] });
  const r2 = await a.get(`/reconcile?account_id=${bank}&date=${date}`);
  near(r2.openItems, -12.5);
  near(r2.reconciledBalance, r1.bookBalance);
  const saved = await a.post('/reconcile', { account_id: bank, date, statement_balance: r1.bookBalance });
  near(saved.difference, 0, 'Auszug stimmt mit dem abgestimmten Saldo überein');
  near((await a.post('/reconcile', { account_id: bank, date, statement_balance: r1.bookBalance + 5 })).difference, 5);
  await a.post('/reconcile/mark', { line_ids: [r2.lines.find((l) => l.text === text).id] });
  near((await a.get(`/reconcile?account_id=${bank}&date=${date}`)).openItems, 0);
  await a.fails(400, 'POST', '/reconcile', { account_id: bank, date, statement_balance: '' });
  await a.fails(400, 'GET', `/reconcile?account_id=${await accountId(a, '3200')}`);

  const stmt = `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"><BkToCstmrStmt><Stmt><Acct><Id><IBAN>CH9300762011623852957</IBAN></Id></Acct>
    <Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="CHF">100.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-01-01</Dt></Dt></Bal>
    <Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="CHF">1234.55</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-01-31</Dt></Dt></Bal></Stmt></BkToCstmrStmt></Document>`;
  assert.deepEqual(await a.post('/reconcile/statement', { xml: stmt }), { balance: 1234.55, date: '2026-01-31', currency: 'CHF', iban: 'CH9300762011623852957' });
  await a.fails(400, 'POST', '/reconcile/statement', { xml: '<Document/>' });
});

test('Treuhänder-Export: Journal als CSV in zwei Formaten', async () => {
  const a = await admin();
  const year = await currentYear(a);
  const text = uniq('Exportprobe');
  await a.post('/accounting/journal', { date: today(), text, lines: [{ account: '1000', debit: 40 }, { account: '1020', credit: 40 }] });
  const lines = await a.req('GET', `/accounting-does-not-exist`);
  assert.equal(lines.status, 404);
  const rows = await a.req('GET', `/journal-export?year_id=${year.id}`);
  assert.ok(rows.type.includes('text/csv'));
  const csv = rows.data.toString('utf8');
  assert.ok(csv.startsWith('﻿Datum;Buchung;Text;Art;Konto'));
  const mine = csv.split('\r\n').filter((l) => l.includes(text));
  assert.equal(mine.length, 2, 'eine Zeile pro Konto');
  assert.ok(mine[0].includes(';1000;') && mine[0].includes(';40.00;0.00;'));
  const pairs = (await a.req('GET', `/journal-export?year_id=${year.id}&format=pairs`)).data.toString('utf8');
  const pair = pairs.split('\r\n').filter((l) => l.includes(text));
  assert.equal(pair.length, 1, 'einfache Buchung als eine Soll/Haben-Zeile');
  assert.ok(pair[0].includes(';1000;1020;40.00;'));
  // Summenprobe: Soll = Haben über den ganzen Export
  const sum = (col) => csv.split('\r\n').slice(1).filter(Boolean).reduce((s, l) => s + Number(l.split(';').at(col)), 0);
  near(sum(-3), sum(-2), 'Soll und Haben des Exports');
});

test('Lohn: Lauf rechnen, buchen, auszahlen, stornieren', async () => {
  const a = await admin();
  await a.put('/settings/company', { iban: 'CH93 0076 2011 6238 5295 7' });
  const period = `20${String(40 + Math.floor(Math.random() * 50))}-0${1 + Math.floor(Math.random() * 9)}`;
  const year = Number(period.slice(0, 4));
  await a.post('/accounting/fiscal-years', { name: uniq(String(year)), start_date: `${year}-01-01`, end_date: `${year}-12-31` });
  for (const e of await a.get('/employees')) await a.put(`/employees/${e.id}`, { active: false });
  await a.fails(400, 'POST', '/payroll', { period });
  await a.fails(400, 'POST', '/payroll', { period: '2026-13' });
  const anna = await a.post('/employees', { name: 'Anna Angestellt', street: 'Weg 1', zip: '8000', city: 'Zürich', monthly_gross: 6000,
    bvg_employee: 300, bvg_employer: 300, iban: 'CH56 0483 5012 3456 7800 9', active: true });
  assert.match(anna.number, /^M-\d{3}$/);
  await a.post('/employees', { name: 'Ex Mitarbeiter', monthly_gross: 5000, exit_date: `${year - 1}-12-31`, active: true });

  const run = await a.post('/payroll', { period });
  assert.equal(run.slips.length, 1, 'ausgetretene Personen werden nicht abgerechnet');
  const slip = run.slips[0];
  // 6000 × (5.3 + 1.1 + 1.2 + 0.5) % = 486, plus BVG 300
  near(slip.deduction_total, 786);
  near(slip.net, 5214);
  // Arbeitgeber: 6000 × (5.3 + 1.1 + 1.5 + 0.2 + 0.5 + 0.2) % = 528, plus BVG 300
  near(slip.employer_total, 828);
  await a.fails(400, 'POST', '/payroll', { period });

  const changed = await a.put(`/payslips/${slip.id}`, { bonus: 1000, expenses: 150 });
  near(changed.slips[0].gross, 7000);
  near(changed.slips[0].deduction_total, 867);            // 7000 × 8.1 % + 300
  near(changed.slips[0].net, 7000 - 867 + 150, 'Spesen sind nicht beitragspflichtig');
  assert.ok(isPdf(await a.req('GET', `/payslips/${slip.id}/pdf`)));
  await a.fails(400, 'POST', `/payroll/${run.id}/payment-file`);

  const b0 = await a.get(`/accounting/trial-balance?year_id=${(await a.get('/accounting/fiscal-years')).find((y) => y.start_date === `${year}-01-01`).id}`);
  assert.equal(b0.rows.length, 0);
  const posted = await a.post(`/payroll/${run.id}/post`);
  assert.equal(posted.status, 'posted');
  const yid = (await a.get('/accounting/fiscal-years')).find((y) => y.start_date === `${year}-01-01`).id;
  const bal = async () => new Map((await a.get(`/accounting/trial-balance?year_id=${yid}`)).rows.map((r) => [r.number, r.balance]));
  let b = await bal();
  near(b.get('5000'), 7150, 'Bruttolohn und Spesen');
  near(b.get('5700'), 916, 'Arbeitgeberbeiträge: 7000 × 8.8 % + 300');
  near(b.get('2270'), -(867 + 916), 'Verbindlichkeit gegenüber den Kassen');
  near(b.get('2275'), -6283, 'geschuldete Nettolöhne');
  await a.fails(400, 'PUT', `/payslips/${slip.id}`, { bonus: 0 });

  const file = await a.post(`/payroll/${run.id}/payment-file`, { date: `${year}-0${period.slice(6)}-25` });
  assert.equal(file.count, 1);
  near(file.total, 6283);
  assert.ok(file.xml.includes('<Cd>SALA</Cd>') && file.xml.includes('CH5604835012345678009'));

  assert.equal((await a.post(`/payroll/${run.id}/pay`, { date: run.date })).status, 'paid');
  b = await bal();
  near(b.get('2275') || 0, 0, 'Löhne ausbezahlt');
  near(b.get('1020'), -6283);
  // Storno setzt den Lauf zurück in den Entwurf; alle Buchungen sind aufgehoben
  assert.equal((await a.del(`/payroll/${run.id}`)).result, 'reopened');
  b = await bal();
  for (const acc of ['5000', '5700', '2270', '2275', '1020']) near(b.get(acc) || 0, 0, `Konto ${acc} nach Storno`);
  assert.equal((await a.del(`/payroll/${run.id}`)).result, 'deleted');

  // Lohndaten sind nur mit eigenem Recht sichtbar
  const role = (await a.get('/roles')).find((r) => r.name === 'Buchhaltung');
  const email = `${uniq('fibu')}@example.com`;
  await a.post('/users', { name: 'Fibu Person', email, password: 'ein-langes-testpasswort', role_id: role.id });
  const u = await login(email, 'ein-langes-testpasswort');
  await u.fails(403, 'GET', '/employees');
  await u.fails(403, 'GET', '/payroll');
});

test('Sehr grosse Listen: Blättern und Suchen auf dem Server', async () => {
  const a = await admin();
  const tag = uniq('Paging');
  for (let i = 0; i < 7; i++) await makeCustomer(a, { company: `${tag} ${String(i).padStart(2, '0')}` });
  const page0 = await a.get(`/customers?page=0&pageSize=3&q=${tag}`);
  assert.equal(page0.total, 7);
  assert.deepEqual(page0.rows.map((r) => r.company), [`${tag} 00`, `${tag} 01`, `${tag} 02`]);
  const page2 = await a.get(`/customers?page=2&pageSize=3&q=${tag}`);
  assert.deepEqual(page2.rows.map((r) => r.company), [`${tag} 06`]);
  assert.ok(Array.isArray(await a.get(`/customers?q=${tag}`)), 'ohne page bleibt die Antwort eine einfache Liste');
  assert.equal((await a.get(`/customers?page=0&pageSize=9999&q=${tag}`)).pageSize, 200, 'Seitengrösse ist begrenzt');

  const found = await a.get(`/reports/search?kind=customers&q=${tag} 03`);
  assert.deepEqual(found.map((r) => r.company), [`${tag} 03`]);
  const p = await makeProduct(a, { name: `${tag} Artikel` });
  await a.post('/prices', { product_id: p.id, min_qty: 5, price: 80 });
  const prod = await a.get(`/reports/search?kind=products&q=${tag}`);
  assert.equal(prod.length, 1);
  assert.deepEqual(prod[0].prices.map((x) => x.price), [80], 'Artikel bringen ihre Sonderpreise mit');
  assert.equal((await a.get(`/reports/search?kind=products&id=${p.id}`))[0].id, p.id);
  assert.ok((await a.get('/reports/search?kind=suppliers&q=')).length <= 30);
});

test('Kurshistorie: Kurs zum Belegdatum', async () => {
  const a = await admin();
  const eur = (await a.get('/currencies')).find((x) => x.code === 'EUR');
  await a.put(`/currencies/${eur.id}`, { rate: 0.91 });
  const history = await a.get('/currency-history?code=EUR');
  assert.equal(history[0].date, today());
  assert.equal(history[0].rate, 0.91);
  assert.equal(history[0].source, 'manuell');
  const c = await makeCustomer(a, { currency: 'EUR' });
  const line = [{ description: 'x', qty: 1, unit_price: 10, vat_rate: 0 }];
  assert.equal((await a.post('/documents', { type: 'quote', customer_id: c.id, items: line })).exchange_rate, 0.91);
  // Ein Beleg mit früherem Datum als der älteste Kurs erhält den aktuellen Kurs
  assert.equal((await a.post('/documents', { type: 'quote', customer_id: c.id, date: '2001-01-01', items: line })).exchange_rate, 0.91);
  await a.put(`/currencies/${eur.id}`, { rate: eur.rate });
  assert.equal((await a.get('/currency-history?code=EUR'))[0].rate, eur.rate, 'ein Eintrag pro Tag, der letzte gilt');
});
