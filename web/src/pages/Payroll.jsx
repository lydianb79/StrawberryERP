// Lohn: Mitarbeitende, Lohnläufe, Lohnabrechnungen, Auszahlung
import { useCallback, useEffect, useState } from 'react';
import CrudPage from '../components/CrudPage.jsx';
import { api, fmtDate, money } from '../lib.js';
import { useAuth } from '../auth.js';
import { DataTable, Field, Icon, Modal, PageHead, useToast } from '../components/ui.jsx';
import { saveText } from '../components/shared.jsx';
import { useLookup } from './MasterData.jsx';

export function Employees() {
  const lookup = useLookup();
  return (
    <CrudPage title="Mitarbeitende" subtitle="Personalstamm für die Lohnabrechnung" endpoint="/employees" writePerm="payroll.write" newLabel="Neue Person"
      defaults={{ active: true, monthly_gross: 0, bvg_employee: 0, bvg_employer: 0 }} exportName="mitarbeitende"
      columns={[
        { key: 'number', label: 'Nr.' },
        { key: 'name', label: 'Name', render: (r) => <b>{r.name}</b> },
        { key: 'city', label: 'Ort', render: (r) => [r.zip, r.city].filter(Boolean).join(' ') },
        { key: 'entry_date', label: 'Eintritt', render: (r) => fmtDate(r.entry_date) },
        { key: 'exit_date', label: 'Austritt', render: (r) => (r.exit_date ? fmtDate(r.exit_date) : '') },
        { key: 'monthly_gross', label: 'Monatslohn brutto', num: true, render: (r) => money(r.monthly_gross) },
        { key: 'active', label: 'Status', render: (r) => (r.active ? <span className="badge green">Aktiv</span> : <span className="badge">Inaktiv</span>) },
      ]}
      fields={[
        { name: 'name', label: 'Name', required: true, span: 2 },
        { name: 'number', label: 'Personal-Nr.', hint: 'Leer lassen für automatische Vergabe' },
        { name: 'ahv_no', label: 'AHV-Nr.', placeholder: '756.1234.5678.97' },
        { name: 'street', label: 'Strasse', span: 2 },
        { name: 'zip', label: 'PLZ' }, { name: 'city', label: 'Ort' },
        { name: 'birth_date', label: 'Geburtsdatum', type: 'date' }, { name: 'iban', label: 'IBAN (Lohnkonto)' },
        { name: 'entry_date', label: 'Eintritt', type: 'date' }, { name: 'exit_date', label: 'Austritt', type: 'date' },
        { name: 'monthly_gross', label: 'Monatslohn brutto', type: 'number' },
        { name: 'cost_center_id', label: 'Kostenstelle', type: 'select', options: (lookup?.costCenters || []).map((c) => ({ value: c.id, label: `${c.code} ${c.name}` })) },
        { name: 'bvg_employee', label: 'BVG Arbeitnehmer (Betrag/Monat)', type: 'number' },
        { name: 'bvg_employer', label: 'BVG Arbeitgeber (Betrag/Monat)', type: 'number' },
        { name: 'active', label: 'Aktiv', type: 'checkbox' },
      ]} />
  );
}

const RUN_STATUS = { draft: ['Entwurf', ''], posted: ['Gebucht', 'blue'], paid: ['Ausbezahlt', 'green'] };
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const periodLabel = (p) => `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;

function RatesModal({ onClose }) {
  const { settings, reloadSettings } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState(structuredClone(settings.payroll));
  const setRate = (side, i, patch) => setForm((f) => ({ ...f, [side]: f[side].map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const save = async (e) => {
    e.preventDefault();
    try {
      const clean = (list) => list.filter((r) => String(r.label || '').trim()).map((r, i) => ({ key: r.key || `x${i}`, label: r.label.trim(), rate: Number(r.rate) || 0 }));
      await api('/settings/payroll', { method: 'PUT', body: { employee: clean(form.employee), employer: clean(form.employer) } });
      await reloadSettings();
      toast('Lohnsätze gespeichert.');
      onClose();
    } catch (err) { toast.error(err.message); }
  };
  const side = (key, title) => (
    <div>
      <h3 style={{ marginBottom: 8 }}>{title}</h3>
      {form[key].map((r, i) => (
        <div className="row" key={i} style={{ flexWrap: 'nowrap', marginBottom: 6 }}>
          <input className="input" value={r.label} onChange={(e) => setRate(key, i, { label: e.target.value })} />
          <input className="input num" style={{ width: 90 }} type="number" step="0.001" min="0" value={r.rate} onChange={(e) => setRate(key, i, { rate: e.target.value })} />
          <span className="muted">%</span>
          <button type="button" className="icon-btn danger" onClick={() => setForm((f) => ({ ...f, [key]: f[key].filter((_, j) => j !== i) }))}><Icon name="x" /></button>
        </div>
      ))}
      <button type="button" className="btn sm" onClick={() => setForm((f) => ({ ...f, [key]: [...f[key], { key: '', label: '', rate: 0 }] }))}><Icon name="plus" /> Zeile</button>
    </div>
  );
  return (
    <Modal title="Lohnsätze" onClose={onClose} wide>
      <form onSubmit={save} className="stack">
        <div className="alert">Die vorbelegten Sätze sind Richtwerte. Massgebend sind die Verfügungen Ihrer Ausgleichskasse, Unfall- und Krankentaggeldversicherung – bitte abgleichen. Die Pensionskasse (BVG) wird als fester Betrag pro Person erfasst.</div>
        <div className="grid-2">{side('employee', 'Abzüge Arbeitnehmer (in % des Bruttolohns)')}{side('employer', 'Beiträge Arbeitgeber (in % des Bruttolohns)')}</div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
          <button className="btn primary">Speichern</button>
        </div>
      </form>
    </Modal>
  );
}

function RunModal({ id, onClose, onChanged }) {
  const { can } = useAuth();
  const toast = useToast();
  const [run, setRun] = useState(null);
  const writable = can('payroll.write');
  useEffect(() => { api(`/payroll/${id}`).then(setRun).catch((e) => { toast.error(e.message); onClose(); }); }, [id]); // eslint-disable-line
  if (!run) return <Modal title="Lohnlauf" onClose={onClose}><div className="empty">Lädt…</div></Modal>;
  const act = async (fn, message, question) => {
    if (question && !window.confirm(question)) return;
    try { const r = await fn(); if (message) toast(message); if (r?.id) setRun(r); onChanged(); return r; } catch (err) { toast.error(err.message); return null; }
  };
  const edit = (slip, patch) => act(() => api(`/payslips/${slip.id}`, { method: 'PUT', body: { bonus: slip.bonus, expenses: slip.expenses, ...patch } }));
  const file = async () => {
    const f = await act(() => api(`/payroll/${id}/payment-file`, { method: 'POST', body: {} }));
    if (f?.xml) { saveText(f.filename, f.xml); toast(`Zahlungsdatei mit ${f.count} Löhnen erstellt (Total ${money(f.total)}).`); }
  };
  const cancel = async () => {
    const draft = run.status === 'draft';
    const r = await act(() => api(`/payroll/${id}`, { method: 'DELETE' }), null,
      draft ? 'Diesen Lohnlauf löschen?' : 'Lohnlauf stornieren? Die Buchungen werden durch Gegenbuchungen aufgehoben, der Lauf wird wieder zum Entwurf.');
    if (r?.result === 'deleted') onClose();
    else if (r) api(`/payroll/${id}`).then(setRun);
  };
  const [label, color] = RUN_STATUS[run.status];
  return (
    <Modal title={`Lohnlauf ${periodLabel(run.period)}`} onClose={onClose} wide
      footer={<>
        {writable && <button className="btn danger" onClick={cancel}>{run.status === 'draft' ? 'Löschen' : 'Stornieren'}</button>}
        <div className="spacer" />
        {writable && run.status !== 'draft' && <button className="btn" onClick={file}><Icon name="download" /> Zahlungsdatei</button>}
        {writable && run.status === 'draft' && <button className="btn primary" onClick={() => act(() => api(`/payroll/${id}/post`, { method: 'POST' }), 'Lohnlauf gebucht.',
          `Lohnlauf ${periodLabel(run.period)} buchen?\n\nBruttolöhne ${money(run.totals.gross)}, Arbeitgeberbeiträge ${money(run.totals.employer)}, Auszahlung ${money(run.totals.net)}.`)}><Icon name="lock" /> Buchen</button>}
        {writable && run.status === 'posted' && <button className="btn primary" onClick={() => act(() => api(`/payroll/${id}/pay`, { method: 'POST', body: {} }), 'Auszahlung gebucht.',
          `Auszahlung von ${money(run.totals.net)} per heute als Bankabgang buchen?`)}><Icon name="out" /> Als ausbezahlt buchen</button>}
      </>}>
      <div className="row" style={{ marginBottom: 10 }}><span className={`badge ${color}`}>{label}</span><span className="muted">Buchungsdatum {fmtDate(run.date)}</span></div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Person</th><th className="num">Monatslohn</th><th className="num" style={{ width: 110 }}>Zulage</th><th className="num">Abzüge</th>
            <th className="num" style={{ width: 110 }}>Spesen</th><th className="num">Auszahlung</th><th className="num">Arbeitgeber</th><th /></tr></thead>
          <tbody>
            {run.slips.map((s) => (
              <tr key={s.id}>
                <td><b>{s.name}</b><div className="muted small">{s.number}{!s.iban && ' · keine IBAN'}</div></td>
                <td className="num">{money(s.base)}</td>
                <td>{run.status === 'draft' && writable ? <input className="input num" type="number" step="0.05" defaultValue={s.bonus} onBlur={(e) => Number(e.target.value) !== s.bonus && edit(s, { bonus: e.target.value })} /> : <span className="num" style={{ display: 'block' }}>{money(s.bonus)}</span>}</td>
                <td className="num" title={s.deductions.map((d) => `${d.label}: ${money(d.amount)}`).join('\n')}>− {money(s.deduction_total)}</td>
                <td>{run.status === 'draft' && writable ? <input className="input num" type="number" step="0.05" defaultValue={s.expenses} onBlur={(e) => Number(e.target.value) !== s.expenses && edit(s, { expenses: e.target.value })} /> : <span className="num" style={{ display: 'block' }}>{money(s.expenses)}</span>}</td>
                <td className="num"><b>{money(s.net)}</b></td>
                <td className="num muted" title={s.employer.map((d) => `${d.label}: ${money(d.amount)}`).join('\n')}>{money(s.employer_total)}</td>
                <td className="actions"><a className="btn sm" href={`/api/payslips/${s.id}/pdf`} target="_blank" rel="noreferrer"><Icon name="pdf" /> Abrechnung</a></td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td>Total ({run.slips.length})</td><td className="num">{money(run.totals.gross)}</td><td /><td className="num">− {money(run.totals.deductions)}</td>
            <td className="num">{money(run.totals.expenses)}</td><td className="num">{money(run.totals.net)}</td><td className="num">{money(run.totals.employer)}</td><td /></tr></tfoot>
        </table>
      </div>
      <p className="muted small" style={{ marginBottom: 0 }}>Zulage und Spesen lassen sich im Entwurf anpassen; die Abzüge werden neu gerechnet. Die einzelnen Abzüge zeigt der Mauszeiger über dem Betrag.</p>
    </Modal>
  );
}

export function PayrollRuns() {
  const { can } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [rates, setRates] = useState(false);
  const now = new Date();
  const [period, setPeriod] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const writable = can('payroll.write');
  const load = useCallback(() => api('/payroll').then(setRows).catch((e) => { setRows([]); toast.error(e.message); }), [toast]);
  useEffect(() => { load(); }, [load]);
  const create = async () => {
    try { const run = await api('/payroll', { method: 'POST', body: { period } }); load(); setOpenId(run.id); } catch (err) { toast.error(err.message); }
  };
  return (
    <>
      <PageHead title="Lohnläufe" subtitle="Monatliche Lohnabrechnung: rechnen, kontrollieren, buchen und auszahlen">
        {can('admin.settings') && <button className="btn" onClick={() => setRates(true)}>Lohnsätze</button>}
        {writable && <><input className="input" style={{ width: 150 }} type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          <button className="btn primary" onClick={create}><Icon name="plus" /> Lohnlauf erstellen</button></>}
      </PageHead>
      <div className="alert info" style={{ marginBottom: 16 }}>Einfache Lohnabrechnung für Monatslöhne mit prozentualen Abzügen. Nicht enthalten sind Quellensteuer, Lohnausweis, 13. Monatslohn, Kinderzulagen und Stundenlöhne.</div>
      <DataTable searchable={false} rows={rows} onRowClick={(r) => setOpenId(r.id)} empty="Noch kein Lohnlauf erstellt." columns={[
        { key: 'period', label: 'Monat', render: (r) => <b>{periodLabel(r.period)}</b> },
        { key: 'employees', label: 'Personen', num: true },
        { key: 'gross', label: 'Bruttolöhne', num: true, render: (r) => money(r.gross) },
        { key: 'employer', label: 'Arbeitgeberbeiträge', num: true, render: (r) => money(r.employer) },
        { key: 'net', label: 'Auszahlung', num: true, render: (r) => money(r.net) },
        { key: 'status', label: 'Status', render: (r) => <span className={`badge ${RUN_STATUS[r.status][1]}`}>{RUN_STATUS[r.status][0]}</span> },
      ]} />
      {openId && <RunModal id={openId} onClose={() => { setOpenId(null); load(); }} onChanged={load} />}
      {rates && <RatesModal onClose={() => setRates(false)} />}
    </>
  );
}
