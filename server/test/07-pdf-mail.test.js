import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admin, makeCustomer, makeProduct, item, uniq } from './helpers.js';

const MAILPIT = process.env.MAILPIT_URL;
const isPdf = (r) => r.type.includes('application/pdf') && r.data.subarray(0, 5).toString() === '%PDF-';

async function issued(a, extra = {}) {
  const c = await makeCustomer(a, { email: 'kunde@example.com', ...extra });
  const p = await makeProduct(a, { is_stock_item: false });
  const draft = await a.post('/documents', { type: 'invoice', customer_id: c.id, items: [item(p, 2)] });
  return a.post(`/documents/${draft.id}/issue`);
}

test('Belege werden als PDF erzeugt', async () => {
  const a = await admin();
  const c = await makeCustomer(a);
  const quote = await a.post('/documents', { type: 'quote', customer_id: c.id, items: [{ description: 'Zeile\nmit Umbruch und Umlauten äöü', qty: 1, unit_price: 10, vat_rate: 8.1 }] });
  const r = await a.req('GET', `/documents/${quote.id}/pdf`);
  assert.equal(r.status, 200);
  assert.ok(isPdf(r), 'gültiges PDF');
  for (const type of ['invoice', 'quote', 'order', 'purchase']) {
    for (const template of ['classic', 'modern', 'minimal']) {
      const preview = await a.req('POST', '/layout-preview', { type, layout: { template } });
      assert.ok(preview.status === 200 && isPdf(preview), `Vorschau ${type}/${template}`);
    }
  }
  // Viele Positionen: mehrseitiges PDF ohne Fehler
  const many = await a.post('/documents', { type: 'quote', customer_id: c.id,
    items: Array.from({ length: 70 }, (_, i) => ({ description: `Position ${i + 1}`, qty: 1, unit_price: 1, vat_rate: 8.1 })) });
  assert.ok(isPdf(await a.req('GET', `/documents/${many.id}/pdf`)));
});

test('QR-Rechnung: Zahlteil und Referenz sobald eine IBAN hinterlegt ist', async () => {
  const a = await admin();
  await a.put('/settings/company', { iban: '' });
  const without = await issued(a);
  assert.equal(without.payment_reference, null);
  const plain = await a.req('GET', `/documents/${without.id}/pdf`);

  await a.put('/settings/company', { iban: 'CH93 0076 2011 6238 5295 7' });
  const scor = await issued(a);
  assert.match(scor.payment_reference, /^RF\d{2}RE\d+$/, 'Creditor Reference bei normaler IBAN');
  const withQr = await a.req('GET', `/documents/${scor.id}/pdf`);
  assert.ok(isPdf(withQr));
  assert.ok(withQr.data.length > plain.data.length + 3000, 'PDF mit Zahlteil ist deutlich grösser');

  await a.put('/settings/company', { iban: 'CH44 3199 9123 0008 8901 2' });
  const qrr = await issued(a);
  assert.match(qrr.payment_reference, /^\d{27}$/, 'QR-Referenz bei QR-IBAN');
  assert.ok(isPdf(await a.req('GET', `/documents/${qrr.id}/pdf`)));

  // Ungültige IBAN darf die PDF-Erzeugung nicht verhindern
  await a.put('/settings/company', { iban: 'CH00 0000' });
  assert.ok(isPdf(await a.req('GET', `/documents/${qrr.id}/pdf`)));
  await a.put('/settings/company', { iban: 'CH93 0076 2011 6238 5295 7' });
});

test('E-Mail-Versand: Einrichtung, Prüfung, Zustellung mit PDF-Anhang', { skip: !MAILPIT && 'MAILPIT_URL nicht gesetzt' }, async () => {
  const a = await admin();
  const inv = await issued(a);
  await a.put('/settings/mail', { host: '', fromAddress: '' });
  assert.equal((await a.get(`/documents/${inv.id}/mail`)).configured, false);
  await a.fails(400, 'POST', `/documents/${inv.id}/send`, { to: 'kunde@example.com', subject: 'x' });

  const saved = await a.put('/settings/mail', { host: 'mailpit', port: 1025, secure: false, user: 'tester', password: 'smtp-geheimnis', fromName: 'Testfirma', fromAddress: 'erp@example.com' });
  assert.equal(saved.passwordSet, true);
  assert.equal('password' in saved, false);
  assert.ok(!JSON.stringify(await a.get('/settings')).includes('smtp-geheimnis'), 'SMTP-Passwort verlässt den Server nicht');
  await a.put('/settings/mail', { user: '', clearPassword: true });

  const draftMail = await a.get(`/documents/${inv.id}/mail`);
  assert.equal(draftMail.configured, true);
  assert.equal(draftMail.to, 'kunde@example.com');
  assert.ok(draftMail.subject.includes(inv.number));
  await a.fails(400, 'POST', `/documents/${inv.id}/send`, { to: 'keine-adresse', subject: 'x' });
  await a.fails(400, 'POST', `/documents/${inv.id}/send`, { to: 'kunde@example.com', subject: '' });

  const subject = uniq('Rechnung-Test');
  const sent = await a.post(`/documents/${inv.id}/send`, { to: 'kunde@example.com, zweite@example.com', cc: 'kopie@example.com', subject, message: 'Guten Tag' });
  assert.ok(sent.sent_at, 'Versandzeitpunkt gespeichert');
  const { messages } = await (await fetch(`${MAILPIT}/api/v1/messages`)).json();
  const mail = messages.find((m) => m.Subject === subject);
  assert.ok(mail, 'Nachricht ist im Postfach angekommen');
  assert.deepEqual(mail.To.map((t) => t.Address).sort(), ['kunde@example.com', 'zweite@example.com']);
  assert.equal(mail.Attachments, 1);
  assert.equal(mail.From.Address, 'erp@example.com');

  // Offerte wird durch den Versand als «gesendet» markiert; Rechnungsentwürfe gehen nicht raus
  const c = await makeCustomer(a);
  const quote = await a.post('/documents', { type: 'quote', customer_id: c.id, items: [{ description: 'x', qty: 1, unit_price: 1, vat_rate: 0 }] });
  assert.equal((await a.post(`/documents/${quote.id}/send`, { to: 'kunde@example.com', subject: uniq('Offerte') })).status, 'sent');
  const draft = await a.post('/documents', { type: 'invoice', customer_id: c.id, items: [{ description: 'x', qty: 1, unit_price: 1, vat_rate: 0 }] });
  await a.fails(400, 'POST', `/documents/${draft.id}/send`, { to: 'kunde@example.com', subject: 'x' });
});
