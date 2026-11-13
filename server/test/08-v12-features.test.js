// Tests für Version 1.2: Teillieferung/-rechnung, Gutschriften, Mahnwesen, Zahlungsabgleich, Abo-Rechnungen,
// Abschlussarbeiten, MwSt-Methoden, Storno statt Löschen, Belegablage, Preislisten, Sprachen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admin, makeCustomer, makeSupplier, makeProduct, item, accountId, balances, delta, near, stockOf, assertBalanced, assertNoChange,
  currentYear, today, uniq } from './helpers.js';

const isPdf = (r) => r.type.includes('application/pdf') && r.data.subarray(0, 5).toString() === '%PDF-';
const issued = async (a, c, items, extra = {}) =>
  a.post(`/documents/${(await a.post('/documents', { type: 'invoice', customer_id: c.id, items, ...extra })).id}/issue`);
const daysAgo = (n) => { const d = new Date(Date.now() - n * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

test('Auftrag: Teillieferung und Teilrechnung', async () => {
  const a = await admin();
  const c = await makeCustomer(a), p = await makeProduct(a, { stock: 20 });
  const order = await a.post('/documents', { type: 'order', customer_id: c.id, items: [item(p, 10)] });
  const it = order.items[0].id;

  const d1 = await a.post(`/documents/${order.id}/deliver`, { items: [{ item_id: it, qty: 4 }] });
  assert.equal(d1.status, 'partly');
  assert.equal(d1.items[0].qty_delivered, 4);
  assert.equal(await stockOf(a, p.id), 16);
  await a.fails(400, 'POST', `/documents/${order.id}/deliver`, { items: [{ item_id: it, qty: 7 }] });
  await a.fails(400, 'PUT', `/documents/${order.id}`, { items: [] });
  await a.fails(400, 'POST', `/documents/${order.id}/status`, { status: 'cancelled' });

  // Teilrechnung über 6 Stück: 4 sind geliefert, 2 werden dabei ausgeliefert
  const inv1 = await a.post(`/documents/${order.id}/convert`, { to: 'invoice', items: [{ item_id: it, qty: 6 }] });
  near(inv1.subtotal, 600);
  assert.equal(await stockOf(a, p.id), 14, 'verrechnete, noch nicht gelieferte Menge wird ausgeliefert');
  let o = await a.get(`/documents/${order.id}`);
  assert.equal(o.status, 'partly');
  assert.equal(o.items[0].qty_invoiced, 6);
  assert.equal(o.items[0].qty_delivered, 6);
  await a.fails(400, 'POST', `/documents/${order.id}/convert`, { to: 'invoice', items: [{ item_id: it, qty: 5 }] });

  await a.post(`/documents/${inv1.id}/issue`);
  assert.equal(await stockOf(a, p.id), 14, 'Rechnung aus Auftrag bucht kein zweites Mal aus');

  // Rest verrechnen, dann ist der Auftrag abgeschlossen
  const inv2 = await a.post(`/documents/${order.id}/convert`, { to: 'invoice' });
  near(inv2.subtotal, 400);
  o = await a.get(`/documents/${order.id}`);
  assert.equal(o.status, 'invoiced');
  assert.equal(await stockOf(a, p.id), 10);
  await a.fails(400, 'POST', `/documents/${order.id}/convert`, { to: 'invoice' });

  // Entwurf löschen gibt die Menge wieder zur Verrechnung frei
  await a.del(`/documents/${inv2.id}`);
  o = await a.get(`/documents/${order.id}`);
  assert.equal(o.status, 'delivered');
  assert.equal(o.items[0].qty_invoiced, 6);
});

test('Gutschrift: Teilgutschrift wird mit der offenen Rechnung verrechnet', async () => {
  const a = await admin();
  const c = await makeCustomer(a), p = await makeProduct(a, { stock: 10 });
  const before = await balances(a);
  const inv = await issued(a, c, [item(p, 5)]);      // 500 + 40.50 MwSt
  assert.equal(await stockOf(a, p.id), 5);

  const draft = await a.post(`/documents/${inv.id}/convert`, { to: 'credit' });
  assert.equal(draft.type, 'credit');
  assert.equal(draft.number, null);
  const edited = await a.put(`/documents/${draft.id}`, { items: [{ ...draft.items[0], qty: 2 }] });
  near(edited.total, 216.2);
  const credit = await a.post(`/documents/${draft.id}/issue`);
  assert.match(credit.number, /^GS-\d{4}-\d{4}$/);
  assert.equal(credit.status, 'paid', 'vollständig mit der Rechnung verrechnet');
  assert.equal(await stockOf(a, p.id), 7, 'Ware wieder eingelagert');

  const after = await a.get(`/documents/${inv.id}`);
  assert.equal(after.status, 'partial');
  near(after.open_amount, 324.3);
  assert.equal(after.payments.at(-1).credit_note_number, credit.number);
  const now = await balances(a);
  near(delta(before, now, '1100'), 324.3, 'Debitor um die Gutschrift reduziert');
  near(delta(before, now, '3200'), -300, 'Erlös netto');
  near(delta(before, now, '2200'), -24.3, 'MwSt netto');
  await a.fails(400, 'DELETE', `/documents/payments/${after.payments.at(-1).id}`);
  await a.fails(400, 'PUT', `/documents/${credit.id}`, { items: [] });

  // Rest bezahlen
  assert.equal((await a.post(`/documents/${inv.id}/payments`, { amount: 324.3 })).status, 'paid');
  near(delta(before, await balances(a), '1100'), 0);
  await assertBalanced(a);
});

test('Gutschrift zu bezahlter Rechnung bleibt als Guthaben offen und wird ausbezahlt', async () => {
  const a = await admin();
  const c = await makeCustomer(a), p = await makeProduct(a, { is_stock_item: false });
  const before = await balances(a);
  const inv = await issued(a, c, [item(p, 1)]);
  await a.post(`/documents/${inv.id}/payments`, { amount: 108.1 });
  const draft = await a.post(`/documents/${inv.id}/convert`, { to: 'credit' });
  const credit = await a.post(`/documents/${draft.id}/issue`, { restock: false });
  assert.equal(credit.status, 'open');
  near(credit.open_amount, 108.1);
  near(delta(before, await balances(a), '1100'), -108.1, 'Guthaben des Kunden');
  await a.fails(400, 'POST', `/documents/${credit.id}/payments`, { amount: 200 });
  assert.equal((await a.post(`/documents/${credit.id}/payments`, { amount: 108.1 })).status, 'paid');
  const now = await balances(a);
  near(delta(before, now, '1100'), 0);
  near(delta(before, now, '1020'), 0, 'Zahlungseingang und Auszahlung heben sich auf');
  near(delta(before, now, '3200'), 0);
  // Umsatzreport rechnet die Gutschrift ab
  await assertBalanced(a);
});

test('Mahnwesen: Stufen, Gebühren, PDF, Zahlung inkl. Gebühr', async () => {
  const a = await admin();
  const c = await makeCustomer(a), p = await makeProduct(a, { is_stock_item: false });
  const overdue = await issued(a, c, [item(p, 1)], { date: daysAgo(60), due_date: daysAgo(30) });
  const fresh = await issued(a, c, [item(p, 1)]);
  const before = await balances(a);

  let list = await a.get('/dunning/proposals');
  const prop = list.find((x) => x.id === overdue.id);
  assert.ok(prop && prop.eligible && prop.next_level === 1);
  assert.equal(list.some((x) => x.id === fresh.id), false, 'nicht fällige Rechnungen werden nicht gemahnt');
  await a.fails(400, 'POST', '/dunning/run', { invoice_ids: [fresh.id] });
  await a.fails(400, 'POST', '/dunning/run', { invoice_ids: [] });

  const [n1] = await a.post('/dunning/run', { invoice_ids: [overdue.id] });
  assert.equal(n1.level, 1);
  assert.equal(n1.fee, 0, 'Zahlungserinnerung ohne Gebühr');
  assertNoChange(before, await balances(a), 'Erinnerung ohne Gebühr bucht nichts');
  assert.ok(isPdf(await a.req('GET', `/dunning/${n1.id}/pdf`)));
  // Wartefrist bis zur nächsten Stufe
  await a.fails(400, 'POST', '/dunning/run', { invoice_ids: [overdue.id] });
  list = await a.get('/dunning/proposals');
  assert.equal(list.find((x) => x.id === overdue.id).eligible, false);

  // Wartefrist auf 0 setzen und 1. Mahnung mit Gebühr auslösen
  const settings = (await a.get('/settings')).dunning;
  settings.levels.forEach((l) => { l.days = 0; });
  await a.put('/settings/dunning', settings);
  const [n2] = await a.post('/dunning/run', { invoice_ids: [overdue.id] });
  assert.equal(n2.level, 2);
  assert.equal(n2.fee, 20);
  let now = await balances(a);
  near(delta(before, now, '1100'), 20, 'Mahngebühr als Forderung');
  near(delta(before, now, '3890'), -20, 'Mahngebühr als Ertrag');
  const doc = await a.get(`/documents/${overdue.id}`);
  near(doc.open_amount, 128.1);
  assert.equal(doc.dunning.length, 2);
  assert.ok(isPdf(await a.req('GET', `/dunning/${n2.id}/pdf`)));

  await a.fails(400, 'POST', `/documents/${overdue.id}/payments`, { amount: 130 });
  assert.equal((await a.post(`/documents/${overdue.id}/payments`, { amount: 108.1 })).status, 'partial', 'ohne Gebühr nicht ausgeglichen');
  assert.equal((await a.post(`/documents/${overdue.id}/payments`, { amount: 20 })).status, 'paid');
  now = await balances(a);
  near(delta(before, now, '1100'), -108.1, 'Rechnung und Gebühr bezahlt (Rechnung war vorher offen)');
  await a.put('/settings/dunning', { ...settings, levels: settings.levels.map((l) => ({ ...l, days: 10 })) });
  await assertBalanced(a);
});

const camt = (entries) => `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.04"><BkToCstmrDbtCdtNtfctn><Ntfctn><Acct><Id><IBAN>CH9300762011623852957</IBAN></Id></Acct>
<Ntry><Amt Ccy="CHF">${entries.reduce((s, e) => s + e.amount, 0).toFixed(2)}</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>${today()}</Dt></BookgDt>
<AcctSvcrRef>${uniq('ZV')}</AcctSvcrRef><NtryDtls>${entries.map((e) => `<TxDtls><Refs><AcctSvcrRef>${uniq('TX')}</AcctSvcrRef></Refs>
<Amt Ccy="CHF">${e.amount.toFixed(2)}</Amt><CdtDbtInd>CRDT</CdtDbtInd><RltdPties><Dbtr><Nm>${e.debtor || 'Kunde &amp; Co'}</Nm></Dbtr></RltdPties>
<RmtInf>${e.reference ? `<Strd><CdtrRefInf><Tp><CdOrPrtry><Prtry>SCOR</Prtry></CdOrPrtry></Tp><Ref>${e.reference}</Ref></CdtrRefInf></Strd>` : ''}${e.text ? `<Ustrd>${e.text}</Ustrd>` : ''}</RmtInf></TxDtls>`).join('')}</NtryDtls></Ntry>
<Ntry><Amt Ccy="CHF">50.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>${today()}</Dt></BookgDt></Ntry>
</Ntfctn></BkToCstmrDbtCdtNtfctn></Document>`;

test('Zahlungsabgleich: camt.054 einlesen, zuordnen, verbuchen, Duplikate erkennen', async () => {
  const a = await admin();
  await a.put('/settings/company', { iban: 'CH93 0076 2011 6238 5295 7' });
  const c = await makeCustomer(a), p = await makeProduct(a, { is_stock_item: false });
  const byRef = await issued(a, c, [item(p, 1)]);
  const byText = await issued(a, c, [item(p, 2)]);
  assert.match(byRef.payment_reference, /^RF/);
  const xml = camt([
    { amount: 108.1, reference: byRef.payment_reference.replace(/(.{4})/g, '$1 ').trim() },
    { amount: 100, text: `Zahlung ${byText.number} Teilbetrag` },
    { amount: 77.7, text: 'ohne Bezug' },
  ]);
  const raw = await fetch(`${process.env.TEST_BASE_URL}/api/banking/preview`, { method: 'POST', headers: { 'Content-Type': 'text/plain', Cookie: a.cookie }, body: xml });
  assert.equal(raw.status, 200);
  const { entries } = await raw.json();
  assert.equal(entries.length, 3, 'Belastungen werden ignoriert');
  assert.deepEqual(entries.map((e) => e.state), ['match', 'match', 'unmatched']);
  assert.equal(entries[0].match.invoice_id, byRef.id);
  assert.equal(entries[1].match.invoice_id, byText.id);
  assert.equal(entries[0].debtor, 'Kunde & Co');

  const pick = entries.filter((e) => e.state === 'match').map((e) => ({ invoice_id: e.match.invoice_id, amount: e.amount, date: e.date, bank_ref: e.bank_ref, debtor: e.debtor }));
  const result = await a.post('/banking/book', { entries: pick });
  assert.equal(result.booked, 2);
  assert.equal((await a.get(`/documents/${byRef.id}`)).status, 'paid');
  assert.equal((await a.get(`/documents/${byText.id}`)).status, 'partial');

  // Dieselbe Datei nochmals: alles als bereits verbucht erkannt, erneutes Buchen wird abgewiesen
  const again = await (await fetch(`${process.env.TEST_BASE_URL}/api/banking/preview`, { method: 'POST', headers: { 'Content-Type': 'text/plain', Cookie: a.cookie }, body: xml })).json();
  assert.deepEqual(again.entries.map((e) => e.state), ['duplicate', 'duplicate', 'unmatched']);
  const dup = await a.post('/banking/book', { entries: pick });
  assert.equal(dup.booked, 0);
  assert.equal(dup.errors.length, 2);
  const bad = await fetch(`${process.env.TEST_BASE_URL}/api/banking/preview`, { method: 'POST', headers: { 'Content-Type': 'text/plain', Cookie: a.cookie }, body: '<foo/>' });
  assert.equal(bad.status, 400);
  await assertBalanced(a);
});

test('Abo-Rechnungen: Vorlage aus Rechnung, fällige Rechnungen erzeugen, Termin fortschreiben', async () => {
  const a = await admin();
  const c = await makeCustomer(a), p = await makeProduct(a, { is_stock_item: false, sale_price: 290 });
  const inv = await issued(a, c, [item(p, 1)], { reference: 'Wartungsvertrag' });
  await a.fails(400, 'POST', '/recurring', { invoice_id: inv.id, period: 'weekly', next_date: today() });
  const { id } = await a.post('/recurring', { invoice_id: inv.id, name: uniq('Wartung'), period: 'monthly', next_date: daysAgo(1), auto_issue: true });
  const { id: later } = await a.post('/recurring', { invoice_id: inv.id, name: uniq('Später'), period: 'yearly', next_date: '2099-01-01' });

  const run = await a.post('/recurring/run', { id });
  assert.equal(run.created.length, 1);
  assert.equal(run.errors.length, 0);
  const created = await a.get(`/documents/${run.created[0].document_id}`);
  assert.equal(created.status, 'open', 'automatisch gebucht');
  assert.equal(created.date, daysAgo(1));
  assert.equal(created.reference, 'Wartungsvertrag');
  near(created.total, inv.total);
  const list = await a.get('/recurring');
  const row = list.find((r) => r.id === id);
  assert.ok(row.next_date > today(), 'nächster Termin liegt in der Zukunft');
  assert.equal(row.last_number, created.number);
  near(row.total, inv.total);
  assert.equal((await a.post('/recurring/run', { id })).created.length, 0, 'kein zweiter Lauf am selben Tag');
  assert.equal((await a.post('/recurring/run', { id: later })).created.length, 0, 'noch nicht fällig');
  await a.del(`/recurring/${later}`);
});

test('Abschlussarbeiten: Lagerbestand in die Bilanz, Fremdwährungen bewerten', async () => {
  const a = await admin();
  const stock = await a.get('/closing/stock');
  near(stock.difference, stock.stockValue - stock.booked);
  if (stock.difference !== 0) {
    const before = await balances(a);
    const posted = await a.post('/closing/stock', { date: today() });
    near(delta(before, await balances(a), '1200'), posted.difference, 'Vorräte = Lagerwert');
    near((await a.get('/closing/stock')).difference, 0);
  }
  await a.fails(400, 'POST', '/closing/stock', { date: today() });

  // Offene EUR-Rechnung zum Kurs 0.95, aktueller Kurs laut Währungstabelle
  const c = await makeCustomer(a, { currency: 'EUR' });
  const inv = await issued(a, c, [{ description: 'Leistung', qty: 1, unit_price: 1000, vat_rate: 0 }], { exchange_rate: 0.95 });
  const eur = (await a.get('/currencies')).find((x) => x.code === 'EUR');
  await a.put(`/currencies/${eur.id}`, { rate: 0.9 });
  const fx = await a.get('/closing/fx');
  const row = fx.receivables.find((r) => r.id === inv.id);
  near(row.difference, -50, 'Forderung ist zum Stichtagskurs 50 weniger wert');
  await a.put(`/currencies/${eur.id}`, { rate: eur.rate });
  await a.post(`/documents/${inv.id}/payments`, { amount: 1000, exchange_rate: 0.95 });
  await assertBalanced(a);
});

test('MwSt-Abrechnung: vereinbart, vereinnahmt, Saldosteuersatz', async () => {
  const a = await admin();
  const c = await makeCustomer(a), p = await makeProduct(a, { is_stock_item: false, sale_price: 1000 });
  const agreed0 = await a.get('/reports/vat?method=agreed');
  const received0 = await a.get('/reports/vat?method=received');
  const inv = await issued(a, c, [item(p, 1)]);        // 1000 + 81
  const agreed1 = await a.get('/reports/vat?method=agreed');
  near(agreed1.outputVat - agreed0.outputVat, 81, 'vereinbart: mit Rechnungsstellung geschuldet');
  near((await a.get('/reports/vat?method=received')).outputVat - received0.outputVat, 0, 'vereinnahmt: erst bei Zahlung');
  await a.post(`/documents/${inv.id}/payments`, { amount: 540.5 });
  near((await a.get('/reports/vat?method=received')).outputVat - received0.outputVat, 40.5, 'vereinnahmt: anteilig zur Zahlung');
  assert.equal(agreed1.output.find((o) => o.rate === 8.1).ziffer, '303');

  await a.put('/settings/company', { vat_method: 'net', vat_net_rate: 6.2 });
  const net = await a.get('/reports/vat');
  assert.equal(net.method, 'net');
  near(net.payable, Math.round(net.gross * 6.2) / 100);
  assert.equal(net.input.vat, 0, 'kein Vorsteuerabzug beim Saldosteuersatz');
  await a.put('/settings/company', { vat_method: 'agreed' });
});

test('Storno statt Löschen: Buchungen und Zahlungen bleiben nachvollziehbar', async () => {
  const a = await admin();
  const year = await currentYear(a);
  const before = await balances(a);
  const text = uniq('Fehlbuchung');
  const { id } = await a.post('/accounting/journal', { date: today(), text, lines: [{ account: '1000', debit: 75 }, { account: '1020', credit: 75 }] });
  await a.del(`/accounting/journal/${id}`);
  assertNoChange(before, await balances(a));
  const journal = await a.get(`/accounting/journal?year_id=${year.id}&q=${text}`);
  assert.equal(journal.length, 2, 'Original und Storno stehen beide im Journal');
  assert.ok(journal.every((e) => e.reversed_by), 'beide sind als storniert verknüpft');
  await a.fails(400, 'DELETE', `/accounting/journal/${id}`);

  const c = await makeCustomer(a), p = await makeProduct(a, { is_stock_item: false });
  const inv = await issued(a, c, [item(p, 1)]);
  const paid = await a.post(`/documents/${inv.id}/payments`, { amount: 108.1 });
  const back = await a.del(`/documents/payments/${paid.payments[0].id}`);
  assert.equal(back.status, 'open');
  assert.ok(back.payments[0].reversed_at, 'Zahlung bleibt sichtbar und ist als storniert markiert');
  await a.fails(400, 'DELETE', `/documents/payments/${paid.payments[0].id}`);

  // Lieferantenrechnung: Korrektur und Storno ohne Löschen
  const s = await makeSupplier(a);
  const acc = await accountId(a, '6500');
  const b0 = await balances(a);
  const bill = await a.post('/payables', { supplier_id: s.id, number: uniq('ST'), expense_account_id: acc, net: 100, vat: 8.1 });
  await a.put(`/payables/${bill.id}`, { supplier_id: s.id, number: bill.number, expense_account_id: acc, net: 200, vat: 16.2 });
  near(delta(b0, await balances(a), '2000'), -216.2, 'nach Korrektur gilt nur der neue Betrag');
  await a.del(`/payables/${bill.id}`);
  assertNoChange(b0, await balances(a), 'Storno hebt die Buchung auf');
  assert.equal((await a.get(`/payables/${bill.id}`)).status, 'cancelled', 'Beleg bleibt erhalten');
  await a.fails(400, 'POST', `/payables/${bill.id}/payments`, { amount: 1 });
  assert.equal((await a.get('/payables?open=1')).some((b) => b.id === bill.id), false);
  await assertBalanced(a);
});

test('Belegablage: Datei an Lieferantenrechnung hängen, herunterladen, Typ prüfen', async () => {
  const a = await admin();
  const s = await makeSupplier(a);
  const bill = await a.post('/payables', { supplier_id: s.id, number: uniq('AT'), expense_account_id: await accountId(a, '6500'), net: 10, vat: 0 });
  const pdf = Buffer.from('%PDF-1.4\n% Testbeleg\n');
  const dataUrl = `data:application/pdf;base64,${pdf.toString('base64')}`;
  const { id } = await a.post('/attachments', { entity: 'supplier_invoice', entity_id: bill.id, filename: 'Rechnung äöü.pdf', dataUrl });
  const list = await a.get(`/attachments?entity=supplier_invoice&entity_id=${bill.id}`);
  assert.deepEqual(list.map((f) => [f.filename, f.size]), [['Rechnung äöü.pdf', pdf.length]]);
  const file = await a.req('GET', `/attachments/${id}`);
  assert.ok(file.data.equals(pdf));
  assert.equal((await a.get(`/payables/${bill.id}`)).attachment_count, 1);
  await a.fails(400, 'POST', '/attachments', { entity: 'supplier_invoice', entity_id: bill.id, filename: 'x.exe', dataUrl: 'data:application/x-msdownload;base64,TVo=' });
  await a.fails(400, 'POST', '/attachments', { entity: 'supplier_invoice', entity_id: bill.id, filename: 'falsch.pdf', dataUrl: `data:application/pdf;base64,${Buffer.from('kein pdf').toString('base64')}` });
  await a.del(`/attachments/${id}`);
  assert.equal((await a.get(`/attachments?entity=supplier_invoice&entity_id=${bill.id}`)).length, 0);
});

test('Preislisten: Kundenpreis, Staffelpreis, Kundenrabatt in den Stammdaten', async () => {
  const a = await admin();
  const c = await makeCustomer(a, { discount_pct: 5, language: 'fr' });
  assert.equal(c.discount_pct, 5);
  const p = await makeProduct(a, { sale_price: 100 });
  await a.post('/prices', { product_id: p.id, min_qty: 10, price: 90 });
  const { id } = await a.post('/prices', { product_id: p.id, customer_id: c.id, min_qty: 1, price: 80 });
  await a.fails(400, 'POST', '/prices', { product_id: p.id, min_qty: 0, price: 1 });
  const prices = await a.get(`/prices?product_id=${p.id}`);
  assert.deepEqual(prices.map((x) => [x.customer_id, x.min_qty, x.price]), [[null, 10, 90], [c.id, 1, 80]]);
  const lookup = await a.get('/reports/lookup');
  assert.equal(lookup.prices.filter((x) => x.product_id === p.id).length, 2);
  assert.equal(lookup.customers.find((x) => x.id === c.id).discount_pct, 5);
  await a.del(`/prices/${id}`);
});

test('Mehrsprachige Belege: Sprache des Kunden wird übernommen, PDF in FR/IT/EN', async () => {
  const a = await admin();
  for (const language of ['fr', 'it', 'en']) {
    const c = await makeCustomer(a, { language });
    const p = await makeProduct(a, { is_stock_item: false });
    const inv = await issued(a, c, [item(p, 1)]);
    assert.equal(inv.language, language);
    assert.ok(isPdf(await a.req('GET', `/documents/${inv.id}/pdf`)), `PDF ${language}`);
  }
  const c = await makeCustomer(a);
  const quote = await a.post('/documents', { type: 'quote', customer_id: c.id, language: 'en', items: [{ description: 'x', qty: 1, unit_price: 1, vat_rate: 0 }] });
  assert.equal(quote.language, 'en');
  assert.equal((await a.put(`/documents/${quote.id}`, { language: 'xx', items: quote.items })).language, 'en', 'unbekannte Sprache wird ignoriert');
});
