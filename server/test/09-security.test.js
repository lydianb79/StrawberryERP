import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, admin, login, uniq } from './helpers.js';
import { totp } from '../src/services/totp.js';

const MAILPIT = process.env.MAILPIT_URL;

async function makeUser(a, password = 'ein-langes-testpasswort') {
  const role = (await a.get('/roles')).find((r) => r.name === 'Nur Lesen');
  const email = `${uniq('user')}@example.com`;
  const { id } = await a.post('/users', { name: 'Test Person', email, password, role_id: role.id });
  return { id, email, password };
}

test('Passwortwechsel beendet andere Sitzungen', async () => {
  const a = await admin();
  const u = await makeUser(a);
  const s1 = await login(u.email, u.password), s2 = await login(u.email, u.password);
  await s1.post('/auth/password', { current: u.password, password: 'neues-langes-passwort-1' });
  await s1.get('/auth/me');                       // die eigene Sitzung bleibt gültig
  await s2.fails(401, 'GET', '/auth/me');         // die andere ist beendet
  await login(u.email, 'neues-langes-passwort-1');
  // Admin setzt das Passwort neu: alle Sitzungen des Benutzers enden
  await a.put(`/users/${u.id}`, { password: 'vom-admin-gesetzt-123' });
  await s1.fails(401, 'GET', '/auth/me');
  // Deaktivieren sperrt sofort
  const s3 = await login(u.email, 'vom-admin-gesetzt-123');
  await a.put(`/users/${u.id}`, { active: false });
  await s3.fails(401, 'GET', '/auth/me');
});

test('Zwei-Faktor-Anmeldung: einrichten, anmelden, zurücksetzen', async () => {
  const a = await admin();
  const u = await makeUser(a);
  const s = await login(u.email, u.password);
  const setup = await s.post('/auth/2fa/setup');
  assert.match(setup.secret, /^[A-Z2-7]{32}$/);
  assert.ok(setup.url.startsWith('otpauth://totp/'));
  assert.ok(setup.qr.startsWith('data:image/svg+xml;base64,'));
  await s.fails(400, 'POST', '/auth/2fa/enable', { code: '000000' });
  await s.post('/auth/2fa/enable', { code: totp(setup.secret) });
  assert.equal((await s.get('/auth/me')).totp_enabled, 1);
  await s.fails(400, 'POST', '/auth/2fa/setup');

  const anon = new Client();
  const need = await anon.req('POST', '/auth/login', { email: u.email, password: u.password });
  assert.equal(need.status, 401);
  assert.equal(need.data.twoFactorRequired, true);
  const wrong = await anon.req('POST', '/auth/login', { email: u.email, password: u.password, code: '123456' });
  assert.equal(wrong.status, 401);
  await anon.fails(401, 'POST', '/auth/login', { email: u.email, password: 'falsch', code: totp(setup.secret) });
  const ok = await anon.req('POST', '/auth/login', { email: u.email, password: u.password, code: totp(setup.secret) });
  assert.equal(ok.status, 200);

  await s.fails(400, 'POST', '/auth/2fa/disable', { password: 'falsch' });
  // Gerät verloren: Administrator setzt den zweiten Faktor zurück
  await a.put(`/users/${u.id}`, { reset2fa: true });
  await login(u.email, u.password);
});

test('Passwort vergessen: Link per E-Mail, einmalig gültig', { skip: !MAILPIT && 'MAILPIT_URL nicht gesetzt' }, async () => {
  const a = await admin();
  await a.put('/settings/mail', { host: 'mailpit', port: 1025, secure: false, user: '', clearPassword: true, fromAddress: 'erp@example.com' });
  await a.put('/settings/company', { app_url: 'https://erp.example.com/' });
  const u = await makeUser(a);
  const old = await login(u.email, u.password);
  const anon = new Client();
  assert.equal((await anon.req('POST', '/auth/forgot', { email: u.email })).status, 204);
  assert.equal((await anon.req('POST', '/auth/forgot', { email: 'niemand@example.com' })).status, 204, 'gleiche Antwort für unbekannte Adressen');

  const { messages } = await (await fetch(`${MAILPIT}/api/v1/messages`)).json();
  const mail = messages.find((m) => m.To.some((t) => t.Address === u.email));
  assert.ok(mail, 'Reset-Mail zugestellt');
  assert.equal(messages.some((m) => m.To.some((t) => t.Address === 'niemand@example.com')), false);
  const body = (await (await fetch(`${MAILPIT}/api/v1/message/${mail.ID}`)).json()).Text;
  const link = body.match(/https:\/\/erp\.example\.com\/passwort-zuruecksetzen\?token=([\w-]+)/);
  assert.ok(link, 'Link verwendet die hinterlegte Adresse der Anwendung');

  await anon.fails(400, 'POST', '/auth/reset', { token: 'falsch', password: 'neues-langes-passwort-2' });
  await anon.fails(400, 'POST', '/auth/reset', { token: link[1], password: 'kurz' });
  assert.equal((await anon.req('POST', '/auth/reset', { token: link[1], password: 'neues-langes-passwort-2' })).status, 204);
  await anon.fails(400, 'POST', '/auth/reset', { token: link[1], password: 'neues-langes-passwort-3' });
  await old.fails(401, 'GET', '/auth/me');
  await login(u.email, 'neues-langes-passwort-2');
  await anon.fails(401, 'POST', '/auth/login', { email: u.email, password: u.password });
});
