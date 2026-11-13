import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, DOC, fmtDate, money, round2, today } from '../lib.js';
import { useAuth } from '../auth.js';
import { Field, Icon, Modal, PageHead, StatusBadge, useToast } from '../components/ui.jsx';

const emptyItem = (vat) => ({ product_id: '', description: '', qty: 1, unit: 'Stk', unit_price: 0, discount_pct: 0, vat_rate: vat });
const lineTotal = (it) => round2((Number(it.qty) || 0) * (Number(it.unit_price) || 0) * (1 - (Number(it.discount_pct) || 0) / 100));

export function PaymentModal({ title, open, accounts, defaultAccount, onClose, onSubmit }) {
  const banks = accounts.filter((a) => a.type === 'asset' && a.number < '1100');
  const [form, setForm] = useState({ date: today(), amount: open, account_id: banks.find((a) => a.number === defaultAccount)?.id || banks[0]?.id || '', note: '' });
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(form); }}>
        <div className="form-grid">
          <Field label="Zahlungsdatum"><input className="input" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          <Field label="Betrag" hint={`Offen: ${money(open)}`}>
            <input className="input num" type="number" step="0.01" min="0.01" required autoFocus value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </Field>
          <Field label="Zahlungskonto">
            <select className="input" required value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })}>
              {banks.map((a) => <option key={a.id} value={a.id}>{a.number} {a.name}</option>)}
            </select>
          </Field>
          <Field label="Bemerkung"><input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
        </div>
        <div className="row" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
          <button className="btn primary">Zahlung buchen</button>
        </div>
      </form>
    </Modal>
  );
}

export default function DocumentEditor({ type }) {
  const meta = DOC[type];
  const { id } = useParams();
  const isNew = id === 'neu';
  const navigate = useNavigate();
  const toast = useToast();
  const { can, settings } = useAuth();
  const defaultVat = settings?.company?.default_vat ?? 8.1;
  const rates = settings?.company?.vat_rates || [8.1, 2.6, 3.8, 0];

  const [lookup, setLookup] = useState(null);
  const [doc, setDoc] = useState(null);
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState(false);

  useEffect(() => { api('/reports/lookup').then(setLookup).catch((e) => toast.error(e.message)); }, [toast]);
  useEffect(() => {
    if (isNew) {
      setDoc({ type, customer_id: '', date: today(), due_date: '', valid_until: '', reference: '', intro_text: '', footer_text: '',
        status: type === 'order' ? 'open' : 'draft', items: [emptyItem(defaultVat)], payments: [], derived: [], editable: true });
    } else {
      setDoc(null);
      api(`/documents/${id}`).then(setDoc).catch((e) => { toast.error(e.message); navigate(`/${meta.path}`); });
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
    const vatLines = [...byRate.entries()].filter(([r]) => r > 0).sort((a, b) => b[0] - a[0]).map(([rate, base]) => ({ rate, vat: round2(base * rate / 100) }));
    const vat = round2(vatLines.reduce((s, v) => s + v.vat, 0));
    return { subtotal: round2(subtotal), vatLines, total: round2(subtotal + vat) };
  }, [doc?.items]);

  const set = (patch) => setDoc((d) => ({ ...d, ...patch }));
  const setItem = (i, patch) => setDoc((d) => ({ ...d, items: d.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));
  const pickProduct = (i, productId) => {
    const p = lookup.products.find((x) => String(x.id) === String(productId));
    if (!p) return setItem(i, { product_id: '' });
    setItem(i, { product_id: p.id, description: p.description ? `${p.name}\n${p.description}` : p.name, unit: p.unit, unit_price: p.sale_price, vat_rate: p.vat_rate });
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
    type, customer_id: doc.customer_id, date: doc.date, due_date: doc.due_date || null, valid_until: doc.valid_until || null,
    reference: doc.reference, intro_text: doc.intro_text, footer_text: doc.footer_text,
    items: doc.items.filter((it) => String(it.description || '').trim() || it.product_id),
  });

  const save = async () => {
    if (!doc.customer_id) return toast.error('Bitte einen Kunden auswählen.');
    const saved = await run(() => (isNew ? api('/documents', { method: 'POST', body: payload() }) : api(`/documents/${id}`, { method: 'PUT', body: payload() })), 'Gespeichert.');
    if (!saved) return null;
    if (isNew) navigate(`/${meta.path}/${saved.id}`, { replace: true });
    else setDoc(saved);
    return saved;
  };

  const action = async (path, body, message, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    const result = await run(() => api(`/documents/${id}/${path}`, { method: 'POST', body: body || {} }), message);
    if (result) setDoc(result);
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
  const customers = lookup.customers;
  const open = round2((doc.total || 0) - (doc.paid_amount || 0));
  const st = doc.status;

  return (
    <div className="stack">
      <PageHead
        title={<span className="row"><Link to={`/${meta.path}`} className="icon-btn" title="Zurück"><Icon name="back" /></Link>
          {isNew ? `${meta.single} erfassen` : `${meta.single} ${doc.number || '(Entwurf)'}`}
          {!isNew && <StatusBadge status={st} overdue={type === 'invoice' && ['open', 'partial'].includes(st) && doc.due_date < today()} />}</span>}>
        {!isNew && <a className="btn" href={`/api/documents/${id}/pdf`} target="_blank" rel="noreferrer"><Icon name="pdf" /> PDF</a>}
        {!isNew && writable && type === 'quote' && st === 'draft' && <button className="btn" disabled={busy} onClick={() => action('status', { status: 'sent' }, 'Als gesendet markiert.')}>Als gesendet markieren</button>}
        {!isNew && writable && type === 'quote' && st === 'sent' && <button className="btn danger" disabled={busy} onClick={() => action('status', { status: 'rejected' }, 'Offerte abgelehnt.')}>Abgelehnt</button>}
        {!isNew && type === 'quote' && st !== 'rejected' && can('orders.write') && <button className="btn" disabled={busy} onClick={() => convert('order')}><Icon name="cart" /> In Auftrag umwandeln</button>}
        {!isNew && type === 'quote' && st !== 'rejected' && can('invoices.write') && <button className="btn" disabled={busy} onClick={() => convert('invoice')}><Icon name="receipt" /> In Rechnung umwandeln</button>}
        {!isNew && writable && type === 'order' && st === 'open' && <button className="btn" disabled={busy} onClick={() => action('deliver', null, 'Auftrag ausgeliefert, Lager gebucht.', 'Auftrag ausliefern und Lagerabgang buchen?')}><Icon name="truck" /> Ausliefern</button>}
        {!isNew && type === 'order' && ['open', 'delivered'].includes(st) && can('invoices.write') && <button className="btn primary" disabled={busy} onClick={() => convert('invoice')}><Icon name="receipt" /> Rechnung erstellen</button>}
        {!isNew && writable && type === 'order' && st === 'open' && <button className="btn danger" disabled={busy} onClick={() => action('status', { status: 'cancelled' }, 'Auftrag storniert.', 'Auftrag wirklich stornieren?')}>Stornieren</button>}
        {!isNew && type === 'invoice' && ['open', 'partial'].includes(st) && can('receivables.write') && <button className="btn primary" disabled={busy} onClick={() => setPaying(true)}><Icon name="in" /> Zahlung erfassen</button>}
        {!isNew && writable && type === 'invoice' && st === 'open' && <button className="btn danger" disabled={busy} onClick={() => action('cancel', null, 'Rechnung storniert.', 'Rechnung stornieren? Es wird eine Gegenbuchung erstellt und der Lagerbestand zurückgebucht.')}>Stornieren</button>}
        {!isNew && editable && <button className="btn danger" disabled={busy} onClick={remove}><Icon name="trash" /> Löschen</button>}
        {editable && <button className={`btn ${type === 'invoice' && !isNew ? '' : 'primary'}`} disabled={busy} onClick={save}><Icon name="check" /> Speichern</button>}
        {!isNew && writable && type === 'invoice' && st === 'draft' && <button className="btn primary" disabled={busy} onClick={issue}><Icon name="lock" /> Rechnung buchen</button>}
      </PageHead>

      {(doc.source || doc.derived?.length > 0) && (
        <div className="alert info">
          {doc.source && <>Erstellt aus <Link to={`/${DOC[doc.source.type].path}/${doc.source.id}`}>{DOC[doc.source.type].single} {doc.source.number}</Link>. </>}
          {doc.derived?.length > 0 && <>Folgebelege: {doc.derived.map((d, i) => (
            <span key={d.id}>{i > 0 && ', '}<Link to={`/${DOC[d.type].path}/${d.id}`}>{DOC[d.type].single} {d.number || '(Entwurf)'}</Link></span>
          ))}</>}
        </div>
      )}

      <div className="card">
        <div className="card-body">
          <div className="form-grid cols-4">
            <Field label="Kunde *" className="span-2">
              <select className="input" value={doc.customer_id} disabled={!editable} onChange={(e) => set({ customer_id: e.target.value })}>
                <option value="">Bitte wählen…</option>
                {!customers.some((c) => c.id === doc.customer_id) && doc.customer_id && <option value={doc.customer_id}>{doc.customer_name}</option>}
                {customers.map((c) => <option key={c.id} value={c.id}>{c.company} ({c.number})</option>)}
              </select>
            </Field>
            <Field label="Datum"><input className="input" type="date" value={doc.date || ''} disabled={!editable} onChange={(e) => set({ date: e.target.value })} /></Field>
            {type === 'invoice' && <Field label="Fällig am" hint={editable ? 'Leer = gemäss Zahlungsfrist' : null}><input className="input" type="date" value={doc.due_date || ''} disabled={!editable} onChange={(e) => set({ due_date: e.target.value })} /></Field>}
            {type === 'quote' && <Field label="Gültig bis" hint={editable ? 'Leer = Standardfrist' : null}><input className="input" type="date" value={doc.valid_until || ''} disabled={!editable} onChange={(e) => set({ valid_until: e.target.value })} /></Field>}
            {type === 'order' && <div />}
            <Field label="Referenz / Betreff" className="span-all"><input className="input" value={doc.reference || ''} disabled={!editable} onChange={(e) => set({ reference: e.target.value })} /></Field>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Positionen</h2></div>
        <div className="table-wrap">
          <table className="table items-table">
            <thead>
              <tr>
                <th style={{ width: 200 }}>Artikel</th><th>Bezeichnung</th><th className="num" style={{ width: 84 }}>Menge</th><th style={{ width: 70 }}>Einh.</th>
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
            <div className="totals">
              <div><span>Zwischensumme</span><span>{money(totals.subtotal)}</span></div>
              {totals.vatLines.map((v) => <div key={v.rate}><span>MwSt {v.rate} %</span><span>{money(v.vat)}</span></div>)}
              <div className="grand"><span>Total {settings?.company?.currency || 'CHF'}</span><span>{money(totals.total)}</span></div>
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
            <div className="card-head"><h2>Zahlungen</h2></div>
            {doc.payments.length ? (
              <table className="table">
                <thead><tr><th>Datum</th><th>Konto</th><th>Bemerkung</th><th className="num">Betrag</th><th /></tr></thead>
                <tbody>
                  {doc.payments.map((p) => (
                    <tr key={p.id}>
                      <td>{fmtDate(p.date)}</td><td>{p.account_number} {p.account_name}</td><td>{p.note}</td><td className="num">{money(p.amount)}</td>
                      <td className="actions">{can('receivables.write') && <button className="icon-btn danger" title="Zahlung entfernen" onClick={() => removePayment(p)}><Icon name="trash" /></button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div className="empty">{st === 'draft' ? 'Zahlungen können nach dem Buchen der Rechnung erfasst werden.' : 'Noch keine Zahlungen erfasst.'}</div>}
          </div>
        )}
      </div>

      {paying && (
        <PaymentModal title={`Zahlungseingang zu ${doc.number}`} open={open} accounts={lookup.accounts} defaultAccount={settings?.accounting?.bank}
          onClose={() => setPaying(false)}
          onSubmit={async (form) => {
            const result = await run(() => api(`/documents/${id}/payments`, { method: 'POST', body: form }), 'Zahlung gebucht.');
            if (result) { setDoc(result); setPaying(false); }
          }} />
      )}
    </div>
  );
}
