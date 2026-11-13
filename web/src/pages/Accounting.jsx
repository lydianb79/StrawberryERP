import { useCallback, useEffect, useState } from 'react';
import { api, fmtDate, fmtDateTime, money, round2, today } from '../lib.js';
import { useAuth } from '../auth.js';
import { DataTable, Field, Icon, Modal, PageHead, useToast } from '../components/ui.jsx';

const REF = {
  manual: 'Manuell', invoice: 'Rechnung', invoice_cancel: 'Storno', payment: 'Zahlung', supplier_invoice: 'Kreditor',
  closing: 'Abschluss', opening: 'Eröffnung',
};

/** Lädt die Geschäftsjahre und wählt das aktuelle (oder jüngste offene) vor. */
function useYears() {
  const [years, setYears] = useState([]);
  const [yearId, setYearId] = useState('');
  const reload = useCallback(async () => {
    const list = await api('/accounting/fiscal-years');
    setYears(list);
    setYearId((cur) => {
      if (cur && list.some((y) => String(y.id) === String(cur))) return cur;
      const t = today();
      return (list.find((y) => y.start_date <= t && y.end_date >= t) || list.find((y) => y.status === 'open') || list[0])?.id || '';
    });
    return list;
  }, []);
  useEffect(() => { reload().catch(() => {}); }, [reload]);
  return { years, yearId, setYearId, reload, year: years.find((y) => String(y.id) === String(yearId)) };
}

function YearSelect({ years, value, onChange }) {
  return (
    <select className="input" style={{ width: 210 }} value={value} onChange={(e) => onChange(e.target.value)}>
      {years.map((y) => <option key={y.id} value={y.id}>Geschäftsjahr {y.name}{y.status === 'closed' ? ' (abgeschlossen)' : ''}</option>)}
    </select>
  );
}

const PrintBtn = () => <button className="btn" onClick={() => window.print()}><Icon name="download" /> Drucken / PDF</button>;

// ---------- Journal ----------
function EntryModal({ accounts, costCenters, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ date: today(), text: '' });
  const blank = { account_id: '', debit: '', credit: '', cost_center_id: '' };
  const [lines, setLines] = useState([{ ...blank }, { ...blank }]);
  const setLine = (i, patch) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const sumD = round2(lines.reduce((s, l) => s + (Number(l.debit) || 0), 0));
  const sumC = round2(lines.reduce((s, l) => s + (Number(l.credit) || 0), 0));
  const balanced = sumD === sumC && sumD > 0;

  const submit = async (e) => {
    e.preventDefault();
    try {
      await api('/accounting/journal', { method: 'POST', body: { ...form, lines: lines.filter((l) => l.account_id) } });
      toast('Buchung erfasst.');
      onSaved();
    } catch (err) { toast.error(err.message); }
  };

  return (
    <Modal title="Manuelle Buchung" onClose={onClose} wide>
      <form onSubmit={submit}>
        <div className="form-grid cols-3">
          <Field label="Buchungsdatum"><input className="input" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          <Field label="Buchungstext *" className="span-2"><input className="input" required autoFocus value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} /></Field>
        </div>
        <table className="table items-table" style={{ marginTop: 14 }}>
          <thead><tr><th>Konto</th>{costCenters.length > 0 && <th style={{ width: 170 }}>Kostenstelle</th>}<th className="num" style={{ width: 130 }}>Soll</th><th className="num" style={{ width: 130 }}>Haben</th><th style={{ width: 36 }} /></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>
                  <select className="input" value={l.account_id} onChange={(e) => setLine(i, { account_id: e.target.value })}>
                    <option value="">Konto wählen…</option>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.number} {a.name}</option>)}
                  </select>
                </td>
                {costCenters.length > 0 && (
                  <td>
                    <select className="input" value={l.cost_center_id} onChange={(e) => setLine(i, { cost_center_id: e.target.value })}>
                      <option value="">–</option>
                      {costCenters.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}
                    </select>
                  </td>
                )}
                <td><input className="input num" type="number" step="0.01" min="0" value={l.debit} onChange={(e) => setLine(i, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} /></td>
                <td><input className="input num" type="number" step="0.01" min="0" value={l.credit} onChange={(e) => setLine(i, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} /></td>
                <td>{lines.length > 2 && <button type="button" className="icon-btn danger" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Icon name="x" /></button>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={costCenters.length > 0 ? 2 : 1}>Summe {!balanced && sumD + sumC > 0 && <span className="neg small">– Differenz {money(Math.abs(sumD - sumC))}</span>}</td>
              <td className="num">{money(sumD)}</td><td className="num">{money(sumC)}</td><td /></tr>
          </tfoot>
        </table>
        <div className="row" style={{ marginTop: 16 }}>
          <button type="button" className="btn" onClick={() => setLines([...lines, { ...blank }])}><Icon name="plus" /> Zeile</button>
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
          <button className="btn primary" disabled={!balanced}>Buchen</button>
        </div>
      </form>
    </Modal>
  );
}

export function Journal() {
  const { can } = useAuth();
  const toast = useToast();
  const { years, yearId, setYearId, year } = useYears();
  const [entries, setEntries] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [accountId, setAccountId] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    if (!yearId) return;
    setEntries(null);
    api(`/accounting/journal?year_id=${yearId}${accountId ? `&account_id=${accountId}` : ''}`).then(setEntries)
      .catch((e) => { setEntries([]); toast.error(e.message); });
  }, [yearId, accountId, toast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api('/reports/lookup').then((l) => { setAccounts(l.accounts); setCostCenters(l.costCenters); }).catch(() => {}); }, []);

  const remove = async (entry) => {
    if (!window.confirm('Diese manuelle Buchung löschen?')) return;
    try { await api(`/accounting/journal/${entry.id}`, { method: 'DELETE' }); toast('Buchung gelöscht.'); load(); } catch (err) { toast.error(err.message); }
  };

  const writable = can('accounting.write') && year?.status === 'open';
  return (
    <>
      <PageHead title="Journal" subtitle="Alle Buchungen der Finanzbuchhaltung (doppelte Buchhaltung)">
        {writable && <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" /> Manuelle Buchung</button>}
      </PageHead>
      <div className="card">
        <div className="card-head">
          <YearSelect years={years} value={yearId} onChange={setYearId} />
          <select className="input" style={{ width: 300 }} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Alle Konten</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.number} {a.name}</option>)}
          </select>
          <div className="spacer" />
          <span className="muted small">{entries ? `${entries.length} Buchungen` : ''}</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Datum</th><th>Nr.</th><th>Text / Konto</th><th>Art</th><th className="num">Soll</th><th className="num">Haben</th><th /></tr></thead>
            <tbody>
              {(entries || []).map((e) => [
                <tr key={`e${e.id}`} className="group-row">
                  <td>{fmtDate(e.date)}</td><td>{e.id}</td><td>{e.text}</td><td>{REF[e.ref_type] || e.ref_type}</td><td /><td />
                  <td className="actions">{writable && e.ref_type === 'manual' && <button className="icon-btn danger" title="Löschen" onClick={() => remove(e)}><Icon name="trash" /></button>}</td>
                </tr>,
                ...e.lines.map((l) => (
                  <tr key={`l${l.id}`}>
                    <td /><td />
                    <td style={{ paddingLeft: l.credit ? 40 : 14 }}>{l.account_number} {l.account_name}</td>
                    <td>{l.cost_center_code && <span className="badge">KST {l.cost_center_code}</span>}</td>
                    <td className="num">{l.debit ? money(l.debit) : ''}</td><td className="num">{l.credit ? money(l.credit) : ''}</td><td />
                  </tr>
                )),
              ])}
            </tbody>
          </table>
          {entries && !entries.length && <div className="empty">Keine Buchungen in diesem Zeitraum.</div>}
          {!entries && <div className="empty">Lädt…</div>}
        </div>
      </div>
      {adding && <EntryModal accounts={accounts} costCenters={costCenters} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
    </>
  );
}

// ---------- Bilanz & Erfolgsrechnung ----------
function useStatement(path) {
  const y = useYears();
  const toast = useToast();
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!y.yearId) return;
    setData(null);
    api(`/accounting/${path}?year_id=${y.yearId}`).then(setData).catch((e) => toast.error(e.message));
  }, [y.yearId, path, toast]);
  return { ...y, data };
}

const Section = ({ title, rows, total, totalLabel }) => (
  <>
    <tr className="section"><td colSpan={3}>{title}</td></tr>
    {rows.map((r) => <tr key={r.number + r.name}><td style={{ width: 70 }} className="muted">{r.number}</td><td>{r.name}</td><td className="num">{money(r.amount)}</td></tr>)}
    {!rows.length && <tr><td /><td className="muted">Keine Bewegungen</td><td /></tr>}
    <tr className="total"><td /><td>{totalLabel}</td><td className="num">{money(total)}</td></tr>
  </>
);

export function BalanceSheet() {
  const { years, yearId, setYearId, data } = useStatement('balance-sheet');
  const sum = (list) => list.reduce((s, r) => s + r.amount, 0);
  const equity = data ? [...data.equity, ...(data.openResult ? [{ number: '', name: data.openResult >= 0 ? 'Laufender Jahresgewinn (noch nicht abgeschlossen)' : 'Laufender Jahresverlust (noch nicht abgeschlossen)', amount: data.openResult }] : [])] : [];
  const diff = data ? round2(data.totalAssets - data.totalLiabilitiesEquity) : 0;
  return (
    <>
      <PageHead title="Bilanz" subtitle={data ? `per ${fmtDate(data.year.status === 'closed' ? data.year.end_date : (today() < data.year.end_date ? today() : data.year.end_date))} · Geschäftsjahr ${data.year.name}` : ''}>
        <YearSelect years={years} value={yearId} onChange={setYearId} /><PrintBtn />
      </PageHead>
      {!data ? <div className="empty">Lädt…</div> : (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <div className="card statement">
            <table className="table"><tbody>
              <Section title="Aktiven" rows={data.assets} total={data.totalAssets} totalLabel="Total Aktiven" />
              <tr className="grand"><td /><td>Bilanzsumme</td><td className="num">{money(data.totalAssets)}</td></tr>
            </tbody></table>
          </div>
          <div className="card statement">
            <table className="table"><tbody>
              <Section title="Fremdkapital" rows={data.liabilities} total={data.totalLiabilities} totalLabel="Total Fremdkapital" />
              <Section title="Eigenkapital" rows={equity} total={sum(equity)} totalLabel="Total Eigenkapital" />
              <tr className="grand"><td /><td>Bilanzsumme</td><td className="num">{money(data.totalLiabilitiesEquity)}</td></tr>
            </tbody></table>
          </div>
          {diff !== 0 && <div className="alert error span-all">Achtung: Aktiven und Passiven weichen um {money(diff)} voneinander ab.</div>}
        </div>
      )}
    </>
  );
}

export function IncomeStatement() {
  const { years, yearId, setYearId, data } = useStatement('income-statement');
  return (
    <>
      <PageHead title="Erfolgsrechnung" subtitle={data ? `${fmtDate(data.year.start_date)} – ${fmtDate(data.year.end_date)} · Geschäftsjahr ${data.year.name}` : ''}>
        <YearSelect years={years} value={yearId} onChange={setYearId} /><PrintBtn />
      </PageHead>
      {!data ? <div className="empty">Lädt…</div> : (
        <div className="card statement">
          <table className="table"><tbody>
            <Section title="Ertrag" rows={data.revenue} total={data.totalRevenue} totalLabel="Total Ertrag" />
            <Section title="Aufwand" rows={data.expense} total={data.totalExpense} totalLabel="Total Aufwand" />
            <tr className="grand"><td /><td>{data.result >= 0 ? 'Jahresgewinn' : 'Jahresverlust'}</td><td className={`num ${data.result >= 0 ? 'pos' : 'neg'}`}>{money(data.result)}</td></tr>
          </tbody></table>
        </div>
      )}
    </>
  );
}

// ---------- Geschäftsjahre & Jahresabschluss ----------
function CloseWizard({ year, onClose, onDone }) {
  const toast = useToast();
  const [preview, setPreview] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  useEffect(() => { api(`/accounting/fiscal-years/${year.id}/close-preview`).then(setPreview).catch((e) => { toast.error(e.message); onClose(); }); }, [year.id]); // eslint-disable-line

  const close = async () => {
    setBusy(true);
    try { setResult(await api(`/accounting/fiscal-years/${year.id}/close`, { method: 'POST' })); } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  if (result) {
    return (
      <Modal title={`Geschäftsjahr ${result.closedYear} abgeschlossen`} onClose={onDone}
        footer={<button className="btn primary" onClick={onDone}>Fertig</button>}>
        <div className="alert ok">Der Jahresabschluss wurde erfolgreich durchgeführt.</div>
        <dl className="dl" style={{ marginTop: 16 }}>
          <dt>{result.profit >= 0 ? 'Jahresgewinn' : 'Jahresverlust'}</dt><dd>CHF {money(result.profit)}</dd>
          <dt>Neues Geschäftsjahr</dt><dd>{result.nextYear}</dd>
          <dt>Vorgetragene Konten</dt><dd>{result.carriedAccounts} Bilanzkonten in die Eröffnungsbilanz übernommen</dd>
        </dl>
      </Modal>
    );
  }
  const blocked = !!preview?.blockingYear;
  return (
    <Modal title={`Jahresabschluss ${year.name}`} onClose={onClose} wide
      footer={<>
        <button className="btn" onClick={onClose}>Abbrechen</button>
        <button className="btn primary" disabled={!preview || !confirmed || busy || blocked} onClick={close}><Icon name="lock" /> Jahr abschliessen</button>
      </>}>
      {!preview ? <div className="empty">Prüfungen laufen…</div> : (
        <div className="stack">
          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="card kpi"><div className="label">Ertrag</div><div className="value" style={{ fontSize: 19 }}>{money(preview.totalRevenue)}</div></div>
            <div className="card kpi"><div className="label">Aufwand</div><div className="value" style={{ fontSize: 19 }}>{money(preview.totalExpense)}</div></div>
            <div className="card kpi"><div className="label">{preview.result >= 0 ? 'Jahresgewinn' : 'Jahresverlust'}</div><div className={`value ${preview.result >= 0 ? 'pos' : 'neg'}`} style={{ fontSize: 19 }}>{money(preview.result)}</div></div>
          </div>
          {blocked && <div className="alert error">Das frühere Geschäftsjahr {preview.blockingYear} muss zuerst abgeschlossen werden.</div>}
          {!preview.balanced && <div className="alert error">Die Bilanz ist nicht ausgeglichen. Bitte Buchungen prüfen.</div>}
          {preview.draftInvoices > 0 && <div className="alert">{preview.draftInvoices} Rechnungsentwurf/-entwürfe mit Datum im Geschäftsjahr sind noch nicht gebucht. Nach dem Abschluss können sie nicht mehr in diesem Jahr gebucht werden.</div>}
          {preview.openOrders > 0 && <div className="alert">{preview.openOrders} Auftrag/Aufträge sind noch nicht verrechnet.</div>}
          <div>
            <h3 style={{ marginBottom: 8 }}>Was beim Abschluss geschieht</h3>
            <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
              <li>Alle Erfolgskonten werden über das Konto «Jahresgewinn/-verlust» abgeschlossen.</li>
              <li>Das Geschäftsjahr {year.name} wird gesperrt – es sind keine Buchungen mehr möglich.</li>
              <li>Das Folgejahr wird (falls nötig) angelegt; die Nummernkreise beginnen neu.</li>
              <li>Die Salden aller Bilanzkonten werden als Eröffnungsbilanz vorgetragen, das Ergebnis in den Gewinnvortrag umgebucht.</li>
              <li>Offene Posten werden übernommen: {preview.receivables.n} Debitoren (CHF {money(preview.receivables.amount)}), {preview.payables.n} Kreditoren (CHF {money(preview.payables.amount)}). Stammdaten und Lagerbestände bleiben unverändert bestehen.</li>
            </ol>
          </div>
          <label className="check"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> Ich habe die Zahlen geprüft und möchte das Geschäftsjahr {year.name} abschliessen.</label>
        </div>
      )}
    </Modal>
  );
}

export function FiscalYears() {
  const { can } = useAuth();
  const toast = useToast();
  const { years, reload } = useYears();
  const [closing, setClosing] = useState(null);
  const [adding, setAdding] = useState(null);
  const mayClose = can('accounting.close');

  const reopen = async (y) => {
    if (!window.confirm(`Abschluss von ${y.name} rückgängig machen?\n\nAbschluss- und Eröffnungsbuchungen werden gelöscht, das Jahr wird wieder geöffnet.`)) return;
    try { await api(`/accounting/fiscal-years/${y.id}/reopen`, { method: 'POST' }); toast(`Geschäftsjahr ${y.name} wieder geöffnet.`); reload(); } catch (err) { toast.error(err.message); }
  };
  const create = async (e) => {
    e.preventDefault();
    try { await api('/accounting/fiscal-years', { method: 'POST', body: adding }); toast('Geschäftsjahr angelegt.'); setAdding(null); reload(); } catch (err) { toast.error(err.message); }
  };
  const suggest = () => {
    const last = years[0];
    const y = last ? Number(last.end_date.slice(0, 4)) + 1 : new Date().getFullYear();
    setAdding({ name: String(y), start_date: `${y}-01-01`, end_date: `${y}-12-31` });
  };

  return (
    <>
      <PageHead title="Jahresabschluss" subtitle="Geschäftsjahre verwalten, abschliessen und Salden auf das neue Jahr vortragen">
        {mayClose && <button className="btn" onClick={suggest}><Icon name="plus" /> Geschäftsjahr anlegen</button>}
      </PageHead>
      <DataTable searchable={false} rows={years} columns={[
        { key: 'name', label: 'Geschäftsjahr', render: (y) => <b>{y.name}</b> },
        { key: 'start_date', label: 'Beginn', render: (y) => fmtDate(y.start_date) },
        { key: 'end_date', label: 'Ende', render: (y) => fmtDate(y.end_date) },
        { key: 'entry_count', label: 'Buchungen', num: true },
        { key: 'status', label: 'Status', render: (y) => (y.status === 'open' ? <span className="badge blue">Offen</span> : <span className="badge green">Abgeschlossen</span>) },
        { key: 'closed_at', label: 'Abgeschlossen am', render: (y) => (y.closed_at ? fmtDateTime(y.closed_at) : '') },
        { key: '_actions', label: '', render: (y) => mayClose && (y.status === 'open'
          ? <button className="btn sm primary" onClick={() => setClosing(y)}><Icon name="lock" /> Abschliessen</button>
          : <button className="btn sm" onClick={() => reopen(y)}>Wieder öffnen</button>) },
      ]} />
      {closing && <CloseWizard year={closing} onClose={() => setClosing(null)} onDone={() => { setClosing(null); reload(); }} />}
      {adding && (
        <Modal title="Geschäftsjahr anlegen" onClose={() => setAdding(null)}>
          <form onSubmit={create}>
            <div className="form-grid cols-3">
              <Field label="Bezeichnung"><input className="input" required value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} /></Field>
              <Field label="Beginn"><input className="input" type="date" required value={adding.start_date} onChange={(e) => setAdding({ ...adding, start_date: e.target.value })} /></Field>
              <Field label="Ende"><input className="input" type="date" required value={adding.end_date} onChange={(e) => setAdding({ ...adding, end_date: e.target.value })} /></Field>
            </div>
            <div className="row" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setAdding(null)}>Abbrechen</button>
              <button className="btn primary">Anlegen</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
