import jwt from 'jsonwebtoken';
import { q, one } from './db.js';
import { HttpError, h } from './util.js';

export const COOKIE = 'serp_token';
const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 24) {
  console.error('[auth] JWT_SECRET fehlt oder ist zu kurz (mind. 24 Zeichen). Bitte in der .env setzen.');
  process.exit(1);
}

/** Katalog aller Berechtigungen (wird in der Rollenverwaltung angezeigt). */
export const PERMISSIONS = [
  { key: 'customers.read', group: 'Kunden', label: 'Kunden ansehen' },
  { key: 'customers.write', group: 'Kunden', label: 'Kunden bearbeiten' },
  { key: 'suppliers.read', group: 'Lieferanten', label: 'Lieferanten ansehen' },
  { key: 'suppliers.write', group: 'Lieferanten', label: 'Lieferanten bearbeiten' },
  { key: 'inventory.read', group: 'Lager', label: 'Artikel & Lager ansehen' },
  { key: 'inventory.write', group: 'Lager', label: 'Artikel bearbeiten, Lager buchen' },
  { key: 'quotes.read', group: 'Offerten', label: 'Offerten ansehen' },
  { key: 'quotes.write', group: 'Offerten', label: 'Offerten erstellen/bearbeiten' },
  { key: 'orders.read', group: 'Aufträge', label: 'Aufträge ansehen' },
  { key: 'orders.write', group: 'Aufträge', label: 'Aufträge erstellen/bearbeiten' },
  { key: 'invoices.read', group: 'Rechnungen', label: 'Rechnungen ansehen' },
  { key: 'invoices.write', group: 'Rechnungen', label: 'Rechnungen erstellen/buchen' },
  { key: 'receivables.read', group: 'Debitoren', label: 'Offene Posten Debitoren ansehen' },
  { key: 'receivables.write', group: 'Debitoren', label: 'Zahlungseingänge erfassen' },
  { key: 'payables.read', group: 'Kreditoren', label: 'Kreditoren ansehen' },
  { key: 'payables.write', group: 'Kreditoren', label: 'Lieferantenrechnungen & Zahlungen erfassen' },
  { key: 'accounting.read', group: 'Buchhaltung', label: 'Journal, Bilanz, Erfolgsrechnung ansehen' },
  { key: 'accounting.write', group: 'Buchhaltung', label: 'Manuell buchen, Kontenplan pflegen' },
  { key: 'accounting.close', group: 'Buchhaltung', label: 'Jahresabschluss durchführen' },
  { key: 'reports.read', group: 'Auswertungen', label: 'Reports & Kennzahlen ansehen' },
  { key: 'admin.users', group: 'Administration', label: 'Benutzer & Rollen verwalten' },
  { key: 'admin.settings', group: 'Administration', label: 'Firmendaten, Layout & Protokoll' },
];

export const signToken = (userId) => jwt.sign({ uid: userId }, SECRET, { expiresIn: '12h' });

export const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.COOKIE_SECURE === 'true',
  maxAge: 12 * 60 * 60 * 1000,
  path: '/',
});

export async function loadUser(id) {
  const user = await one(
    `SELECT u.id, u.email, u.name, u.active, u.role_id, r.name AS role
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
    [id],
  );
  if (!user || !user.active) return null;
  const perms = await q('SELECT permission FROM role_permissions WHERE role_id = ?', [user.role_id]);
  user.permissions = perms.map((p) => p.permission);
  return user;
}

export const authenticate = h(async (req, _res, next) => {
  const token = req.cookies?.[COOKIE];
  if (!token) throw new HttpError(401, 'Nicht angemeldet');
  let payload;
  try {
    payload = jwt.verify(token, SECRET);
  } catch {
    throw new HttpError(401, 'Sitzung abgelaufen');
  }
  const user = await loadUser(payload.uid);
  if (!user) throw new HttpError(401, 'Benutzer deaktiviert');
  req.user = user;
  next();
});

export const has = (user, perm) => user.permissions.includes('*') || user.permissions.includes(perm);

/** Middleware: mindestens eine der Berechtigungen muss vorhanden sein. */
export const can = (...perms) => (req, _res, next) =>
  perms.some((p) => has(req.user, p)) ? next() : next(new HttpError(403, 'Keine Berechtigung für diese Aktion'));

export function need(req, perm) {
  if (!has(req.user, perm)) throw new HttpError(403, 'Keine Berechtigung für diese Aktion');
}

export async function audit(req, action, entity = null, entityId = null, details = null) {
  try {
    await q(
      'INSERT INTO audit_log (user_id, user_name, action, entity, entity_id, details) VALUES (?,?,?,?,?,?)',
      [req.user?.id ?? null, req.user?.name ?? null, action, entity, entityId == null ? null : String(entityId),
        details ? String(details).slice(0, 500) : null],
    );
  } catch (err) {
    console.error('[audit]', err.message);
  }
}
