import { useCallback, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './lib.js';
import { AuthCtx, useAuth } from './auth.js';
import { Icon, Modal, Field, useToast } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import { Customers, Suppliers, Accounts } from './pages/MasterData.jsx';
import { Products, StockMovements } from './pages/Inventory.jsx';
import DocumentList from './pages/DocumentList.jsx';
import DocumentEditor from './pages/DocumentEditor.jsx';
import { Receivables, Payables } from './pages/OpenItems.jsx';
import { Journal, BalanceSheet, IncomeStatement, FiscalYears } from './pages/Accounting.jsx';
import Reports from './pages/Reports.jsx';
import { Users, Roles, CompanySettings, LayoutSettings, AuditLog } from './pages/Admin.jsx';


const NAV = [
  { title: null, items: [{ to: '/', label: 'Dashboard', icon: 'home', end: true }] },
  { title: 'Verkauf', items: [
    { to: '/kunden', label: 'Kunden', icon: 'users', perm: 'customers.read' },
    { to: '/offerten', label: 'Offerten', icon: 'file', perm: 'quotes.read' },
    { to: '/auftraege', label: 'Aufträge', icon: 'cart', perm: 'orders.read' },
    { to: '/rechnungen', label: 'Rechnungen', icon: 'receipt', perm: 'invoices.read' },
  ] },
  { title: 'Lager & Einkauf', items: [
    { to: '/artikel', label: 'Artikel & Lager', icon: 'box', perm: 'inventory.read' },
    { to: '/lagerbewegungen', label: 'Lagerbewegungen', icon: 'swap', perm: 'inventory.read' },
    { to: '/lieferanten', label: 'Lieferanten', icon: 'truck', perm: 'suppliers.read' },
  ] },
  { title: 'Finanzen', items: [
    { to: '/debitoren', label: 'Debitoren', icon: 'in', perm: 'receivables.read' },
    { to: '/kreditoren', label: 'Kreditoren', icon: 'out', perm: 'payables.read' },
    { to: '/journal', label: 'Journal', icon: 'book', perm: 'accounting.read' },
    { to: '/konten', label: 'Kontenplan', icon: 'list', perm: 'accounting.read' },
    { to: '/bilanz', label: 'Bilanz', icon: 'scale', perm: 'accounting.read' },
    { to: '/erfolgsrechnung', label: 'Erfolgsrechnung', icon: 'trend', perm: 'accounting.read' },
    { to: '/jahresabschluss', label: 'Jahresabschluss', icon: 'calendar', perm: 'accounting.read' },
  ] },
  { title: 'Auswertungen', items: [{ to: '/reports', label: 'Reports', icon: 'chart', perm: 'reports.read' }] },
  { title: 'Administration', items: [
    { to: '/admin/benutzer', label: 'Benutzer', icon: 'users', perm: 'admin.users' },
    { to: '/admin/rollen', label: 'Rollen & Rechte', icon: 'shield', perm: 'admin.users' },
    { to: '/admin/firma', label: 'Firma & Nummern', icon: 'building', perm: 'admin.settings' },
    { to: '/admin/layout', label: 'Beleglayout', icon: 'layout', perm: 'admin.settings' },
    { to: '/admin/protokoll', label: 'Protokoll', icon: 'clock', perm: 'admin.settings' },
  ] },
];

function PasswordModal({ onClose }) {
  const toast = useToast();
  const [form, setForm] = useState({ current: '', password: '', repeat: '' });
  const submit = async (e) => {
    e.preventDefault();
    if (form.password !== form.repeat) return toast.error('Die neuen Passwörter stimmen nicht überein.');
    try {
      await api('/auth/password', { method: 'POST', body: { current: form.current, password: form.password } });
      toast('Passwort geändert.');
      onClose();
    } catch (err) { toast.error(err.message); }
  };
  const input = (key, label) => (
    <Field label={label}>
      <input className="input" type="password" required minLength={key === 'current' ? 1 : 10} value={form[key]}
        autoComplete={key === 'current' ? 'current-password' : 'new-password'} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
    </Field>
  );
  return (
    <Modal title="Passwort ändern" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        {input('current', 'Aktuelles Passwort')}
        {input('password', 'Neues Passwort (mind. 10 Zeichen)')}
        {input('repeat', 'Neues Passwort wiederholen')}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
          <button className="btn primary">Speichern</button>
        </div>
      </form>
    </Modal>
  );
}

function Shell({ children }) {
  const { user, can, settings, logout } = useAuth();
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
        <div className="sidebar-foot">StrawberryERP 1.0</div>
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
          <button className="icon-btn" title="Passwort ändern" onClick={() => setPw(true)}><Icon name="key" /></button>
          <button className="icon-btn" title="Abmelden" onClick={logout}><Icon name="logout" /></button>
        </header>
        <main className="content">{children}</main>
      </div>
      {pw && <PasswordModal onClose={() => setPw(false)} />}
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

  const can = useCallback((perm) => !!user && (user.permissions.includes('*') || user.permissions.includes(perm)), [user]);
  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
  }, []);

  if (user === undefined) return <div className="empty">Lädt…</div>;
  if (!user) return <Login onLogin={setUser} />;

  const doc = (type, perm) => (
    <>
      <Route path="" element={<Guard perm={`${perm}.read`}><DocumentList type={type} /></Guard>} />
      <Route path=":id" element={<Guard perm={`${perm}.read`}><DocumentEditor type={type} /></Guard>} />
    </>
  );

  return (
    <AuthCtx.Provider value={{ user, can, settings, reloadSettings, logout }}>
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
