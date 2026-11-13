import { useEffect, useState } from 'react';
import CrudPage from '../components/CrudPage.jsx';
import { DataTable, Field, Icon, Modal, PageHead, useToast } from '../components/ui.jsx';
import { api, fmtDateTime, money, qty } from '../lib.js';
import { useAuth } from '../auth.js';

const MOVE = { in: ['Wareneingang', 'green'], out: ['Warenausgang', 'amber'], adjust: ['Inventurkorrektur', 'blue'] };

function StockModal({ product, onClose, onDone }) {
  const toast = useToast();
  const [form, setForm] = useState({ type: 'in', qty: '', reference: '', note: '' });
  const submit = async (e) => {
    e.preventDefault();
    try {
      await api(`/products/${product.id}/movements`, { method: 'POST', body: form });
      toast('Lagerbewegung gebucht.');
      onDone();
    } catch (err) { toast.error(err.message); }
  };
  return (
    <Modal title={`Lager buchen: ${product.sku} – ${product.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="muted" style={{ marginTop: 0 }}>Aktueller Bestand: <b>{qty(product.stock_qty)} {product.unit}</b></p>
        <div className="form-grid">
          <Field label="Bewegungsart">
            <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="in">Wareneingang (+)</option>
              <option value="out">Warenausgang (−)</option>
              <option value="adjust">Inventur: neuen Bestand setzen</option>
            </select>
          </Field>
          <Field label={form.type === 'adjust' ? 'Neuer Bestand' : 'Menge'}>
            <input className="input num" type="number" step="any" min="0" required autoFocus value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
          </Field>
          <Field label="Referenz" hint="z.B. Lieferschein-Nr.">
            <input className="input" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
          </Field>
          <Field label="Bemerkung">
            <input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </Field>
        </div>
        <div className="row" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
          <button className="btn primary">Buchen</button>
        </div>
      </form>
    </Modal>
  );
}

export function Products() {
  const { can, settings } = useAuth();
  const [stock, setStock] = useState(null);
  const rates = settings?.company?.vat_rates || [8.1, 2.6, 3.8, 0];
  return (
    <>
      <CrudPage title="Artikel & Lager" subtitle="Artikelstamm, Preise und Lagerbestände" endpoint="/products" writePerm="inventory.write"
        newLabel="Neuer Artikel" exportName="artikel"
        defaults={{ unit: 'Stk', vat_rate: settings?.company?.default_vat ?? 8.1, is_stock_item: true, active: true, sale_price: 0, purchase_price: 0, min_stock: 0 }}
        columns={[
          { key: 'sku', label: 'Art.-Nr.' },
          { key: 'name', label: 'Bezeichnung', render: (r) => <b>{r.name}</b> },
          { key: 'sale_price', label: 'VK-Preis', num: true, render: (r) => money(r.sale_price) },
          { key: 'purchase_price', label: 'EK-Preis', num: true, render: (r) => money(r.purchase_price) },
          { key: 'stock_qty', label: 'Bestand', num: true, render: (r) => (r.is_stock_item ? `${qty(r.stock_qty)} ${r.unit}` : '–') },
          { key: 'min_stock', label: 'Mindestbest.', num: true, render: (r) => (r.is_stock_item ? qty(r.min_stock) : '–') },
          { key: 'location', label: 'Lagerort' },
          { key: 'state', label: 'Status', csv: (r) => (!r.active ? 'Inaktiv' : r.is_stock_item && r.stock_qty <= r.min_stock ? 'Nachbestellen' : 'OK'),
            render: (r) => (!r.active ? <span className="badge">Inaktiv</span>
              : !r.is_stock_item ? <span className="badge blue">Dienstleistung</span>
                : r.stock_qty <= r.min_stock ? <span className="badge red">Nachbestellen</span> : <span className="badge green">An Lager</span>) },
        ]}
        fields={[
          { name: 'sku', label: 'Artikelnummer', required: true },
          { name: 'unit', label: 'Einheit', required: true },
          { name: 'name', label: 'Bezeichnung', required: true, span: 2 },
          { name: 'description', label: 'Beschreibung', type: 'textarea', span: 'all' },
          { name: 'sale_price', label: 'Verkaufspreis (netto)', type: 'number' },
          { name: 'purchase_price', label: 'Einstandspreis', type: 'number' },
          { name: 'vat_rate', label: 'MwSt-Satz', type: 'select', required: true, options: rates.map((r) => ({ value: r, label: `${r} %` })) },
          { name: 'location', label: 'Lagerort' },
          { name: 'min_stock', label: 'Mindestbestand', type: 'number' },
          { name: 'is_stock_item', label: 'Lagerartikel (Bestand führen)', type: 'checkbox' },
          { name: 'active', label: 'Aktiv', type: 'checkbox' },
        ]}
        rowActions={(row, reload) => (can('inventory.write') && row.is_stock_item
          ? <button className="btn sm" onClick={() => setStock({ product: row, reload })}><Icon name="swap" /> Buchen</button> : null)} />
      {stock && <StockModal product={stock.product} onClose={() => setStock(null)} onDone={() => { stock.reload(); setStock(null); }} />}
    </>
  );
}

export function StockMovements() {
  const [rows, setRows] = useState(null);
  const toast = useToast();
  useEffect(() => { api('/products/movements').then(setRows).catch((e) => { setRows([]); toast.error(e.message); }); }, [toast]);
  return (
    <>
      <PageHead title="Lagerbewegungen" subtitle="Lückenloses Protokoll aller Zu- und Abgänge (letzte 500)" />
      <DataTable rows={rows} exportName="lagerbewegungen" columns={[
        { key: 'created_at', label: 'Datum', render: (r) => fmtDateTime(r.created_at) },
        { key: 'sku', label: 'Art.-Nr.' },
        { key: 'product_name', label: 'Artikel', render: (r) => <b>{r.product_name}</b> },
        { key: 'type', label: 'Art', render: (r) => <span className={`badge ${MOVE[r.type][1]}`}>{MOVE[r.type][0]}</span>, csv: (r) => MOVE[r.type][0] },
        { key: 'qty', label: 'Menge', num: true, render: (r) => <span className={r.qty < 0 ? 'neg' : 'pos'}>{r.qty > 0 ? '+' : ''}{qty(r.qty)}</span> },
        { key: 'balance_after', label: 'Bestand danach', num: true, render: (r) => qty(r.balance_after) },
        { key: 'reference', label: 'Referenz' },
        { key: 'note', label: 'Bemerkung' },
        { key: 'user_name', label: 'Benutzer' },
      ]} />
    </>
  );
}
