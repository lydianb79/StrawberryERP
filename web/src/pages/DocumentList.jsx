import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, DOC, fmtDate, money, STATUS } from '../lib.js';
import { useAuth } from '../auth.js';
import { DataTable, Icon, PageHead, StatusBadge, useToast } from '../components/ui.jsx';

const FILTERS = {
  quote: ['draft', 'sent', 'accepted', 'rejected'],
  order: ['open', 'delivered', 'invoiced', 'cancelled'],
  invoice: ['draft', 'open', 'partial', 'paid', 'cancelled'],
  purchase: ['draft', 'ordered', 'partly', 'received', 'cancelled'],
};
const SUBTITLE = {
  quote: 'Angebote erstellen und in Aufträge umwandeln', order: 'Auftragsabwicklung und Auslieferung',
  invoice: 'Rechnungen erstellen, buchen und versenden', purchase: 'Bestellungen bei Lieferanten, Wareneingang und Rechnungskontrolle',
};
const NEW = { quote: 'Neue Offerte', order: 'Neuer Auftrag', invoice: 'Neue Rechnung', purchase: 'Neue Bestellung' };

export default function DocumentList({ type }) {
  const meta = DOC[type];
  const { can, settings } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [status, setStatus] = useState('');
  const base = settings?.company?.currency || 'CHF';

  useEffect(() => { setStatus(''); }, [type]);
  useEffect(() => {
    setRows(null);
    api(`/documents?type=${type}${status ? `&status=${status}` : ''}`).then(setRows).catch((e) => { setRows([]); toast.error(e.message); });
  }, [type, status, toast]);

  const columns = [
    { key: 'number', label: 'Nr.', render: (r) => <b>{r.number || 'Entwurf'}</b>, csv: (r) => r.number || 'Entwurf' },
    { key: 'partner_name', label: type === 'purchase' ? 'Lieferant' : 'Kunde' },
    { key: 'date', label: 'Datum', render: (r) => fmtDate(r.date), csv: (r) => fmtDate(r.date) },
    type === 'quote' && { key: 'valid_until', label: 'Gültig bis', render: (r) => fmtDate(r.valid_until), csv: (r) => fmtDate(r.valid_until) },
    type === 'invoice' && { key: 'due_date', label: 'Fällig', render: (r) => fmtDate(r.due_date), csv: (r) => fmtDate(r.due_date) },
    type === 'purchase' && { key: 'due_date', label: 'Liefertermin', render: (r) => fmtDate(r.due_date), csv: (r) => fmtDate(r.due_date) },
    { key: 'reference', label: 'Referenz' },
    { key: 'currency', label: 'Whg.' },
    { key: 'subtotal', label: 'Netto', num: true, render: (r) => money(r.subtotal) },
    { key: 'total', label: 'Total inkl. MwSt', num: true, render: (r) => money(r.total) },
    type === 'invoice' && { key: 'open', label: 'Offen', num: true, csv: (r) => r.total - r.paid_amount,
      render: (r) => (['open', 'partial'].includes(r.status) ? money(r.total - r.paid_amount) : '–') },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} overdue={!!r.overdue} />, csv: (r) => STATUS[r.status]?.[0] },
  ].filter(Boolean);
  const before = columns.findIndex((c) => c.key === 'subtotal');

  return (
    <>
      <PageHead title={meta.title} subtitle={SUBTITLE[type]}>
        {can(`${meta.perm}.write`) && <button className="btn primary" onClick={() => navigate(`/${meta.path}/neu`)}><Icon name="plus" /> {NEW[type]}</button>}
      </PageHead>
      <DataTable columns={columns} rows={rows} exportName={meta.path} onRowClick={(r) => navigate(`/${meta.path}/${r.id}`)}
        toolbar={(
          <select className="input" style={{ width: 200 }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Alle Status</option>
            {FILTERS[type].map((s) => <option key={s} value={s}>{STATUS[s][0]}</option>)}
          </select>
        )}
        footer={(list) => (
          <tr>
            <td colSpan={before}>Summe in {base}</td>
            <td className="num">{money(list.reduce((s, r) => s + r.base_subtotal, 0))}</td>
            <td className="num">{money(list.reduce((s, r) => s + r.base_total, 0))}</td>
            <td colSpan={columns.length - before - 2} />
          </tr>
        )} />
    </>
  );
}
