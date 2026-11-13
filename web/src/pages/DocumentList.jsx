import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, DOC, fmtDate, money, STATUS } from '../lib.js';
import { useAuth } from '../auth.js';
import { DataTable, Icon, PageHead, StatusBadge, useToast } from '../components/ui.jsx';

const FILTERS = {
  quote: ['draft', 'sent', 'accepted', 'rejected'],
  order: ['open', 'delivered', 'invoiced', 'cancelled'],
  invoice: ['draft', 'open', 'partial', 'paid', 'cancelled'],
};

export default function DocumentList({ type }) {
  const meta = DOC[type];
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [status, setStatus] = useState('');

  useEffect(() => { setStatus(''); }, [type]);
  useEffect(() => {
    setRows(null);
    api(`/documents?type=${type}${status ? `&status=${status}` : ''}`).then(setRows).catch((e) => { setRows([]); toast.error(e.message); });
  }, [type, status, toast]);

  const columns = [
    { key: 'number', label: 'Nr.', render: (r) => <b>{r.number || 'Entwurf'}</b>, csv: (r) => r.number || 'Entwurf' },
    { key: 'customer_name', label: 'Kunde' },
    { key: 'date', label: 'Datum', render: (r) => fmtDate(r.date), csv: (r) => fmtDate(r.date) },
    type === 'quote' && { key: 'valid_until', label: 'Gültig bis', render: (r) => fmtDate(r.valid_until), csv: (r) => fmtDate(r.valid_until) },
    type === 'invoice' && { key: 'due_date', label: 'Fällig', render: (r) => fmtDate(r.due_date), csv: (r) => fmtDate(r.due_date) },
    { key: 'reference', label: 'Referenz' },
    { key: 'subtotal', label: 'Netto', num: true, render: (r) => money(r.subtotal) },
    { key: 'total', label: 'Total inkl. MwSt', num: true, render: (r) => money(r.total) },
    type === 'invoice' && { key: 'open', label: 'Offen', num: true, csv: (r) => r.total - r.paid_amount,
      render: (r) => (['open', 'partial'].includes(r.status) ? money(r.total - r.paid_amount) : '–') },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} overdue={!!r.overdue} />, csv: (r) => STATUS[r.status]?.[0] },
  ].filter(Boolean);

  return (
    <>
      <PageHead title={meta.title} subtitle={{ quote: 'Angebote erstellen und in Aufträge umwandeln', order: 'Auftragsabwicklung und Auslieferung', invoice: 'Rechnungen erstellen, buchen und versenden' }[type]}>
        {can(`${meta.perm}.write`) && (
          <button className="btn primary" onClick={() => navigate(`/${meta.path}/neu`)}><Icon name="plus" /> {{ quote: 'Neue Offerte', order: 'Neuer Auftrag', invoice: 'Neue Rechnung' }[type]}</button>
        )}
      </PageHead>
      <DataTable columns={columns} rows={rows} exportName={meta.path} onRowClick={(r) => navigate(`/${meta.path}/${r.id}`)}
        toolbar={(
          <select className="input" style={{ width: 180 }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Alle Status</option>
            {FILTERS[type].map((s) => <option key={s} value={s}>{STATUS[s][0]}</option>)}
          </select>
        )}
        footer={(list) => (
          <tr>
            <td colSpan={columns.findIndex((c) => c.key === 'subtotal')}>Summe</td>
            <td className="num">{money(list.reduce((s, r) => s + r.subtotal, 0))}</td>
            <td className="num">{money(list.reduce((s, r) => s + r.total, 0))}</td>
            <td colSpan={type === 'invoice' ? 2 : 1} />
          </tr>
        )} />
    </>
  );
}
