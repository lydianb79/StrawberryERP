import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, compact, fmtDate, money, monthLabel, qty } from '../lib.js';
import { useAuth } from '../auth.js';
import { BarChart, PageHead, StatusBadge } from '../components/ui.jsx';

function Kpi({ label, value, sub, tone }) {
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className={`value ${tone || ''}`}>{value}</div>
      <div className="sub">{sub}</div>
    </div>
  );
}

/** Füllt die letzten 12 Monate lückenlos auf. */
function last12(monthly) {
  const map = new Map(monthly.map((m) => [m.month, m.amount]));
  const out = [];
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 11);
  for (let i = 0; i < 12; i++) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ label: monthLabel(key), value: map.get(key) || 0 });
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}

export default function Dashboard() {
  const { user, can } = useAuth();
  const [data, setData] = useState(null);
  const [tasks, setTasks] = useState([]);
  const loadTasks = () => api('/crm?mine=1').then(setTasks).catch(() => setTasks([]));
  useEffect(() => { api('/reports/dashboard').then(setData).catch(() => setData({})); loadTasks(); }, []);
  if (!data) return <div className="empty">Lädt…</div>;
  const f = data.finance;

  return (
    <div className="stack">
      <PageHead title={`Guten Tag, ${user.name.split(' ')[0]}`} subtitle={f?.fiscalYear ? `Übersicht Geschäftsjahr ${f.fiscalYear}` : 'Übersicht'} />
      <div className="kpi-grid" style={f ? { gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' } : undefined}>
        {f && <Kpi label="Umsatz (netto)" value={`CHF ${money(f.revenue.amount)}`} sub={`${f.revenue.n} Rechnungen im Geschäftsjahr`} />}
        {f && <Kpi label="Offene Debitoren" value={`CHF ${money(f.receivables.amount)}`}
          sub={f.receivables.overdue > 0 ? <span className="neg">davon überfällig: CHF {money(f.receivables.overdue)}</span> : `${f.receivables.n} offene Posten`} />}
        {f && <Kpi label="Offene Kreditoren" value={`CHF ${money(f.payables.amount)}`}
          sub={f.payables.overdue > 0 ? <span className="neg">davon überfällig: CHF {money(f.payables.overdue)}</span> : `${f.payables.n} offene Posten`} />}
        {f && <Kpi label="Lagerwert" value={`CHF ${money(f.stockValue)}`} sub="zu Einstandspreisen" />}
        <Kpi label="Offene Offerten" value={data.openQuotes?.n ?? 0} sub={`Volumen CHF ${money(data.openQuotes?.amount)}`} />
        <Kpi label="Aufträge in Arbeit" value={data.openOrders?.n ?? 0} sub={`Volumen CHF ${money(data.openOrders?.amount)}`} />
        {can('purchasing.read') && <Kpi label="Offene Bestellungen" value={data.openPurchases?.n ?? 0} sub={`Volumen CHF ${money(data.openPurchases?.amount)}`} />}
      </div>

      <div className="grid-3">
        {f && (
          <div className="card">
            <div className="card-head"><h2>Umsatz der letzten 12 Monate</h2><span className="muted small">netto, in CHF</span></div>
            <div className="card-body"><BarChart data={last12(f.monthly)} format={compact} /></div>
          </div>
        )}
        <div className="card">
          <div className="card-head"><h2>Lager: Nachbestellen</h2></div>
          {data.lowStock?.length ? (
            <table className="table">
              <tbody>
                {data.lowStock.map((p) => (
                  <tr key={p.id}>
                    <td><b>{p.name}</b><div className="muted small">{p.sku}</div></td>
                    <td className="num"><span className="neg">{qty(p.stock_qty)}</span> <span className="muted">/ min. {qty(p.min_stock)} {p.unit}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div className="empty">Alle Bestände über dem Mindestbestand.</div>}
        </div>
      </div>

      {tasks.length > 0 && (
        <div className="card">
          <div className="card-head"><h2>Meine offenen Aufgaben</h2></div>
          <table className="table">
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id}>
                  <td style={{ width: 36 }}><input type="checkbox" title="Erledigt" onChange={() => api(`/crm/${t.id}`, { method: 'PUT', body: { done: true } }).then(loadTasks)} /></td>
                  <td><b>{t.text}</b><div className="muted small">{t.customer_name}{t.document_number ? ` · ${t.document_number}` : ''}</div></td>
                  <td className="num">{t.due_date ? <span className={t.due_date < new Date().toISOString().slice(0, 10) ? 'neg' : ''}>fällig {fmtDate(t.due_date)}</span> : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {f && can('invoices.read') && (
        <div className="card">
          <div className="card-head"><h2>Letzte Rechnungen</h2><div className="spacer" /><Link to="/rechnungen">Alle anzeigen</Link></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Nr.</th><th>Kunde</th><th>Datum</th><th className="num">Betrag</th><th>Status</th></tr></thead>
              <tbody>
                {f.recent.map((r) => (
                  <tr key={r.id}>
                    <td><Link to={`/rechnungen/${r.id}`}>{r.number || 'Entwurf'}</Link></td>
                    <td>{r.customer_name}</td>
                    <td>{fmtDate(r.date)}</td>
                    <td className="num">{r.currency !== 'CHF' ? `${r.currency} ` : ''}{money(r.total)}</td>
                    <td><StatusBadge status={r.status} overdue={!!r.overdue} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
