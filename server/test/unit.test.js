// Unit-Tests der Rechenlogik – ohne Datenbank und ohne laufenden Server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { isQRReferenceValid, isSCORReferenceValid } from 'swissqrbill/utils';
import { computeTotals, openItemBase } from '../src/services/documents.js';
import { fxLines, toBase } from '../src/services/currency.js';
import { referenceFor, buildQrBill, countryCode } from '../src/services/qrbill.js';
import { isNewer } from '../src/services/system.js';
import { fillTemplate, parseRecipients } from '../src/services/mail.js';
import { renderDocumentPdf, sampleDocument } from '../src/services/pdf.js';
import { DEFAULTS } from '../src/services/settings.js';
import { round2, addDays, isDate } from '../src/util.js';
import { MIGRATIONS } from '../src/migrations.js';
import { pool } from '../src/db.js';

test.after(() => pool.end());

test('round2 rundet kaufmännisch, auch negative Beträge', () => {
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(2.675), 2.68);
  assert.equal(round2(-1.005), -1.01);
  assert.equal(round2(0.1 + 0.2), 0.3);
  assert.equal(round2('abc'), 0);
});

test('Datumshilfen', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2027-01-01', -1), '2026-12-31');
  assert.equal(isDate('2026-02-30'), false);
  assert.equal(isDate('2026-2-3'), false);
  assert.equal(isDate('2026-02-03'), true);
});

test('computeTotals: MwSt pro Satz, Summen gerundet', () => {
  const t = computeTotals([{ line_total: 100.05, vat_rate: 8.1 }, { line_total: 58.5, vat_rate: 2.6 }, { line_total: 10, vat_rate: 0 }]);
  assert.deepEqual(t.vatLines, [{ rate: 8.1, base: 100.05, vat: 8.1 }, { rate: 2.6, base: 58.5, vat: 1.52 }]);
  assert.equal(t.subtotal, 168.55);
  assert.equal(t.total, 178.17);
  assert.deepEqual(computeTotals([]), { subtotal: 0, vat_total: 0, total: 0, vatLines: [] });
});

test('openItemBase: Schlusszahlung übernimmt den Rundungsrest', () => {
  const rate = 0.9512, total = 333.33;
  const parts = [];
  for (const amount of [111.11, 111.11, 111.11]) parts.push(openItemBase(total, rate, parts.map((_, i) => ({ amount: 111.11 })).slice(0, parts.length), amount));
  assert.equal(round2(parts.reduce((s, v) => s + v, 0)), toBase(total, rate));
  assert.equal(openItemBase(100, 1, [], 40), 40);
});

test('fxLines: Kursgewinn und -verlust auf der richtigen Seite', () => {
  const acc = { fxGain: '6990', fxLoss: '6940' };
  assert.deepEqual(fxLines('receivable', 950, 970, acc), [{ account: '6990', credit: 20 }]);
  assert.deepEqual(fxLines('receivable', 950, 930, acc), [{ account: '6940', debit: 20 }]);
  assert.deepEqual(fxLines('payable', 950, 900, acc), [{ account: '6990', credit: 50 }]);
  assert.deepEqual(fxLines('payable', 950, 1000, acc), [{ account: '6940', debit: 50 }]);
  assert.deepEqual(fxLines('payable', 950, 950, acc), []);
});

test('Zahlungsreferenzen sind gültig (QR-Referenz und Creditor Reference)', () => {
  const doc = { id: 4711, number: 'RE-2026-0042', customer_number: 'K-10004' };
  const qrr = referenceFor('CH44 3199 9123 0008 8901 2', doc);
  assert.equal(qrr.length, 27);
  assert.ok(isQRReferenceValid(qrr));
  const scor = referenceFor('CH93 0076 2011 6238 5295 7', doc);
  assert.ok(scor.startsWith('RF') && isSCORReferenceValid(scor));
  assert.notEqual(referenceFor('CH4431999123000889012', { ...doc, id: 4712 }), qrr, 'pro Beleg eindeutig');
});

test('buildQrBill nennt den Grund, wenn kein Zahlteil möglich ist', () => {
  const company = { name: 'Firma AG', street: 'Weg 1', zip: '8000', city: 'Zürich', country: 'Schweiz', iban: 'CH9300762011623852957' };
  const partner = { company: 'Kunde', street: 'Gasse 2', zip: '3000', city: 'Bern', country: 'CH', number: 'K-1' };
  const doc = { id: 1, number: 'RE-1', total: 10, currency: 'CHF' };
  assert.ok(buildQrBill({ doc, partner, company }).bill);
  assert.ok(buildQrBill({ doc: { ...doc, currency: 'EUR' }, partner, company }).bill);
  assert.match(buildQrBill({ doc: { ...doc, currency: 'USD' }, partner, company }).reason, /CHF oder EUR/);
  assert.match(buildQrBill({ doc, partner, company: { ...company, iban: '' } }).reason, /Keine IBAN/);
  assert.match(buildQrBill({ doc, partner, company: { ...company, iban: 'DE89370400440532013000' } }).reason, /Schweiz oder Liechtenstein/);
  assert.equal(countryCode('Deutschland'), 'DE');
  assert.equal(countryCode('li'), 'LI');
  assert.equal(countryCode(''), 'CH');
});

test('Versionsvergleich für die Update-Prüfung', () => {
  assert.equal(isNewer('v1.1.0', '1.0.0'), true);
  assert.equal(isNewer('v1.10.0', '1.9.3'), true);
  assert.equal(isNewer('v1.0.0', '1.0.0'), false);
  assert.equal(isNewer('v1.0.9', '1.1.0'), false);
  assert.equal(isNewer('unsinn', '1.0.0'), false);
});

test('E-Mail: Platzhalter und Adressprüfung', () => {
  const text = fillTemplate('{nummer} für {kunde}: {waehrung} {total} bis {faellig} – {firma}',
    { number: 'RE-1', partner_name: 'Kunde AG', total: 1234.5, currency: 'CHF', due_date: '2026-12-24' }, { name: 'Firma' });
  assert.equal(text, "RE-1 für Kunde AG: CHF 1'234.50 bis 24.12.2026 – Firma");
  assert.deepEqual(parseRecipients('a@example.com; b@example.com', 'An'), ['a@example.com', 'b@example.com']);
  assert.throws(() => parseRecipients('kaputt', 'An'));
  assert.throws(() => parseRecipients('', 'An', true));
  assert.deepEqual(parseRecipients('', 'CC'), []);
});

test('PDF-Erzeugung ohne Datenbank (alle Vorlagen, mit Zahlteil)', async () => {
  for (const template of ['classic', 'modern', 'minimal']) {
    const settings = structuredClone(DEFAULTS);
    settings.layout.template = template;
    settings.company.iban = 'CH9300762011623852957';
    const stream = new PassThrough();
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    const done = new Promise((resolve) => stream.on('end', resolve));
    renderDocumentPdf({ ...sampleDocument(settings), settings, logo: null }, stream);
    await done;
    const pdf = Buffer.concat(chunks);
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.ok(pdf.length > 8000, `PDF ${template} enthält den Zahlteil`);
  }
});

test('Migrationen sind lückenlos und aufsteigend nummeriert', () => {
  assert.deepEqual(MIGRATIONS.map((m) => m.version), MIGRATIONS.map((_, i) => i + 2));
  for (const m of MIGRATIONS) assert.ok(m.name && m.statements.length > 0);
});

test('Überwachung: Statuswechsel lösen Meldungen aus, Dauerstörungen nur einmal täglich', async () => {
  const { diff, checks } = await import('../src/monitor.js');
  const ok = { service: { ok: true }, backup: { ok: true } };
  const down = { service: { ok: false }, backup: { ok: true } };
  const now = Date.now();
  assert.equal(diff(null, ok, now).notify, false, 'alles in Ordnung: keine Meldung');
  const first = diff({ failing: [] }, down, now);
  assert.deepEqual([first.notify, first.started], [true, ['service']]);
  assert.equal(diff({ failing: ['service'], notifiedAt: now - 3600_000 }, down, now).notify, false, 'gleiche Störung: nicht erneut');
  assert.equal(diff({ failing: ['service'], notifiedAt: now - 25 * 3600_000 }, down, now).remind, true, 'nach einem Tag erinnern');
  const fixed = diff({ failing: ['service'], notifiedAt: now }, ok, now);
  assert.deepEqual([fixed.notify, fixed.resolved], [true, ['service']]);

  const time = new Date(now - 2 * 3600_000).toISOString();
  assert.equal(checks.backup({ now, status: { ok: true, time, size: 100 } }).ok, true);
  assert.equal(checks.backup({ now, status: { ok: true, time: new Date(now - 30 * 3600_000).toISOString() } }).ok, false, 'zu alte Sicherung');
  assert.equal(checks.backup({ now, status: { ok: false, time, message: 'kaputt' } }).ok, false);
  assert.equal(checks.backup({ now, status: null }).ok, false);
  assert.equal(checks.disk({ paths: ['/x'], statfs: () => ({ bavail: 5, blocks: 100 }) }).ok, false, '95 % belegt');
  assert.equal(checks.disk({ paths: ['/x'], statfs: () => ({ bavail: 50, blocks: 100 }) }).ok, true);
  assert.equal(checks.units({ run: () => 'active' }).ok, true);
  assert.equal(checks.units({ run: (u) => (u === 'nginx' ? 'failed' : 'active') }).ok, false);
  assert.equal(checks.units({ run: () => { const e = new Error('x'); e.code = 'ENOENT'; throw e; } }), null, 'ohne systemd nicht anwendbar');
});

test('Lohnberechnung: Abzüge auf 5 Rappen, Spesen ohne Beiträge', async () => {
  const { computePayslip } = await import('../src/services/payroll.js');
  const rates = { employee: [{ key: 'ahv', label: 'AHV', rate: 5.3 }, { key: 'alv', label: 'ALV', rate: 1.1 }], employer: [{ key: 'ahv', label: 'AHV', rate: 5.3 }] };
  const s = computePayslip({ monthly_gross: 5432.1, bvg_employee: 211.35, bvg_employer: 0 }, rates, { bonus: 0, expenses: 80 });
  assert.deepEqual(s.deductions.map((d) => d.amount), [287.9, 59.75, 211.35]);
  assert.equal(s.net, 5432.1 - 287.9 - 59.75 - 211.35 + 80);
  assert.equal(s.employer_total, 287.9);
  assert.equal(computePayslip({ monthly_gross: 0, bvg_employee: 0, bvg_employer: 0 }, rates).net, 0);
});

test('Zahlungsdatei: Prüfungen und Zeichenbereinigung', async () => {
  const { buildPain001 } = await import('../src/services/pain001.js');
  const debtor = { name: 'Firma AG', iban: 'CH9300762011623852957' };
  const pay = { id: 1, name: 'Bäckerei Hug', city: 'Zürich', country: 'Schweiz', iban: 'CH5604835012345678009', amount: 10.5, currency: 'CHF', message: 'Rechnung <1>' };
  const f = buildPain001(debtor, [pay, { ...pay, id: 2, currency: 'EUR', amount: 20 }], { date: '2030-01-01', msgId: 'TEST1' });
  assert.equal(f.total, 30.5);
  assert.equal((f.xml.match(/<PmtInf>/g) || []).length, 2, 'ein Block je Währung');
  assert.ok(f.xml.includes('<Nm>Baeckerei Hug</Nm>') && f.xml.includes('<Ustrd>Rechnung 1</Ustrd>'));
  assert.throws(() => buildPain001(debtor, [{ ...pay, iban: 'CH00' }], { date: '2030-01-01' }), /IBAN/);
  assert.throws(() => buildPain001(debtor, [{ ...pay, currency: 'USD' }], { date: '2030-01-01' }), /CHF und EUR/);
  assert.throws(() => buildPain001({ name: 'x', iban: '' }, [pay], { date: '2030-01-01' }), /IBAN/);
  assert.throws(() => buildPain001(debtor, [], { date: '2030-01-01' }));
});
