// Lagerorte, Bestand je Lagerort und Charge, Umlagerung, geführte Inventur
import { useCallback, useEffect, useState } from 'react';
import CrudPage from '../components/CrudPage.jsx';
import { api, fmtDate, fmtDateTime, money, qty, today } from '../lib.js';
import { useAuth } from '../auth.js';
import { DataTable, Field, Icon, Modal, PageHead, useToast } from '../components/ui.jsx';

export function Warehouses() {
  return (
    <CrudPage title="Lagerorte" subtitle="Standorte und Lagerplätze. Belege buchen auf den ersten aktiven Lagerort; Umlagerungen erfolgen beim Artikel unter «Bestand»."
      endpoint="/warehouses" writePerm="inventory.write" newLabel="Neuer Lagerort" defaults={{ active: true }} exportName="lagerorte"
      columns={[
        { key: 'code', label: 'Kürzel', render: (r) => <b>{r.code}</b> },
        { key: 'name', label: 'Bezeichnung' },
        { key: 'active', label: 'Status', render: (r) => (r.active ? <span className="badge green">Aktiv</span> : <span className="badge">Inaktiv</span>) },
      ]}
      fields={[
        { name: 'code', label: 'Kürzel', required: true, placeholder: 'z.B. AL' },
        { name: 'name', label: 'Bezeichnung', required: true },
        { name: 'active', label: 'Aktiv', type: 'checkbox' },
      ]} />
  );
}

/** Bestand eines Artikels je Lagerort und Charge, mit Umlagerung. */
export function StockDetail({ product, onClose, onChanged }) {
  const { can } = useAuth();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ from: '', to: '', qty: '', batch: '' });
  const load = useCallback(() => api(`/inventory/stock?product_id=${product.id}`).then((d) => {
    setData(d);
    setForm((f) => ({ ...f, from: f.from || d.warehouses[0]?.id || '', to: f.to || d.warehouses[1]?.id || '' }));
  }).catch((e) => toast.error(e.message)), [product.id, toast]);
  useEffect(() => { load(); }, [load]);
  const transfer = async (e) => {
    e.preventDefault();
    try {
      await api('/inventory/transfer', { method: 'POST', body: { ...form, product_id: product.id } });
      toast('Umlagerung gebucht.');
      setForm({ ...form, qty: '', batch: '' });
      load();
      onChanged?.();
    } catch (err) { toast.error(err.message); }
  };
  return (
    <Modal title={`Bestand: ${product.sku} – ${product.name}`} onClose={onClose} wide>
      {!data ? <div className="empty">Lädt…</div> : (
        <div className="stack">
          <table className="table">
            <thead><tr><th>Lagerort</th><th className="num">Bestand</th></tr></thead>
            <tbody>
              {data.warehouses.map((w) => <tr key={w.id}><td><b>{w.code}</b> {w.name}</td><td className="num">{qty(w.qty)} {product.unit}</td></tr>)}
            </tbody>
            <tfoot><tr><td>Gesamtbestand</td><td className="num">{qty(data.warehouses.reduce((s, w) => s + w.qty, 0))} {product.unit}</td></tr></tfoot>
          </table>
          {product.tracking !== 'none' && (
            <table className="table">
              <thead><tr><th>{product.tracking === 'serial' ? 'Seriennummer' : 'Charge'}</th><th>Lagerort</th><th>Verfall</th><th className="num">Bestand</th></tr></thead>
              <tbody>
                {data.batches.map((b) => <tr key={b.id}><td><b>{b.batch}</b></td><td>{b.warehouse_code}</td><td>{b.expiry ? fmtDate(b.expiry) : '–'}</td><td className="num">{qty(b.qty)}</td></tr>)}
                {!data.batches.length && <tr><td colSpan={4} className="muted">Keine Chargen an Lager.</td></tr>}
              </tbody>
            </table>
          )}
          {can('inventory.write') && data.warehouses.length > 1 && (
            <form onSubmit={transfer}>
              <h3 style={{ marginBottom: 8 }}>Umlagern</h3>
              <div className="form-grid cols-4" style={{ alignItems: 'end' }}>
                <Field label="Von">
                  <select className="input" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })}>
                    {data.warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} ({qty(w.qty)})</option>)}
                  </select>
                </Field>
                <Field label="Nach">
                  <select className="input" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })}>
                    {data.warehouses.map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}
                  </select>
                </Field>
                <Field label="Menge"><input className="input num" type="number" step="any" min="0.001" required value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} /></Field>
                {product.tracking !== 'none'
                  ? <Field label="Charge"><input className="input" required value={form.batch} onChange={(e) => setForm({ ...form, batch: e.target.value })} /></Field>
                  : <div className="field"><button className="btn primary">Umlagern</button></div>}
                {product.tracking !== 'none' && <div className="field span-all"><button className="btn primary" style={{ alignSelf: 'flex-end' }}>Umlagern</button></div>}
              </div>
            </form>
          )}
        </div>
      )}
    </Modal>
  );
}

// ---------- Geführte Inventur ----------
function StocktakeModal({ id, onClose, onDone }) {
  const { can } = useAuth();
  const toast = useToast();
  const [st, setSt] = useState(null);
  const [counts, setCounts] = useState({});
  const [onlyDiff, setOnlyDiff] = useState(false);
  useEffect(() => {
    api(`/stocktakes/${id}`).then((d) => { setSt(d); setCounts(Object.fromEntries(d.items.map((i) => [i.id, i.counted_qty ?? '']))); }).catch((e) => { toast.error(e.message); onClose(); });
  }, [id]); // eslint-disable-line
  if (!st) return <Modal title="Inventur" onClose={onClose}><div className="empty">Lädt…</div></Modal>;
  const open = st.status === 'open' && can('inventory.write');
  const items = () => st.items.map((i) => ({ id: i.id, counted_qty: counts[i.id] }));
  const diff = (i) => (counts[i.id] === '' || counts[i.id] == null ? null : Math.round((Number(counts[i.id]) - i.expected_qty) * 1000) / 1000);
  const save = async () => {
    try { await api(`/stocktakes/${id}`, { method: 'PUT', body: { items: items() } }); toast('Zählung gespeichert.'); onDone(false); } catch (err) { toast.error(err.message); }
  };
  const post = async () => {
    const counted = st.items.filter((i) => diff(i) !== null);
    const changed = counted.filter((i) => diff(i) !== 0).length;
    if (!window.confirm(`Inventur abschliessen?\n\n${counted.length} von ${st.items.length} Artikeln gezählt, ${changed} mit Abweichung. Abweichungen werden als Inventurkorrektur gebucht; nicht gezählte Artikel bleiben unverändert.`)) return;
    try {
      const r = await api(`/stocktakes/${id}/post`, { method: 'POST', body: { items: items() } });
      toast(`Inventur ${r.number} abgeschlossen: ${r.corrections} Korrektur(en) gebucht.`);
      onDone(true);
    } catch (err) { toast.error(err.message); }
  };
  const shown = st.items.filter((i) => !onlyDiff || (diff(i) !== null && diff(i) !== 0));
  const value = st.items.reduce((s, i) => s + (diff(i) || 0) * i.purchase_price, 0);
  return (
    <Modal title={`Inventur ${st.number} – ${st.warehouse_code} ${st.warehouse_name}`} onClose={onClose} wide
      footer={open ? <><button className="btn" onClick={onClose}>Schliessen</button><button className="btn" onClick={save}>Zählung speichern</button><button className="btn primary" onClick={post}><Icon name="lock" /> Abschliessen &amp; buchen</button></>
        : <button className="btn" onClick={onClose}>Schliessen</button>}>
      <div className="row" style={{ marginBottom: 10 }}>
        <span className="muted">Stichtag {fmtDate(st.date)} · {st.status === 'open' ? 'Sollbestand zum Zeitpunkt der Eröffnung' : `abgeschlossen am ${fmtDateTime(st.posted_at)}`}</span>
        <div className="spacer" />
        <label className="check"><input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> nur Abweichungen</label>
        <button className="btn sm" onClick={() => window.print()}>Zählliste drucken</button>
      </div>
      <div className="table-wrap" style={{ maxHeight: '55vh', overflowY: 'auto' }}>
        <table className="table">
          <thead><tr><th>Lagerplatz</th><th>Art.-Nr.</th><th>Artikel</th><th className="num">Soll</th><th className="num" style={{ width: 130 }}>Gezählt</th><th className="num">Differenz</th></tr></thead>
          <tbody>
            {shown.map((i) => (
              <tr key={i.id}>
                <td>{i.location || '–'}</td><td>{i.sku}</td><td>{i.name}</td><td className="num">{qty(i.expected_qty)} {i.unit}</td>
                <td>{open ? <input className="input num" type="number" step="any" min="0" value={counts[i.id]} onChange={(e) => setCounts({ ...counts, [i.id]: e.target.value })} /> : <span className="num" style={{ display: 'block' }}>{i.counted_qty == null ? '–' : qty(i.counted_qty)}</span>}</td>
                <td className="num">{diff(i) === null ? '' : <span className={diff(i) < 0 ? 'neg' : diff(i) > 0 ? 'pos' : ''}>{diff(i) > 0 ? '+' : ''}{qty(diff(i))}</span>}</td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={6} className="muted">Keine Einträge.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="muted small" style={{ marginBottom: 0 }}>Wert der Abweichungen zu Einstandspreisen: {money(value)}</p>
    </Modal>
  );
}

export function Stocktakes() {
  const { can } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [warehouses, setWarehouses] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(null);
  const load = useCallback(() => api('/stocktakes').then(setRows).catch((e) => { setRows([]); toast.error(e.message); }), [toast]);
  useEffect(() => { load(); api('/reports/lookup').then((l) => setWarehouses(l.warehouses)).catch(() => {}); }, [load]);
  const create = async (e) => {
    e.preventDefault();
    try {
      const st = await api('/stocktakes', { method: 'POST', body: creating });
      setCreating(null);
      load();
      setOpenId(st.id);
    } catch (err) { toast.error(err.message); }
  };
  const discard = async (r) => {
    if (!window.confirm(`Inventur ${r.number} verwerfen? Es wird nichts gebucht.`)) return;
    try { await api(`/stocktakes/${r.id}`, { method: 'DELETE' }); load(); } catch (err) { toast.error(err.message); }
  };
  return (
    <>
      <PageHead title="Inventur" subtitle="Geführte Bestandsaufnahme: Zählliste erstellen, Mengen erfassen, Abweichungen als Inventurkorrektur buchen">
        {can('inventory.write') && <button className="btn primary" onClick={() => setCreating({ warehouse_id: warehouses[0]?.id || '', date: today(), note: '' })}><Icon name="plus" /> Neue Inventur</button>}
      </PageHead>
      <DataTable searchable={false} rows={rows} onRowClick={(r) => setOpenId(r.id)} empty="Noch keine Inventur durchgeführt." columns={[
        { key: 'number', label: 'Nr.', render: (r) => <b>{r.number}</b> },
        { key: 'warehouse_code', label: 'Lagerort', render: (r) => `${r.warehouse_code} ${r.warehouse_name}` },
        { key: 'date', label: 'Stichtag', render: (r) => fmtDate(r.date) },
        { key: 'counted', label: 'Gezählt', num: true, render: (r) => `${r.counted || 0} / ${r.positions}` },
        { key: 'note', label: 'Bemerkung' },
        { key: 'status', label: 'Status', render: (r) => (r.status === 'open' ? <span className="badge amber">In Arbeit</span> : <span className="badge green">Abgeschlossen</span>) },
        { key: '_actions', label: '', render: (r) => r.status === 'open' && can('inventory.write') && <button className="icon-btn danger" title="Verwerfen" onClick={() => discard(r)}><Icon name="trash" /></button> },
      ]} />
      {openId && <StocktakeModal id={openId} onClose={() => { setOpenId(null); load(); }} onDone={(closed) => { if (closed) setOpenId(null); load(); }} />}
      {creating && (
        <Modal title="Neue Inventur" onClose={() => setCreating(null)}>
          <form onSubmit={create}>
            <p className="muted" style={{ marginTop: 0 }}>Für alle aktiven Lagerartikel des Lagerorts wird der aktuelle Bestand als Sollbestand festgehalten.</p>
            <div className="form-grid">
              <Field label="Lagerort">
                <select className="input" required value={creating.warehouse_id} onChange={(e) => setCreating({ ...creating, warehouse_id: e.target.value })}>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} {w.name}</option>)}
                </select>
              </Field>
              <Field label="Stichtag"><input className="input" type="date" required value={creating.date} onChange={(e) => setCreating({ ...creating, date: e.target.value })} /></Field>
              <Field label="Bemerkung" className="span-all"><input className="input" value={creating.note} onChange={(e) => setCreating({ ...creating, note: e.target.value })} /></Field>
            </div>
            <div className="row" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setCreating(null)}>Abbrechen</button>
              <button className="btn primary">Zählliste erstellen</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
