import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate, money, round2, today } from '../lib.js';
import { useAuth } from '../auth.js';
import { DataTable, Field, Icon, Modal, PageHead, StatusBadge, Tabs, useToast } from '../components/ui.jsx';
import { PaymentModal } from './DocumentEditor.jsx';

const BUCKETS = [['current', 'Nicht fällig'], ['d30', '1–30 Tage überfällig'], ['d60', '31–60 Tage'], ['d90', 'Über 60 Tage']];

export function Aging({ rows }) {
  const sum = (b) => rows.filter((r) => r.bucket === b).reduce((s, r) => s + r.open_amount, 0);
  return (
    <div className="aging">
      {BUCKETS.map(([key, label]) => (
        <div key={key}><span className="muted small">{label}</span><b className={key !== 'current' && sum(key) > 0 ? 'neg' : ''}>{money(sum(key))}</b></div>
      ))}
    </div>
  );
}

const openColumns = (linkTo) => [
  { key: 'number', label: 'Beleg', render: (r) => (linkTo ? <Link to={linkTo(r)} onClick={(e) => e.stopPropagation()}><b>{r.number}</b></Link> : <b>{r.number}</b>) },
  { key: 'partner', label: 'Partner' },
  { key: 'date', label: 'Datum', render: (r) => fmtDate(r.date), csv: (r) => fmtDate(r.date) },
  { key: 'due_date', label: 'Fällig', render: (r) => fmtDate(r.due_date), csv: (r) => fmtDate(r.due_date) },
  { key: 'days_overdue', label: 'Tage überfällig', num: true, render: (r) => (r.days_overdue > 0 ? <span className="neg">{r.days_overdue}</span> : '–') },
  { key: 'total', label: 'Betrag', num: true, render: (r) => money(r.total) },
  { key: 'paid_amount', label: 'Bezahlt', num: true, render: (r) => money(r.paid_amount) },
  { key: 'open_amount', label: 'Offen', num: true, render: (r) => <b>{money(r.open_amount)}</b> },
];

const openFooter = (list) => (
  <tr>
    <td colSpan={5}>Total offene Posten</td>
    <td className="num">{money(list.reduce((s, r) => s + r.total, 0))}</td>
    <td className="num">{money(list.reduce((s, r) => s + r.paid_amount, 0))}</td>
    <td className="num">{money(list.reduce((s, r) => s + r.open_amount, 0))}</td>
    <td />
  </tr>
);

// ---------- Debitoren ----------
export function Receivables() {
  const { can, settings } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [paying, setPaying] = useState(null);

  const load = useCallback(() => api('/reports/receivables').then(setRows).catch((e) => { setRows([]); toast.error(e.message); }), [toast]);
  useEffect(() => { load(); api('/reports/lookup').then((l) => setAccounts(l.accounts)).catch(() => {}); }, [load]);

  const columns = [...openColumns((r) => `/rechnungen/${r.id}`), {
    key: '_actions', label: '',
    render: (r) => can('receivables.write') && <button className="btn sm" onClick={() => setPaying(r)}><Icon name="in" /> Zahlung</button>,
  }];

  return (
    <div className="stack">
      <PageHead title="Debitoren" subtitle="Offene Kundenrechnungen und Zahlungseingänge" />
      {rows && <Aging rows={rows} />}
      <DataTable columns={columns} rows={rows} exportName="debitoren-offene-posten" empty="Keine offenen Debitoren – alle Rechnungen sind bezahlt." footer={openFooter} />
      {paying && (
        <PaymentModal title={`Zahlungseingang zu ${paying.number} – ${paying.partner}`} open={paying.open_amount} accounts={accounts}
          defaultAccount={settings?.accounting?.bank} onClose={() => setPaying(null)}
          onSubmit={async (form) => {
            try {
              await api(`/documents/${paying.id}/payments`, { method: 'POST', body: form });
              toast('Zahlung gebucht.');
              setPaying(null);
              load();
            } catch (err) { toast.error(err.message); }
          }} />
      )}
    </div>
  );
}

// ---------- Kreditoren ----------
function BillModal({ bill, lookup, rates, writable, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(bill.id ? { ...bill } : {
    supplier_id: '', number: '', date: today(), due_date: '', description: '', net: '', vat: '',
    expense_account_id: lookup.accounts.find((a) => a.number === '4200')?.id || '',
  });
  const [rate, setRate] = useState(bill.id && bill.net ? '' : rates[0]);
  const locked = !writable || (bill.id && bill.paid_amount > 0);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setNet = (net, r = rate) => set({ net, ...(r !== '' ? { vat: round2(Number(net) * Number(r) / 100) } : {}) });
  const accounts = lookup.accounts.filter((a) => a.type === 'expense' || a.type === 'asset');

  const submit = async (e) => {
    e.preventDefault();
    try {
      const body = { ...form, due_date: form.due_date || null };
      if (bill.id) await api(`/payables/${bill.id}`, { method: 'PUT', body });
      else await api('/payables', { method: 'POST', body });
      toast('Lieferantenrechnung gespeichert und verbucht.');
      onSaved();
    } catch (err) { toast.error(err.message); }
  };
  const remove = async () => {
    if (!window.confirm('Lieferantenrechnung und zugehörige Buchung löschen?')) return;
    try { await api(`/payables/${bill.id}`, { method: 'DELETE' }); toast('Gelöscht.'); onSaved(); } catch (err) { toast.error(err.message); }
  };
  const removePayment = async (p) => {
    if (!window.confirm(`Zahlung über ${money(p.amount)} entfernen?`)) return;
    try { await api(`/payables/payments/${p.id}`, { method: 'DELETE' }); toast('Zahlung entfernt.'); onSaved(); } catch (err) { toast.error(err.message); }
  };

  return (
    <Modal title={bill.id ? `Lieferantenrechnung ${bill.number}` : 'Lieferantenrechnung erfassen'} onClose={onClose} wide>
      <form onSubmit={submit}>
        {locked && writable && <div className="alert" style={{ marginBottom: 14 }}>Diese Rechnung hat Zahlungen und kann nicht mehr geändert werden.</div>}
        <div className="form-grid cols-3">
          <Field label="Lieferant *" className="span-2">
            <select className="input" required disabled={locked} value={form.supplier_id} onChange={(e) => set({ supplier_id: e.target.value })}>
              <option value="">Bitte wählen…</option>
              {lookup.suppliers.map((s) => <option key={s.id} value={s.id}>{s.company} ({s.number})</option>)}
            </select>
          </Field>
          <Field label="Rechnungs-Nr. Lieferant *"><input className="input" required disabled={locked} value={form.number} onChange={(e) => set({ number: e.target.value })} /></Field>
          <Field label="Rechnungsdatum"><input className="input" type="date" required disabled={locked} value={form.date} onChange={(e) => set({ date: e.target.value })} /></Field>
          <Field label="Fällig am" hint="Leer = gemäss Zahlungsfrist"><input className="input" type="date" disabled={locked} value={form.due_date || ''} onChange={(e) => set({ due_date: e.target.value })} /></Field>
          <Field label="Aufwand-/Gegenkonto *">
            <select className="input" required disabled={locked} value={form.expense_account_id} onChange={(e) => set({ expense_account_id: e.target.value })}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.number} {a.name}</option>)}
            </select>
          </Field>
          <Field label="Beschreibung" className="span-all"><input className="input" disabled={locked} value={form.description || ''} onChange={(e) => set({ description: e.target.value })} /></Field>
          <Field label="Betrag netto *"><input className="input num" type="number" step="0.01" min="0.01" required disabled={locked} value={form.net} onChange={(e) => setNet(e.target.value)} /></Field>
          <Field label="MwSt-Satz">
            <select className="input" disabled={locked} value={rate} onChange={(e) => { setRate(e.target.value); if (e.target.value !== '') setNet(form.net, e.target.value); }}>
              <option value="">manuell</option>
              {rates.map((r) => <option key={r} value={r}>{r} %</option>)}
            </select>
          </Field>
          <Field label="Vorsteuer (MwSt)"><input className="input num" type="number" step="0.01" min="0" disabled={locked || rate !== ''} value={form.vat} onChange={(e) => set({ vat: e.target.value })} /></Field>
        </div>
        <p style={{ textAlign: 'right', margin: '14px 0 0' }}>Total brutto: <b>{money(Number(form.net || 0) + Number(form.vat || 0))}</b></p>

        {bill.id && bill.payments?.length > 0 && (
          <table className="table" style={{ marginTop: 14 }}>
            <thead><tr><th>Zahlung vom</th><th>Konto</th><th>Bemerkung</th><th className="num">Betrag</th><th /></tr></thead>
            <tbody>
              {bill.payments.map((p) => (
                <tr key={p.id}>
                  <td>{fmtDate(p.date)}</td><td>{p.account_number} {p.account_name}</td><td>{p.note}</td><td className="num">{money(p.amount)}</td>
                  <td className="actions">{writable && <button type="button" className="icon-btn danger" onClick={() => removePayment(p)}><Icon name="trash" /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="row" style={{ marginTop: 20 }}>
          {bill.id && !locked && <button type="button" className="btn danger" onClick={remove}><Icon name="trash" /> Löschen</button>}
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>{locked ? 'Schliessen' : 'Abbrechen'}</button>
          {!locked && <button className="btn primary">Speichern &amp; verbuchen</button>}
        </div>
      </form>
    </Modal>
  );
}

export function Payables() {
  const { can, settings } = useAuth();
  const toast = useToast();
  const writable = can('payables.write');
  const [tab, setTab] = useState('open');
  const [rows, setRows] = useState(null);
  const [aging, setAging] = useState(null);
  const [lookup, setLookup] = useState(null);
  const [editing, setEditing] = useState(null);
  const [paying, setPaying] = useState(null);

  const load = useCallback(() => {
    api(`/payables${tab === 'open' ? '?open=1' : ''}`).then(setRows).catch((e) => { setRows([]); toast.error(e.message); });
    api('/reports/payables').then(setAging).catch(() => setAging([]));
  }, [tab, toast]);
  useEffect(() => { setRows(null); load(); }, [load]);
  useEffect(() => { api('/reports/lookup').then(setLookup).catch(() => {}); }, []);

  const open = async (row) => {
    try { setEditing(await api(`/payables/${row.id}`)); } catch (err) { toast.error(err.message); }
  };

  const columns = [
    { key: 'number', label: 'Rechnungs-Nr.', render: (r) => <b>{r.number}</b> },
    { key: 'supplier_name', label: 'Lieferant' },
    { key: 'description', label: 'Beschreibung' },
    { key: 'date', label: 'Datum', render: (r) => fmtDate(r.date), csv: (r) => fmtDate(r.date) },
    { key: 'due_date', label: 'Fällig', render: (r) => fmtDate(r.due_date), csv: (r) => fmtDate(r.due_date) },
    { key: 'account_number', label: 'Konto' },
    { key: 'total', label: 'Brutto', num: true, render: (r) => money(r.total) },
    { key: 'open', label: 'Offen', num: true, render: (r) => money(r.total - r.paid_amount), csv: (r) => r.total - r.paid_amount },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} overdue={!!r.overdue} /> },
    { key: '_actions', label: '', render: (r) => writable && r.status !== 'paid' && <button className="btn sm" onClick={() => setPaying(r)}><Icon name="out" /> Zahlen</button> },
  ];

  return (
    <div className="stack">
      <PageHead title="Kreditoren" subtitle="Lieferantenrechnungen erfassen, verbuchen und bezahlen">
        {writable && lookup && <button className="btn primary" onClick={() => setEditing({})}><Icon name="plus" /> Lieferantenrechnung</button>}
      </PageHead>
      {aging && <Aging rows={aging} />}
      <div>
        <Tabs tabs={[['open', 'Offene Posten'], ['all', 'Alle Rechnungen']]} value={tab} onChange={setTab} />
        <DataTable columns={columns} rows={rows} exportName="kreditoren" onRowClick={open}
          empty={tab === 'open' ? 'Keine offenen Kreditoren.' : 'Noch keine Lieferantenrechnungen erfasst.'}
          footer={(list) => (
            <tr><td colSpan={6}>Summe</td><td className="num">{money(list.reduce((s, r) => s + r.total, 0))}</td>
              <td className="num">{money(list.reduce((s, r) => s + r.total - r.paid_amount, 0))}</td><td colSpan={2} /></tr>
          )} />
      </div>
      {editing && lookup && (
        <BillModal bill={editing} lookup={lookup} rates={settings?.company?.vat_rates || [8.1, 2.6, 3.8, 0]} writable={writable}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
      {paying && lookup && (
        <PaymentModal title={`Zahlung an ${paying.supplier_name} (${paying.number})`} open={round2(paying.total - paying.paid_amount)} accounts={lookup.accounts}
          defaultAccount={settings?.accounting?.bank} onClose={() => setPaying(null)}
          onSubmit={async (form) => {
            try {
              await api(`/payables/${paying.id}/payments`, { method: 'POST', body: form });
              toast('Zahlung gebucht.');
              setPaying(null);
              load();
            } catch (err) { toast.error(err.message); }
          }} />
      )}
    </div>
  );
}
