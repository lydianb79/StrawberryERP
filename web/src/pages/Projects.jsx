// Projekte und Zeiterfassung
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, fmtDate, money, qty, today } from '../lib.js';
import { useAuth } from '../auth.js';
import { DataTable, Field, Icon, Modal, PageHead, useToast } from '../components/ui.jsx';
import { EntityCombo } from '../components/shared.jsx';
import { useLookup } from './MasterData.jsx';

export function Projects() {
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const lookup = useLookup();
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null);
  const writable = can('projects.write');
  const load = useCallback(() => api('/project-overview').then(setRows).catch((e) => { setRows([]); toast.error(e.message); }), [toast]);
  useEffect(() => { load(); }, [load]);
  const set = (patch) => setEditing((cur) => ({ ...cur, ...patch }));

  const save = async (e) => {
    e.preventDefault();
    try {
      const body = { name: editing.name, number: editing.number || '', customer_id: editing.customer_id || '', status: editing.status, hourly_rate: editing.hourly_rate,
        budget_hours: editing.budget_hours ?? '', cost_center_id: editing.cost_center_id || '', notes: editing.notes || '' };
      if (editing.id) await api(`/projects/${editing.id}`, { method: 'PUT', body });
      else await api('/projects', { method: 'POST', body });
      toast('Projekt gespeichert.');
      setEditing(null);
      load();
    } catch (err) { toast.error(err.message); }
  };
  const invoice = async (p) => {
    if (!window.confirm(`Offene Stunden von «${p.name}» (${qty(p.open_hours)} Std, ${money(p.open_amount)}) in einen Rechnungsentwurf übernehmen?`)) return;
    try {
      const { document_id } = await api(`/projects/${p.id}/invoice`, { method: 'POST', body: {} });
      toast('Rechnungsentwurf erstellt.');
      navigate(`/rechnungen/${document_id}`);
    } catch (err) { toast.error(err.message); }
  };

  return (
    <>
      <PageHead title="Projekte" subtitle="Projekte mit Stundenbudget, erfassten Zeiten und Verrechnung der offenen Stunden">
        {writable && <button className="btn primary" onClick={() => setEditing({ name: '', status: 'open', hourly_rate: 150 })}><Icon name="plus" /> Neues Projekt</button>}
      </PageHead>
      <DataTable rows={rows} exportName="projekte" onRowClick={writable ? (r) => setEditing({ ...r }) : undefined} empty="Noch keine Projekte angelegt." columns={[
        { key: 'number', label: 'Nr.' },
        { key: 'name', label: 'Projekt', render: (r) => <b>{r.name}</b> },
        { key: 'customer_name', label: 'Kunde' },
        { key: 'hours', label: 'Stunden', num: true, render: (r) => (r.budget_hours ? <span className={r.hours > r.budget_hours ? 'neg' : ''}>{qty(r.hours)} / {qty(r.budget_hours)}</span> : qty(r.hours)) },
        { key: 'open_hours', label: 'Offen (Std)', num: true, render: (r) => qty(r.open_hours) },
        { key: 'open_amount', label: 'Offen (Betrag)', num: true, render: (r) => money(r.open_amount) },
        { key: 'invoiced_amount', label: 'Verrechnet', num: true, render: (r) => money(r.invoiced_amount) },
        { key: 'status', label: 'Status', render: (r) => (r.status === 'open' ? <span className="badge blue">Laufend</span> : <span className="badge">Abgeschlossen</span>), csv: (r) => r.status },
        { key: '_actions', label: '', render: (r) => (
          <span className="row" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
            <Link className="btn sm" to={`/zeiterfassung?projekt=${r.id}`}><Icon name="timer" /> Zeiten</Link>
            {writable && can('invoices.write') && r.open_hours > 0 && <button className="btn sm" onClick={() => invoice(r)}><Icon name="receipt" /> Abrechnen</button>}
          </span>
        ) },
      ]} />
      {editing && (
        <Modal title={editing.id ? `Projekt ${editing.number}` : 'Neues Projekt'} onClose={() => setEditing(null)}>
          <form onSubmit={save}>
            <div className="form-grid">
              <Field label="Bezeichnung *" className="span-all"><input className="input" required autoFocus value={editing.name} onChange={(e) => set({ name: e.target.value })} /></Field>
              <Field label="Kunde" hint="Nötig für die Verrechnung">
                <EntityCombo kind="customers" value={editing.customer_id || ''} label={editing.customer_name} emptyLabel="Kein Kunde (internes Projekt)"
                  onPick={(id, row) => set({ customer_id: id, customer_name: row?.company || '' })} />
              </Field>
              <Field label="Stundensatz"><input className="input num" type="number" step="0.05" min="0" value={editing.hourly_rate} onChange={(e) => set({ hourly_rate: e.target.value })} /></Field>
              <Field label="Stundenbudget" hint="Leer = kein Budget"><input className="input num" type="number" step="any" min="0" value={editing.budget_hours ?? ''} onChange={(e) => set({ budget_hours: e.target.value })} /></Field>
              <Field label="Kostenstelle">
                <select className="input" value={editing.cost_center_id || ''} onChange={(e) => set({ cost_center_id: e.target.value })}>
                  <option value="">–</option>
                  {(lookup?.costCenters || []).map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}
                </select>
              </Field>
              <Field label="Status">
                <select className="input" value={editing.status} onChange={(e) => set({ status: e.target.value })}>
                  <option value="open">Laufend</option><option value="closed">Abgeschlossen</option>
                </select>
              </Field>
              <Field label="Notizen" className="span-all"><textarea className="input" rows={3} value={editing.notes || ''} onChange={(e) => set({ notes: e.target.value })} /></Field>
            </div>
            <div className="row" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setEditing(null)}>Abbrechen</button>
              <button className="btn primary">Speichern</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

export function TimeTracking() {
  const { can } = useAuth();
  const toast = useToast();
  const all = can('projects.read');
  const preset = new URLSearchParams(window.location.search).get('projekt') || '';
  const [projects, setProjects] = useState([]);
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState({ project_id: preset, mine: !preset });
  const blank = { project_id: preset, date: today(), hours: '', description: '', billable: true };
  const [form, setForm] = useState(blank);
  const [editId, setEditId] = useState(null);

  const load = useCallback(() => {
    api(`/time-entries?${filter.project_id ? `project_id=${filter.project_id}&` : ''}${filter.mine ? 'mine=1' : ''}`).then(setRows).catch((e) => { setRows([]); toast.error(e.message); });
  }, [filter, toast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    // Die Auswahlliste der laufenden Projekte steht allen angemeldeten Personen offen
    api('/reports/lookup').then((l) => setProjects(l.projects)).catch(() => setProjects([]));
  }, []);

  const save = async (e) => {
    e.preventDefault();
    try {
      if (editId) await api(`/time-entries/${editId}`, { method: 'PUT', body: form });
      else await api('/time-entries', { method: 'POST', body: form });
      toast(editId ? 'Eintrag geändert.' : 'Zeit erfasst.');
      setForm({ ...blank, project_id: form.project_id, date: form.date });
      setEditId(null);
      load();
    } catch (err) { toast.error(err.message); }
  };
  const remove = async (r) => {
    if (!window.confirm('Diesen Zeiteintrag löschen?')) return;
    try { await api(`/time-entries/${r.id}`, { method: 'DELETE' }); load(); } catch (err) { toast.error(err.message); }
  };
  const total = (list) => list.reduce((s, r) => s + r.hours, 0);

  return (
    <div className="stack">
      <PageHead title="Zeiterfassung" subtitle="Arbeitszeit auf Projekte buchen – verrechenbare Stunden fliessen in die Projektabrechnung" />
      <form className="card" onSubmit={save}>
        <div className="card-body">
          <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', alignItems: 'end' }}>
            <Field label="Projekt *">
              <select className="input" required value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })}>
                <option value="">Bitte wählen…</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.number} {p.name}</option>)}
              </select>
            </Field>
            <Field label="Datum"><input className="input" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
            <Field label="Stunden *"><input className="input num" type="number" step="0.25" min="0.25" max="24" required value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} /></Field>
            <Field label="Tätigkeit"><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <div className="field"><label className="check" style={{ height: 36 }}><input type="checkbox" checked={form.billable} onChange={(e) => setForm({ ...form, billable: e.target.checked })} /> verrechenbar</label></div>
            <div className="field row" style={{ flexWrap: 'nowrap' }}>
              <button className="btn primary">{editId ? 'Ändern' : 'Erfassen'}</button>
              {editId && <button type="button" className="btn" onClick={() => { setEditId(null); setForm(blank); }}>Abbrechen</button>}
            </div>
          </div>
        </div>
      </form>
      <DataTable rows={rows} exportName="zeiterfassung" empty="Noch keine Zeiten erfasst."
        toolbar={(
          <>
            <select className="input" style={{ width: 260 }} value={filter.project_id} onChange={(e) => setFilter({ ...filter, project_id: e.target.value })}>
              <option value="">Alle Projekte</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.number} {p.name}</option>)}
            </select>
            {all && <label className="check"><input type="checkbox" checked={filter.mine} onChange={(e) => setFilter({ ...filter, mine: e.target.checked })} /> nur meine</label>}
          </>
        )}
        columns={[
          { key: 'date', label: 'Datum', render: (r) => fmtDate(r.date), csv: (r) => fmtDate(r.date) },
          { key: 'project_number', label: 'Projekt', render: (r) => <><b>{r.project_number}</b> {r.project_name}</>, csv: (r) => `${r.project_number} ${r.project_name}` },
          { key: 'user_name', label: 'Person' },
          { key: 'description', label: 'Tätigkeit' },
          { key: 'hours', label: 'Stunden', num: true, render: (r) => qty(r.hours) },
          { key: 'billable', label: 'Verrechnung', render: (r) => (r.invoiced_document_id ? <Link to={`/rechnungen/${r.invoiced_document_id}`}>{r.invoice_number || 'Rechnungsentwurf'}</Link>
            : r.billable ? <span className="badge amber">offen</span> : <span className="muted">intern</span>), csv: (r) => (r.invoiced_document_id ? 'verrechnet' : r.billable ? 'offen' : 'intern') },
          { key: '_actions', label: '', render: (r) => !r.invoiced_document_id && (
            <>
              <button className="icon-btn" title="Bearbeiten" onClick={() => { setEditId(r.id); setForm({ project_id: r.project_id, date: r.date, hours: r.hours, description: r.description || '', billable: !!r.billable }); }}><Icon name="edit" /></button>
              <button className="icon-btn danger" title="Löschen" onClick={() => remove(r)}><Icon name="trash" /></button>
            </>
          ) },
        ]}
        footer={(list) => <tr><td colSpan={4}>Total</td><td className="num">{qty(total(list))}</td><td colSpan={2} /></tr>} />
    </div>
  );
}
