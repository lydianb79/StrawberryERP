import jwt from 'jsonwebtoken';
import { q, one } from './db.js';
import { HttpError, h } from './util.js';
import { getSettings } from './services/settings.js';

export const COOKIE = 'serp_token';
const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 24) {
  console.error('[auth] JWT_SECRET fehlt oder ist zu kurz (mind. 24 Zeichen). Bitte in der .env setzen.');
  process.exit(1);
}

/**
 * Module der Anwendung. Der Administrator kann Module ausschalten (Administration → Module): Ihre Menüpunkte verschwinden
 * für alle Benutzer – auch für Administratoren – und die zugehörigen Funktionen sind gesperrt. Daten bleiben erhalten.
 * Module mit always: true gehören zum Kern und lassen sich nicht ausschalten.
 */
export const MODULES = [
  { key: 'masterdata', label: 'Kunden und Lieferanten', always: true, menu: ['Kunden', 'Lieferanten'],
    description: 'Adressstamm mit Ansprechpersonen, Notizen und Aufgaben. Wird von allen Belegen verwendet.' },
  { key: 'quotes', label: 'Offerten', menu: ['Offerten'], description: 'Angebote erstellen, versenden und in Aufträge oder Rechnungen umwandeln.' },
  { key: 'orders', label: 'Aufträge', menu: ['Aufträge'], description: 'Auftragsbestätigungen, Teillieferungen und Teilrechnungen.' },
  { key: 'invoicing', label: 'Rechnungen', menu: ['Rechnungen', 'Gutschriften', 'Abo-Rechnungen'],
    description: 'Rechnungen mit QR-Zahlteil, Gutschriften und wiederkehrende Rechnungen.' },
  { key: 'receivables', label: 'Debitoren', menu: ['Debitoren'], description: 'Offene Posten, Zahlungseingänge, Mahnwesen und Zahlungsabgleich mit Kontoauszügen.' },
  { key: 'inventory', label: 'Artikel und Lager', menu: ['Artikel & Lager', 'Lagerbewegungen', 'Lagerorte', 'Inventur'],
    description: 'Artikelstamm, Preislisten, Lagerorte, Chargen und Inventur. Ohne dieses Modul sind in Belegen nur freie Positionen möglich.' },
  { key: 'purchasing', label: 'Einkauf', menu: ['Bestellungen'], description: 'Bestellungen bei Lieferanten und Wareneingang.' },
  { key: 'payables', label: 'Kreditoren', menu: ['Kreditoren'], description: 'Lieferantenrechnungen, Zahlungen und Zahlungsdateien für das E-Banking.' },
  { key: 'projects', label: 'Projekte und Zeiterfassung', menu: ['Projekte', 'Zeiterfassung'], description: 'Projekte, Arbeitszeit und Verrechnung offener Stunden.' },
  { key: 'accounting', label: 'Finanzbuchhaltung', menu: ['Bankabstimmung', 'Journal', 'Kontenplan', 'Kostenstellen', 'Bilanz', 'Erfolgsrechnung', 'Jahresabschluss'],
    description: 'Journal, Bilanz, Erfolgsrechnung und Jahresabschluss. Ausgeschaltet werden Belege weiterhin im Hintergrund verbucht – nur die Ansicht entfällt.' },
  { key: 'payroll', label: 'Lohn', menu: ['Mitarbeitende', 'Lohnläufe'], description: 'Personalstamm, Lohnläufe, Lohnabrechnungen und Lohnausweise.' },
  { key: 'reports', label: 'Auswertungen', menu: ['Reports'], description: 'Umsatz, Fälligkeiten, Lagerbewertung, Kostenstellen, MwSt-Abrechnung und Kennzahlen auf dem Dashboard.' },
  { key: 'admin', label: 'Administration', always: true, menu: ['Benutzer', 'Rollen & Rechte', 'Module', 'Firma & Nummern', 'Währungen', 'Beleglayout', 'E-Mail', 'Protokoll', 'System & Updates'],
    description: 'Benutzer, Rollen, Module und Einstellungen.' },
];

const P = (key, module, group, label, description, implies = []) => ({ key, module, group, label, description, implies });

/**
 * Katalog aller Berechtigungen. implies: Rechte, die automatisch mitgelten (wer bearbeiten darf, darf auch ansehen).
 */
export const PERMISSIONS = [
  P('customers.read', 'masterdata', 'Kunden', 'Kunden ansehen', 'Kundenliste, Ansprechpersonen, Notizen und Aufgaben einsehen.'),
  P('customers.write', 'masterdata', 'Kunden', 'Kunden bearbeiten', 'Kunden anlegen, ändern und löschen; Ansprechpersonen pflegen.', ['customers.read']),
  P('suppliers.read', 'masterdata', 'Lieferanten', 'Lieferanten ansehen', 'Lieferantenliste und Ansprechpersonen einsehen.'),
  P('suppliers.write', 'masterdata', 'Lieferanten', 'Lieferanten bearbeiten', 'Lieferanten anlegen, ändern und löschen.', ['suppliers.read']),
  P('quotes.read', 'quotes', 'Offerten', 'Offerten ansehen', 'Offerten und ihre PDF einsehen.'),
  P('quotes.write', 'quotes', 'Offerten', 'Offerten bearbeiten', 'Offerten erstellen, ändern, per E-Mail senden und ihren Status setzen.', ['quotes.read']),
  P('orders.read', 'orders', 'Aufträge', 'Aufträge ansehen', 'Aufträge und Auftragsbestätigungen einsehen.'),
  P('orders.write', 'orders', 'Aufträge', 'Aufträge bearbeiten', 'Aufträge erstellen, ausliefern (Lagerabgang) und stornieren.', ['orders.read']),
  P('invoices.read', 'invoicing', 'Rechnungen', 'Rechnungen ansehen', 'Rechnungen, Gutschriften und Abo-Rechnungen einsehen.'),
  P('invoices.write', 'invoicing', 'Rechnungen', 'Rechnungen bearbeiten', 'Rechnungen und Gutschriften erstellen, buchen, stornieren und versenden; Abo-Rechnungen verwalten.', ['invoices.read']),
  P('receivables.read', 'receivables', 'Debitoren', 'Offene Posten ansehen', 'Offene Kundenrechnungen, Fälligkeiten und Mahnungen einsehen.'),
  P('receivables.write', 'receivables', 'Debitoren', 'Zahlungen und Mahnungen', 'Zahlungseingänge erfassen und stornieren, Mahnlauf durchführen, Mahnungen versenden.', ['receivables.read']),
  P('banking.import', 'receivables', 'Debitoren', 'Kontoauszüge einlesen', 'Kontoauszüge (camt) hochladen und Zahlungen den Rechnungen zuordnen.', ['receivables.read']),
  P('inventory.read', 'inventory', 'Artikel und Lager', 'Artikel und Lager ansehen', 'Artikel, Bestände, Lagerbewegungen, Lagerorte und Inventuren einsehen.'),
  P('inventory.write', 'inventory', 'Artikel und Lager', 'Artikel und Lager bearbeiten', 'Artikel und Preise pflegen, Lager buchen, umlagern, Inventur durchführen.', ['inventory.read']),
  P('purchasing.read', 'purchasing', 'Einkauf', 'Bestellungen ansehen', 'Bestellungen bei Lieferanten einsehen.'),
  P('purchasing.write', 'purchasing', 'Einkauf', 'Bestellungen bearbeiten', 'Bestellungen erstellen, auslösen und Wareneingänge buchen.', ['purchasing.read']),
  P('payables.read', 'payables', 'Kreditoren', 'Kreditoren ansehen', 'Lieferantenrechnungen, offene Posten und abgelegte Belege einsehen.'),
  P('payables.write', 'payables', 'Kreditoren', 'Kreditoren bearbeiten', 'Lieferantenrechnungen erfassen und stornieren, Zahlungen buchen, Zahlungsdateien erstellen.', ['payables.read']),
  P('projects.read', 'projects', 'Projekte', 'Projekte ansehen', 'Projekte und die Zeiten aller Mitarbeitenden einsehen.'),
  P('projects.write', 'projects', 'Projekte', 'Projekte verwalten', 'Projekte anlegen, Zeiten aller Personen ändern und offene Stunden abrechnen (Rechnung braucht zusätzlich «Rechnungen bearbeiten»).', ['projects.read', 'time.write']),
  P('time.write', 'projects', 'Projekte', 'Eigene Zeit erfassen', 'Eigene Arbeitszeit auf Projekte buchen und eigene Einträge ändern.'),
  P('accounting.read', 'accounting', 'Finanzbuchhaltung', 'Buchhaltung ansehen', 'Journal, Kontenplan, Bilanz, Erfolgsrechnung und Bankabstimmung einsehen; Journal exportieren.'),
  P('accounting.write', 'accounting', 'Finanzbuchhaltung', 'Buchen', 'Manuell buchen und stornieren, Kontenplan und Kostenstellen pflegen, Bank abstimmen, Abschlussarbeiten buchen.', ['accounting.read']),
  P('accounting.close', 'accounting', 'Finanzbuchhaltung', 'Jahresabschluss', 'Geschäftsjahre anlegen, abschliessen und wieder öffnen.', ['accounting.read']),
  P('payroll.read', 'payroll', 'Lohn', 'Lohndaten ansehen', 'Mitarbeitende, Löhne, Lohnabrechnungen und Lohnausweise einsehen. Vertrauliche Daten.'),
  P('payroll.write', 'payroll', 'Lohn', 'Lohn bearbeiten', 'Personalstamm pflegen, Lohnläufe erstellen, buchen, auszahlen und stornieren.', ['payroll.read']),
  P('reports.read', 'reports', 'Auswertungen', 'Auswertungen ansehen', 'Reports und die Finanzkennzahlen auf dem Dashboard einsehen.'),
  P('admin.users', 'admin', 'Administration', 'Benutzer und Rollen', 'Benutzer anlegen, Passwörter und Zwei-Faktor-Anmeldung zurücksetzen, Rollen und ihre Rechte festlegen.'),
  P('admin.settings', 'admin', 'Administration', 'Einstellungen', 'Module, Firmendaten, Nummernkreise, Währungen, Beleglayout, E-Mail-Server, Mahnstufen und Lohnsätze ändern; Protokoll und Systemstatus einsehen.'),
];

const BY_KEY = new Map(PERMISSIONS.map((p) => [p.key, p]));

/**
 * Wirksame Rechte: die Rechte der Rolle samt allem, was sie einschliessen (bearbeiten → ansehen),
 * ohne die Rechte ausgeschalteter Module. Das Sonderrecht '*' (Administrator) steht für alle Rechte.
 */
export function effectivePermissions(rolePermissions, modules = {}) {
  const out = new Set();
  const add = (key) => {
    const p = BY_KEY.get(key);
    if (!p || out.has(key)) return;
    out.add(key);
    p.implies.forEach(add);
  };
  (rolePermissions.includes('*') ? PERMISSIONS.map((p) => p.key) : rolePermissions).forEach(add);
  const enabled = (m) => MODULES.find((x) => x.key === m)?.always || modules[m] !== false;
  return PERMISSIONS.filter((p) => out.has(p.key) && enabled(p.module)).map((p) => p.key);
}

/** tv = Token-Version des Benutzers: ändert sie sich (Passwortwechsel, Reset), werden alle bestehenden Sitzungen ungültig. */
export const signToken = (userId, tokenVersion = 0) => jwt.sign({ uid: userId, tv: tokenVersion }, SECRET, { expiresIn: '12h' });

export const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.COOKIE_SECURE === 'true',
  maxAge: 12 * 60 * 60 * 1000,
  path: '/',
});

export async function loadUser(id) {
  const user = await one(
    `SELECT u.id, u.email, u.name, u.active, u.role_id, u.token_version, u.totp_enabled, r.name AS role
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
    [id],
  );
  if (!user || !user.active) return null;
  const perms = (await q('SELECT permission FROM role_permissions WHERE role_id = ?', [user.role_id])).map((p) => p.permission);
  const { modules } = await getSettings();
  user.is_admin = perms.includes('*');
  user.permissions = effectivePermissions(perms, modules);
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
  if ((payload.tv ?? 0) !== user.token_version) throw new HttpError(401, 'Sitzung wurde beendet – bitte neu anmelden');
  req.user = user;
  next();
});

export const has = (user, perm) => user.permissions.includes(perm);

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
