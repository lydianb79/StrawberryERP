import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, admin, login, uniq } from './helpers.js';

test('ohne Anmeldung ist die API gesperrt', async () => {
  const anon = new Client();
  await anon.fails(401, 'GET', '/customers');
  await anon.fails(401, 'GET', '/settings');
  const health = await anon.get('/health');
  assert.equal(health.status, 'ok');
});

test('falsches Passwort wird abgelehnt, ohne Details preiszugeben', async () => {
  const anon = new Client();
  const a = await anon.fails(401, 'POST', '/auth/login', { email: 'admin@example.com', password: 'falsch' });
  const b = await anon.fails(401, 'POST', '/auth/login', { email: 'gibt-es-nicht@example.com', password: 'falsch' });
  assert.equal(a, b);
});

test('Rollen beschränken den Zugriff serverseitig', async () => {
  const a = await admin();
  const role = await a.post('/roles', { name: uniq('Testrolle'), permissions: ['inventory.read', 'inventory.write', 'gibt.es.nicht'] });
  const roles = await a.get('/roles');
  assert.deepEqual(roles.find((r) => r.id === role.id).permissions.sort(), ['inventory.read', 'inventory.write']);

  const email = `${uniq('lager')}@example.com`;
  await a.fails(400, 'POST', '/users', { name: 'Kurz', email, password: 'kurz', role_id: role.id });
  await a.post('/users', { name: 'Lena Lager', email, password: 'ein-langes-testpasswort', role_id: role.id });

  const u = await login(email, 'ein-langes-testpasswort');
  await u.get('/products');
  await u.post('/products', { sku: uniq('R'), name: 'Darf ich', active: true });
  await u.fails(403, 'GET', '/customers');
  await u.fails(403, 'POST', '/customers', { company: 'Nein' });
  await u.fails(403, 'GET', '/documents?type=invoice');
  await u.fails(403, 'GET', '/accounting/journal');
  await u.fails(403, 'GET', '/users');
  await u.fails(403, 'GET', '/audit');
  await u.fails(403, 'PUT', '/settings/company', { name: 'Gekapert' });
  await u.fails(403, 'GET', '/system');
  // Nicht-Admins sehen keine SMTP-Details
  const settings = await u.get('/settings');
  assert.deepEqual(Object.keys(settings.mail), ['configured']);
});

test('Administrator kann sich nicht selbst aussperren', async () => {
  const a = await admin();
  await a.fails(400, 'DELETE', `/users/${a.user.id}`);
  await a.fails(400, 'PUT', `/users/${a.user.id}`, { active: false });
  const sys = (await a.get('/roles')).find((r) => r.is_system);
  await a.fails(400, 'PUT', `/roles/${sys.id}`, { name: 'Entmachtet', permissions: [] });
  await a.fails(400, 'DELETE', `/roles/${sys.id}`);
});

test('Passwort ändern verlangt das aktuelle Passwort', async () => {
  const a = await admin();
  await a.fails(400, 'POST', '/auth/password', { current: 'falsch', password: 'neues-langes-passwort' });
  await a.fails(400, 'POST', '/auth/password', { current: process.env.ADMIN_PASSWORD, password: 'kurz' });
});
