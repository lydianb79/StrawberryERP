import { useEffect, useState } from 'react';
import { api, compact, fmtDate, money, monthLabel, qty } from '../lib.js';
import { BarChart, DataTable, Field, PageHead, Tabs, useToast } from '../components/ui.jsx';
import { Aging } from './OpenItems.jsx';

const year = new Date().getFullYear();

function useReport(path, deps = []) {
  const toast = useToast();
  const [data, setData] = useState(null);
  useEffect(() => {
    setData(null);
    api(path).then(setData).catch((e) => toast.error(e.message));
  }, [path, toast, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return data;
}

function Range({ range, setRange }) {
  return (
    <div className="row no-print" style={{ marginBottom: 16 }}>
      <Field label="Von"><input className="input" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
      <Field label="Bis"><input className="input" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
    </div>
  );
}

function Sales({ range }) {
  const data = useReport(`/reports/sales?from=${range.from}&to=${range.to}`);
  if (!data) return <div className="empty">Lädt…</div>;
  return (
    <div className="stack">
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="card kpi"><div className="label">Umsatz netto</div><div className="value">CHF {money(data.totals.net)}</div></div>
        <div className="card kpi"><div className="label">Umsatz brutto</div><div className="value">CHF {money(data.totals.gross)}</div></div>
        <div className="card kpi"><div className="label">Rechnungen</div><div className="value">{data.totals.n}</div><div className="sub">Ø CHF {money(data.totals.n ? data.totals.net / data.totals.n : 0)}</div></div>
      </div>
      <div className="card">
        <div className="card-head"><h2>Umsatz pro Monat</h2><span className="muted small">netto, in CHF</span></div>
        <div className="card-body">
          {data.monthly.length ? <BarChart data={data.monthly.map((m) => ({ label: monthLabel(m.month), value: m.net }))} format={compact} />
            : <div className="empty">Keine Umsätze im Zeitraum.</div>}
        </div>
      </div>
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div>
          <h2 style={{ marginBottom: 10 }}>Top-Kunden</h2>
          <DataTable searchable={false} exportName="top-kunden" rows={data.customers} columns={[
            { key: 'number', label: 'Nr.' }, { key: 'company', label: 'Kunde', render: (r) => <b>{r.company}</b> },
            { key: 'n', label: 'Rechnungen', num: true }, { key: 'net', label: 'Umsatz netto', num: true, render: (r) => money(r.net) },
          ]} />
        </div>
        <div>
          <h2 style={{ marginBottom: 10 }}>Top-Artikel</h2>
          <DataTable searchable={false} exportName="top-artikel" rows={data.products} columns={[
            { key: 'sku', label: 'Art.-Nr.' }, { key: 'name', label: 'Artikel', render: (r) => <b>{r.name}</b> },
            { key: 'qty', label: 'Menge', num: true, render: (r) => qty(r.qty) }, { key: 'net', label: 'Umsatz netto', num: true, render: (r) => money(r.net) },
          ]} />
        </div>
      </div>
    </div>
  );
}

function OpenItems({ kind }) {
  const rows = useReport(`/reports/${kind}`);
  if (!rows) return <div className="empty">Lädt…</div>;
  return (
    <div className="stack">
      <Aging rows={rows} />
      <DataTable rows={rows} exportName={kind === 'receivables' ? 'debitoren-faelligkeit' : 'kreditoren-faelligkeit'} empty="Keine offenen Posten."
        columns={[
          { key: 'number', label: 'Beleg', render: (r) => <b>{r.number}</b> },
          { key: 'partner_number', label: 'Nr.' },
          { key: 'partner', label: kind === 'receivables' ? 'Kunde' : 'Lieferant' },
          { key: 'date', label: 'Datum', render: (r) => fmtDate(r.date), csv: (r) => fmtDate(r.date) },
          { key: 'due_date', label: 'Fällig', render: (r) => fmtDate(r.due_date), csv: (r) => fmtDate(r.due_date) },
          { key: 'days_overdue', label: 'Tage überfällig', num: true, render: (r) => (r.days_overdue > 0 ? <span className="neg">{r.days_overdue}</span> : '–') },
          { key: 'total', label: 'Betrag', num: true, render: (r) => money(r.total) },
          { key: 'open_amount', label: 'Offen', num: true, render: (r) => <b>{money(r.open_amount)}</b> },
        ]}
        footer={(list) => (
          <tr><td colSpan={6}>Total</td><td className="num">{money(list.reduce((s, r) => s + r.total, 0))}</td><td className="num">{money(list.reduce((s, r) => s + r.open_amount, 0))}</td></tr>
        )} />
    </div>
  );
}

function Stock() {
  const rows = useReport('/reports/stock');
  if (!rows) return <div className="empty">Lädt…</div>;
  return (
    <DataTable rows={rows} exportName="lagerbewertung" columns={[
      { key: 'sku', label: 'Art.-Nr.' }, { key: 'name', label: 'Artikel', render: (r) => <b>{r.name}</b> }, { key: 'location', label: 'Lagerort' },
      { key: 'stock_qty', label: 'Bestand', num: true, render: (r) => <span className={r.low ? 'neg' : ''}>{qty(r.stock_qty)} {r.unit}</span> },
      { key: 'min_stock', label: 'Mindestbest.', num: true, render: (r) => qty(r.min_stock) },
      { key: 'purchase_price', label: 'EK-Preis', num: true, render: (r) => money(r.purchase_price) },
      { key: 'stock_value', label: 'Lagerwert', num: true, render: (r) => money(r.stock_value) },
      { key: 'low', label: 'Hinweis', render: (r) => (r.low ? <span className="badge red">Nachbestellen</span> : ''), csv: (r) => (r.low ? 'Nachbestellen' : '') },
    ]}
      footer={(list) => <tr><td colSpan={6}>Lagerwert total (zu Einstandspreisen)</td><td className="num">{money(list.reduce((s, r) => s + r.stock_value, 0))}</td><td /></tr>} />
  );
}

function Vat({ range }) {
  const data = useReport(`/reports/vat?from=${range.from}&to=${range.to}`);
  if (!data) return <div className="empty">Lädt…</div>;
  return (
    <div className="card statement">
      <table className="table">
        <tbody>
          <tr className="section"><td colSpan={3}>Geschuldete Umsatzsteuer (gebuchte Rechnungen)</td></tr>
          {data.output.map((o) => <tr key={o.rate}><td>Umsätze zu {o.rate} %</td><td className="num">{money(o.base)}</td><td className="num">{money(o.vat)}</td></tr>)}
          {!data.output.length && <tr><td className="muted" colSpan={3}>Keine Umsätze im Zeitraum</td></tr>}
          <tr className="total"><td>Total Umsatzsteuer</td><td /><td className="num">{money(data.outputVat)}</td></tr>
          <tr className="section"><td colSpan={3}>Vorsteuer (Lieferantenrechnungen)</td></tr>
          <tr><td>{data.input.n} Lieferantenrechnungen</td><td className="num">{money(data.input.base)}</td><td className="num">{money(data.input.vat)}</td></tr>
          <tr className="grand"><td>{data.payable >= 0 ? 'An die ESTV zu bezahlen' : 'Guthaben gegenüber ESTV'}</td><td /><td className="num">{money(Math.abs(data.payable))}</td></tr>
        </tbody>
      </table>
      <div className="card-body muted small">Übersicht nach vereinbartem Entgelt (Rechnungsdatum). Dient als Grundlage für die MwSt-Abrechnung und ersetzt diese nicht.</div>
    </div>
  );
}

export default function Reports() {
  const [tab, setTab] = useState('sales');
  const [range, setRange] = useState({ from: `${year}-01-01`, to: `${year}-12-31` });
  return (
    <>
      <PageHead title="Reports" subtitle="Auswertungen zu Umsatz, offenen Posten, Lager und Mehrwertsteuer">
        <button className="btn" onClick={() => window.print()}>Drucken / PDF</button>
      </PageHead>
      <Tabs value={tab} onChange={setTab} tabs={[['sales', 'Umsatz'], ['receivables', 'Debitoren-Fälligkeit'], ['payables', 'Kreditoren-Fälligkeit'], ['stock', 'Lagerbewertung'], ['vat', 'MwSt-Übersicht']]} />
      {(tab === 'sales' || tab === 'vat') && <Range range={range} setRange={setRange} />}
      {tab === 'sales' && <Sales range={range} />}
      {tab === 'receivables' && <OpenItems kind="receivables" />}
      {tab === 'payables' && <OpenItems kind="payables" />}
      {tab === 'stock' && <Stock />}
      {tab === 'vat' && <Vat range={range} />}
    </>
  );
}
