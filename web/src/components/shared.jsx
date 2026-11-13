// Gemeinsame Bausteine: Suche in Stammdaten, Belegablage, Notizen/Aufgaben, Positionsliste, Datei-Download
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, fmtDate, money, round2 } from '../lib.js';
import { useAuth } from '../auth.js';
import { Combo, Field, Icon, useToast } from './ui.jsx';

/** Speichert Text als Datei im Browser. */
export function saveText(filename, text, type = 'application/xml') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const SEARCH_LABEL = {
  customers: (r) => ({ value: r.id, label: r.company, hint: r.number, row: r }),
  suppliers: (r) => ({ value: r.id, label: r.company, hint: r.number, row: r }),
  products: (r) => ({ value: r.id, label: `${r.sku} – ${r.name}`, row: r }),
};

/**
 * Auswahlfeld für Kunden, Lieferanten oder Artikel mit Suche auf dem Server (höchstens 30 Treffer je Anfrage).
 * onPick(id, row) erhält den ganzen Datensatz, damit Preise, Währung usw. übernommen werden können.
 */
export function EntityCombo({ kind, value, label, onPick, disabled, placeholder, emptyLabel }) {
  const load = useCallback((query) => api(`/reports/search?kind=${kind}&q=${encodeURIComponent(query)}`).then((rows) => rows.map(SEARCH_LABEL[kind])), [kind]);
  return <Combo load={load} value={value} label={label} disabled={disabled} placeholder={placeholder} emptyLabel={emptyLabel} onChange={onPick} />;
}

/** Belegablage: Dateien (PDF, PNG, JPEG) zu einem Beleg oder einer Lieferantenrechnung. */
export function Attachments({ entity, entityId, writable }) {
  const toast = useToast();
  const [files, setFiles] = useState([]);
  const fileRef = useRef(null);
  const load = useCallback(() => { if (entityId) api(`/attachments?entity=${entity}&entity_id=${entityId}`).then(setFiles).catch(() => {}); }, [entity, entityId]);
  useEffect(() => { load(); }, [load]);
  const attach = (file) => {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { toast.error('Die Datei darf höchstens 8 MB gross sein.'); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await api('/attachments', { method: 'POST', body: { entity, entity_id: entityId, filename: file.name, dataUrl: reader.result } });
        toast('Datei abgelegt.');
        load();
      } catch (err) { toast.error(err.message); }
    };
    reader.readAsDataURL(file);
  };
  const detach = async (f) => {
    if (!window.confirm(`«${f.filename}» entfernen?`)) return;
    try { await api(`/attachments/${f.id}`, { method: 'DELETE' }); load(); } catch (err) { toast.error(err.message); }
  };
  return (
    <div>
      <div className="row"><h3>Belegablage</h3><div className="spacer" />
        <input ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg" hidden onChange={(e) => { attach(e.target.files[0]); e.target.value = ''; }} />
        {writable && <button type="button" className="btn sm" onClick={() => fileRef.current.click()}><Icon name="clip" /> Datei anhängen</button>}
      </div>
      {files.length ? files.map((f) => (
        <div className="row" key={f.id} style={{ padding: '5px 0' }}>
          <a href={`/api/attachments/${f.id}`} target="_blank" rel="noreferrer">{f.filename}</a>
          <span className="muted small">{Math.max(1, Math.round(f.size / 1024))} KB · {fmtDate(f.created_at)} · {f.user_name}</span>
          <div className="spacer" />
          {writable && <button type="button" className="icon-btn danger" title="Entfernen" onClick={() => detach(f)}><Icon name="trash" /></button>}
        </div>
      )) : <p className="muted small" style={{ margin: '6px 0 0' }}>Noch keine Datei abgelegt (PDF, PNG oder JPEG, max. 8 MB).</p>}
    </div>
  );
}

/** Notizen und Aufgaben zu einem Kunden oder Beleg. */
export function CrmPanel({ customerId, documentId, users = [] }) {
  const toast = useToast();
  const { user } = useAuth();
  const [items, setItems] = useState(null);
  const [form, setForm] = useState({ kind: 'note', text: '', due_date: '', assigned_to: '' });
  const filter = documentId ? `document_id=${documentId}` : `customer_id=${customerId}`;
  const load = useCallback(() => api(`/crm?${filter}`).then(setItems).catch(() => setItems([])), [filter]);
  useEffect(() => { load(); }, [load]);
  const add = async (e) => {
    e.preventDefault();
    try {
      await api('/crm', { method: 'POST', body: { ...form, customer_id: customerId, document_id: documentId, assigned_to: form.kind === 'task' ? form.assigned_to || user.id : null } });
      setForm({ kind: form.kind, text: '', due_date: '', assigned_to: '' });
      load();
    } catch (err) { toast.error(err.message); }
  };
  const change = async (id, body, method = 'PUT') => {
    try { await api(`/crm/${id}`, { method, body: method === 'PUT' ? body : undefined }); load(); } catch (err) { toast.error(err.message); }
  };
  return (
    <div className="stack">
      <form onSubmit={add} className="form-grid cols-4" style={{ alignItems: 'end' }}>
        <Field label="Art">
          <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            <option value="note">Notiz</option><option value="task">Aufgabe</option>
          </select>
        </Field>
        <Field label="Text" className={form.kind === 'task' ? '' : 'span-2'}><input className="input" required value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} /></Field>
        {form.kind === 'task' && <Field label="Fällig am"><input className="input" type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></Field>}
        {form.kind === 'task' && users.length > 0 ? (
          <Field label="Zuständig">
            <select className="input" value={form.assigned_to || user.id} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
        ) : null}
        <div className={`field ${form.kind === 'task' && users.length > 0 ? 'span-all' : ''}`}><button className="btn"><Icon name="plus" /> Hinzufügen</button></div>
      </form>
      {items && !items.length && <p className="muted small" style={{ margin: 0 }}>Noch keine Notizen oder Aufgaben.</p>}
      {(items || []).map((i) => (
        <div className="row" key={i.id} style={{ alignItems: 'flex-start', borderTop: '1px solid var(--line-2)', paddingTop: 8 }}>
          {i.kind === 'task'
            ? <input type="checkbox" style={{ marginTop: 3 }} checked={!!i.done_at} title="Erledigt" onChange={(e) => change(i.id, { done: e.target.checked })} />
            : <span className="muted"><Icon name="file" /></span>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className={i.done_at ? 'strike' : ''}>{i.text}</div>
            <div className="muted small">
              {i.kind === 'task' ? `Aufgabe${i.assigned_name ? ` für ${i.assigned_name}` : ''}${i.due_date ? ` · fällig ${fmtDate(i.due_date)}` : ''}` : 'Notiz'} · {i.created_name}, {fmtDate(i.created_at)}
              {i.document_number && !documentId ? ` · zu ${i.document_number}` : ''}
            </div>
          </div>
          <button type="button" className="icon-btn danger" title="Löschen" onClick={() => change(i.id, null, 'DELETE')}><Icon name="trash" /></button>
        </div>
      ))}
    </div>
  );
}

/** Einfache Positionsliste (Bezeichnung, Menge, Preis, Rabatt, MwSt) – für Abo-Vorlagen. */
export function ItemsEditor({ items, onChange, rates = [8.1, 2.6, 3.8, 0] }) {
  const set = (i, patch) => onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const line = (it) => round2((Number(it.qty) || 0) * (Number(it.unit_price) || 0) * (1 - (Number(it.discount_pct) || 0) / 100));
  return (
    <div>
      <table className="table items-table">
        <thead><tr><th>Bezeichnung</th><th className="num" style={{ width: 80 }}>Menge</th><th style={{ width: 70 }}>Einh.</th><th className="num" style={{ width: 100 }}>Preis</th>
          <th className="num" style={{ width: 76 }}>Rabatt %</th><th style={{ width: 86 }}>MwSt</th><th className="num" style={{ width: 96 }}>Betrag</th><th style={{ width: 34 }} /></tr></thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i}>
              <td><input className="input" value={it.description || ''} onChange={(e) => set(i, { description: e.target.value })} /></td>
              <td><input className="input num" type="number" step="any" value={it.qty} onChange={(e) => set(i, { qty: e.target.value })} /></td>
              <td><input className="input" value={it.unit || ''} onChange={(e) => set(i, { unit: e.target.value })} /></td>
              <td><input className="input num" type="number" step="0.01" value={it.unit_price} onChange={(e) => set(i, { unit_price: e.target.value })} /></td>
              <td><input className="input num" type="number" step="any" min="0" max="100" value={it.discount_pct || 0} onChange={(e) => set(i, { discount_pct: e.target.value })} /></td>
              <td><select className="input" value={Number(it.vat_rate)} onChange={(e) => set(i, { vat_rate: e.target.value })}>
                {[...new Set([...rates, Number(it.vat_rate)])].map((r) => <option key={r} value={r}>{r} %</option>)}</select></td>
              <td className="num" style={{ paddingTop: 13 }}>{money(line(it))}</td>
              <td><button type="button" className="icon-btn danger" onClick={() => onChange(items.filter((_, j) => j !== i))}><Icon name="x" /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ marginTop: 8 }}>
        <button type="button" className="btn sm" onClick={() => onChange([...items, { description: '', qty: 1, unit: 'Stk', unit_price: 0, discount_pct: 0, vat_rate: rates[0] }])}><Icon name="plus" /> Position</button>
        <div className="spacer" />
        <b>Netto {money(items.reduce((s, it) => s + line(it), 0))}</b>
      </div>
    </div>
  );
}
