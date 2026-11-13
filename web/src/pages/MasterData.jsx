import { useEffect, useState } from 'react';
import CrudPage from '../components/CrudPage.jsx';
import { ACCOUNT_TYPES, LANGUAGES, api } from '../lib.js';
import { Field, Icon, Modal, Tabs, useToast } from '../components/ui.jsx';
import { CrmPanel } from '../components/shared.jsx';
import { fmtDate } from '../lib.js';
import { useAuth } from '../auth.js';

/** Auswahllisten (Währungen, Konten, Lieferanten …) für Formulare. */
export function useLookup() {
  const [lookup, setLookup] = useState(null);
  useEffect(() => { api('/reports/lookup').then(setLookup).catch(() => setLookup({ customers: [], suppliers: [], products: [], accounts: [], years: [], currencies: [], costCenters: [] })); }, []);
  return lookup;
}

/** Ansprechpersonen eines Kunden oder Lieferanten sowie Notizen und Aufgaben zum Kunden. */
function PartnerModal({ partner, kind, writable, users, onClose }) {
  const toast = useToast();
  const [tab, setTab] = useState('contacts');
  const [rows, setRows] = useState(null);
  const blank = { name: '', role: '', email: '', phone: '', mobile: '', is_primary: false };
  const [form, setForm] = useState(blank);
  const key = kind === 'supplier' ? 'supplier_id' : 'customer_id';
  const load = () => api(`/contacts?${key}=${partner.id}`).then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, [partner.id]); // eslint-disable-line
  const save = async (e) => {
    e.preventDefault();
    try {
      if (form.id) await api(`/contacts/${form.id}`, { method: 'PUT', body: form });
      else await api('/contacts', { method: 'POST', body: { ...form, [key]: partner.id } });
      setForm(blank);
      load();
    } catch (err) { toast.error(err.message); }
  };
  const remove = async (c) => {
    if (!window.confirm(`«${c.name}» entfernen?`)) return;
    try { await api(`/contacts/${c.id}`, { method: 'DELETE' }); load(); } catch (err) { toast.error(err.message); }
  };
  const input = (name, label, type = 'text') => (
    <Field label={label}><input className="input" type={type} required={name === 'name'} value={form[name] || ''} onChange={(e) => setForm({ ...form, [name]: e.target.value })} /></Field>
  );
  return (
    <Modal title={`${partner.company} (${partner.number})`} onClose={onClose} wide>
      {kind === 'customer' && <Tabs value={tab} onChange={setTab} tabs={[['contacts', 'Ansprechpersonen'], ['crm', 'Notizen & Aufgaben']]} />}
      {tab === 'crm' ? <CrmPanel customerId={partner.id} users={users} /> : (
        <div className="stack">
          <table className="table">
            <thead><tr><th>Name</th><th>Funktion</th><th>E-Mail</th><th>Telefon</th><th>Mobile</th><th /></tr></thead>
            <tbody>
              {(rows || []).map((c) => (
                <tr key={c.id}>
                  <td><b>{c.name}</b>{!!c.is_primary && <span className="badge blue" style={{ marginLeft: 6 }}>Hauptkontakt</span>}</td>
                  <td>{c.role}</td><td>{c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}</td><td>{c.phone}</td><td>{c.mobile}</td>
                  <td className="actions">{writable && <>
                    <button className="icon-btn" title="Bearbeiten" onClick={() => setForm({ ...c, is_primary: !!c.is_primary })}><Icon name="edit" /></button>
                    <button className="icon-btn danger" title="Entfernen" onClick={() => remove(c)}><Icon name="trash" /></button></>}</td>
                </tr>
              ))}
              {rows && !rows.length && <tr><td colSpan={6} className="muted">Noch keine Ansprechpersonen erfasst.</td></tr>}
            </tbody>
          </table>
          {writable && (
            <form onSubmit={save}>
              <h3 style={{ marginBottom: 8 }}>{form.id ? 'Ansprechperson bearbeiten' : 'Ansprechperson hinzufügen'}</h3>
              <div className="form-grid cols-3">
                {input('name', 'Name *')}{input('role', 'Funktion')}{input('email', 'E-Mail', 'email')}{input('phone', 'Telefon')}{input('mobile', 'Mobile')}
                <div className="field" style={{ justifyContent: 'flex-end' }}><label className="check"><input type="checkbox" checked={!!form.is_primary} onChange={(e) => setForm({ ...form, is_primary: e.target.checked })} /> Hauptkontakt</label></div>
              </div>
              <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
                {form.id && <button type="button" className="btn" onClick={() => setForm(blank)}>Abbrechen</button>}
                <button className="btn primary">{form.id ? 'Speichern' : 'Hinzufügen'}</button>
              </div>
            </form>
          )}
        </div>
      )}
    </Modal>
  );
}

function usePartnerModal(kind, perm) {
  const { can } = useAuth();
  const lookup = useLookup();
  const [partner, setPartner] = useState(null);
  return {
    rowActions: (row) => <button className="btn sm" onClick={() => setPartner(row)}><Icon name="users" /> Kontakte</button>,
    modal: partner && <PartnerModal partner={partner} kind={kind} writable={can(perm)} users={lookup?.users || []} onClose={() => setPartner(null)} />,
  };
}

function RateHistory({ currency, base, onClose }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { api(`/currency-history?code=${currency.code}`).then(setRows).catch(() => setRows([])); }, [currency.code]);
  return (
    <Modal title={`Kursverlauf ${currency.code}`} onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>Neue Belege ohne Kursangabe erhalten den Kurs, der am Belegdatum gültig war.</p>
      <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
        <table className="table">
          <thead><tr><th>Gültig ab</th><th className="num">1 {currency.code} = … {base}</th><th>Quelle</th></tr></thead>
          <tbody>
            {(rows || []).map((r) => <tr key={r.date}><td>{fmtDate(r.date)}</td><td className="num">{r.rate}</td><td>{r.source}</td></tr>)}
            {rows && !rows.length && <tr><td colSpan={3} className="muted">Noch kein Verlauf vorhanden.</td></tr>}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

const activeBadge = (row) => (row.active ? <span className="badge green">Aktiv</span> : <span className="badge">Inaktiv</span>);

const partnerColumns = [
  { key: 'number', label: 'Nr.', render: (r) => <span className="nowrap">{r.number}</span> },
  { key: 'company', label: 'Firma / Name', render: (r) => <b>{r.company}</b> },
  { key: 'contact_name', label: 'Kontakt' },
  { key: 'city', label: 'Ort', render: (r) => [r.zip, r.city].filter(Boolean).join(' ') },
  { key: 'email', label: 'E-Mail' },
  { key: 'phone', label: 'Telefon' },
  { key: 'active', label: 'Status', render: activeBadge, csv: (r) => (r.active ? 'Aktiv' : 'Inaktiv') },
];

const partnerFields = (currencies, extra = []) => [
  { name: 'company', label: 'Firma / Name', required: true, span: 2 },
  { name: 'number', label: 'Nummer', hint: 'Leer lassen für automatische Vergabe' },
  { name: 'contact_name', label: 'Kontaktperson' },
  { name: 'email', label: 'E-Mail', type: 'email' },
  { name: 'phone', label: 'Telefon' },
  { name: 'street', label: 'Strasse', span: 2 },
  { name: 'zip', label: 'PLZ' },
  { name: 'city', label: 'Ort' },
  { name: 'country', label: 'Land' },
  { name: 'vat_no', label: 'UID / MwSt-Nr.' },
  { name: 'payment_terms_days', label: 'Zahlungsfrist (Tage)', type: 'number' },
  { name: 'currency', label: 'Währung', type: 'select', required: true, options: currencies.map((c) => ({ value: c, label: c })) },
  { name: 'language', label: 'Belegsprache', type: 'select', required: true, options: Object.entries(LANGUAGES).map(([value, label]) => ({ value, label })) },
  ...extra,
  { name: 'notes', label: 'Notizen', type: 'textarea', span: 'all' },
  { name: 'active', label: 'Aktiv', type: 'checkbox' },
];

const partnerDefaults = (base) => ({ country: 'Schweiz', payment_terms_days: 30, active: true, currency: base, language: 'de', discount_pct: 0 });

function useCurrencyCodes() {
  const { settings } = useAuth();
  const lookup = useLookup();
  const base = settings?.company?.currency || 'CHF';
  return { base, codes: [...new Set([base, ...(lookup?.currencies || []).map((c) => c.code)])] };
}

export function Customers() {
  const { base, codes } = useCurrencyCodes();
  const contacts = usePartnerModal('customer', 'customers.write');
  return (
    <>{contacts.modal}<CrudPage rowActions={contacts.rowActions} title="Kunden" subtitle="Kundenstamm mit Adressen und Konditionen" endpoint="/customers" writePerm="customers.write"
      columns={partnerColumns} fields={partnerFields(codes, [{ name: 'discount_pct', label: 'Kundenrabatt (%)', type: 'number', hint: 'Wird auf neuen Belegpositionen vorgeschlagen' }])} defaults={partnerDefaults(base)} newLabel="Neuer Kunde" exportName="kunden" /></>
  );
}

export function Suppliers() {
  const { base, codes } = useCurrencyCodes();
  const contacts = usePartnerModal('supplier', 'suppliers.write');
  return (
    <>{contacts.modal}<CrudPage rowActions={contacts.rowActions} title="Lieferanten" subtitle="Lieferantenstamm für Einkauf und Kreditoren" endpoint="/suppliers" writePerm="suppliers.write"
      columns={partnerColumns} fields={partnerFields(codes, [{ name: 'iban', label: 'IBAN' }])} defaults={partnerDefaults(base)}
      newLabel="Neuer Lieferant" exportName="lieferanten" /></>
  );
}

export function Accounts() {
  return (
    <CrudPage title="Kontenplan" subtitle="Konten der Finanzbuchhaltung (Kontenrahmen KMU)" endpoint="/accounting/accounts" writePerm="accounting.write"
      newLabel="Neues Konto" exportName="kontenplan" defaults={{ type: 'expense', active: true }}
      columns={[
        { key: 'number', label: 'Konto' },
        { key: 'name', label: 'Bezeichnung', render: (r) => <b>{r.name}</b> },
        { key: 'type', label: 'Kontenart', render: (r) => ACCOUNT_TYPES[r.type], csv: (r) => ACCOUNT_TYPES[r.type] },
        { key: 'active', label: 'Status', render: activeBadge, csv: (r) => (r.active ? 'Aktiv' : 'Inaktiv') },
      ]}
      fields={[
        { name: 'number', label: 'Kontonummer', required: true },
        { name: 'type', label: 'Kontenart', type: 'select', required: true, options: Object.entries(ACCOUNT_TYPES).map(([value, label]) => ({ value, label })) },
        { name: 'name', label: 'Bezeichnung', required: true, span: 2 },
        { name: 'active', label: 'Aktiv', type: 'checkbox' },
      ]} />
  );
}

export function CostCenters() {
  return (
    <CrudPage title="Kostenstellen" subtitle="Erträge und Aufwände nach Bereichen, Projekten oder Standorten auswerten (Reports → Kostenstellen)"
      endpoint="/cost-centers" writePerm="accounting.write" newLabel="Neue Kostenstelle" exportName="kostenstellen" defaults={{ active: true }}
      columns={[
        { key: 'code', label: 'Code' },
        { key: 'name', label: 'Bezeichnung', render: (r) => <b>{r.name}</b> },
        { key: 'active', label: 'Status', render: activeBadge, csv: (r) => (r.active ? 'Aktiv' : 'Inaktiv') },
      ]}
      fields={[
        { name: 'code', label: 'Code', required: true, placeholder: 'z.B. 100' },
        { name: 'name', label: 'Bezeichnung', required: true },
        { name: 'active', label: 'Aktiv', type: 'checkbox' },
      ]} />
  );
}

export function Currencies() {
  const { settings } = useAuth();
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const [history, setHistory] = useState(null);
  const base = settings?.company?.currency || 'CHF';
  const refresh = async () => {
    try {
      const r = await api('/currencies-refresh', { method: 'POST' });
      toast(`Kurse vom ${r.date || 'heute'} übernommen: ${r.updated.map((u) => `${u.code} ${u.rate}`).join(', ') || 'keine'}${r.skipped.length ? ` · ohne Kurs: ${r.skipped.join(', ')}` : ''}`);
      setVersion((v) => v + 1);
    } catch (err) { toast.error(err.message); }
  };
  return (
    <>{history && <RateHistory currency={history} base={base} onClose={() => setHistory(null)} />}<CrudPage key={version} headerActions={<button className="btn" onClick={refresh}>Kurse jetzt aktualisieren</button>}
      rowActions={(row) => (row.code === base ? null : <button className="btn sm" onClick={() => setHistory(row)}>Verlauf</button>)} title="Währungen" subtitle={`Fremdwährungen und Kurse. Basiswährung der Buchhaltung: ${base}. Der Kurs gibt an, wie viel ${base} eine Einheit der Fremdwährung wert ist.`}
      endpoint="/currencies" writePerm="admin.settings" newLabel="Neue Währung" exportName="waehrungen" defaults={{ rate: 1, active: true }}
      columns={[
        { key: 'code', label: 'Code', render: (r) => <b>{r.code}</b> },
        { key: 'name', label: 'Bezeichnung' },
        { key: 'rate', label: `Kurs (1 Einheit = … ${base})`, num: true, render: (r) => (r.code === base ? '1 (Basiswährung)' : r.rate) },
        { key: 'active', label: 'Status', render: activeBadge, csv: (r) => (r.active ? 'Aktiv' : 'Inaktiv') },
      ]}
      fields={[
        { name: 'code', label: 'Währungscode (ISO)', required: true, placeholder: 'EUR' },
        { name: 'name', label: 'Bezeichnung', required: true },
        { name: 'rate', label: `Kurs: 1 Einheit = … ${base}`, type: 'number', required: true, hint: 'Vorschlagswert für neue Belege; pro Beleg und Zahlung überschreibbar' },
        { name: 'active', label: 'Aktiv', type: 'checkbox' },
      ]} /></>
  );
}
