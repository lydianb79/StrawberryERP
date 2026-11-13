import { useCallback, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './lib.js';
import { AuthCtx, useAuth } from './auth.js';
import { Icon, Modal, Field, useToast } from './components/ui.jsx';
import Login, { ResetPassword } from './pages/Login.jsx';
import { Recurring } from './pages/Billing.jsx';
import { Projects, TimeTracking } from './pages/Projects.jsx';
import { Warehouses, Stocktakes } from './pages/Stock.jsx';
import { Employees, PayrollRuns } from './pages/Payroll.jsx';
import Reconcile from './pages/Reconcile.jsx';
import Dashboard from './pages/Dashboard.jsx';
import { Customers, Suppliers, Accounts, CostCenters, Currencies } from './pages/MasterData.jsx';
import { Products, StockMovements } from './pages/Inventory.jsx';
import DocumentList from './pages/DocumentList.jsx';
import DocumentEditor from './pages/DocumentEditor.jsx';
import { Receivables, Payables } from './pages/OpenItems.jsx';
import { Journal, BalanceSheet, IncomeStatement, FiscalYears } from './pages/Accounting.jsx';
import Reports from './pages/Reports.jsx';
import { Users, Roles, CompanySettings, LayoutSettings, AuditLog, MailSettings, SystemInfo } from './pages/Admin.jsx';


const NAV = [
  { title: null, items: [{ to: '/', label: 'Dashboard', icon: 'home', end: true }] },
  { title: 'Verkauf', items: [
    { to: '/kunden', label: 'Kunden', icon: 'users', perm: 'customers.read' },
    { to: '/offerten', label: 'Offerten', icon: 'file', perm: 'quotes.read' },
    { to: '/auftraege', label: 'Aufträge', icon: 'cart', perm: 'orders.read' },
    { to: '/rechnungen', label: 'Rechnungen', icon: 'receipt', perm: 'invoices.read' },
    { to: '/gutschriften', label: 'Gutschriften', icon: 'undo', perm: 'invoices.read' },
    { to: '/abos', label: 'Abo-Rechnungen', icon: 'repeat', perm: 'invoices.read' },
  ] },
  { title: 'Projekte', items: [
    { to: '/projekte', label: 'Projekte', icon: 'folder', perm: 'projects.read' },
    { to: '/zeiterfassung', label: 'Zeiterfassung', icon: 'timer', perm: 'time.write' },
  ] },
  { title: 'Lager & Einkauf', items: [
    { to: '/artikel', label: 'Artikel & Lager', icon: 'box', perm: 'inventory.read' },
    { to: '/lagerbewegungen', label: 'Lagerbewegungen', icon: 'swap', perm: 'inventory.read' },
    { to: '/lagerorte', label: 'Lagerorte', icon: 'warehouse', perm: 'inventory.read' },
    { to: '/inventur', label: 'Inventur', icon: 'clipboard', perm: 'inventory.read' },
    { to: '/bestellungen', label: 'Bestellungen', icon: 'cart', perm: 'purchasing.read' },
    { to: '/lieferanten', label: 'Lieferanten', icon: 'truck', perm: 'suppliers.read' },
  ] },
  { title: 'Finanzen', items: [
    { to: '/debitoren', label: 'Debitoren', icon: 'in', perm: 'receivables.read' },
    { to: '/kreditoren', label: 'Kreditoren', icon: 'out', perm: 'payables.read' },
    { to: '/bankabstimmung', label: 'Bankabstimmung', icon: 'bank', perm: 'accounting.read' },
    { to: '/journal', label: 'Journal', icon: 'book', perm: 'accounting.read' },
    { to: '/konten', label: 'Kontenplan', icon: 'list', perm: 'accounting.read' },
    { to: '/kostenstellen', label: 'Kostenstellen', icon: 'target', perm: 'accounting.read' },
    { to: '/bilanz', label: 'Bilanz', icon: 'scale', perm: 'accounting.read' },
    { to: '/erfolgsrechnung', label: 'Erfolgsrechnung', icon: 'trend', perm: 'accounting.read' },
    { to: '/jahresabschluss', label: 'Jahresabschluss', icon: 'calendar', perm: 'accounting.read' },
  ] },
  { title: 'Lohn', items: [
    { to: '/mitarbeitende', label: 'Mitarbeitende', icon: 'users', perm: 'payroll.read' },
    { to: '/lohnlaeufe', label: 'Lohnläufe', icon: 'wallet', perm: 'payroll.read' },
  ] },
  { title: 'Auswertungen', items: [{ to: '/reports', label: 'Reports', icon: 'chart', perm: 'reports.read' }] },
  { title: 'Administration', items: [
    { to: '/admin/benutzer', label: 'Benutzer', icon: 'users', perm: 'admin.users' },
    { to: '/admin/rollen', label: 'Rollen & Rechte', icon: 'shield', perm: 'admin.users' },
    { to: '/admin/firma', label: 'Firma & Nummern', icon: 'building', perm: 'admin.settings' },
    { to: '/admin/waehrungen', label: 'Währungen', icon: 'coins', perm: 'admin.settings' },
    { to: '/admin/layout', label: 'Beleglayout', icon: 'layout', perm: 'admin.settings' },
    { to: '/admin/email', label: 'E-Mail', icon: 'mail', perm: 'admin.settings' },
    { to: '/admin/protokoll', label: 'Protokoll', icon: 'clock', perm: 'admin.settings' },
    { to: '/admin/system', label: 'System & Updates', icon: 'refresh', perm: 'admin.settings' },
  ] },
];

/** Konto & Sicherheit: Passwort ändern und Zwei-Faktor-Anmeldung einrichten. */
function AccountModal({ onClose, onChanged }) {
  const toast = useToast();
  const { user } = useAuth();
  const [form, setForm] = useState({ current: '', password: '', repeat: '' });
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [off, setOff] = useState('');
  const [codes, setCodes] = useState(null);
  const [left, setLeft] = useState(null);
  useEffect(() => { if (user.totp_enabled) api('/auth/2fa/recovery-codes').then(setLeft).catch(() => {}); }, [user.totp_enabled]);
  const submit = async (e) => {
    e.preventDefault();
    if (form.password !== form.repeat) return toast.error('Die neuen Passwörter stimmen nicht überein.');
    try {
      await api('/auth/password', { method: 'POST', body: { current: form.current, password: form.password } });
      toast('Passwort geändert. Andere Sitzungen wurden beendet.');
      return onClose();
    } catch (err) { return toast.error(err.message); }
  };
  const call = async (path, body, message) => {
    try {
      const result = await api(path, { method: 'POST', body });
      if (result?.recoveryCodes) setCodes(result.recoveryCodes);
      if (message) { toast(message); await onChanged(); setSetup(null); setCode(''); setOff(''); }
      return result;
    } catch (err) { toast.error(err.message); return null; }
  };
  const input = (key, label) => (
    <Field label={label}>
      <input className="input" type="password" required minLength={key === 'current' ? 1 : 10} value={form[key]}
        autoComplete={key === 'current' ? 'current-password' : 'new-password'} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
    </Field>
  );
  return (
    <Modal title="Konto & Sicherheit" onClose={onClose}>
      <div className="stack">
        <form onSubmit={submit} className="stack">
          <h3>Passwort ändern</h3>
          {input('current', 'Aktuelles Passwort')}
          {input('password', 'Neues Passwort (mind. 10 Zeichen)')}
          {input('repeat', 'Neues Passwort wiederholen')}
          <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn primary">Passwort speichern</button></div>
        </form>
        <hr style={{ border: 0, borderTop: '1px solid var(--line)', width: '100%' }} />
        <div className="stack">
          <div className="row"><h3>Zwei-Faktor-Anmeldung</h3>{user.totp_enabled ? <span className="badge green">Aktiv</span> : <span className="badge">Nicht aktiv</span>}</div>
          {codes && (
            <div className="alert">
              <b>Wiederherstellungscodes – jetzt sicher aufbewahren.</b> Jeder Code ersetzt einmalig den Code aus der App, falls Ihr Gerät verloren geht. Sie werden nur dieses eine Mal angezeigt.
              <pre className="code" style={{ columnCount: 2, margin: '10px 0' }}>{codes.join('\n')}</pre>
              <button type="button" className="btn sm" onClick={() => navigator.clipboard?.writeText(codes.join('\n')).then(() => toast('Codes kopiert.'))}>Kopieren</button>
            </div>
          )}
          {user.totp_enabled ? (
            <>
              <p className="muted" style={{ margin: 0 }}>Bei jeder Anmeldung wird zusätzlich ein Code aus Ihrer Authenticator-App verlangt. Bei Verlust des Geräts hilft ein Wiederherstellungscode{left ? ` (noch ${left.unused} von ${left.total} unbenutzt)` : ''} – oder ein Administrator setzt den zweiten Faktor zurück.</p>
              <div className="row">
                <input className="input" style={{ maxWidth: 240 }} type="password" placeholder="Passwort zur Bestätigung" autoComplete="current-password" value={off} onChange={(e) => setOff(e.target.value)} />
                <button className="btn" disabled={!off} onClick={() => call('/auth/2fa/recovery-codes', { password: off }, 'Neue Wiederherstellungscodes erzeugt – die alten sind ungültig.')}>Neue Codes</button>
                <button className="btn danger" disabled={!off} onClick={() => call('/auth/2fa/disable', { password: off }, 'Zwei-Faktor-Anmeldung ausgeschaltet.')}>Ausschalten</button>
              </div>
            </>
          ) : !setup ? (
            <>
              <p className="muted" style={{ margin: 0 }}>Schützt Ihr Konto zusätzlich mit einem zeitbasierten Code (Google Authenticator, Microsoft Authenticator, 1Password u.a.).</p>
              <div><button className="btn" onClick={async () => setSetup(await call('/auth/2fa/setup', {}))}><Icon name="shield" /> Einrichten</button></div>
            </>
          ) : (
            <>
              <p className="muted" style={{ margin: 0 }}>1. QR-Code mit der Authenticator-App scannen (oder den Schlüssel von Hand eingeben). 2. Den angezeigten Code hier bestätigen.</p>
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <img src={setup.qr} alt="QR-Code für die Authenticator-App" width="170" height="170" style={{ border: '1px solid var(--line)', borderRadius: 8 }} />
                <div className="stack" style={{ flex: 1, minWidth: 200 }}>
                  <Field label="Schlüssel"><input className="input" readOnly value={setup.secret.replace(/(.{4})/g, '$1 ').trim()} onFocus={(e) => e.target.select()} /></Field>
                  <Field label="Code aus der App"><input className="input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
                  <div><button className="btn primary" disabled={code.replace(/\s/g, '').length !== 6} onClick={() => call('/auth/2fa/enable', { code }, 'Zwei-Faktor-Anmeldung aktiviert.')}>Aktivieren</button></div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

function Shell({ children }) {
  const { user, can, settings, logout, reloadUser } = useAuth();
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  const initials = user.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="app">
      <aside className={`sidebar no-print ${open ? 'open' : ''}`} onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
        <div className="brand"><img src="/favicon.svg" alt="" /><span>Strawberry<span>ERP</span></span></div>
        {NAV.map((group, i) => {
          const items = group.items.filter((it) => !it.perm || can(it.perm));
          if (!items.length) return null;
          return (
            <nav className="nav-group" key={i}>
              {group.title && <div className="nav-title">{group.title}</div>}
              {items.map((it) => (
                <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                  <Icon name={it.icon} /> {it.label}
                </NavLink>
              ))}
            </nav>
          );
        })}
        <div className="sidebar-foot">StrawberryERP {settings?.version || ''}</div>
      </aside>
      <div className="main">
        <header className="topbar no-print">
          <button className="icon-btn menu-btn" onClick={() => setOpen(true)} aria-label="Menü"><Icon name="menu" /></button>
          <span className="company">{settings?.company?.name}</span>
          <div className="spacer" />
          <div className="user-chip">
            <div className="avatar">{initials}</div>
            <div>
              <div style={{ fontWeight: 600, lineHeight: 1.2 }}>{user.name}</div>
              <div className="muted small">{user.role}</div>
            </div>
          </div>
          <button className="icon-btn" title="Konto & Sicherheit" onClick={() => setPw(true)}><Icon name="key" /></button>
          <button className="icon-btn" title="Abmelden" onClick={logout}><Icon name="logout" /></button>
        </header>
        <main className="content">{children}</main>
      </div>
      {pw && <AccountModal onClose={() => setPw(false)} onChanged={reloadUser} />}
    </div>
  );
}

function Guard({ perm, children }) {
  const { can } = useAuth();
  if (perm && !can(perm)) {
    return <div className="card"><div className="empty">Sie haben keine Berechtigung für diesen Bereich.</div></div>;
  }
  return children;
}

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = lädt, null = abgemeldet
  const [settings, setSettings] = useState(null);

  const reloadSettings = useCallback(async () => {
    try { setSettings(await api('/settings')); } catch { /* Anmeldung nötig */ }
  }, []);

  useEffect(() => {
    api('/auth/me').then(setUser).catch(() => setUser(null));
    const onUnauthorized = () => setUser(null);
    window.addEventListener('serp:unauthorized', onUnauthorized);
    return () => window.removeEventListener('serp:unauthorized', onUnauthorized);
  }, []);
  useEffect(() => { if (user) reloadSettings(); }, [user, reloadSettings]);

  const reloadUser = useCallback(() => api('/auth/me').then(setUser).catch(() => setUser(null)), []);
  const can = useCallback((perm) => !!user && (user.permissions.includes('*') || user.permissions.includes(perm)), [user]);
  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
  }, []);

  if (window.location.pathname === '/passwort-zuruecksetzen') return <ResetPassword />;
  if (user === undefined) return <div className="empty">Lädt…</div>;
  if (!user) return <Login onLogin={setUser} />;

  const doc = (type, perm) => (
    <>
      <Route path="" element={<Guard perm={`${perm}.read`}><DocumentList type={type} /></Guard>} />
      <Route path=":id" element={<Guard perm={`${perm}.read`}><DocumentEditor type={type} /></Guard>} />
    </>
  );

  return (
    <AuthCtx.Provider value={{ user, can, settings, reloadSettings, logout, reloadUser }}>
      <Shell>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/kunden" element={<Guard perm="customers.read"><Customers /></Guard>} />
          <Route path="/lieferanten" element={<Guard perm="suppliers.read"><Suppliers /></Guard>} />
          <Route path="/artikel" element={<Guard perm="inventory.read"><Products /></Guard>} />
          <Route path="/lagerbewegungen" element={<Guard perm="inventory.read"><StockMovements /></Guard>} />
          <Route path="/offerten">{doc('quote', 'quotes')}</Route>
          <Route path="/auftraege">{doc('order', 'orders')}</Route>
          <Route path="/rechnungen">{doc('invoice', 'invoices')}</Route>
          <Route path="/gutschriften">{doc('credit', 'invoices')}</Route>
          <Route path="/abos" element={<Guard perm="invoices.read"><Recurring /></Guard>} />
          <Route path="/projekte" element={<Guard perm="projects.read"><Projects /></Guard>} />
          <Route path="/zeiterfassung" element={<Guard perm="time.write"><TimeTracking /></Guard>} />
          <Route path="/lagerorte" element={<Guard perm="inventory.read"><Warehouses /></Guard>} />
          <Route path="/inventur" element={<Guard perm="inventory.read"><Stocktakes /></Guard>} />
          <Route path="/bankabstimmung" element={<Guard perm="accounting.read"><Reconcile /></Guard>} />
          <Route path="/mitarbeitende" element={<Guard perm="payroll.read"><Employees /></Guard>} />
          <Route path="/lohnlaeufe" element={<Guard perm="payroll.read"><PayrollRuns /></Guard>} />
          <Route path="/bestellungen">{doc('purchase', 'purchasing')}</Route>
          <Route path="/kostenstellen" element={<Guard perm="accounting.read"><CostCenters /></Guard>} />
          <Route path="/admin/waehrungen" element={<Guard perm="admin.settings"><Currencies /></Guard>} />
          <Route path="/admin/email" element={<Guard perm="admin.settings"><MailSettings /></Guard>} />
          <Route path="/admin/system" element={<Guard perm="admin.settings"><SystemInfo /></Guard>} />
          <Route path="/debitoren" element={<Guard perm="receivables.read"><Receivables /></Guard>} />
          <Route path="/kreditoren" element={<Guard perm="payables.read"><Payables /></Guard>} />
          <Route path="/journal" element={<Guard perm="accounting.read"><Journal /></Guard>} />
          <Route path="/konten" element={<Guard perm="accounting.read"><Accounts /></Guard>} />
          <Route path="/bilanz" element={<Guard perm="accounting.read"><BalanceSheet /></Guard>} />
          <Route path="/erfolgsrechnung" element={<Guard perm="accounting.read"><IncomeStatement /></Guard>} />
          <Route path="/jahresabschluss" element={<Guard perm="accounting.read"><FiscalYears /></Guard>} />
          <Route path="/reports" element={<Guard perm="reports.read"><Reports /></Guard>} />
          <Route path="/admin/benutzer" element={<Guard perm="admin.users"><Users /></Guard>} />
          <Route path="/admin/rollen" element={<Guard perm="admin.users"><Roles /></Guard>} />
          <Route path="/admin/firma" element={<Guard perm="admin.settings"><CompanySettings /></Guard>} />
          <Route path="/admin/layout" element={<Guard perm="admin.settings"><LayoutSettings /></Guard>} />
          <Route path="/admin/protokoll" element={<Guard perm="admin.settings"><AuditLog /></Guard>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </AuthCtx.Provider>
  );
}
