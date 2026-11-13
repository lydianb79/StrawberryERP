// Mahnwesen, Zahlungsabgleich (Kontoauszug einlesen) und wiederkehrende Rechnungen
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate, fmtDateTime, money } from '../lib.js';
import { useAuth } from '../auth.js';
import { DataTable, Field, Icon, Modal, PageHead, useToast } from '../components/ui.jsx';
import { MailModal } from './DocumentEditor.jsx';

// ---------- Mahnwesen ----------
function DunningSettings({ onClose }) {
  const { settings, reloadSettings } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState(structuredClone(settings.dunning));
  const setLevel = (i, patch) => setForm((f) => ({ ...f, levels: f.levels.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const save = async (e) => {
    e.preventDefault();
    try {
      await api('/settings/dunning', { method: 'PUT', body: { paymentDays: Number(form.paymentDays) || 10,
        levels: form.levels.map((l) => ({ ...l, days: Number(l.days) || 0, fee: Number(l.fee) || 0 })) } });
      await reloadSettings();
      toast('Mahnstufen gespeichert.');
      onClose();
    } catch (err) { toast.error(err.message); }
  };
  return (
    <Modal title="Mahnstufen einrichten" onClose={onClose} wide>
      <form onSubmit={save} className="stack">
        <Field label="Neue Zahlungsfrist ab Mahndatum (Tage)"><input className="input num" style={{ maxWidth: 140 }} type="number" min="1" value={form.paymentDays} onChange={(e) => setForm({ ...form, paymentDays: e.target.value })} /></Field>
        {form.levels.map((l, i) => (
          <div className="card" key={i}>
            <div className="card-body">
              <div className="form-grid cols-4">
                <Field label={`Stufe ${i + 1}: Bezeichnung`} className="span-2"><input className="input" required value={l.title} onChange={(e) => setLevel(i, { title: e.target.value })} /></Field>
                <Field label={i === 0 ? 'Tage nach Fälligkeit' : 'Tage nach Vorstufe'}><input className="input num" type="number" min="0" value={l.days} onChange={(e) => setLevel(i, { days: e.target.value })} /></Field>
                <Field label="Mahngebühr"><input className="input num" type="number" min="0" step="0.05" value={l.fee} onChange={(e) => setLevel(i, { fee: e.target.value })} /></Field>
                <Field label="Text auf dem Schreiben" className="span-all" hint="Platzhalter: {frist} = neue Zahlungsfrist, {nummer}, {kunde}"><textarea className="input" rows={3} value={l.text} onChange={(e) => setLevel(i, { text: e.target.value })} /></Field>
              </div>
              {form.levels.length > 1 && <button type="button" className="btn sm danger" style={{ marginTop: 10 }} onClick={() => setForm({ ...form, levels: form.levels.filter((_, j) => j !== i) })}>Stufe entfernen</button>}
            </div>
          </div>
        ))}
        <div className="row">
          <button type="button" className="btn" onClick={() => setForm({ ...form, levels: [...form.levels, { title: `${form.levels.length}. Mahnung`, days: 10, fee: 0, text: '' }] })}><Icon name="plus" /> Stufe hinzufügen</button>
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
          <button className="btn primary">Speichern</button>
        </div>
      </form>
    </Modal>
  );
}

export function DunningTab() {
  const { can } = useAuth();
  const toast = useToast();
  const [props, setProps] = useState(null);
  const [notices, setNotices] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [mail, setMail] = useState(null);
  const [config, setConfig] = useState(false);
  const writable = can('receivables.write');

  const load = useCallback(() => {
    api('/dunning/proposals').then((list) => { setProps(list); setPicked(new Set(list.filter((p) => p.eligible).map((p) => p.id))); })
      .catch((e) => { setProps([]); toast.error(e.message); });
    api('/dunning').then(setNotices).catch(() => setNotices([]));
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const toggle = (id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const runDunning = async () => {
    if (!picked.size) return toast.error('Bitte mindestens eine Rechnung auswählen.');
    if (!window.confirm(`Für ${picked.size} Rechnung(en) die nächste Mahnstufe auslösen?\n\nMahngebühren werden dabei als Forderung verbucht.`)) return undefined;
    try {
      const created = await api('/dunning/run', { method: 'POST', body: { invoice_ids: [...picked] } });
      toast(`${created.length} Mahnung(en) erstellt.`);
      return load();
    } catch (err) { return toast.error(err.message); }
  };

  return (
    <div className="stack">
      <div className="row">
        <h2>Mahnlauf: überfällige Rechnungen</h2>
        <div className="spacer" />
        {can('admin.settings') && <button className="btn" onClick={() => setConfig(true)}>Mahnstufen einrichten</button>}
        {writable && <button className="btn primary" disabled={!picked.size} onClick={runDunning}><Icon name="bell" /> {picked.size} Mahnung(en) erstellen</button>}
      </div>
      <DataTable searchable={false} rows={props} empty="Keine überfälligen Rechnungen." columns={[
        { key: 'pick', label: '', render: (r) => (r.eligible && writable ? <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} /> : null) },
        { key: 'number', label: 'Rechnung', render: (r) => <Link to={`/rechnungen/${r.id}`}><b>{r.number}</b></Link> },
        { key: 'customer_name', label: 'Kunde' },
        { key: 'due_date', label: 'Fällig', render: (r) => fmtDate(r.due_date) },
        { key: 'days_overdue', label: 'Tage überfällig', num: true, render: (r) => <span className="neg">{r.days_overdue}</span> },
        { key: 'open_amount', label: 'Offen', num: true, render: (r) => `${r.currency} ${money(r.open_amount)}` },
        { key: 'dunning_level', label: 'Bisher', render: (r) => (r.dunning_level ? `Stufe ${r.dunning_level} am ${fmtDate(r.dunning_date)}` : 'nicht gemahnt') },
        { key: 'next', label: 'Nächster Schritt', render: (r) => (!r.next_level ? <span className="badge red">Höchste Stufe erreicht</span>
          : r.eligible ? <span className="badge amber">{r.next_title}{r.next_fee > 0 ? ` (+ ${money(r.next_fee)})` : ''}</span>
            : <span className="muted">{r.next_title} in {r.wait_days} Tagen</span>) },
      ]} />

      <h2>Erstellte Mahnungen</h2>
      <DataTable rows={notices} exportName="mahnungen" empty="Noch keine Mahnungen erstellt." columns={[
        { key: 'date', label: 'Datum', render: (r) => fmtDate(r.date), csv: (r) => fmtDate(r.date) },
        { key: 'number', label: 'Rechnung', render: (r) => <Link to={`/rechnungen/${r.document_id}`}>{r.number}</Link> },
        { key: 'customer_name', label: 'Kunde' },
        { key: 'level', label: 'Stufe', num: true },
        { key: 'fee', label: 'Gebühr', num: true, render: (r) => money(r.fee) },
        { key: 'open_amount', label: 'Offen bei Mahnung', num: true, render: (r) => `${r.currency} ${money(r.open_amount)}` },
        { key: 'due_date', label: 'Neue Frist', render: (r) => fmtDate(r.due_date), csv: (r) => fmtDate(r.due_date) },
        { key: 'sent_at', label: 'Versendet', render: (r) => (r.sent_at ? fmtDateTime(r.sent_at) : '–') },
        { key: '_actions', label: '', render: (r) => (
          <span className="row" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
            <a className="btn sm" href={`/api/dunning/${r.id}/pdf`} target="_blank" rel="noreferrer"><Icon name="pdf" /> PDF</a>
            {writable && <button className="btn sm" onClick={() => setMail(r)}><Icon name="mail" /> E-Mail</button>}
          </span>
        ) },
      ]} />
      {mail && (
        <MailModal title={`Mahnung zu ${mail.number} per E-Mail senden`} draftPath={`/dunning/${mail.id}/mail`} sendPath={`/dunning/${mail.id}/send`}
          onClose={() => setMail(null)} onSent={() => { setMail(null); load(); }} />
      )}
      {config && <DunningSettings onClose={() => setConfig(false)} />}
    </div>
  );
}

// ---------- Zahlungsabgleich ----------
const STATE = { match: ['Zugeordnet', 'green'], review: ['Prüfen', 'amber'], unmatched: ['Nicht zugeordnet', ''], duplicate: ['Bereits verbucht', 'blue'] };

export function BankingTab() {
  const toast = useToast();
  const { settings } = useAuth();
  const fileRef = useRef(null);
  const [entries, setEntries] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [xml, setXml] = useState(null);

  useEffect(() => {
    api('/reports/lookup').then((l) => {
      const banks = l.accounts.filter((a) => a.type === 'asset' && a.number < '1100');
      setAccounts(banks);
      setAccountId(banks.find((a) => a.number === settings?.accounting?.bank)?.id || banks[0]?.id || '');
    }).catch(() => {});
  }, [settings]);

  const preview = async (text) => {
    setBusy(true);
    try {
      const res = await fetch('/api/banking/preview', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'text/plain' }, body: text });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
      setEntries(data.entries);
      setPicked(new Set(data.entries.map((e, i) => (e.state === 'match' ? i : null)).filter((i) => i !== null)));
      setXml(text);
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  const upload = (file) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast.error('Die Datei ist zu gross (max. 10 MB).'); return; }
    const reader = new FileReader();
    reader.onload = () => preview(String(reader.result));
    reader.readAsText(file);
  };
  const book = async () => {
    const list = [...picked].map((i) => entries[i]).map((e) => ({ invoice_id: e.match.invoice_id, amount: e.amount, date: e.date, bank_ref: e.bank_ref, debtor: e.debtor }));
    setBusy(true);
    try {
      const result = await api('/banking/book', { method: 'POST', body: { entries: list, account_id: accountId } });
      if (result.errors.length) toast.error(`${result.booked} verbucht, ${result.errors.length} abgelehnt: ${result.errors[0].error}`);
      else toast(`${result.booked} Zahlung(en) verbucht.`);
      await preview(xml);
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  const toggle = (i) => setPicked((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });

  return (
    <div className="stack">
      <div className="card">
        <div className="card-body">
          <div className="row">
            <div style={{ maxWidth: 560 }}>
              <h2>Kontoauszug einlesen</h2>
              <p className="muted" style={{ margin: '4px 0 0' }}>Laden Sie einen Kontoauszug im Format camt.053 oder camt.054 (XML) aus dem E-Banking hoch. Zahlungseingänge werden über die QR-Referenz oder die Rechnungsnummer den offenen Rechnungen zugeordnet.</p>
            </div>
            <div className="spacer" />
            <input ref={fileRef} type="file" accept=".xml,text/xml,application/xml" hidden onChange={(e) => { upload(e.target.files[0]); e.target.value = ''; }} />
            <button className="btn primary" disabled={busy} onClick={() => fileRef.current.click()}><Icon name="bank" /> {busy ? 'Bitte warten…' : 'Datei wählen'}</button>
          </div>
        </div>
      </div>
      {entries && (
        <>
          <div className="row">
            <h2>{entries.length} Zahlungseingänge</h2>
            <div className="spacer" />
            <select className="input" style={{ width: 260 }} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.number} {a.name}</option>)}
            </select>
            <button className="btn primary" disabled={busy || !picked.size} onClick={book}><Icon name="check" /> {picked.size} Zahlung(en) verbuchen</button>
          </div>
          <DataTable searchable={false} rows={entries.map((e, i) => ({ ...e, id: i }))} empty="Der Kontoauszug enthält keine Zahlungseingänge." columns={[
            { key: 'pick', label: '', render: (r) => (r.state === 'match' ? <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} /> : null) },
            { key: 'date', label: 'Datum', render: (r) => fmtDate(r.date) },
            { key: 'debtor', label: 'Zahler' },
            { key: 'amount', label: 'Betrag', num: true, render: (r) => `${r.currency} ${money(r.amount)}` },
            { key: 'reference', label: 'Referenz / Mitteilung', render: (r) => <span className="small">{r.reference || r.message || '–'}</span> },
            { key: 'match', label: 'Rechnung', render: (r) => (r.match ? <><Link to={`/rechnungen/${r.match.invoice_id}`}><b>{r.match.number}</b></Link><div className="muted small">{r.match.customer_name} · offen {money(r.match.open_amount)}</div></> : '–') },
            { key: 'state', label: 'Status', render: (r) => <><span className={`badge ${STATE[r.state][1]}`}>{STATE[r.state][0]}</span><div className="muted small">{r.hint}</div></> },
          ]} />
          <p className="muted small">Nicht zugeordnete oder zu prüfende Eingänge erfassen Sie bei der betreffenden Rechnung von Hand. Bereits verbuchte Bankbuchungen werden beim erneuten Einlesen erkannt.</p>
        </>
      )}
    </div>
  );
}

// ---------- Abo-Rechnungen ----------
const PERIOD = { monthly: 'Monatlich', quarterly: 'Vierteljährlich', halfyearly: 'Halbjährlich', yearly: 'Jährlich' };

export function Recurring() {
  const { can } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null);
  const writable = can('invoices.write');
  const load = useCallback(() => api('/recurring').then(setRows).catch((e) => { setRows([]); toast.error(e.message); }), [toast]);
  useEffect(() => { load(); }, [load]);

  const runNow = async (id) => {
    try {
      const result = await api('/recurring/run', { method: 'POST', body: id ? { id } : {} });
      if (result.errors.length) toast.error(`Fehler: ${result.errors[0].error}`);
      toast(result.created.length ? `${result.created.length} Rechnung(en) erstellt.` : 'Keine Abo-Rechnung ist fällig.');
      load();
    } catch (err) { toast.error(err.message); }
  };
  const save = async (e) => {
    e.preventDefault();
    try {
      await api(`/recurring/${editing.id}`, { method: 'PUT', body: editing });
      toast('Gespeichert.');
      setEditing(null);
      load();
    } catch (err) { toast.error(err.message); }
  };
  const remove = async () => {
    if (!window.confirm(`Abo «${editing.name}» löschen? Bereits erstellte Rechnungen bleiben bestehen.`)) return;
    try { await api(`/recurring/${editing.id}`, { method: 'DELETE' }); toast('Abo gelöscht.'); setEditing(null); load(); } catch (err) { toast.error(err.message); }
  };
  const set = (patch) => setEditing((cur) => ({ ...cur, ...patch }));

  return (
    <>
      <PageHead title="Abo-Rechnungen" subtitle="Wiederkehrende Rechnungen für Wartungsverträge, Mieten und Abonnemente – werden zum Termin automatisch erstellt">
        {writable && <button className="btn" onClick={() => runNow(null)}><Icon name="repeat" /> Fällige jetzt erstellen</button>}
      </PageHead>
      <div className="alert info" style={{ marginBottom: 16 }}>Ein neues Abo legen Sie aus einer bestehenden Rechnung an: Rechnung öffnen → <b>Als Abo</b>. Positionen und Texte der Rechnung dienen als Vorlage.</div>
      <DataTable rows={rows} exportName="abo-rechnungen" onRowClick={writable ? (r) => setEditing({ ...r, active: !!r.active, auto_issue: !!r.auto_issue, end_date: r.end_date || '' }) : undefined}
        empty="Noch keine Abo-Rechnungen eingerichtet." columns={[
          { key: 'name', label: 'Bezeichnung', render: (r) => <b>{r.name}</b> },
          { key: 'customer_name', label: 'Kunde' },
          { key: 'period', label: 'Rhythmus', render: (r) => PERIOD[r.period], csv: (r) => PERIOD[r.period] },
          { key: 'next_date', label: 'Nächste Rechnung', render: (r) => fmtDate(r.next_date), csv: (r) => fmtDate(r.next_date) },
          { key: 'total', label: 'Betrag', num: true, render: (r) => `${r.currency} ${money(r.total)}` },
          { key: 'auto_issue', label: 'Erstellt als', render: (r) => (r.auto_issue ? 'gebuchte Rechnung' : 'Entwurf') },
          { key: 'last_number', label: 'Letzte Rechnung', render: (r) => (r.last_document_id ? <Link to={`/rechnungen/${r.last_document_id}`} onClick={(e) => e.stopPropagation()}>{r.last_number || 'Entwurf'}</Link> : '–') },
          { key: 'active', label: 'Status', render: (r) => (r.active ? <span className="badge green">Aktiv</span> : <span className="badge">Beendet</span>) },
          { key: '_actions', label: '', render: (r) => writable && !!r.active && <button className="btn sm" onClick={() => runNow(r.id)}>Jetzt ausführen</button> },
        ]} />
      {editing && (
        <Modal title={`Abo: ${editing.name}`} onClose={() => setEditing(null)}>
          <form onSubmit={save}>
            <div className="form-grid">
              <Field label="Bezeichnung *" className="span-all"><input className="input" required value={editing.name} onChange={(e) => set({ name: e.target.value })} /></Field>
              <Field label="Rhythmus">
                <select className="input" value={editing.period} onChange={(e) => set({ period: e.target.value })}>
                  {Object.entries(PERIOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="Nächste Rechnung am *"><input className="input" type="date" required value={editing.next_date} onChange={(e) => set({ next_date: e.target.value })} /></Field>
              <Field label="Endet am" hint="Leer = unbefristet"><input className="input" type="date" value={editing.end_date} onChange={(e) => set({ end_date: e.target.value })} /></Field>
              <div className="field" style={{ justifyContent: 'flex-end', gap: 8 }}>
                <label className="check"><input type="checkbox" checked={editing.auto_issue} onChange={(e) => set({ auto_issue: e.target.checked })} /> Automatisch buchen</label>
                <label className="check"><input type="checkbox" checked={editing.active} onChange={(e) => set({ active: e.target.checked })} /> Aktiv</label>
              </div>
            </div>
            <p className="muted small">Positionen ändern: aus einer angepassten Rechnung ein neues Abo anlegen und dieses hier beenden.</p>
            <div className="row" style={{ marginTop: 14 }}>
              <button type="button" className="btn danger" onClick={remove}><Icon name="trash" /> Löschen</button>
              <div className="spacer" />
              <button type="button" className="btn" onClick={() => setEditing(null)}>Abbrechen</button>
              <button className="btn primary">Speichern</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
