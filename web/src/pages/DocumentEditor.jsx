import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, DOC, fmtDate, fmtDateTime, money, qty as fmtQty, round2, today } from '../lib.js';
import { useAuth } from '../auth.js';
import { Field, Icon, Modal, PageHead, StatusBadge, useToast } from '../components/ui.jsx';

const emptyItem = (vat) => ({ product_id: '', description: '', qty: 1, unit: 'Stk', unit_price: 0, discount_pct: 0, vat_rate: vat });
const lineTotal = (it) => round2((Number(it.qty) || 0) * (Number(it.unit_price) || 0) * (1 - (Number(it.discount_pct) || 0) / 100));

/** Zahlung erfassen – bei Fremdwährung mit Tageskurs (Kursdifferenz wird automatisch gebucht). */
export function PaymentModal({ title, open, accounts, defaultAccount, onClose, onSubmit, currency, baseCurrency = 'CHF', rate }) {
  const banks = accounts.filter((a) => a.type === 'asset' && a.number < '1100');
  const foreign = !!currency && currency !== baseCurrency;
  const [form, setForm] = useState({
    date: today(), amount: open, account_id: banks.find((a) => a.number === defaultAccount)?.id || banks[0]?.id || '', note: '',
    ...(foreign ? { exchange_rate: rate } : {}),
  });
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(form); }}>
        <div className="form-grid">
          <Field label="Zahlungsdatum"><input className="input" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          <Field label={`Betrag${currency ? ` (${currency})` : ''}`} hint={`Offen: ${money(open)}`}>
            <input className="input num" type="number" step="0.01" min="0.01" required autoFocus value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </Field>
          <Field label="Zahlungskonto">
            <select className="input" required value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })}>
              {banks.map((a) => <option key={a.id} value={a.id}>{a.number} {a.name}</option>)}
            </select>
          </Field>
          {foreign && (
            <Field label={`Kurs am Zahlungstag (1 ${currency} = … ${baseCurrency})`} hint={`Belegkurs ${rate} · entspricht ${baseCurrency} ${money((Number(form.amount) || 0) * (Number(form.exchange_rate) || 0))}`}>
              <input className="input num" type="number" step="any" min="0.000001" required value={form.exchange_rate} onChange={(e) => setForm({ ...form, exchange_rate: e.target.value })} />
            </Field>
          )}
          <Field label="Bemerkung" className={foreign ? 'span-all' : ''}><input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
        </div>
        <div className="row" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
          <button className="btn primary">Zahlung buchen</button>
        </div>
      </form>
    </Modal>
  );
}

function MailModal({ doc, onClose, onSent }) {
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api(`/documents/${doc.id}/mail`).then(setForm).catch((e) => { toast.error(e.message); onClose(); }); }, [doc.id]); // eslint-disable-line
  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await api(`/documents/${doc.id}/send`, { method: 'POST', body: form });
      toast('E-Mail gesendet.');
      onSent(result);
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={`${DOC[doc.type].single} ${doc.number || ''} per E-Mail senden`} onClose={onClose} wide>
      {!form ? <div className="empty">Lädt…</div> : !form.configured ? (
        <div className="alert">Der E-Mail-Versand ist noch nicht eingerichtet. Ein Administrator kann den SMTP-Server unter <b>Administration → E-Mail</b> hinterlegen.</div>
      ) : (
        <form onSubmit={send} className="stack">
          <div className="form-grid">
            <Field label="An *" hint="Mehrere Adressen mit Komma trennen"><input className="input" required autoFocus value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} /></Field>
            <Field label="Kopie (CC)"><input className="input" value={form.cc || ''} onChange={(e) => setForm({ ...form, cc: e.target.value })} /></Field>
            <Field label="Betreff *" className="span-all"><input className="input" required value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></Field>
            <Field label="Nachricht" className="span-all"><textarea className="input" rows={9} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></Field>
          </div>
          <div className="row">
            <span className="muted small"><Icon name="pdf" /> Der Beleg wird als PDF angehängt.</span>
            <div className="spacer" />
            <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
            <button className="btn primary" disabled={busy}>{busy ? 'Sendet…' : 'Senden'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function ReceiveModal({ doc, onClose, onSubmit }) {
  const open = doc.items.filter((it) => it.qty - it.qty_received > 0.0005);
  const [qtys, setQtys] = useState(Object.fromEntries(open.map((it) => [it.id, round2(it.qty - it.qty_received)])));
  return (
    <Modal title={`Wareneingang zu ${doc.number}`} onClose={onClose} wide>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(open.map((it) => ({ item_id: it.id, qty: Number(qtys[it.id]) || 0 }))); }}>
        <table className="table">
          <thead><tr><th>Artikel</th><th className="num">Bestellt</th><th className="num">Bereits erhalten</th><th className="num" style={{ width: 150 }}>Jetzt erhalten</th></tr></thead>
          <tbody>
            {open.map((it) => (
              <tr key={it.id}>
                <td><b>{it.sku}</b> {it.description.split('\n')[0]}{!it.product_id && <div className="muted small">Freie Position – ohne Lagerbuchung</div>}</td>
                <td className="num">{fmtQty(it.qty)} {it.unit}</td>
                <td className="num">{fmtQty(it.qty_received)}</td>
                <td><input className="input num" type="number" step="any" min="0" max={round2(it.qty - it.qty_received)} value={qtys[it.id]} onChange={(e) => setQtys({ ...qtys, [it.id]: e.target.value })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">Die Mengen werden als Wareneingang ins Lager gebucht; der Einstandspreis der Artikel wird auf den Bestellpreis nachgeführt.</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
          <button className="btn primary">Wareneingang buchen</button>
        </div>
      </form>
    </Modal>
  );
}

function BillFromOrderModal({ doc, accounts, onClose, onSubmit }) {
  const expense = accounts.filter((a) => a.type === 'expense' || a.type === 'asset');
  const [form, setForm] = useState({ number: '', date: today(), due_date: '', net: doc.subtotal, vat: doc.vat_total,
    expense_account_id: expense.find((a) => a.number === '4200')?.id || expense[0]?.id || '' });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  return (
    <Modal title={`Lieferantenrechnung zu ${doc.number}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit({ ...form, due_date: form.due_date || null }); }}>
        <div className="form-grid">
          <Field label="Rechnungs-Nr. des Lieferanten *"><input className="input" required autoFocus value={form.number} onChange={(e) => set({ number: e.target.value })} /></Field>
          <Field label="Rechnungsdatum"><input className="input" type="date" required value={form.date} onChange={(e) => set({ date: e.target.value })} /></Field>
          <Field label={`Betrag netto (${doc.currency})`}><input className="input num" type="number" step="0.01" min="0.01" required value={form.net} onChange={(e) => set({ net: e.target.value })} /></Field>
          <Field label={`Vorsteuer (${doc.currency})`}><input className="input num" type="number" step="0.01" min="0" value={form.vat} onChange={(e) => set({ vat: e.target.value })} /></Field>
          <Field label="Aufwand-/Gegenkonto" className="span-all">
            <select className="input" required value={form.expense_account_id} onChange={(e) => set({ expense_account_id: e.target.value })}>
              {expense.map((a) => <option key={a.id} value={a.id}>{a.number} {a.name}</option>)}
            </select>
          </Field>
          <Field label="Fällig am" hint="Leer = gemäss Zahlungsfrist"><input className="input" type="date" value={form.due_date} onChange={(e) => set({ due_date: e.target.value })} /></Field>
        </div>
        <p className="muted small">Die Rechnung wird als Kreditor verbucht und erscheint unter Finanzen → Kreditoren.</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
          <button className="btn primary">Erfassen &amp; verbuchen</button>
        </div>
      </form>
    </Modal>
  );
}

export default function DocumentEditor({ type }) {
  const meta = DOC[type];
  const purchase = type === 'purchase';
  const partnerKey = purchase ? 'supplier_id' : 'customer_id';
  const { id } = useParams();
  const isNew = id === 'neu';
  const navigate = useNavigate();
  const toast = useToast();
  const { can, settings } = useAuth();
  const defaultVat = settings?.company?.default_vat ?? 8.1;
  const rates = settings?.company?.vat_rates || [8.1, 2.6, 3.8, 0];
  const base = settings?.company?.currency || 'CHF';

  const [lookup, setLookup] = useState(null);
  const [doc, setDoc] = useState(null);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(null); // pay | mail | receive | bill

  useEffect(() => { api('/reports/lookup').then(setLookup).catch((e) => toast.error(e.message)); }, [toast]);
  useEffect(() => {
    if (isNew) {
      setDoc({ type, customer_id: '', supplier_id: '', date: today(), due_date: '', valid_until: '', reference: '', intro_text: '', footer_text: '',
        currency: base, exchange_rate: 1, cost_center_id: '', status: type === 'order' ? 'open' : 'draft',
        items: [emptyItem(defaultVat)], payments: [], derived: [], bills: [], editable: true });
    } else {
      setDoc(null);
      api(`/documents/${id}`).then((loaded) => {
        // Beleg gehört zu einem anderen Bereich (z.B. Offerte unter /rechnungen aufgerufen): dorthin umleiten
        if (loaded.type !== type) navigate(`/${DOC[loaded.type].path}/${id}`, { replace: true });
        else setDoc(loaded);
      }).catch((e) => { toast.error(e.message); navigate(`/${meta.path}`); });
    }
  }, [id, isNew, type]); // eslint-disable-line react-hooks/exhaustive-deps

  const writable = can(`${meta.perm}.write`);
  const editable = !!doc?.editable && writable;

  const totals = useMemo(() => {
    const byRate = new Map();
    let subtotal = 0;
    for (const it of doc?.items || []) {
      const lt = lineTotal(it);
      subtotal += lt;
      const rate = Number(it.vat_rate) || 0;
      byRate.set(rate, (byRate.get(rate) || 0) + lt);
    }
    const vatLines = [...byRate.entries()].filter(([r]) => r > 0).sort((a, b) => b[0] - a[0]).map(([rate, b]) => ({ rate, vat: round2(b * rate / 100) }));
    const vat = round2(vatLines.reduce((s, v) => s + v.vat, 0));
    return { subtotal: round2(subtotal), vatLines, total: round2(subtotal + vat) };
  }, [doc?.items]);

  const set = (patch) => setDoc((d) => ({ ...d, ...patch }));
  const setItem = (i, patch) => setDoc((d) => ({ ...d, items: d.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));
  const rateOf = (code) => (code === base ? 1 : lookup.currencies.find((c) => c.code === code)?.rate ?? 1);
  const productItem = (p) => ({ product_id: p.id, description: p.description ? `${p.name}\n${p.description}` : p.name, unit: p.unit,
    unit_price: purchase ? p.purchase_price : p.sale_price, vat_rate: p.vat_rate });
  const pickProduct = (i, productId) => {
    const p = lookup.products.find((x) => String(x.id) === String(productId));
    setItem(i, p ? productItem(p) : { product_id: '' });
  };
  const pickPartner = (value) => {
    const list = purchase ? lookup.suppliers : lookup.customers;
    const partner = list.find((x) => String(x.id) === String(value));
    const currency = partner?.currency || doc.currency;
    set({ [partnerKey]: value, currency, exchange_rate: rateOf(currency) });
  };
  const addLowStock = () => {
    const present = new Set(doc.items.map((it) => String(it.product_id)));
    const wanted = lookup.products.filter((p) => p.is_stock_item && p.stock_qty <= p.min_stock && !present.has(String(p.id))
      && (!p.supplier_id || String(p.supplier_id) === String(doc.supplier_id)));
    if (!wanted.length) return toast('Keine weiteren Artikel unter Mindestbestand für diesen Lieferanten.');
    const items = doc.items.filter((it) => it.product_id || String(it.description || '').trim());
    set({ items: [...items, ...wanted.map((p) => ({ ...emptyItem(defaultVat), ...productItem(p), qty: Math.max(1, round2(2 * p.min_stock - p.stock_qty)) }))] });
    return toast(`${wanted.length} Artikel hinzugefügt.`);
  };

  const run = useCallback(async (fn, message) => {
    setBusy(true);
    try {
      const result = await fn();
      if (message) toast(message);
      return result;
    } catch (err) {
      toast.error(err.message);
      return null;
    } finally { setBusy(false); }
  }, [toast]);

  const payload = () => ({
    type, [partnerKey]: doc[partnerKey], date: doc.date, due_date: doc.due_date || null, valid_until: doc.valid_until || null,
    reference: doc.reference, intro_text: doc.intro_text, footer_text: doc.footer_text,
    currency: doc.currency, exchange_rate: doc.exchange_rate, cost_center_id: doc.cost_center_id || null,
    items: doc.items.filter((it) => String(it.description || '').trim() || it.product_id),
  });

  const save = async () => {
    if (!doc[partnerKey]) return toast.error(purchase ? 'Bitte einen Lieferanten auswählen.' : 'Bitte einen Kunden auswählen.');
    const saved = await run(() => (isNew ? api('/documents', { method: 'POST', body: payload() }) : api(`/documents/${id}`, { method: 'PUT', body: payload() })), 'Gespeichert.');
    if (!saved) return null;
    if (isNew) navigate(`/${meta.path}/${saved.id}`, { replace: true });
    else setDoc(saved);
    return saved;
  };

  const action = async (path, body, message, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return null;
    const result = await run(() => api(`/documents/${id}/${path}`, { method: 'POST', body: body || {} }), message);
    if (result) setDoc(result);
    return result;
  };

  const convert = async (to) => {
    const result = await run(() => api(`/documents/${id}/convert`, { method: 'POST', body: { to } }), `${DOC[to].single} erstellt.`);
    if (result) navigate(`/${DOC[to].path}/${result.id}`);
  };

  const issue = async () => {
    if (!window.confirm('Rechnung definitiv buchen?\n\nDie Rechnungsnummer wird vergeben, der Betrag als Debitor verbucht und der Lagerbestand reduziert. Danach ist die Rechnung nicht mehr änderbar.')) return;
    if (editable && !(await save())) return;
    await action('issue', null, 'Rechnung gebucht.');
  };

  const placeOrder = async () => {
    if (!window.confirm('Bestellung auslösen? Danach kann sie nicht mehr geändert werden.')) return;
    if (editable && !(await save())) return;
    await action('status', { status: 'ordered' }, 'Bestellung ausgelöst.');
  };

  const remove = async () => {
    if (!window.confirm('Diesen Beleg wirklich löschen?')) return;
    const ok = await run(async () => { await api(`/documents/${id}`, { method: 'DELETE' }); return true; }, 'Beleg gelöscht.');
    if (ok) navigate(`/${meta.path}`);
  };

  const removePayment = async (p) => {
    if (!window.confirm(`Zahlung vom ${fmtDate(p.date)} über ${money(p.amount)} entfernen?`)) return;
    const result = await run(() => api(`/documents/payments/${p.id}`, { method: 'DELETE' }), 'Zahlung entfernt.');
    if (result) setDoc(result);
  };

  if (!doc || !lookup) return <div className="empty">Lädt…</div>;
  const partners = purchase ? lookup.suppliers : lookup.customers;
  const open = round2((doc.total || 0) - (doc.paid_amount || 0));
  const st = doc.status;
  const foreign = doc.currency !== base;
  const showReceived = purchase && !isNew && st !== 'draft';
  const currencyCodes = [...new Set([base, ...lookup.currencies.map((c) => c.code), doc.currency])];

  return (
    <div className="stack">
      <PageHead
        title={<span className="row"><Link to={`/${meta.path}`} className="icon-btn" title="Zurück"><Icon name="back" /></Link>
          {isNew ? `${meta.single} erfassen` : `${meta.single} ${doc.number || '(Entwurf)'}`}
          {!isNew && <StatusBadge status={st} overdue={type === 'invoice' && ['open', 'partial'].includes(st) && doc.due_date < today()} />}</span>}>
        {!isNew && <a className="btn" href={`/api/documents/${id}/pdf`} target="_blank" rel="noreferrer"><Icon name="pdf" /> PDF</a>}
        {!isNew && writable && !(type === 'invoice' && st === 'draft') && st !== 'cancelled' && <button className="btn" disabled={busy} onClick={() => setModal('mail')}><Icon name="mail" /> E-Mail</button>}
        {!isNew && writable && type === 'quote' && st === 'draft' && <button className="btn" disabled={busy} onClick={() => action('status', { status: 'sent' }, 'Als gesendet markiert.')}>Als gesendet markieren</button>}
        {!isNew && writable && type === 'quote' && st === 'sent' && <button className="btn danger" disabled={busy} onClick={() => action('status', { status: 'rejected' }, 'Offerte abgelehnt.')}>Abgelehnt</button>}
        {!isNew && type === 'quote' && st !== 'rejected' && can('orders.write') && <button className="btn" disabled={busy} onClick={() => convert('order')}><Icon name="cart" /> In Auftrag umwandeln</button>}
        {!isNew && type === 'quote' && st !== 'rejected' && can('invoices.write') && <button className="btn" disabled={busy} onClick={() => convert('invoice')}><Icon name="receipt" /> In Rechnung umwandeln</button>}
        {!isNew && writable && type === 'order' && st === 'open' && <button className="btn" disabled={busy} onClick={() => action('deliver', null, 'Auftrag ausgeliefert, Lager gebucht.', 'Auftrag ausliefern und Lagerabgang buchen?')}><Icon name="truck" /> Ausliefern</button>}
        {!isNew && type === 'order' && ['open', 'delivered'].includes(st) && can('invoices.write') && <button className="btn primary" disabled={busy} onClick={() => convert('invoice')}><Icon name="receipt" /> Rechnung erstellen</button>}
        {!isNew && writable && type === 'order' && st === 'open' && <button className="btn danger" disabled={busy} onClick={() => action('status', { status: 'cancelled' }, 'Auftrag storniert.', 'Auftrag wirklich stornieren?')}>Stornieren</button>}
        {!isNew && type === 'invoice' && ['open', 'partial'].includes(st) && can('receivables.write') && <button className="btn primary" disabled={busy} onClick={() => setModal('pay')}><Icon name="in" /> Zahlung erfassen</button>}
        {!isNew && writable && type === 'invoice' && st === 'open' && <button className="btn danger" disabled={busy} onClick={() => action('cancel', null, 'Rechnung storniert.', 'Rechnung stornieren? Es wird eine Gegenbuchung erstellt und der Lagerbestand zurückgebucht.')}>Stornieren</button>}
        {!isNew && writable && purchase && ['ordered', 'partly'].includes(st) && <button className="btn primary" disabled={busy} onClick={() => setModal('receive')}><Icon name="box" /> Wareneingang</button>}
        {!isNew && purchase && ['ordered', 'partly', 'received'].includes(st) && can('payables.write') && <button className="btn" disabled={busy} onClick={() => setModal('bill')}><Icon name="out" /> Lieferantenrechnung</button>}
        {!isNew && writable && purchase && st === 'partly' && <button className="btn" disabled={busy} onClick={() => action('status', { status: 'received' }, 'Bestellung abgeschlossen.', 'Bestellung abschliessen? Die Restmenge wird nicht mehr erwartet.')}>Abschliessen</button>}
        {!isNew && writable && purchase && st === 'ordered' && <button className="btn danger" disabled={busy} onClick={() => action('status', { status: 'cancelled' }, 'Bestellung storniert.', 'Bestellung wirklich stornieren?')}>Stornieren</button>}
        {!isNew && editable && <button className="btn danger" disabled={busy} onClick={remove}><Icon name="trash" /> Löschen</button>}
        {editable && <button className={`btn ${(type === 'invoice' || purchase) && !isNew ? '' : 'primary'}`} disabled={busy} onClick={save}><Icon name="check" /> Speichern</button>}
        {!isNew && writable && type === 'invoice' && st === 'draft' && <button className="btn primary" disabled={busy} onClick={issue}><Icon name="lock" /> Rechnung buchen</button>}
        {!isNew && writable && purchase && st === 'draft' && <button className="btn primary" disabled={busy} onClick={placeOrder}><Icon name="check" /> Bestellung auslösen</button>}
      </PageHead>

      {(doc.source || doc.derived?.length > 0 || doc.bills?.length > 0 || doc.sent_at) && (
        <div className="alert info">
          {doc.source && <>Erstellt aus <Link to={`/${DOC[doc.source.type].path}/${doc.source.id}`}>{DOC[doc.source.type].single} {doc.source.number}</Link>. </>}
          {doc.derived?.length > 0 && <>Folgebelege: {doc.derived.map((d, i) => (
            <span key={d.id}>{i > 0 && ', '}<Link to={`/${DOC[d.type].path}/${d.id}`}>{DOC[d.type].single} {d.number || '(Entwurf)'}</Link></span>
          ))}. </>}
          {doc.bills?.length > 0 && <>Lieferantenrechnungen: {doc.bills.map((b, i) => (
            <span key={b.id}>{i > 0 && ', '}<Link to="/kreditoren">{b.number}</Link> ({b.currency} {money(b.total)})</span>
          ))}. </>}
          {doc.sent_at && <>Per E-Mail gesendet am {fmtDateTime(doc.sent_at)}.</>}
        </div>
      )}

      <div className="card">
        <div className="card-body">
          <div className="form-grid cols-4">
            <Field label={purchase ? 'Lieferant *' : 'Kunde *'} className="span-2">
              <select className="input" value={doc[partnerKey] || ''} disabled={!editable} onChange={(e) => pickPartner(e.target.value)}>
                <option value="">Bitte wählen…</option>
                {!partners.some((c) => c.id === doc[partnerKey]) && doc[partnerKey] && <option value={doc[partnerKey]}>{doc.partner_name}</option>}
                {partners.map((c) => <option key={c.id} value={c.id}>{c.company} ({c.number})</option>)}
              </select>
            </Field>
            <Field label="Datum"><input className="input" type="date" value={doc.date || ''} disabled={!editable} onChange={(e) => set({ date: e.target.value })} /></Field>
            {type === 'invoice' && <Field label="Fällig am" hint={editable ? 'Leer = gemäss Zahlungsfrist' : null}><input className="input" type="date" value={doc.due_date || ''} disabled={!editable} onChange={(e) => set({ due_date: e.target.value })} /></Field>}
            {type === 'quote' && <Field label="Gültig bis" hint={editable ? 'Leer = Standardfrist' : null}><input className="input" type="date" value={doc.valid_until || ''} disabled={!editable} onChange={(e) => set({ valid_until: e.target.value })} /></Field>}
            {purchase && <Field label="Gewünschter Liefertermin"><input className="input" type="date" value={doc.due_date || ''} disabled={!editable} onChange={(e) => set({ due_date: e.target.value })} /></Field>}
            {type === 'order' && <div />}
            <Field label="Referenz / Betreff" className="span-2"><input className="input" value={doc.reference || ''} disabled={!editable} onChange={(e) => set({ reference: e.target.value })} /></Field>
            <Field label="Währung" hint={foreign ? `1 ${doc.currency} = ${doc.exchange_rate} ${base}` : null}>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <select className="input" value={doc.currency} disabled={!editable} onChange={(e) => set({ currency: e.target.value, exchange_rate: rateOf(e.target.value) })}>
                  {currencyCodes.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                {foreign && <input className="input num" title="Kurs" type="number" step="any" min="0.000001" value={doc.exchange_rate} disabled={!editable} onChange={(e) => set({ exchange_rate: e.target.value })} />}
              </div>
            </Field>
            <Field label="Kostenstelle">
              <select className="input" value={doc.cost_center_id || ''} disabled={!editable} onChange={(e) => set({ cost_center_id: e.target.value })}>
                <option value="">–</option>
                {doc.cost_center_id && !lookup.costCenters.some((c) => c.id === doc.cost_center_id) && <option value={doc.cost_center_id}>{doc.cost_center_code}</option>}
                {lookup.costCenters.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}
              </select>
            </Field>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Positionen</h2></div>
        <div className="table-wrap">
          <table className="table items-table">
            <thead>
              <tr>
                <th style={{ width: 200 }}>Artikel</th><th>Bezeichnung</th><th className="num" style={{ width: 84 }}>Menge</th>
                {showReceived && <th className="num" style={{ width: 84 }}>Erhalten</th>}
                <th style={{ width: 70 }}>Einh.</th>
                <th className="num" style={{ width: 110 }}>Preis</th><th className="num" style={{ width: 80 }}>Rabatt %</th><th style={{ width: 90 }}>MwSt</th>
                <th className="num" style={{ width: 110 }}>Betrag</th><th style={{ width: 36 }} />
              </tr>
            </thead>
            <tbody>
              {doc.items.map((it, i) => (
                <tr key={i}>
                  <td>
                    <select className="input" value={it.product_id || ''} disabled={!editable} onChange={(e) => pickProduct(i, e.target.value)}>
                      <option value="">Freie Position</option>
                      {lookup.products.map((p) => <option key={p.id} value={p.id}>{p.sku} – {p.name}</option>)}
                    </select>
                  </td>
                  <td><textarea className="input" rows={1} value={it.description || ''} disabled={!editable} onChange={(e) => setItem(i, { description: e.target.value })}
                    style={{ height: Math.max(34, 20 * String(it.description || '').split('\n').length + 14) }} /></td>
                  <td><input className="input num" type="number" step="any" value={it.qty} disabled={!editable} onChange={(e) => setItem(i, { qty: e.target.value })} /></td>
                  {showReceived && <td className="num" style={{ paddingTop: 13 }}><span className={it.qty_received + 0.0005 < it.qty ? 'neg' : 'pos'}>{fmtQty(it.qty_received)}</span></td>}
                  <td><input className="input" value={it.unit || ''} disabled={!editable} onChange={(e) => setItem(i, { unit: e.target.value })} /></td>
                  <td><input className="input num" type="number" step="0.01" value={it.unit_price} disabled={!editable} onChange={(e) => setItem(i, { unit_price: e.target.value })} /></td>
                  <td><input className="input num" type="number" step="any" min="0" max="100" value={it.discount_pct} disabled={!editable} onChange={(e) => setItem(i, { discount_pct: e.target.value })} /></td>
                  <td>
                    <select className="input" value={Number(it.vat_rate)} disabled={!editable} onChange={(e) => setItem(i, { vat_rate: e.target.value })}>
                      {[...new Set([...rates, Number(it.vat_rate)])].map((r) => <option key={r} value={r}>{r} %</option>)}
                    </select>
                  </td>
                  <td className="num" style={{ paddingTop: 13 }}>{money(lineTotal(it))}</td>
                  <td>{editable && <button className="icon-btn danger" title="Position entfernen" onClick={() => set({ items: doc.items.filter((_, j) => j !== i) })}><Icon name="x" /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {doc.items.length === 0 && <div className="empty">Noch keine Positionen.</div>}
        </div>
        <div className="card-body">
          <div className="row" style={{ alignItems: 'flex-start' }}>
            {editable && <button className="btn" onClick={() => set({ items: [...doc.items, emptyItem(defaultVat)] })}><Icon name="plus" /> Position hinzufügen</button>}
            {editable && purchase && <button className="btn" onClick={addLowStock}><Icon name="box" /> Artikel unter Mindestbestand</button>}
            <div className="totals">
              <div><span>Zwischensumme</span><span>{money(totals.subtotal)}</span></div>
              {totals.vatLines.map((v) => <div key={v.rate}><span>MwSt {v.rate} %</span><span>{money(v.vat)}</span></div>)}
              <div className="grand"><span>Total {doc.currency}</span><span>{money(totals.total)}</span></div>
              {foreign && <div className="muted"><span>entspricht {base}</span><span>{money(totals.total * (Number(doc.exchange_rate) || 0))}</span></div>}
              {type === 'invoice' && doc.paid_amount > 0 && <>
                <div><span>Bezahlt</span><span>− {money(doc.paid_amount)}</span></div>
                <div><b>Offen</b><b>{money(open)}</b></div>
              </>}
            </div>
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h2>Texte auf dem Beleg</h2></div>
          <div className="card-body stack">
            <Field label="Einleitungstext" hint="Leer = Standardtext aus dem Beleglayout">
              <textarea className="input" rows={3} value={doc.intro_text || ''} disabled={!editable} onChange={(e) => set({ intro_text: e.target.value })} />
            </Field>
            <Field label="Schlusstext" hint="Leer = Standardtext aus dem Beleglayout">
              <textarea className="input" rows={3} value={doc.footer_text || ''} disabled={!editable} onChange={(e) => set({ footer_text: e.target.value })} />
            </Field>
          </div>
        </div>
        {type === 'invoice' && !isNew && (
          <div className="card">
            <div className="card-head"><h2>Zahlungen</h2>{doc.payment_reference && <span className="muted small">Referenz {doc.payment_reference}</span>}</div>
            {doc.payments.length ? (
              <table className="table">
                <thead><tr><th>Datum</th><th>Konto</th><th>Bemerkung</th>{foreign && <th className="num">Kurs</th>}<th className="num">Betrag</th><th /></tr></thead>
                <tbody>
                  {doc.payments.map((p) => (
                    <tr key={p.id}>
                      <td>{fmtDate(p.date)}</td><td>{p.account_number} {p.account_name}</td><td>{p.note}</td>
                      {foreign && <td className="num">{p.exchange_rate}</td>}
                      <td className="num">{money(p.amount)}</td>
                      <td className="actions">{can('receivables.write') && <button className="icon-btn danger" title="Zahlung entfernen" onClick={() => removePayment(p)}><Icon name="trash" /></button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div className="empty">{st === 'draft' ? 'Zahlungen können nach dem Buchen der Rechnung erfasst werden.' : 'Noch keine Zahlungen erfasst.'}</div>}
          </div>
        )}
      </div>

      {modal === 'pay' && (
        <PaymentModal title={`Zahlungseingang zu ${doc.number}`} open={open} accounts={lookup.accounts} defaultAccount={settings?.accounting?.bank}
          currency={doc.currency} baseCurrency={base} rate={doc.exchange_rate} onClose={() => setModal(null)}
          onSubmit={async (form) => {
            const result = await run(() => api(`/documents/${id}/payments`, { method: 'POST', body: form }), 'Zahlung gebucht.');
            if (result) { setDoc(result); setModal(null); }
          }} />
      )}
      {modal === 'mail' && <MailModal doc={doc} onClose={() => setModal(null)} onSent={(result) => { setDoc(result); setModal(null); }} />}
      {modal === 'receive' && (
        <ReceiveModal doc={doc} onClose={() => setModal(null)}
          onSubmit={async (items) => { if (await action('receive', { items }, 'Wareneingang gebucht.')) setModal(null); }} />
      )}
      {modal === 'bill' && (
        <BillFromOrderModal doc={doc} accounts={lookup.accounts} onClose={() => setModal(null)}
          onSubmit={async (form) => { if (await action('bill', form, 'Lieferantenrechnung erfasst und verbucht.')) setModal(null); }} />
      )}
    </div>
  );
}
