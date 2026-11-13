import { useCallback, useEffect, useRef, useState } from 'react';
import { api, fmtDate, fmtDateTime } from '../lib.js';
import { useAuth } from '../auth.js';
import { AutoField, DataTable, Field, Icon, Modal, PageHead, useToast } from '../components/ui.jsx';

// ---------- Benutzer ----------
export function Users() {
  const toast = useToast();
  const { user: me } = useAuth();
  const [rows, setRows] = useState(null);
  const [roles, setRoles] = useState([]);
  const [editing, setEditing] = useState(null);

  const load = useCallback(() => {
    api('/users').then(setRows).catch((e) => { setRows([]); toast.error(e.message); });
    api('/roles').then(setRoles).catch(() => {});
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const save = async (e) => {
    e.preventDefault();
    try {
      const body = { name: editing.name, email: editing.email, role_id: editing.role_id, active: editing.active, password: editing.password || undefined };
      if (editing.id) await api(`/users/${editing.id}`, { method: 'PUT', body });
      else await api('/users', { method: 'POST', body });
      toast('Benutzer gespeichert.');
      setEditing(null);
      load();
    } catch (err) { toast.error(err.message); }
  };
  const remove = async () => {
    if (!window.confirm(`Benutzer «${editing.name}» wirklich löschen?`)) return;
    try { await api(`/users/${editing.id}`, { method: 'DELETE' }); toast('Benutzer gelöscht.'); setEditing(null); load(); } catch (err) { toast.error(err.message); }
  };
  const set = (name) => (v) => setEditing((cur) => ({ ...cur, [name]: v }));

  return (
    <>
      <PageHead title="Benutzer" subtitle="Benutzerkonten und Rollenzuweisung">
        <button className="btn primary" onClick={() => setEditing({ name: '', email: '', role_id: '', active: true, password: '' })}><Icon name="plus" /> Neuer Benutzer</button>
      </PageHead>
      <DataTable rows={rows} onRowClick={(r) => setEditing({ ...r, active: !!r.active, password: '' })} columns={[
        { key: 'name', label: 'Name', render: (r) => <b>{r.name}</b> },
        { key: 'email', label: 'E-Mail' },
        { key: 'role', label: 'Rolle', render: (r) => <span className="badge blue">{r.role}</span> },
        { key: 'last_login', label: 'Letzte Anmeldung', render: (r) => fmtDateTime(r.last_login) },
        { key: 'active', label: 'Status', render: (r) => (r.active ? <span className="badge green">Aktiv</span> : <span className="badge">Deaktiviert</span>) },
      ]} />
      {editing && (
        <Modal title={editing.id ? 'Benutzer bearbeiten' : 'Neuer Benutzer'} onClose={() => setEditing(null)}>
          <form onSubmit={save}>
            <div className="form-grid">
              <AutoField field={{ label: 'Name', required: true }} value={editing.name} onChange={set('name')} />
              <AutoField field={{ label: 'E-Mail', type: 'email', required: true }} value={editing.email} onChange={set('email')} />
              <AutoField field={{ label: 'Rolle', type: 'select', required: true, options: roles.map((r) => ({ value: r.id, label: r.name })) }} value={editing.role_id} onChange={set('role_id')} />
              <AutoField field={{ label: editing.id ? 'Neues Passwort' : 'Passwort', type: 'password', required: !editing.id, hint: editing.id ? 'Leer lassen = unverändert' : 'Mindestens 10 Zeichen' }} value={editing.password} onChange={set('password')} />
              <AutoField field={{ label: 'Konto aktiv', type: 'checkbox' }} value={editing.active} onChange={set('active')} />
            </div>
            <div className="row" style={{ marginTop: 20 }}>
              {editing.id && editing.id !== me.id && <button type="button" className="btn danger" onClick={remove}><Icon name="trash" /> Löschen</button>}
              <div className="spacer" />
              <button type="button" className="btn" onClick={() => setEditing(null)}>Abbrechen</button>
              <button className="btn primary">Speichern</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

// ---------- Rollen ----------
export function Roles() {
  const toast = useToast();
  const [roles, setRoles] = useState(null);
  const [perms, setPerms] = useState([]);
  const [editing, setEditing] = useState(null);

  const load = useCallback(() => api('/roles').then(setRoles).catch((e) => { setRoles([]); toast.error(e.message); }), [toast]);
  useEffect(() => { load(); api('/permissions').then(setPerms).catch(() => {}); }, [load]);

  const groups = [...new Set(perms.map((p) => p.group))];
  const toggle = (key) => setEditing((cur) => ({ ...cur, permissions: cur.permissions.includes(key) ? cur.permissions.filter((p) => p !== key) : [...cur.permissions, key] }));
  const save = async (e) => {
    e.preventDefault();
    try {
      if (editing.id) await api(`/roles/${editing.id}`, { method: 'PUT', body: editing });
      else await api('/roles', { method: 'POST', body: editing });
      toast('Rolle gespeichert.');
      setEditing(null);
      load();
    } catch (err) { toast.error(err.message); }
  };
  const remove = async () => {
    if (!window.confirm(`Rolle «${editing.name}» löschen?`)) return;
    try { await api(`/roles/${editing.id}`, { method: 'DELETE' }); toast('Rolle gelöscht.'); setEditing(null); load(); } catch (err) { toast.error(err.message); }
  };

  return (
    <>
      <PageHead title="Rollen & Rechte" subtitle="Rollenbasierte Zugriffssteuerung: Jede Rolle bündelt Berechtigungen pro Modul">
        <button className="btn primary" onClick={() => setEditing({ name: '', description: '', permissions: [] })}><Icon name="plus" /> Neue Rolle</button>
      </PageHead>
      <DataTable searchable={false} rows={roles} onRowClick={(r) => setEditing({ ...r })} columns={[
        { key: 'name', label: 'Rolle', render: (r) => <b>{r.name}</b> },
        { key: 'description', label: 'Beschreibung' },
        { key: 'permissions', label: 'Berechtigungen', render: (r) => (r.permissions.includes('*') ? <span className="badge red">Vollzugriff</span> : `${r.permissions.length} von ${perms.length}`) },
        { key: 'user_count', label: 'Benutzer', num: true },
      ]} />
      {editing && (
        <Modal title={editing.id ? `Rolle: ${editing.name}` : 'Neue Rolle'} onClose={() => setEditing(null)} wide>
          <form onSubmit={save}>
            {editing.is_system ? <div className="alert info" style={{ marginBottom: 14 }}>Die Systemrolle «Administrator» hat immer Vollzugriff und kann nicht geändert werden.</div> : null}
            <div className="form-grid">
              <Field label="Name *"><input className="input" required disabled={!!editing.is_system} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
              <Field label="Beschreibung"><input className="input" disabled={!!editing.is_system} value={editing.description || ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Field>
            </div>
            {!editing.is_system && (
              <div className="perm-grid" style={{ marginTop: 18 }}>
                {groups.map((g) => (
                  <div key={g}>
                    <h3>{g}</h3>
                    {perms.filter((p) => p.group === g).map((p) => (
                      <label className="check" key={p.key} style={{ padding: '3px 0' }}>
                        <input type="checkbox" checked={editing.permissions.includes(p.key)} onChange={() => toggle(p.key)} /> {p.label}
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            )}
            <div className="row" style={{ marginTop: 20 }}>
              {editing.id && !editing.is_system && <button type="button" className="btn danger" onClick={remove}><Icon name="trash" /> Löschen</button>}
              <div className="spacer" />
              <button type="button" className="btn" onClick={() => setEditing(null)}>{editing.is_system ? 'Schliessen' : 'Abbrechen'}</button>
              {!editing.is_system && <button className="btn primary">Speichern</button>}
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

// ---------- Firma, Nummernkreise, Konten ----------
function SettingsCard({ title, hint, settingKey, fields, cols = 2 }) {
  const { settings, reloadSettings } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState(null);
  useEffect(() => { if (settings) setForm({ ...settings[settingKey] }); }, [settings, settingKey]);
  if (!form) return null;
  const save = async (e) => {
    e.preventDefault();
    try {
      const body = { ...form };
      for (const f of fields) {
        if (f.type === 'number') body[f.name] = Number(body[f.name]) || 0;
        if (f.list) body[f.name] = String(body[f.name]).split(/[;,\s]+/).map(Number).filter((n) => Number.isFinite(n) && n >= 0);
      }
      await api(`/settings/${settingKey}`, { method: 'PUT', body });
      await reloadSettings();
      toast('Einstellungen gespeichert.');
    } catch (err) { toast.error(err.message); }
  };
  return (
    <form className="card" onSubmit={save}>
      <div className="card-head"><h2>{title}</h2><div className="spacer" /><button className="btn primary sm">Speichern</button></div>
      <div className="card-body">
        {hint && <p className="muted" style={{ marginTop: 0 }}>{hint}</p>}
        <div className={`form-grid cols-${cols}`}>
          {fields.map((f) => <AutoField key={f.name} field={f} value={f.list && Array.isArray(form[f.name]) ? form[f.name].join('; ') : form[f.name]} onChange={(v) => setForm((cur) => ({ ...cur, [f.name]: v }))} />)}
        </div>
      </div>
    </form>
  );
}

export function CompanySettings() {
  const [accounts, setAccounts] = useState([]);
  useEffect(() => { api('/reports/lookup').then((l) => setAccounts(l.accounts)).catch(() => {}); }, []);
  const acc = (name, label) => ({ name, label, type: 'select', required: true, options: accounts.map((a) => ({ value: a.number, label: `${a.number} ${a.name}` })) });
  return (
    <div className="stack">
      <PageHead title="Firma & Nummern" subtitle="Stammdaten der eigenen Firma, Nummernkreise und Standardkonten" />
      <SettingsCard title="Firmendaten" settingKey="company" cols={3} fields={[
        { name: 'name', label: 'Firmenname', required: true, span: 2 }, { name: 'addition', label: 'Zusatz' },
        { name: 'street', label: 'Strasse', span: 2 }, { name: 'country', label: 'Land' },
        { name: 'zip', label: 'PLZ' }, { name: 'city', label: 'Ort', span: 2 },
        { name: 'phone', label: 'Telefon' }, { name: 'email', label: 'E-Mail', type: 'email' }, { name: 'website', label: 'Website' },
        { name: 'vat_no', label: 'UID / MwSt-Nr.', placeholder: 'CHE-123.456.789 MWST' }, { name: 'bank_name', label: 'Bank' }, { name: 'iban', label: 'IBAN', hint: 'CH/LI-IBAN oder QR-IBAN – wird für die QR-Rechnung verwendet' },
        { name: 'bic', label: 'BIC / SWIFT' }, { name: 'currency', label: 'Basiswährung', hint: 'Währung der Buchhaltung – nach den ersten Buchungen nicht mehr ändern' }, { name: 'default_payment_terms', label: 'Zahlungsfrist Standard (Tage)', type: 'number' },
        { name: 'quote_validity_days', label: 'Gültigkeit Offerten (Tage)', type: 'number' }, { name: 'default_vat', label: 'Standard-MwSt-Satz (%)', type: 'number' },
        { name: 'vat_rates', label: 'MwSt-Sätze (%)', list: true, hint: 'Mit Strichpunkt getrennt' },
      ]} />
      <SettingsCard title="Nummernkreise" settingKey="numbering" cols={4}
        hint="Belegnummern werden fortlaufend vergeben, z.B. RE-2026-0001. Mit Jahreszahl beginnt die Zählung in jedem Jahr neu."
        fields={[
          { name: 'quotePrefix', label: 'Präfix Offerten', required: true }, { name: 'orderPrefix', label: 'Präfix Aufträge', required: true },
          { name: 'invoicePrefix', label: 'Präfix Rechnungen', required: true }, { name: 'purchasePrefix', label: 'Präfix Bestellungen', required: true },
          { name: 'digits', label: 'Anzahl Stellen', type: 'number' },
          { name: 'includeYear', label: 'Jahreszahl in der Nummer', type: 'checkbox', span: 2 },
        ]} />
      {accounts.length > 0 && (
        <SettingsCard title="Standardkonten für automatische Buchungen" settingKey="accounting" cols={2}
          hint="Diese Konten werden beim Buchen von Rechnungen, Zahlungen, Lieferantenrechnungen und beim Jahresabschluss verwendet."
          fields={[
            acc('receivables', 'Debitoren'), acc('payables', 'Kreditoren'), acc('bank', 'Standard-Zahlungskonto'), acc('revenue', 'Erlöskonto'),
            acc('vatPayable', 'Geschuldete MwSt'), acc('vatInput', 'Vorsteuer'), acc('retainedEarnings', 'Gewinnvortrag'), acc('yearResult', 'Jahresgewinn/-verlust'),
            acc('fxGain', 'Kursgewinne'), acc('fxLoss', 'Kursverluste'),
          ]} />
      )}
    </div>
  );
}

// ---------- Beleglayout ----------
const TEMPLATES = [['classic', 'Klassisch'], ['modern', 'Modern (Farbflächen)'], ['minimal', 'Minimal (Schwarz-Weiss)']];

export function LayoutSettings() {
  const { settings, reloadSettings } = useAuth();
  const toast = useToast();
  const [layout, setLayout] = useState(null);
  const [type, setType] = useState('invoice');
  const [logoVersion, setLogoVersion] = useState(0);
  const [hasLogo, setHasLogo] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const fileRef = useRef(null);
  const urlRef = useRef(null);

  useEffect(() => { if (settings && !layout) { setLayout({ ...settings.layout }); setHasLogo(settings.hasLogo); } }, [settings, layout]);

  // Live-Vorschau (verzögert, damit nicht bei jedem Tastendruck gerendert wird)
  useEffect(() => {
    if (!layout) return undefined;
    const timer = setTimeout(async () => {
      try {
        const res = await api('/layout-preview', { method: 'POST', body: { layout, type }, raw: true });
        const url = URL.createObjectURL(await res.blob());
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = url;
        setPreviewUrl(url);
      } catch (err) { toast.error(err.message); }
    }, 450);
    return () => clearTimeout(timer);
  }, [layout, type, logoVersion, toast]);
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  if (!layout) return <div className="empty">Lädt…</div>;
  const set = (patch) => setLayout((l) => ({ ...l, ...patch }));
  const check = (name, label) => (
    <label className="check"><input type="checkbox" checked={!!layout[name]} onChange={(e) => set({ [name]: e.target.checked })} /> {label}</label>
  );

  const save = async () => {
    try {
      await api('/settings/layout', { method: 'PUT', body: { ...layout, logoWidth: Number(layout.logoWidth) || 150 } });
      await reloadSettings();
      toast('Beleglayout gespeichert.');
    } catch (err) { toast.error(err.message); }
  };

  const upload = (file) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) return toast.error('Bitte ein PNG- oder JPEG-Bild wählen.');
    if (file.size > 2 * 1024 * 1024) return toast.error('Das Logo darf höchstens 2 MB gross sein.');
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await api('/settings-logo', { method: 'POST', body: { dataUrl: reader.result } });
        setHasLogo(true);
        setLogoVersion((v) => v + 1);
        reloadSettings();
        toast('Logo hochgeladen.');
      } catch (err) { toast.error(err.message); }
    };
    reader.readAsDataURL(file);
  };
  const removeLogo = async () => {
    try { await api('/settings-logo', { method: 'DELETE' }); setHasLogo(false); setLogoVersion((v) => v + 1); reloadSettings(); toast('Logo entfernt.'); } catch (err) { toast.error(err.message); }
  };

  const textField = (name, label) => (
    <Field label={label}><textarea className="input" rows={2} value={layout[name] || ''} onChange={(e) => set({ [name]: e.target.value })} /></Field>
  );

  return (
    <>
      <PageHead title="Beleglayout" subtitle="Logo, Farben, Schrift und Texte für Offerten, Auftragsbestätigungen und Rechnungen">
        <button className="btn primary" onClick={save}><Icon name="check" /> Layout speichern</button>
      </PageHead>
      <div className="grid-2" style={{ alignItems: 'start', gridTemplateColumns: 'minmax(340px, 460px) 1fr' }}>
        <div className="stack">
          <div className="card">
            <div className="card-head"><h2>Logo</h2></div>
            <div className="card-body stack">
              <div className="logo-box">
                {hasLogo ? <img src={`/api/settings-logo?v=${logoVersion}`} alt="Firmenlogo" /> : <span className="muted">Kein Logo hinterlegt – der Firmenname wird gedruckt.</span>}
                <div className="spacer" />
                <input ref={fileRef} type="file" accept="image/png,image/jpeg" hidden onChange={(e) => { upload(e.target.files[0]); e.target.value = ''; }} />
                <button className="btn sm" onClick={() => fileRef.current.click()}>{hasLogo ? 'Ersetzen' : 'Hochladen'}</button>
                {hasLogo && <button className="icon-btn danger" title="Logo entfernen" onClick={removeLogo}><Icon name="trash" /></button>}
              </div>
              <div className="form-grid cols-3">
                <Field label="Position">
                  <select className="input" value={layout.logoPosition} onChange={(e) => set({ logoPosition: e.target.value })}>
                    <option value="left">Links</option><option value="center">Mitte</option><option value="right">Rechts</option>
                  </select>
                </Field>
                <Field label="Breite (pt)"><input className="input num" type="number" min="40" max="300" value={layout.logoWidth} onChange={(e) => set({ logoWidth: e.target.value })} /></Field>
                <div className="field" style={{ justifyContent: 'flex-end' }}>{check('showLogo', 'Logo drucken')}</div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h2>Gestaltung</h2></div>
            <div className="card-body stack">
              <div className="form-grid">
                <Field label="Vorlage">
                  <select className="input" value={layout.template} onChange={(e) => set({ template: e.target.value })}>
                    {TEMPLATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Field>
                <Field label="Schrift">
                  <select className="input" value={layout.font} onChange={(e) => set({ font: e.target.value })}>
                    <option value="Helvetica">Helvetica (serifenlos)</option><option value="Times">Times (Serifen)</option><option value="Courier">Courier (Schreibmaschine)</option>
                  </select>
                </Field>
                <Field label="Akzentfarbe">
                  <div className="row" style={{ flexWrap: 'nowrap' }}>
                    <input className="color-input" type="color" value={layout.accentColor} onChange={(e) => set({ accentColor: e.target.value })} />
                    <input className="input" value={layout.accentColor} onChange={(e) => set({ accentColor: e.target.value })} />
                  </div>
                </Field>
                <Field label="Adressfeld (Fenstercouvert)">
                  <select className="input" value={layout.addressPosition} onChange={(e) => set({ addressPosition: e.target.value })}>
                    <option value="left">Links</option><option value="right">Rechts</option>
                  </select>
                </Field>
              </div>
              <div className="form-grid">
                {check('showSenderLine', 'Absenderzeile über Adresse')}
                {check('showSku', 'Spalte Artikelnummer')}
                {check('showUnit', 'Spalte Einheit')}
                {check('showDiscount', 'Spalte Rabatt (falls vorhanden)')}
                {check('showBankDetails', 'Bankverbindung auf Rechnung')}
                {check('showQrBill', 'QR-Rechnung (Zahlteil) auf Rechnung')}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h2>Standardtexte</h2></div>
            <div className="card-body stack">
              <p className="muted small" style={{ margin: 0 }}>Platzhalter: {'{kunde}'}, {'{nummer}'}, {'{datum}'}, {'{faellig}'}, {'{gueltig}'}, {'{total}'}</p>
              {textField('quoteIntro', 'Offerte – Einleitung')}
              {textField('quoteClosing', 'Offerte – Schlusstext')}
              {textField('orderIntro', 'Auftragsbestätigung – Einleitung')}
              {textField('orderClosing', 'Auftragsbestätigung – Schlusstext')}
              {textField('invoiceIntro', 'Rechnung – Einleitung')}
              {textField('invoiceClosing', 'Rechnung – Schlusstext')}
              {textField('purchaseIntro', 'Bestellung – Einleitung')}
              {textField('purchaseClosing', 'Bestellung – Schlusstext')}
              {textField('footerText', 'Fusszeile (leer = Firmenangaben)')}
            </div>
          </div>
        </div>

        <div className="card" style={{ position: 'sticky', top: 0 }}>
          <div className="card-head">
            <h2>Vorschau</h2><div className="spacer" />
            {previewUrl && <a className="btn sm" href={previewUrl} target="_blank" rel="noreferrer"><Icon name="pdf" /> In neuem Tab</a>}
            <select className="input" style={{ width: 200 }} value={type} onChange={(e) => setType(e.target.value)}>
              <option value="invoice">Rechnung</option><option value="quote">Offerte</option><option value="order">Auftragsbestätigung</option><option value="purchase">Bestellung</option>
            </select>
          </div>
          <div className="card-body">
            {previewUrl ? <iframe className="preview-frame" title="Vorschau" src={`${previewUrl}#toolbar=0&navpanes=0&view=FitH`} /> : <div className="empty">Vorschau wird erstellt…</div>}
          </div>
        </div>
      </div>
    </>
  );
}

// ---------- Protokoll ----------
export function AuditLog() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api('/audit').then(setRows).catch(() => setRows([])); }, []);
  return (
    <>
      <PageHead title="Protokoll" subtitle="Nachvollziehbarkeit: Die letzten 500 Aktionen aller Benutzer" />
      <DataTable rows={rows} exportName="protokoll" columns={[
        { key: 'created_at', label: 'Zeitpunkt', render: (r) => fmtDateTime(r.created_at), csv: (r) => r.created_at },
        { key: 'user_name', label: 'Benutzer' },
        { key: 'action', label: 'Aktion', render: (r) => <span className="badge">{r.action}</span> },
        { key: 'entity', label: 'Objekt' },
        { key: 'entity_id', label: 'ID' },
        { key: 'details', label: 'Details' },
      ]} />
    </>
  );
}

// ---------- E-Mail (SMTP) ----------
const MAIL_TEXTS = [['quote', 'Offerte'], ['order', 'Auftragsbestätigung'], ['invoice', 'Rechnung'], ['purchase', 'Bestellung']];

export function MailSettings() {
  const { settings, reloadSettings } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (settings?.mail && !form) setForm({ ...settings.mail, password: '' }); }, [settings, form]);
  if (!form) return <div className="empty">Lädt…</div>;
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const input = (name, label, props = {}) => (
    <Field label={label} hint={props.hint} className={props.className}>
      <input className="input" type={props.type || 'text'} placeholder={props.placeholder} autoComplete="off" value={form[name] ?? ''} onChange={(e) => set({ [name]: e.target.value })} />
    </Field>
  );
  const save = async (e) => {
    e?.preventDefault();
    try {
      const saved = await api('/settings/mail', { method: 'PUT', body: { ...form, port: Number(form.port) || 587 } });
      setForm({ ...saved, password: '' });
      await reloadSettings();
      toast('E-Mail-Einstellungen gespeichert.');
      return true;
    } catch (err) { toast.error(err.message); return false; }
  };
  const test = async () => {
    if (!testTo) return toast.error('Bitte eine Empfängeradresse für den Test angeben.');
    setBusy(true);
    try {
      if (!(await save())) return undefined;
      await api('/mail-test', { method: 'POST', body: { to: testTo } });
      return toast(`Testnachricht an ${testTo} gesendet.`);
    } catch (err) { return toast.error(err.message); } finally { setBusy(false); }
  };
  return (
    <form className="stack" onSubmit={save}>
      <PageHead title="E-Mail" subtitle="SMTP-Server für den Versand von Offerten, Auftragsbestätigungen, Rechnungen und Bestellungen als PDF">
        <button className="btn primary"><Icon name="check" /> Speichern</button>
      </PageHead>
      <div className="card">
        <div className="card-head"><h2>Postausgangsserver (SMTP)</h2>{form.configured ? <span className="badge green">Eingerichtet</span> : <span className="badge amber">Nicht eingerichtet</span>}</div>
        <div className="card-body">
          <div className="form-grid cols-3">
            {input('host', 'SMTP-Server', { placeholder: 'smtp.ihr-provider.ch', className: 'span-2' })}
            {input('port', 'Port', { type: 'number', hint: '587 (STARTTLS) oder 465 (TLS)' })}
            {input('user', 'Benutzername', { hint: 'Leer = ohne Anmeldung' })}
            <Field label="Passwort" hint={form.passwordSet ? 'Gespeichert – leer lassen, um es beizubehalten' : 'Wird nur auf dem Server gespeichert'}>
              <input className="input" type="password" autoComplete="new-password" placeholder={form.passwordSet ? '••••••••' : ''} value={form.password} onChange={(e) => set({ password: e.target.value })} />
            </Field>
            <div className="field" style={{ justifyContent: 'flex-end' }}>
              <label className="check"><input type="checkbox" checked={!!form.secure} onChange={(e) => set({ secure: e.target.checked })} /> TLS direkt (Port 465)</label>
            </div>
            {input('fromName', 'Absendername', { placeholder: settings?.company?.name })}
            {input('fromAddress', 'Absenderadresse *', { type: 'email', placeholder: 'buchhaltung@ihre-firma.ch' })}
            {input('replyTo', 'Antwort an (Reply-To)', { type: 'email' })}
            {input('bcc', 'Blindkopie (BCC) jeder Nachricht', { type: 'email', hint: 'z.B. für die eigene Ablage' })}
          </div>
          <div className="row" style={{ marginTop: 18 }}>
            <input className="input" style={{ maxWidth: 300 }} type="email" placeholder="Testnachricht an …" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
            <button type="button" className="btn" disabled={busy} onClick={test}><Icon name="mail" /> {busy ? 'Sendet…' : 'Speichern & Testnachricht senden'}</button>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h2>Textvorlagen</h2></div>
        <div className="card-body stack">
          <p className="muted small" style={{ margin: 0 }}>Platzhalter: {'{nummer}'}, {'{kunde}'}, {'{datum}'}, {'{faellig}'}, {'{gueltig}'}, {'{waehrung}'}, {'{total}'}, {'{firma}'}. Betreff und Text lassen sich vor jedem Versand anpassen.</p>
          {MAIL_TEXTS.map(([key, label]) => (
            <div className="form-grid" key={key} style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr)' }}>
              {input(`${key}Subject`, `${label} – Betreff`)}
              <Field label={`${label} – Text`}><textarea className="input" rows={4} value={form[`${key}Body`] || ''} onChange={(e) => set({ [`${key}Body`]: e.target.value })} /></Field>
            </div>
          ))}
        </div>
      </div>
    </form>
  );
}

// ---------- System & Updates ----------
export function SystemInfo() {
  const toast = useToast();
  const [info, setInfo] = useState(null);
  const load = useCallback((refresh) => {
    setInfo(null);
    api(`/system${refresh ? '?refresh=1' : ''}`).then(setInfo).catch((e) => toast.error(e.message));
  }, [toast]);
  useEffect(() => { load(false); }, [load]);
  if (!info) return <div className="empty">Lädt…</div>;
  const tag = info.latest?.tag;
  return (
    <div className="stack">
      <PageHead title="System & Updates" subtitle="Installierte Version, verfügbare Releases und Vorgehen beim Update">
        <button className="btn" onClick={() => load(true)}><Icon name="refresh" /> Jetzt prüfen</button>
      </PageHead>
      {info.updateAvailable && (
        <div className="alert ok"><b>Neue Version {tag} verfügbar</b> (veröffentlicht am {fmtDate(info.latest.published_at)}). <a href={info.latest.url} target="_blank" rel="noreferrer">Release-Notizen ansehen</a></div>
      )}
      {!info.updateAvailable && tag && <div className="alert info">StrawberryERP ist aktuell. Neuestes Release: {tag}.</div>}
      {info.latest?.error && <div className="alert">{info.latest.error}</div>}
      {info.latest?.disabled && <div className="alert">Die automatische Versionsprüfung ist ausgeschaltet (UPDATE_CHECK=false).</div>}
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-head"><h2>Installation</h2></div>
          <div className="card-body">
            <dl className="dl">
              <dt>StrawberryERP</dt><dd>{info.version}</dd>
              <dt>Datenbankschema</dt><dd>Version {info.schemaVersion}</dd>
              <dt>Datenbank</dt><dd>{info.database}</dd>
              <dt>Node.js</dt><dd>{info.node}</dd>
              <dt>Release-Quelle</dt><dd>github.com/{info.repo}</dd>
              <dt>Zuletzt geprüft</dt><dd>{info.checkedAt ? fmtDateTime(info.checkedAt.replace('T', ' ')) + ' UTC' : '–'}</dd>
            </dl>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h2>So wird aktualisiert</h2></div>
          <div className="card-body stack">
            <div>
              <h3>CentOS (native Installation)</h3>
              <pre className="code">cd /root/StrawberryERP{'\n'}sudo bash deploy/update.sh{tag && info.updateAvailable ? ` ${tag}` : ''}</pre>
              <p className="muted small" style={{ margin: 0 }}>Das Skript sichert zuerst die Datenbank, holt das Release, baut die Anwendung neu und prüft danach, ob der Dienst läuft. Schlägt der Start fehl, wird automatisch die vorherige Version wiederhergestellt.</p>
            </div>
            <div>
              <h3>Docker</h3>
              <pre className="code">git fetch --tags && git checkout {tag || 'vX.Y.Z'}{'\n'}docker compose up -d --build</pre>
            </div>
            <p className="muted small" style={{ margin: 0 }}>Anpassungen am Datenbankschema werden beim Start der neuen Version automatisch und genau einmal ausgeführt (Migrationen). Ein Update ist ohne Datenverlust wiederholbar.</p>
          </div>
        </div>
      </div>
      {info.updateAvailable && info.latest.notes && (
        <div className="card">
          <div className="card-head"><h2>Release-Notizen {tag}</h2></div>
          <div className="card-body"><pre className="code" style={{ whiteSpace: 'pre-wrap' }}>{info.latest.notes}</pre></div>
        </div>
      )}
    </div>
  );
}
