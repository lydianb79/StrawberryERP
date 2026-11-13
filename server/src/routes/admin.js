import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { q, one, tx } from '../db.js';
import { can, audit, PERMISSIONS } from '../auth.js';
import { HttpError, h } from '../util.js';
import { validatePassword } from './auth.js';
import { getSettings, saveSetting, getLogo, SETTING_KEYS, DEFAULTS } from '../services/settings.js';
import { renderDocumentPdf, sampleDocument } from '../services/pdf.js';
import { sendTestMail, mailConfigured } from '../services/mail.js';
import { systemInfo, VERSION } from '../services/system.js';
import { has } from '../auth.js';

const r = Router();

// ---------- Benutzer ----------
const USER_COLS = 'u.id, u.email, u.name, u.role_id, r.name AS role, u.active, u.totp_enabled, u.last_login, u.created_at';

r.get('/users', can('admin.users'), h(async (_req, res) => {
  res.json(await q(`SELECT ${USER_COLS} FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.name`));
}));

async function assertAdminRemains(conn, excludeUserId) {
  const row = await one(
    `SELECT COUNT(*) AS n FROM users u JOIN role_permissions p ON p.role_id = u.role_id AND p.permission = '*'
      WHERE u.active = 1 AND u.id <> ?`, [excludeUserId], conn);
  if (!row.n) throw new HttpError(400, 'Es muss mindestens ein aktiver Administrator bestehen bleiben.');
}

r.post('/users', can('admin.users'), h(async (req, res) => {
  const { email, name, password, role_id, active = true } = req.body || {};
  if (!email || !name || !role_id) throw new HttpError(400, 'Name, E-Mail und Rolle sind Pflichtfelder.');
  validatePassword(password);
  const result = await q('INSERT INTO users (email, name, password_hash, role_id, active) VALUES (?,?,?,?,?)',
    [String(email).trim().toLowerCase(), String(name).trim(), await bcrypt.hash(password, 12), role_id, active ? 1 : 0]);
  await audit(req, 'create', 'user', result.insertId, email);
  res.status(201).json({ id: result.insertId });
}));

r.put('/users/:id', can('admin.users'), h(async (req, res) => {
  const id = Number(req.params.id);
  const { email, name, password, role_id, active, reset2fa } = req.body || {};
  await tx(async (conn) => {
    const user = await one('SELECT * FROM users WHERE id = ? FOR UPDATE', [id], conn);
    if (!user) throw new HttpError(404, 'Benutzer nicht gefunden');
    const data = {};
    if (email) data.email = String(email).trim().toLowerCase();
    if (name) data.name = String(name).trim();
    if (role_id) data.role_id = Number(role_id);
    if (active !== undefined) data.active = active ? 1 : 0;
    if (password) {
      validatePassword(password);
      data.password_hash = await bcrypt.hash(password, 12);
      data.token_version = user.token_version + 1; // bestehende Sitzungen des Benutzers beenden
    }
    if (reset2fa) { data.totp_enabled = 0; data.totp_secret = null; }
    if (data.active === 0) data.token_version = user.token_version + 1;
    if (id === req.user.id && data.active === 0) throw new HttpError(400, 'Sie können sich nicht selbst deaktivieren.');
    if (Object.keys(data).length) await q('UPDATE users SET ? WHERE id = ?', [data, id], conn);
    if (data.active === 0 || data.role_id) {
      const stillAdmin = await one(
        `SELECT 1 AS ok FROM users u JOIN role_permissions p ON p.role_id = u.role_id AND p.permission = '*' WHERE u.id = ? AND u.active = 1`, [id], conn);
      if (!stillAdmin) await assertAdminRemains(conn, id);
    }
  });
  await audit(req, 'update', 'user', id);
  res.status(204).end();
}));

r.delete('/users/:id', can('admin.users'), h(async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) throw new HttpError(400, 'Sie können sich nicht selbst löschen.');
  await tx(async (conn) => {
    await assertAdminRemains(conn, id);
    await q('DELETE FROM users WHERE id = ?', [id], conn);
  });
  await audit(req, 'delete', 'user', id);
  res.status(204).end();
}));

// ---------- Rollen ----------
r.get('/permissions', can('admin.users'), (_req, res) => res.json(PERMISSIONS));

r.get('/roles', can('admin.users'), h(async (_req, res) => {
  const roles = await q('SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS user_count FROM roles r ORDER BY r.is_system DESC, r.name');
  const perms = await q('SELECT role_id, permission FROM role_permissions');
  for (const role of roles) role.permissions = perms.filter((p) => p.role_id === role.id).map((p) => p.permission);
  res.json(roles);
}));

const validPerms = (list) => {
  const known = new Set(PERMISSIONS.map((p) => p.key));
  return [...new Set((Array.isArray(list) ? list : []).filter((p) => known.has(p)))];
};

async function saveRole(req, id) {
  const { name, description, permissions } = req.body || {};
  if (!String(name || '').trim()) throw new HttpError(400, 'Rollenname fehlt.');
  return tx(async (conn) => {
    if (id) {
      const role = await one('SELECT * FROM roles WHERE id = ? FOR UPDATE', [id], conn);
      if (!role) throw new HttpError(404, 'Rolle nicht gefunden');
      if (role.is_system) throw new HttpError(400, 'Die Systemrolle «Administrator» kann nicht geändert werden.');
      await q('UPDATE roles SET name = ?, description = ? WHERE id = ?', [name.trim(), description || null, id], conn);
    } else {
      id = (await q('INSERT INTO roles (name, description) VALUES (?, ?)', [name.trim(), description || null], conn)).insertId;
    }
    await q('DELETE FROM role_permissions WHERE role_id = ?', [id], conn);
    const perms = validPerms(permissions);
    if (perms.length) await q('INSERT INTO role_permissions (role_id, permission) VALUES ?', [perms.map((p) => [id, p])], conn);
    return id;
  });
}

r.post('/roles', can('admin.users'), h(async (req, res) => {
  const id = await saveRole(req, null);
  await audit(req, 'create', 'role', id, req.body.name);
  res.status(201).json({ id });
}));

r.put('/roles/:id', can('admin.users'), h(async (req, res) => {
  await saveRole(req, Number(req.params.id));
  await audit(req, 'update', 'role', req.params.id, req.body.name);
  res.status(204).end();
}));

r.delete('/roles/:id', can('admin.users'), h(async (req, res) => {
  const role = await one('SELECT * FROM roles WHERE id = ?', [req.params.id]);
  if (!role) throw new HttpError(404, 'Rolle nicht gefunden');
  if (role.is_system) throw new HttpError(400, 'Systemrollen können nicht gelöscht werden.');
  const used = await one('SELECT COUNT(*) AS n FROM users WHERE role_id = ?', [role.id]);
  if (used.n) throw new HttpError(400, 'Dieser Rolle sind noch Benutzer zugewiesen.');
  await q('DELETE FROM roles WHERE id = ?', [role.id]);
  await audit(req, 'delete', 'role', role.id, role.name);
  res.status(204).end();
}));

// ---------- Einstellungen ----------
r.get('/settings', h(async (req, res) => {
  const settings = await getSettings();
  const logo = await getLogo();
  // SMTP-Zugangsdaten verlassen den Server nie; Nicht-Admins sehen nur, ob der Versand eingerichtet ist.
  const { password, ...mail } = settings.mail;
  const mailPublic = has(req.user, 'admin.settings') ? { ...mail, passwordSet: !!password } : {};
  res.json({ ...settings, mail: { ...mailPublic, configured: mailConfigured(settings.mail) }, hasLogo: !!logo, version: VERSION });
}));

r.put('/settings/:key', can('admin.settings'), h(async (req, res) => {
  const { key } = req.params;
  if (!SETTING_KEYS.includes(key)) throw new HttpError(404, 'Unbekannte Einstellung');
  const value = {};
  for (const k of Object.keys(DEFAULTS[key])) if (k in (req.body || {})) value[k] = req.body[k];
  const current = (await getSettings())[key];
  if (key === 'mail' && !value.password) delete value.password; // leeres Feld = Passwort unverändert lassen
  if (key === 'mail' && req.body?.clearPassword) value.password = '';
  if (key === 'company' && value.currency) value.currency = String(value.currency).toUpperCase().slice(0, 3);
  await saveSetting(key, { ...current, ...value });
  await audit(req, 'update', 'settings', key);
  const saved = (await getSettings())[key];
  if (key === 'mail') { saved.passwordSet = !!saved.password; delete saved.password; }
  res.json(saved);
}));

r.get('/settings-logo', h(async (_req, res) => {
  const logo = await getLogo();
  if (!logo) throw new HttpError(404, 'Kein Logo hinterlegt');
  res.set('Content-Type', logo.mime).set('Cache-Control', 'no-store').send(logo.buffer);
}));

r.post('/settings-logo', can('admin.settings'), h(async (req, res) => {
  const m = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.dataUrl || ''));
  if (!m) throw new HttpError(400, 'Bitte ein PNG- oder JPEG-Bild hochladen.');
  const buffer = Buffer.from(m[2], 'base64');
  if (buffer.length > 2 * 1024 * 1024) throw new HttpError(400, 'Das Logo darf höchstens 2 MB gross sein.');
  const isPng = buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const isJpg = buffer[0] === 0xff && buffer[1] === 0xd8;
  if (!isPng && !isJpg) throw new HttpError(400, 'Die Datei ist kein gültiges PNG/JPEG.');
  await q("INSERT INTO settings (`key`, value) VALUES ('logo', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
    [JSON.stringify({ mime: isPng ? 'image/png' : 'image/jpeg', data: m[2] })]);
  await audit(req, 'update', 'settings', 'logo');
  res.status(204).end();
}));

r.delete('/settings-logo', can('admin.settings'), h(async (req, res) => {
  await q("DELETE FROM settings WHERE `key` = 'logo'");
  await audit(req, 'delete', 'settings', 'logo');
  res.status(204).end();
}));

/** Layout-Vorschau: rendert einen Beispielbeleg mit den (ungespeicherten) Einstellungen aus dem Body. */
r.post('/layout-preview', can('admin.settings'), h(async (req, res) => {
  const settings = await getSettings();
  if (req.body?.layout && typeof req.body.layout === 'object') {
    for (const k of Object.keys(DEFAULTS.layout)) if (k in req.body.layout) settings.layout[k] = req.body.layout[k];
  }
  const sample = sampleDocument(settings);
  const type = ['quote', 'order', 'invoice', 'credit', 'purchase'].includes(req.body?.type) ? req.body.type : 'invoice';
  sample.doc.type = type;
  sample.doc.number = `${settings.numbering[`${type}Prefix`]}-${new Date().getFullYear()}-0042`;
  sample.doc.valid_until = sample.doc.due_date;
  res.set('Content-Type', 'application/pdf');
  renderDocumentPdf({ ...sample, settings, logo: await getLogo() }, res);
}));

// ---------- E-Mail-Test & System ----------
r.post('/mail-test', can('admin.settings'), h(async (req, res) => {
  await sendTestMail(undefined, req.body?.to);
  await audit(req, 'mail-test', 'settings', 'mail', req.body?.to);
  res.status(204).end();
}));

r.get('/system', can('admin.settings'), h(async (req, res) => {
  res.json(await systemInfo(req.query.refresh === '1'));
}));

// ---------- Protokoll ----------
r.get('/audit', can('admin.settings'), h(async (_req, res) => {
  res.json(await q('SELECT * FROM audit_log ORDER BY id DESC LIMIT 500'));
}));

export default r;
