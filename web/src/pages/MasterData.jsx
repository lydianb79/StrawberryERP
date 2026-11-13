import CrudPage from '../components/CrudPage.jsx';
import { ACCOUNT_TYPES } from '../lib.js';

const activeBadge = (row) => (row.active ? <span className="badge green">Aktiv</span> : <span className="badge">Inaktiv</span>);

const partnerColumns = [
  { key: 'number', label: 'Nr.' },
  { key: 'company', label: 'Firma / Name', render: (r) => <b>{r.company}</b> },
  { key: 'contact_name', label: 'Kontakt' },
  { key: 'city', label: 'Ort', render: (r) => [r.zip, r.city].filter(Boolean).join(' ') },
  { key: 'email', label: 'E-Mail' },
  { key: 'phone', label: 'Telefon' },
  { key: 'active', label: 'Status', render: activeBadge, csv: (r) => (r.active ? 'Aktiv' : 'Inaktiv') },
];

const partnerFields = (extra = []) => [
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
  ...extra,
  { name: 'notes', label: 'Notizen', type: 'textarea', span: 'all' },
  { name: 'active', label: 'Aktiv', type: 'checkbox' },
];

const partnerDefaults = { country: 'Schweiz', payment_terms_days: 30, active: true };

export function Customers() {
  return (
    <CrudPage title="Kunden" subtitle="Kundenstamm mit Adressen und Konditionen" endpoint="/customers" writePerm="customers.write"
      columns={partnerColumns} fields={partnerFields()} defaults={partnerDefaults} newLabel="Neuer Kunde" exportName="kunden" />
  );
}

export function Suppliers() {
  return (
    <CrudPage title="Lieferanten" subtitle="Lieferantenstamm für Einkauf und Kreditoren" endpoint="/suppliers" writePerm="suppliers.write"
      columns={partnerColumns} fields={partnerFields([{ name: 'iban', label: 'IBAN' }])} defaults={partnerDefaults}
      newLabel="Neuer Lieferant" exportName="lieferanten" />
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
