import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, admin, login, uniq } from './helpers.js';
import { effectivePermissions, PERMISSIONS, MODULES } from '../src/auth.js';
import { pool } from '../src/db.js';

test.after(() => pool.end());

const PASSWORD = 'ein-langes-testpasswort';
async function userWith(a, permissions) {
  const role = await a.post('/roles', { name: uniq('Rolle'), permissions });
  const email = `${uniq('rolle')}@example.com`;
  await a.post('/users', { name: 'Test Rolle', email, password: PASSWORD, role_id: role.id });
  return login(email, PASSWORD);
}

test('wirksame Rechte: Einschlüsse, Vollzugriff und ausgeschaltete Module', () => {
  assert.deepEqual(effectivePermissions(['customers.write']), ['customers.read', 'customers.write']);
  assert.deepEqual(effectivePermissions(['projects.write']).sort(), ['projects.read', 'projects.write', 'time.write']);
  assert.equal(effectivePermissions(['*']).length, PERMISSIONS.length);
  assert.deepEqual(effectivePermissions(['gibt.es.nicht']), []);
  const off = effectivePermissions(['*'], { payroll: false, admin: false, masterdata: false });
  assert.ok(!off.some((p) => p.startsWith('payroll.')), 'Lohn ist ausgeschaltet');
  assert.ok(off.includes('admin.users') && off.includes('customers.read'), 'Kernmodule bleiben immer an');
  // Jedes Recht gehört zu einem bekannten Modul, jedes eingeschlossene Recht existiert
  const keys = new Set(PERMISSIONS.map((p) => p.key));
  for (const p of PERMISSIONS) {
    assert.ok(MODULES.some((m) => m.key === p.module), `Modul von ${p.key}`);
    assert.ok(p.description, `Beschreibung von ${p.key}`);
    for (const i of p.implies) assert.ok(keys.has(i), `${p.key} schliesst ${i} ein`);
  }
});

test('Rechtekatalog und vordefinierte Rollen', async () => {
  const a = await admin();
  const catalog = await a.get('/permissions');
  assert.equal(catalog.permissions.length, PERMISSIONS.length);
  assert.ok(catalog.modules.find((m) => m.key === 'payroll').menu.includes('Lohnläufe'));

  const roles = await a.get('/roles');
  const names = roles.map((r) => r.name);
  const by = (name) => roles.find((r) => r.name === name);
  for (const name of ['Administrator', 'Buchhaltung', 'Verkauf', 'Lager', 'Nur Lesen', 'Geschäftsleitung', 'Verkaufsleitung', 'Einkauf',
    'Debitorenbuchhaltung', 'Kreditorenbuchhaltung', 'Personal', 'Projektleitung', 'Zeiterfassung', 'Treuhand']) {
    assert.ok(names.includes(name), `Rolle ${name} vorhanden`);
    assert.ok(by(name).description, `Rolle ${name} hat eine Beschreibung`);
  }
  assert.equal(by('Administrator').effective.length, PERMISSIONS.length);
  assert.deepEqual(by('Zeiterfassung').effective, ['time.write']);
  assert.deepEqual(by('Personal').effective, ['payroll.read', 'payroll.write']);
  // Lesende Rollen ändern nichts
  for (const name of ['Geschäftsleitung', 'Treuhand', 'Nur Lesen']) {
    assert.ok(by(name).effective.every((p) => p.endsWith('.read')), `${name} ist rein lesend`);
  }
  assert.ok(by('Geschäftsleitung').effective.includes('payroll.read'));
  assert.ok(!by('Nur Lesen').effective.includes('payroll.read'));
  assert.ok(!by('Treuhand').effective.includes('payroll.read'));

  // Katalog ist nur für die Administration bestimmt
  const u = await userWith(a, ['time.write']);
  await u.fails(403, 'GET', '/permissions');
});

test('Bearbeiten schliesst Ansehen ein', async () => {
  const a = await admin();
  const u = await userWith(a, ['customers.write']);
  assert.deepEqual(u.user.permissions, ['customers.read', 'customers.write']);
  assert.equal(u.user.is_admin, false);
  await u.get('/customers');
  await u.post('/customers', { company: uniq('Einschluss AG') });
  await u.fails(403, 'GET', '/suppliers');
});

test('ausgeschaltetes Modul ist für alle gesperrt, auch für den Administrator', async () => {
  const a = await admin();
  const u = await userWith(a, ['payroll.read', 'customers.read']);
  await u.get('/payroll');
  try {
    const saved = await a.put('/settings/modules', { payroll: false, admin: false, masterdata: false, unbekannt: false });
    assert.equal(saved.payroll, false);
    assert.equal(saved.accounting, true);
    assert.ok(!('admin' in saved) && !('unbekannt' in saved), 'Kernmodule und Unbekanntes werden nicht gespeichert');

    await a.fails(403, 'GET', '/payroll');
    await a.fails(403, 'GET', '/employees');
    await u.fails(403, 'GET', '/payroll');
    await u.get('/customers');
    const me = await a.get('/auth/me');
    assert.ok(!me.permissions.some((p) => p.startsWith('payroll.')));
    assert.ok(me.permissions.includes('admin.settings') && me.permissions.includes('customers.write'));
    assert.equal((await a.get('/settings')).modules.payroll, false);
    // Die Rollenübersicht zeigt weiterhin, was die Rolle bei eingeschaltetem Modul dürfte
    assert.ok((await a.get('/roles')).find((r) => r.is_system).effective.includes('payroll.write'));
  } finally {
    await a.put('/settings/modules', { payroll: true });
  }
  await a.get('/payroll');
  await u.get('/payroll');
  assert.ok((await a.get('/auth/me')).permissions.includes('payroll.write'));

  // Module darf nur schalten, wer die Einstellungen ändern darf
  await u.fails(403, 'PUT', '/settings/modules', { payroll: false });
  await new Client().fails(401, 'PUT', '/settings/modules', { payroll: false });
});
