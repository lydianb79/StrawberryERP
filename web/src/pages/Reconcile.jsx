// Bankabstimmung: Buchsaldo gegen Kontoauszug, Buchungen als abgestimmt markieren
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, fmtDate, fmtDateTime, money, round2, today } from '../lib.js';
import { useAuth } from '../auth.js';
import { Field, Icon, PageHead, useToast } from '../components/ui.jsx';

export default function Reconcile() {
  const { can, settings } = useAuth();
  const toast = useToast();
  const fileRef = useRef(null);
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState(today());
  const [statement, setStatement] = useState('');
  const [data, setData] = useState(null);
  const [showDone, setShowDone] = useState(false);
  const writable = can('accounting.write');

  useEffect(() => {
    api('/reports/lookup').then((l) => {
      const banks = l.accounts.filter((a) => a.type === 'asset' && a.number < '1100');
      setAccounts(banks);
      setAccountId(banks.find((a) => a.number === settings?.accounting?.bank)?.id || banks[0]?.id || '');
    }).catch(() => {});
  }, [settings]);
  const load = useCallback(() => {
    if (!accountId) return;
    api(`/reconcile?account_id=${accountId}&date=${date}`).then(setData).catch((e) => toast.error(e.message));
  }, [accountId, date, toast]);
  useEffect(() => { load(); }, [load]);

  const mark = async (ids, reconciled) => {
    try { await api('/reconcile/mark', { method: 'POST', body: { line_ids: ids, reconciled } }); load(); } catch (err) { toast.error(err.message); }
  };
  const readStatement = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const s = await api('/reconcile/statement', { method: 'POST', body: { xml: String(reader.result) } });
        setStatement(String(s.balance));
        if (s.date) setDate(s.date);
        toast(`Schlusssaldo ${money(s.balance)} per ${fmtDate(s.date)} übernommen.`);
      } catch (err) { toast.error(err.message); }
    };
    reader.readAsText(file);
  };
  const save = async () => {
    try {
      const r = await api('/reconcile', { method: 'POST', body: { account_id: accountId, date, statement_balance: statement } });
      toast(r.difference === 0 ? 'Abstimmung festgehalten – keine Differenz.' : `Abstimmung festgehalten – Differenz ${money(r.difference)}.`);
      load();
    } catch (err) { toast.error(err.message); }
  };

  const open = data ? data.lines.filter((l) => !l.reconciled_at) : [];
  const shown = data ? data.lines.filter((l) => showDone || !l.reconciled_at) : [];
  const difference = data && statement !== '' ? round2(Number(statement) - data.reconciledBalance) : null;

  return (
    <div className="stack">
      <PageHead title="Bankabstimmung" subtitle="Saldo der Buchhaltung mit dem Kontoauszug der Bank abgleichen" />
      <div className="card">
        <div className="card-body">
          <div className="form-grid cols-4" style={{ alignItems: 'end' }}>
            <Field label="Konto">
              <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.number} {a.name}</option>)}
              </select>
            </Field>
            <Field label="Per Datum"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Saldo laut Kontoauszug"><input className="input num" type="number" step="0.01" value={statement} onChange={(e) => setStatement(e.target.value)} /></Field>
            <div className="field row" style={{ flexWrap: 'nowrap' }}>
              <input ref={fileRef} type="file" accept=".xml,text/xml,application/xml" hidden onChange={(e) => { readStatement(e.target.files[0]); e.target.value = ''; }} />
              <button className="btn" onClick={() => fileRef.current.click()} title="Schlusssaldo aus einem camt.053-Kontoauszug übernehmen"><Icon name="bank" /> aus camt.053</button>
            </div>
          </div>
        </div>
      </div>
      {data && (
        <>
          <div className="kpi-grid">
            <div className="card kpi"><div className="label">Saldo Buchhaltung</div><div className="value">{money(data.bookBalance)}</div><div className="sub">Konto {data.account.number} per {fmtDate(data.date)}</div></div>
            <div className="card kpi"><div className="label">Noch nicht abgestimmt</div><div className="value">{money(data.openItems)}</div><div className="sub">{open.length} Buchungen</div></div>
            <div className="card kpi"><div className="label">Abgestimmter Saldo</div><div className="value">{money(data.reconciledBalance)}</div><div className="sub">sollte dem Kontoauszug entsprechen</div></div>
            <div className="card kpi"><div className="label">Differenz zum Auszug</div>
              <div className={`value ${difference ? 'neg' : difference === 0 ? 'pos' : ''}`}>{difference === null ? '–' : money(difference)}</div>
              <div className="sub">{difference === null ? 'Saldo laut Auszug eingeben' : difference === 0 ? 'stimmt überein' : 'bitte klären'}</div></div>
          </div>
          <div className="card">
            <div className="card-head">
              <h2>Buchungen auf dem Konto</h2>
              <label className="check"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> abgestimmte anzeigen</label>
              <div className="spacer" />
              {writable && open.length > 0 && <button className="btn sm" onClick={() => mark(open.map((l) => l.id), true)}>Alle {open.length} abstimmen</button>}
              {writable && <button className="btn sm primary" disabled={statement === ''} onClick={save}><Icon name="check" /> Abstimmung festhalten</button>}
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th style={{ width: 40 }} /><th>Datum</th><th>Text</th><th className="num">Eingang</th><th className="num">Ausgang</th><th>Abgestimmt</th></tr></thead>
                <tbody>
                  {shown.map((l) => (
                    <tr key={l.id}>
                      <td>{writable && <input type="checkbox" checked={!!l.reconciled_at} onChange={(e) => mark([l.id], e.target.checked)} title="Auf dem Kontoauszug vorhanden" />}</td>
                      <td>{fmtDate(l.date)}</td><td>{l.text}</td>
                      <td className="num">{l.debit ? money(l.debit) : ''}</td><td className="num">{l.credit ? money(l.credit) : ''}</td>
                      <td className="muted small">{l.reconciled_at ? fmtDateTime(l.reconciled_at) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!shown.length && <div className="empty">{data.lines.length ? 'Alle Buchungen sind abgestimmt.' : 'Keine Buchungen auf diesem Konto.'}</div>}
            </div>
          </div>
          {data.history.length > 0 && (
            <div className="card">
              <div className="card-head"><h2>Festgehaltene Abstimmungen</h2></div>
              <table className="table">
                <thead><tr><th>Per</th><th className="num">Saldo Auszug</th><th className="num">Saldo Buchhaltung</th><th className="num">Nicht abgestimmt</th><th className="num">Differenz</th><th>Erfasst</th></tr></thead>
                <tbody>
                  {data.history.map((h) => {
                    const d = round2(h.statement_balance - (h.book_balance - h.open_items));
                    return (
                      <tr key={h.id}><td>{fmtDate(h.date)}</td><td className="num">{money(h.statement_balance)}</td><td className="num">{money(h.book_balance)}</td>
                        <td className="num">{money(h.open_items)}</td><td className={`num ${d ? 'neg' : 'pos'}`}>{money(d)}</td><td className="muted small">{h.user_name}, {fmtDateTime(h.created_at)}</td></tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
