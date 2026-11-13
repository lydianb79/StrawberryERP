import { useEffect, useState } from 'react';
import CrudPage from '../components/CrudPage.jsx';
import { ACCOUNT_TYPES, api } from '../lib.js';
import { useAuth } from '../auth.js';

/** Auswahllisten (Währungen, Konten, Lieferanten …) für Formulare. */
export function useLookup() {
  const [lookup, setLookup] = useState(null);
  useEffect(() => { api('/reports/lookup').then(setLookup).catch(() => setLookup({ customers: [], suppliers: [], products: [], accounts: [], years: [], currencies: [], costCenters: [] })); }, []);
  return lookup;
}

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
  ...extra,
  { name: 'notes', label: 'Notizen', type: 'textarea', span: 'all' },
  { name: 'active', label: 'Aktiv', type: 'checkbox' },
];

const partnerDefaults = (base) => ({ country: 'Schweiz', payment_terms_days: 30, active: true, currency: base });

function useCurrencyCodes() {
  const { settings } = useAuth();
  const lookup = useLookup();
  const base = settings?.company?.currency || 'CHF';
  return { base, codes: [...new Set([base, ...(lookup?.currencies || []).map((c) => c.code)])] };
}

export function Customers() {
  const { base, codes } = useCurrencyCodes();
  return (
    <CrudPage title="Kunden" subtitle="Kundenstamm mit Adressen und Konditionen" endpoint="/customers" writePerm="customers.write"
      columns={partnerColumns} fields={partnerFields(codes)} defaults={partnerDefaults(base)} newLabel="Neuer Kunde" exportName="kunden" />
  );
}

export function Suppliers() {
  const { base, codes } = useCurrencyCodes();
  return (
    <CrudPage title="Lieferanten" subtitle="Lieferantenstamm für Einkauf und Kreditoren" endpoint="/suppliers" writePerm="suppliers.write"
      columns={partnerColumns} fields={partnerFields(codes, [{ name: 'iban', label: 'IBAN' }])} defaults={partnerDefaults(base)}
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
  const base = settings?.company?.currency || 'CHF';
  return (
    <CrudPage title="Währungen" subtitle={`Fremdwährungen und Kurse. Basiswährung der Buchhaltung: ${base}. Der Kurs gibt an, wie viel ${base} eine Einheit der Fremdwährung wert ist.`}
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
      ]} />
  );
}
