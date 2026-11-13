import { q, one } from '../db.js';
import { HttpError, round2, today, addDays, needDate, isDate } from '../util.js';
import { getSettings } from './settings.js';
import { documentNumber } from './numbering.js';
import { postEntry, reverseEntriesByRef, accountIdByNumber } from './ledger.js';
import { moveDocumentStock, moveStock } from './stock.js';
import { resolveCurrency, toBase, fxLines } from './currency.js';
import { paymentReference } from './qrbill.js';

export const TYPES = {
  quote: { perm: 'quotes', label: 'Offerte', initial: 'draft', partner: 'customer' },
  order: { perm: 'orders', label: 'Auftragsbestätigung', initial: 'open', partner: 'customer' },
  invoice: { perm: 'invoices', label: 'Rechnung', initial: 'draft', partner: 'customer' },
  credit: { perm: 'invoices', label: 'Gutschrift', initial: 'draft', partner: 'customer' },
  purchase: { perm: 'purchasing', label: 'Bestellung', initial: 'draft', partner: 'supplier' },
};
export const LANGUAGES = ['de', 'fr', 'it', 'en'];

const EDITABLE = { quote: ['draft', 'sent'], order: ['open'], invoice: ['draft'], credit: ['draft'], purchase: ['draft'] };
export const isEditable = (doc) => EDITABLE[doc.type].includes(doc.status);
const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const EPS = 0.0005;

/** Offener Betrag einer Rechnung inkl. Mahngebühren (Belegwährung). */
export const dueTotal = (doc) => round2(doc.total + (doc.dunning_fees || 0));
export const openAmount = (doc) => round2(dueTotal(doc) - doc.paid_amount);

async function normalizeItems(conn, items) {
  const out = [];
  for (const [i, it] of (Array.isArray(items) ? items : []).entries()) {
    const description = String(it.description || '').trim();
    if (!description) throw new HttpError(400, `Position ${i + 1}: Bezeichnung fehlt.`);
    const qty = Number(it.qty) || 0;
    const unit_price = round2(it.unit_price);
    const discount_pct = Math.min(100, Math.max(0, Number(it.discount_pct) || 0));
    const vat_rate = Math.max(0, Number(it.vat_rate) || 0);
    const product_id = it.product_id ? Number(it.product_id) : null;
    let sku = null;
    if (product_id) {
      const p = await one('SELECT sku FROM products WHERE id = ?', [product_id], conn);
      if (!p) throw new HttpError(400, `Position ${i + 1}: Artikel existiert nicht.`);
      sku = p.sku;
    }
    out.push({
      position: i + 1, product_id, sku, description, qty, unit: String(it.unit || '').slice(0, 20),
      unit_price, discount_pct, vat_rate, line_total: round2(qty * unit_price * (1 - discount_pct / 100)),
      source_item_id: it.source_item_id ? Number(it.source_item_id) : null,
    });
  }
  return out;
}

export function computeTotals(items) {
  const byRate = new Map();
  let subtotal = 0;
  for (const it of items) {
    subtotal += it.line_total;
    byRate.set(Number(it.vat_rate), (byRate.get(Number(it.vat_rate)) || 0) + it.line_total);
  }
  const vatLines = [...byRate.entries()].filter(([rate]) => rate > 0).sort((a, b) => b[0] - a[0])
    .map(([rate, base]) => ({ rate, base: round2(base), vat: round2(base * rate / 100) }));
  const vat_total = round2(vatLines.reduce((s, v) => s + v.vat, 0));
  subtotal = round2(subtotal);
  return { subtotal, vat_total, total: round2(subtotal + vat_total), vatLines };
}

async function writeItems(conn, docId, items) {
  await q('DELETE FROM document_items WHERE document_id = ?', [docId], conn);
  if (!items.length) return;
  await q(
    `INSERT INTO document_items (document_id, position, product_id, sku, description, qty, unit, unit_price, discount_pct, vat_rate, line_total, source_item_id) VALUES ?`,
    [items.map((i) => [docId, i.position, i.product_id, i.sku, i.description, i.qty, i.unit, i.unit_price, i.discount_pct, i.vat_rate, i.line_total, i.source_item_id])],
    conn);
}

async function loadPartner(conn, type, data, current) {
  if (TYPES[type].partner === 'supplier') {
    const supplier = await one('SELECT * FROM suppliers WHERE id = ?', [data.supplier_id ?? current?.supplier_id], conn);
    if (!supplier) throw new HttpError(400, 'Bitte einen Lieferanten auswählen.');
    return { partner: supplier, customer_id: null, supplier_id: supplier.id };
  }
  const customer = await one('SELECT * FROM customers WHERE id = ?', [data.customer_id ?? current?.customer_id], conn);
  if (!customer) throw new HttpError(400, 'Bitte einen Kunden auswählen.');
  return { partner: customer, customer_id: customer.id, supplier_id: null };
}

async function headerFields(conn, type, data, partner, current) {
  const settings = await getSettings(conn);
  const date = data.date ? needDate(data.date, 'Datum') : today();
  let due_date = null, valid_until = null;
  if (type === 'invoice') {
    due_date = isDate(data.due_date) ? data.due_date : addDays(date, partner.payment_terms_days ?? settings.company.default_payment_terms);
  }
  if (type === 'quote') {
    valid_until = isDate(data.valid_until) ? data.valid_until : addDays(date, settings.company.quote_validity_days);
  }
  if (type === 'purchase') due_date = isDate(data.due_date) ? data.due_date : null; // gewünschter Liefertermin
  const cur = await resolveCurrency(conn, data.currency ?? current?.currency, data.exchange_rate ?? current?.exchange_rate, partner.currency, date);
  let cost_center_id = data.cost_center_id === undefined ? current?.cost_center_id ?? null : data.cost_center_id || null;
  if (cost_center_id && !(await one('SELECT id FROM cost_centers WHERE id = ?', [cost_center_id], conn))) cost_center_id = null;
  const language = [data.language, current?.language, partner.language].find((l) => LANGUAGES.includes(l)) || 'de';
  return {
    date, due_date, valid_until, currency: cur.currency, exchange_rate: cur.exchange_rate, cost_center_id, language,
    reference: data.reference ? String(data.reference).slice(0, 190) : null,
    intro_text: data.intro_text || null,
    footer_text: data.footer_text || null,
  };
}

export async function createDocument(conn, user, data, extra = {}) {
  const type = data.type;
  if (!TYPES[type]) throw new HttpError(400, 'Unbekannter Belegtyp');
  const { partner, customer_id, supplier_id } = await loadPartner(conn, type, data);
  const hdr = await headerFields(conn, type, data, partner);
  const items = await normalizeItems(conn, data.items);
  const t = computeTotals(items);
  // Rechnungen und Gutschriften erhalten ihre Nummer erst beim Buchen (lückenlose Nummernkreise)
  const number = type === 'invoice' || type === 'credit' ? null : await documentNumber(conn, type, hdr.date);
  const res = await q(
    `INSERT INTO documents (type, number, customer_id, supplier_id, date, due_date, valid_until, status, reference, intro_text, footer_text,
                            currency, exchange_rate, cost_center_id, language, subtotal, vat_total, total, source_id, stock_booked, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [type, number, customer_id, supplier_id, hdr.date, hdr.due_date, hdr.valid_until, TYPES[type].initial, hdr.reference, hdr.intro_text,
      hdr.footer_text, hdr.currency, hdr.exchange_rate, hdr.cost_center_id, hdr.language, t.subtotal, t.vat_total, t.total,
      extra.source_id || null, extra.stock_booked || 0, user?.id ?? null],
    conn);
  await writeItems(conn, res.insertId, items);
  return res.insertId;
}

export async function lockDocument(conn, id) {
  const doc = await one('SELECT * FROM documents WHERE id = ? FOR UPDATE', [id], conn);
  if (!doc) throw new HttpError(404, 'Beleg nicht gefunden');
  return doc;
}

export async function updateDocument(conn, id, data) {
  const doc = await lockDocument(conn, id);
  if (!isEditable(doc)) throw new HttpError(400, 'Dieser Beleg kann in seinem aktuellen Status nicht mehr bearbeitet werden.');
  const { partner, customer_id, supplier_id } = await loadPartner(conn, doc.type, data, doc);
  const hdr = await headerFields(conn, doc.type, data, partner, doc);
  const items = await normalizeItems(conn, data.items);
  const t = computeTotals(items);
  await q(
    `UPDATE documents SET customer_id=?, supplier_id=?, date=?, due_date=?, valid_until=?, reference=?, intro_text=?, footer_text=?,
            currency=?, exchange_rate=?, cost_center_id=?, language=?, subtotal=?, vat_total=?, total=? WHERE id=?`,
    [customer_id, supplier_id, hdr.date, hdr.due_date, hdr.valid_until, hdr.reference, hdr.intro_text, hdr.footer_text,
      hdr.currency, hdr.exchange_rate, hdr.cost_center_id, hdr.language, t.subtotal, t.vat_total, t.total, id], conn);
  await writeItems(conn, id, items);
  if (doc.type === 'invoice' && doc.source_id) await syncOrderProgress(conn, doc.source_id);
  return doc;
}

/** Adresse des Belegpartners (Kunde oder Lieferant) in einheitlicher Form. */
export async function getPartner(conn, doc) {
  return doc.supplier_id
    ? one('SELECT * FROM suppliers WHERE id = ?', [doc.supplier_id], conn)
    : one('SELECT * FROM customers WHERE id = ?', [doc.customer_id], conn);
}

export async function getDocument(conn, id) {
  const doc = await one(
    `SELECT d.*, COALESCE(c.company, s.company) AS partner_name, COALESCE(c.number, s.number) AS partner_number,
            COALESCE(c.email, s.email) AS partner_email, cc.code AS cost_center_code
       FROM documents d LEFT JOIN customers c ON c.id = d.customer_id LEFT JOIN suppliers s ON s.id = d.supplier_id
       LEFT JOIN cost_centers cc ON cc.id = d.cost_center_id WHERE d.id = ?`, [id], conn);
  if (!doc) throw new HttpError(404, 'Beleg nicht gefunden');
  doc.items = await q('SELECT * FROM document_items WHERE document_id = ? ORDER BY position', [id], conn);
  doc.vatLines = computeTotals(doc.items).vatLines;
  doc.payments = ['invoice', 'credit'].includes(doc.type)
    ? await q(`SELECT p.*, a.number AS account_number, a.name AS account_name, cn.number AS credit_note_number
                 FROM payments p LEFT JOIN accounts a ON a.id = p.account_id LEFT JOIN documents cn ON cn.id = p.credit_note_id
                WHERE p.document_id = ? ORDER BY p.date, p.id`, [id], conn)
    : [];
  doc.source = doc.source_id ? await one('SELECT id, type, number FROM documents WHERE id = ?', [doc.source_id], conn) : null;
  doc.derived = await q('SELECT id, type, number, status FROM documents WHERE source_id = ? ORDER BY id', [id], conn);
  doc.bills = doc.type === 'purchase'
    ? await q('SELECT id, number, total, currency, status FROM supplier_invoices WHERE purchase_order_id = ? ORDER BY id', [id], conn)
    : [];
  doc.dunning = doc.type === 'invoice' ? await q('SELECT * FROM dunning_notices WHERE document_id = ? ORDER BY id', [id], conn) : [];
  doc.open_amount = ['invoice', 'credit'].includes(doc.type) ? openAmount(doc) : null;
  doc.editable = isEditable(doc);
  return doc;
}

export async function deleteDocument(conn, id) {
  const doc = await lockDocument(conn, id);
  if (!isEditable(doc)) throw new HttpError(400, 'Gebuchte oder abgeschlossene Belege können nicht gelöscht werden – bitte stornieren.');
  const child = await one('SELECT id FROM documents WHERE source_id = ? LIMIT 1', [id], conn);
  if (child) throw new HttpError(400, 'Aus diesem Beleg wurden bereits Folgebelege erstellt.');
  await q('DELETE FROM documents WHERE id = ?', [id], conn);
  if (doc.type === 'invoice' && doc.source_id) await syncOrderProgress(conn, doc.source_id);
  return doc;
}

const QUOTE_STATUS = ['draft', 'sent', 'accepted', 'rejected'];

export async function setStatus(conn, id, status) {
  const doc = await lockDocument(conn, id);
  if (doc.type === 'quote') {
    if (!QUOTE_STATUS.includes(status)) throw new HttpError(400, 'Ungültiger Status');
  } else if (doc.type === 'order') {
    if (status !== 'cancelled' || doc.status !== 'open') throw new HttpError(400, 'Nur offene, nicht ausgelieferte Aufträge können storniert werden.');
  } else if (doc.type === 'purchase') {
    const ok = (status === 'ordered' && doc.status === 'draft') || (status === 'cancelled' && ['draft', 'ordered'].includes(doc.status))
      || (status === 'received' && doc.status === 'partly'); // Restmenge wird nicht mehr geliefert
    if (!ok) throw new HttpError(400, 'Dieser Statuswechsel ist für die Bestellung nicht möglich.');
    if (status === 'ordered') {
      const count = await one('SELECT COUNT(*) AS n FROM document_items WHERE document_id = ?', [id], conn);
      if (!count.n) throw new HttpError(400, 'Die Bestellung enthält keine Positionen.');
    }
  } else {
    throw new HttpError(400, 'Der Status von Rechnungen und Gutschriften wird über Buchen, Zahlung und Storno gesteuert.');
  }
  await q('UPDATE documents SET status = ? WHERE id = ?', [status, id], conn);
  return doc;
}

// ---------- Auftrag: Teillieferung und Teilrechnung ----------

/** Führt verrechnete Mengen und Status eines Auftrags aus seinen (nicht stornierten) Rechnungen nach. */
export async function syncOrderProgress(conn, orderId) {
  const order = await one("SELECT * FROM documents WHERE id = ? AND type = 'order' FOR UPDATE", [orderId], conn);
  if (!order || order.status === 'cancelled') return;
  const invoiced = await q(
    `SELECT i.source_item_id AS id, SUM(i.qty) AS qty FROM document_items i JOIN documents d ON d.id = i.document_id
      WHERE d.source_id = ? AND d.type = 'invoice' AND d.status <> 'cancelled' AND i.source_item_id IS NOT NULL GROUP BY i.source_item_id`, [orderId], conn);
  const byItem = new Map(invoiced.map((r) => [r.id, r.qty]));
  const items = await q('SELECT * FROM document_items WHERE document_id = ?', [orderId], conn);
  for (const it of items) {
    it.qty_invoiced = r3(byItem.get(it.id) || 0);
    await q('UPDATE document_items SET qty_invoiced = ? WHERE id = ?', [it.qty_invoiced, it.id], conn);
  }
  const allInvoiced = items.length > 0 && items.every((it) => it.qty_invoiced + EPS >= it.qty);
  const allDelivered = items.length > 0 && items.every((it) => it.qty_delivered + EPS >= it.qty);
  const any = items.some((it) => it.qty_delivered > EPS || it.qty_invoiced > EPS);
  const status = allInvoiced ? 'invoiced' : allDelivered ? 'delivered' : any ? 'partly' : 'open';
  await q('UPDATE documents SET status = ?, stock_booked = ? WHERE id = ?', [status, any ? 1 : 0, orderId], conn);
}

async function deliverItem(conn, user, order, it, qty) {
  await q('UPDATE document_items SET qty_delivered = qty_delivered + ? WHERE id = ?', [qty, it.id], conn);
  if (it.product_id) {
    await moveStock(conn, { product_id: it.product_id, delta: -qty, type: 'out', reference: order.number, note: 'Warenausgang', user_id: user?.id });
  }
}

/** Auftrag (teilweise) ausliefern. deliveries: [{ item_id, qty }] – ohne Angabe wird die gesamte Restmenge geliefert. */
export async function deliverOrder(conn, user, id, deliveries) {
  const doc = await lockDocument(conn, id);
  if (doc.type !== 'order' || !['open', 'partly'].includes(doc.status)) throw new HttpError(400, 'Dieser Auftrag hat keine offenen Liefermengen.');
  const items = await q('SELECT * FROM document_items WHERE document_id = ? ORDER BY position', [id], conn);
  const wanted = Array.isArray(deliveries) && deliveries.length
    ? new Map(deliveries.map((d) => [Number(d.item_id), Number(d.qty) || 0]))
    : new Map(items.map((it) => [it.id, Math.max(0, it.qty - it.qty_delivered)]));
  let n = 0;
  for (const it of items) {
    const qty = r3(wanted.get(it.id));
    if (qty <= 0) continue;
    const rest = r3(it.qty - it.qty_delivered);
    if (qty > rest + EPS) throw new HttpError(400, `Position ${it.position}: Es sind nur noch ${rest} ${it.unit || ''} zu liefern.`);
    await deliverItem(conn, user, doc, it, qty);
    n += 1;
  }
  if (!n) throw new HttpError(400, 'Es gibt keine offenen Liefermengen.');
  await syncOrderProgress(conn, id);
  return doc;
}

/**
 * Offerte → Auftrag/Rechnung, Auftrag → Rechnung, Rechnung → Gutschrift.
 * Auftrag → Rechnung: quantities [{ item_id, qty }] für eine Teilrechnung; ohne Angabe alles noch nicht Verrechnete.
 * Noch nicht gelieferte, aber verrechnete Mengen werden dabei ausgeliefert (Lagerabgang).
 */
export async function convertDocument(conn, user, id, to, quantities) {
  const src = await lockDocument(conn, id);
  const allowed = (src.type === 'quote' && (to === 'order' || to === 'invoice')) || (src.type === 'order' && to === 'invoice')
    || (src.type === 'invoice' && to === 'credit');
  if (!allowed) throw new HttpError(400, 'Diese Umwandlung ist nicht möglich.');
  if (src.type === 'quote' && src.status === 'rejected') throw new HttpError(400, 'Abgelehnte Offerten können nicht umgewandelt werden.');
  if (src.type === 'order' && !['open', 'partly', 'delivered'].includes(src.status)) throw new HttpError(400, 'Der Auftrag wurde bereits vollständig verrechnet oder storniert.');
  if (src.type === 'invoice' && !['open', 'partial', 'paid'].includes(src.status)) throw new HttpError(400, 'Gutschriften sind nur zu gebuchten Rechnungen möglich.');
  let items = await q('SELECT * FROM document_items WHERE document_id = ? ORDER BY position', [id], conn);
  const base = {
    type: to, customer_id: src.customer_id, date: today(), currency: src.currency, cost_center_id: src.cost_center_id, language: src.language,
    reference: src.reference || `${TYPES[src.type].label} ${src.number}`,
  };

  if (src.type === 'order') {
    const wanted = Array.isArray(quantities) && quantities.length
      ? new Map(quantities.map((x) => [Number(x.item_id), Number(x.qty) || 0]))
      : new Map(items.map((it) => [it.id, Math.max(0, it.qty - it.qty_invoiced)]));
    const lines = [];
    for (const it of items) {
      const qty = r3(wanted.get(it.id));
      if (qty <= 0) continue;
      const rest = r3(it.qty - it.qty_invoiced);
      if (qty > rest + EPS) throw new HttpError(400, `Position ${it.position}: Es sind nur noch ${rest} ${it.unit || ''} zu verrechnen.`);
      const missing = r3(it.qty_invoiced + qty - it.qty_delivered);
      if (missing > EPS) await deliverItem(conn, user, src, it, missing);
      lines.push({ ...it, qty, source_item_id: it.id });
    }
    if (!lines.length) throw new HttpError(400, 'Es gibt keine offenen Mengen zu verrechnen.');
    const newId = await createDocument(conn, user, { ...base, items: lines }, { source_id: src.id, stock_booked: 2 });
    await syncOrderProgress(conn, src.id);
    return newId;
  }

  items = items.map((it) => ({ ...it, source_item_id: null }));
  if (src.type === 'invoice') {
    return createDocument(conn, user, { ...base, exchange_rate: src.exchange_rate, reference: `Rechnung ${src.number}`, items }, { source_id: src.id });
  }
  const newId = await createDocument(conn, user, { ...base, items }, { source_id: src.id });
  await q("UPDATE documents SET status = 'accepted' WHERE id = ?", [id], conn);
  return newId;
}

// ---------- Rechnung ----------

async function revenueLines(conn, doc, accounting, side) {
  const items = await q(
    'SELECT i.line_total, p.revenue_account_id FROM document_items i LEFT JOIN products p ON p.id = i.product_id WHERE i.document_id = ?', [doc.id], conn);
  if (!items.length) throw new HttpError(400, 'Der Beleg enthält keine Positionen.');
  const defaultRevenue = await accountIdByNumber(conn, accounting.revenue);
  const byAccount = new Map();
  for (const it of items) {
    const acc = it.revenue_account_id || defaultRevenue;
    byAccount.set(acc, (byAccount.get(acc) || 0) + it.line_total);
  }
  const rate = doc.exchange_rate;
  const total = toBase(doc.total, rate), vat = toBase(doc.vat_total, rate);
  const lines = [...byAccount.entries()].map(([account_id, amount]) => ({ account_id, amount: toBase(amount, rate) }));
  // Rundungsdifferenz aus der Umrechnung auf die erste Erlöszeile legen
  const diff = round2(total - vat - lines.reduce((s, l) => s + l.amount, 0));
  if (diff) lines[0].amount = round2(lines[0].amount + diff);
  const other = side === 'credit' ? 'debit' : 'credit';
  return [
    { account: accounting.receivables, [side]: total },
    ...lines.map((l) => ({ account_id: l.account_id, [other]: l.amount, cost_center_id: doc.cost_center_id })),
    { account: accounting.vatPayable, [other]: vat },
  ];
}

/** Rechnung buchen: Nummer vergeben, Debitor/Erlös/MwSt buchen (in Basiswährung), Lagerabgang. */
export async function issueInvoice(conn, user, id) {
  const doc = await lockDocument(conn, id);
  if (doc.type !== 'invoice' || doc.status !== 'draft') throw new HttpError(400, 'Nur Rechnungsentwürfe können gebucht werden.');
  if (doc.total <= 0) throw new HttpError(400, 'Der Rechnungsbetrag muss grösser als 0 sein.');
  const { accounting } = await getSettings(conn);
  const lines = await revenueLines(conn, doc, accounting, 'debit');
  const number = await documentNumber(conn, 'invoice', doc.date);
  const customer = await one('SELECT company, number FROM customers WHERE id = ?', [doc.customer_id], conn);
  await postEntry(conn, { date: doc.date, text: `Rechnung ${number} – ${customer.company}`, ref_type: 'invoice', ref_id: id, user_id: user?.id, lines });
  let stock_booked = doc.stock_booked;
  if (!stock_booked) {
    await moveDocumentStock(conn, id, -1, number, user?.id);
    stock_booked = 1;
  }
  await q("UPDATE documents SET number = ?, status = 'open', stock_booked = ?, payment_reference = ? WHERE id = ?",
    [number, stock_booked, await paymentReference(conn, { id, number, customer_number: customer.number }), id], conn);
  return number;
}

/** Rechnung stornieren: Buchungen (inkl. Mahngebühren) durch Gegenbuchungen aufheben, Lager zurückbuchen. */
export async function cancelInvoice(conn, user, id) {
  const doc = await lockDocument(conn, id);
  if (doc.type !== 'invoice' || !['open', 'partial'].includes(doc.status)) throw new HttpError(400, 'Nur gebuchte, nicht vollständig bezahlte Rechnungen können storniert werden.');
  if (doc.paid_amount > 0) throw new HttpError(400, 'Bitte zuerst die erfassten Zahlungen stornieren – oder eine Gutschrift erstellen.');
  await reverseEntriesByRef(conn, 'invoice', id, { user_id: user?.id, text: `Storno Rechnung ${doc.number}` });
  await reverseEntriesByRef(conn, 'dunning', id, { user_id: user?.id, text: `Storno Mahngebühr ${doc.number}` });
  if (doc.stock_booked === 1) await moveDocumentStock(conn, id, 1, `Storno ${doc.number}`, user?.id);
  await q("UPDATE documents SET status = 'cancelled', stock_booked = 0, dunning_fees = 0 WHERE id = ?", [id], conn);
  if (doc.source_id) await syncOrderProgress(conn, doc.source_id);
  return doc;
}

const payStatus = (total, paid) => (paid <= 0.005 ? 'open' : paid + 0.005 >= total ? 'paid' : 'partial');

/**
 * Betrag in Basiswährung, mit dem ein offener Posten bei dieser Zahlung ausgebucht wird (zum Belegkurs).
 * Die Schlusszahlung übernimmt den Rest, damit keine Rundungsrappen stehen bleiben.
 * baseDue: gebuchter Gesamtbetrag in Basiswährung, falls er nicht einfach total × Kurs ist (z.B. mit Mahngebühren).
 */
export function openItemBase(total, rate, previousPayments, amount, baseDue) {
  const paidBefore = round2(previousPayments.reduce((s, p) => s + p.amount, 0));
  const clearedBefore = round2(previousPayments.reduce((s, p) => s + toBase(p.amount, rate), 0));
  return paidBefore + amount + 0.005 >= total ? round2((baseDue ?? toBase(total, rate)) - clearedBefore) : toBase(amount, rate);
}

async function invoiceBaseDue(conn, doc) {
  const fees = await q('SELECT fee + interest AS fee FROM dunning_notices WHERE document_id = ?', [doc.id], conn);
  return doc.dunning_fees > 0
    ? round2(toBase(doc.total, doc.exchange_rate) + fees.reduce((s, f) => s + toBase(f.fee, doc.exchange_rate), 0))
    : toBase(doc.total, doc.exchange_rate);
}

/**
 * Zahlung erfassen. Rechnung: Zahlungseingang. Gutschrift: Auszahlung des Guthabens an den Kunden.
 * data.bank_ref: Referenz der Bank (camt) – verhindert doppeltes Verbuchen.
 */
export async function addPayment(conn, user, id, data) {
  const doc = await lockDocument(conn, id);
  if (!['invoice', 'credit'].includes(doc.type) || !['open', 'partial'].includes(doc.status)) throw new HttpError(400, 'Auf diesen Beleg kann keine Zahlung erfasst werden.');
  const amount = round2(data.amount);
  const due = doc.type === 'invoice' ? dueTotal(doc) : doc.total;
  const open = round2(due - doc.paid_amount);
  if (amount <= 0) throw new HttpError(400, 'Der Betrag muss grösser als 0 sein.');
  if (amount > open + 0.005) throw new HttpError(400, `Der Betrag übersteigt den offenen Posten (${open.toFixed(2)}).`);
  const date = data.date ? needDate(data.date, 'Zahlungsdatum') : today();
  const bank_ref = data.bank_ref ? String(data.bank_ref).slice(0, 80) : null;
  if (bank_ref && await one('SELECT id FROM payments WHERE bank_ref = ? AND reversed_at IS NULL', [bank_ref], conn)) {
    throw new HttpError(409, 'Diese Bankbuchung wurde bereits verbucht.');
  }
  const { accounting } = await getSettings(conn);
  const account_id = data.account_id ? Number(data.account_id) : await accountIdByNumber(conn, accounting.bank);
  const payRate = doc.exchange_rate === 1 ? 1 : (Number(data.exchange_rate) > 0 ? Number(data.exchange_rate) : doc.exchange_rate);
  const previous = await q('SELECT amount FROM payments WHERE document_id = ? AND reversed_at IS NULL AND credit_note_id IS NULL', [id], conn);
  const applied = await q('SELECT amount FROM payments WHERE document_id = ? AND reversed_at IS NULL AND credit_note_id IS NOT NULL', [id], conn);
  const baseDue = doc.type === 'invoice' ? await invoiceBaseDue(conn, doc) : undefined;
  const cleared = openItemBase(due, doc.exchange_rate, [...previous, ...applied], amount, baseDue);
  const cash = toBase(amount, payRate);
  const res = await q(
    "INSERT INTO payments (kind, document_id, date, amount, exchange_rate, account_id, note, bank_ref, created_by) VALUES ('receivable',?,?,?,?,?,?,?,?)",
    [id, date, amount, payRate, account_id, data.note || null, bank_ref, user?.id ?? null], conn);
  const invoice = doc.type === 'invoice';
  await postEntry(conn, {
    date, text: invoice ? `Zahlungseingang ${doc.number}` : `Auszahlung Gutschrift ${doc.number}`, ref_type: 'payment', ref_id: res.insertId, user_id: user?.id,
    lines: invoice
      ? [{ account_id, debit: cash }, { account: accounting.receivables, credit: cleared }, ...fxLines('receivable', cleared, cash, accounting)]
      : [{ account: accounting.receivables, debit: cleared }, { account_id, credit: cash }, ...fxLines('payable', cleared, cash, accounting)],
  });
  const paid = round2(doc.paid_amount + amount);
  await q('UPDATE documents SET paid_amount = ?, status = ? WHERE id = ?', [paid, payStatus(due, paid), id], conn);
  return res.insertId;
}
export const addInvoicePayment = addPayment;

/** Zahlung stornieren: Gegenbuchung statt Löschen; die Zahlung bleibt als storniert sichtbar. */
export async function reversePayment(conn, user, paymentId) {
  const pay = await one("SELECT * FROM payments WHERE id = ? AND kind = 'receivable'", [paymentId], conn);
  if (!pay) throw new HttpError(404, 'Zahlung nicht gefunden');
  if (pay.reversed_at) throw new HttpError(400, 'Diese Zahlung ist bereits storniert.');
  if (pay.credit_note_id) throw new HttpError(400, 'Verrechnungen mit Gutschriften können nicht storniert werden.');
  const doc = await lockDocument(conn, pay.document_id);
  await reverseEntriesByRef(conn, 'payment', pay.id, { user_id: user?.id, text: `Storno Zahlung ${doc.number}` });
  await q('UPDATE payments SET reversed_at = NOW() WHERE id = ?', [pay.id], conn);
  const paid = round2(doc.paid_amount - pay.amount);
  const due = doc.type === 'invoice' ? dueTotal(doc) : doc.total;
  await q('UPDATE documents SET paid_amount = ?, status = ? WHERE id = ?', [paid, payStatus(due, paid), doc.id], conn);
  return doc;
}
export const removeInvoicePayment = (conn, paymentId, user) => reversePayment(conn, user, paymentId);

// ---------- Gutschrift ----------

/**
 * Gutschrift buchen: Erlös und MwSt zurückbuchen, Ware optional wieder einlagern
 * und das Guthaben mit der zugehörigen Rechnung verrechnen, soweit diese noch offen ist.
 */
export async function issueCredit(conn, user, id, { restock = true } = {}) {
  const doc = await lockDocument(conn, id);
  if (doc.type !== 'credit' || doc.status !== 'draft') throw new HttpError(400, 'Nur Gutschrift-Entwürfe können gebucht werden.');
  if (doc.total <= 0) throw new HttpError(400, 'Der Gutschriftsbetrag muss grösser als 0 sein.');
  const { accounting } = await getSettings(conn);
  const lines = await revenueLines(conn, doc, accounting, 'credit');
  const number = await documentNumber(conn, 'credit', doc.date);
  const customer = await one('SELECT company FROM customers WHERE id = ?', [doc.customer_id], conn);
  await postEntry(conn, { date: doc.date, text: `Gutschrift ${number} – ${customer.company}`, ref_type: 'credit', ref_id: id, user_id: user?.id, lines });
  if (restock) await moveDocumentStock(conn, id, 1, number, user?.id);

  let applied = 0;
  if (doc.source_id) {
    const inv = await one("SELECT * FROM documents WHERE id = ? AND type = 'invoice' FOR UPDATE", [doc.source_id], conn);
    if (inv && ['open', 'partial'].includes(inv.status) && inv.currency === doc.currency) {
      applied = Math.min(doc.total, openAmount(inv));
      if (applied > 0) {
        await q(
          "INSERT INTO payments (kind, document_id, date, amount, exchange_rate, account_id, note, credit_note_id, created_by) VALUES ('receivable',?,?,?,?,NULL,?,?,?)",
          [inv.id, doc.date, applied, inv.exchange_rate, `Verrechnung Gutschrift ${number}`, id, user?.id ?? null], conn);
        const paid = round2(inv.paid_amount + applied);
        await q('UPDATE documents SET paid_amount = ?, status = ? WHERE id = ?', [paid, payStatus(dueTotal(inv), paid), inv.id], conn);
      }
    }
  }
  await q('UPDATE documents SET number = ?, status = ?, paid_amount = ?, stock_booked = ? WHERE id = ?',
    [number, applied + 0.005 >= doc.total ? 'paid' : 'open', round2(applied), restock ? 1 : 0, id], conn);
  return number;
}

/** Gutschrift stornieren: Buchung und Lagerzugang aufheben, Verrechnung mit der Rechnung zurücknehmen. */
export async function cancelCredit(conn, user, id) {
  const doc = await lockDocument(conn, id);
  if (doc.type !== 'credit' || !['open', 'paid'].includes(doc.status)) throw new HttpError(400, 'Nur gebuchte Gutschriften können storniert werden.');
  const refunds = await one('SELECT COUNT(*) AS n FROM payments WHERE document_id = ? AND reversed_at IS NULL', [id], conn);
  if (refunds.n) throw new HttpError(400, 'Bitte zuerst die Auszahlungen dieser Gutschrift stornieren.');
  await reverseEntriesByRef(conn, 'credit', id, { user_id: user?.id, text: `Storno Gutschrift ${doc.number}` });
  if (doc.stock_booked === 1) await moveDocumentStock(conn, id, -1, `Storno ${doc.number}`, user?.id);
  // Verrechnung mit der Rechnung zurücknehmen: der Eintrag bleibt als storniert sichtbar
  const applied = await q('SELECT * FROM payments WHERE credit_note_id = ? AND reversed_at IS NULL', [id], conn);
  for (const a of applied) {
    const inv = await lockDocument(conn, a.document_id);
    const paid = round2(inv.paid_amount - a.amount);
    await q('UPDATE payments SET reversed_at = NOW() WHERE id = ?', [a.id], conn);
    await q('UPDATE documents SET paid_amount = ?, status = ? WHERE id = ?', [paid, payStatus(dueTotal(inv), paid), inv.id], conn);
  }
  await q("UPDATE documents SET status = 'cancelled', paid_amount = 0, stock_booked = 0 WHERE id = ?", [id], conn);
  return doc;
}

// ---------- Bestellwesen ----------

/** Wareneingang zu einer Bestellung. received: [{ item_id, qty }] – ohne Angabe wird die gesamte Restmenge gebucht. */
export async function receivePurchase(conn, user, id, received) {
  const doc = await lockDocument(conn, id);
  if (doc.type !== 'purchase' || !['ordered', 'partly'].includes(doc.status)) throw new HttpError(400, 'Wareneingänge sind nur für bestellte Ware möglich.');
  const items = await q('SELECT * FROM document_items WHERE document_id = ? ORDER BY position', [id], conn);
  const wanted = Array.isArray(received) && received.length
    ? new Map(received.map((r) => [Number(r.item_id), Number(r.qty) || 0]))
    : new Map(items.map((it) => [it.id, Math.max(0, it.qty - it.qty_received)]));
  const batches = new Map((Array.isArray(received) ? received : []).map((r) => [Number(r.item_id), r]));
  let booked = 0;
  for (const it of items) {
    const qty = r3(wanted.get(it.id));
    if (qty <= 0) continue;
    const rest = r3(it.qty - it.qty_received);
    if (qty > rest + EPS) throw new HttpError(400, `Position ${it.position}: Es sind nur noch ${rest} ${it.unit || ''} offen.`);
    await q('UPDATE document_items SET qty_received = qty_received + ? WHERE id = ?', [qty, it.id], conn);
    if (it.product_id) {
      // Einstandspreis in Basiswährung: führt den letzten Einkaufspreis und den gleitenden Durchschnittspreis nach
      const net = round2(it.unit_price * (1 - it.discount_pct / 100) * doc.exchange_rate);
      const extra = batches.get(it.id) || {};
      await moveStock(conn, { product_id: it.product_id, delta: qty, type: 'in', reference: doc.number, note: 'Wareneingang Bestellung', user_id: user?.id,
        unit_cost: net, batch: extra.batch, expiry: extra.expiry, warehouse_id: extra.warehouse_id });
      if (net > 0) await q('UPDATE products SET purchase_price = ? WHERE id = ?', [net, it.product_id], conn);
    }
    booked += 1;
  }
  if (!booked) throw new HttpError(400, 'Bitte mindestens eine Menge grösser als 0 angeben.');
  const rest = await one('SELECT COUNT(*) AS n FROM document_items WHERE document_id = ? AND qty_received + 0.0005 < qty', [id], conn);
  await q('UPDATE documents SET status = ? WHERE id = ?', [rest.n ? 'partly' : 'received', id], conn);
  return doc;
}

export async function markSent(conn, id) {
  const doc = await lockDocument(conn, id);
  await q('UPDATE documents SET sent_at = NOW(), status = ? WHERE id = ?', [doc.type === 'quote' && doc.status === 'draft' ? 'sent' : doc.status, id], conn);
}
