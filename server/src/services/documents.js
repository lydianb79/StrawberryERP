import { q, one } from '../db.js';
import { HttpError, round2, today, addDays, needDate, isDate } from '../util.js';
import { getSettings } from './settings.js';
import { documentNumber } from './numbering.js';
import { postEntry, deleteEntriesByRef, accountIdByNumber } from './ledger.js';
import { moveDocumentStock } from './stock.js';

export const TYPES = {
  quote: { perm: 'quotes', label: 'Offerte', initial: 'draft' },
  order: { perm: 'orders', label: 'Auftragsbestätigung', initial: 'open' },
  invoice: { perm: 'invoices', label: 'Rechnung', initial: 'draft' },
};

const EDITABLE = { quote: ['draft', 'sent'], order: ['open'], invoice: ['draft'] };
export const isEditable = (doc) => EDITABLE[doc.type].includes(doc.status);

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
    `INSERT INTO document_items (document_id, position, product_id, sku, description, qty, unit, unit_price, discount_pct, vat_rate, line_total) VALUES ?`,
    [items.map((i) => [docId, i.position, i.product_id, i.sku, i.description, i.qty, i.unit, i.unit_price, i.discount_pct, i.vat_rate, i.line_total])],
    conn);
}

async function headerFields(conn, type, data, customer) {
  const settings = await getSettings(conn);
  const date = data.date ? needDate(data.date, 'Datum') : today();
  let due_date = null, valid_until = null;
  if (type === 'invoice') {
    due_date = isDate(data.due_date) ? data.due_date : addDays(date, customer.payment_terms_days ?? settings.company.default_payment_terms);
  }
  if (type === 'quote') {
    valid_until = isDate(data.valid_until) ? data.valid_until : addDays(date, settings.company.quote_validity_days);
  }
  return {
    date, due_date, valid_until,
    reference: data.reference ? String(data.reference).slice(0, 190) : null,
    intro_text: data.intro_text || null,
    footer_text: data.footer_text || null,
  };
}

export async function createDocument(conn, user, data, extra = {}) {
  const type = data.type;
  if (!TYPES[type]) throw new HttpError(400, 'Unbekannter Belegtyp');
  const customer = await one('SELECT * FROM customers WHERE id = ?', [data.customer_id], conn);
  if (!customer) throw new HttpError(400, 'Bitte einen Kunden auswählen.');
  const hdr = await headerFields(conn, type, data, customer);
  const items = await normalizeItems(conn, data.items);
  const t = computeTotals(items);
  const number = type === 'invoice' ? null : await documentNumber(conn, type, hdr.date);
  const res = await q(
    `INSERT INTO documents (type, number, customer_id, date, due_date, valid_until, status, reference, intro_text, footer_text,
                            subtotal, vat_total, total, source_id, stock_booked, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [type, number, customer.id, hdr.date, hdr.due_date, hdr.valid_until, TYPES[type].initial, hdr.reference, hdr.intro_text,
      hdr.footer_text, t.subtotal, t.vat_total, t.total, extra.source_id || null, extra.stock_booked || 0, user?.id ?? null],
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
  const customer = await one('SELECT * FROM customers WHERE id = ?', [data.customer_id ?? doc.customer_id], conn);
  if (!customer) throw new HttpError(400, 'Bitte einen Kunden auswählen.');
  const hdr = await headerFields(conn, doc.type, data, customer);
  const items = await normalizeItems(conn, data.items);
  const t = computeTotals(items);
  await q(
    `UPDATE documents SET customer_id=?, date=?, due_date=?, valid_until=?, reference=?, intro_text=?, footer_text=?,
            subtotal=?, vat_total=?, total=? WHERE id=?`,
    [customer.id, hdr.date, hdr.due_date, hdr.valid_until, hdr.reference, hdr.intro_text, hdr.footer_text,
      t.subtotal, t.vat_total, t.total, id], conn);
  await writeItems(conn, id, items);
  return doc;
}

export async function getDocument(conn, id) {
  const doc = await one(
    `SELECT d.*, c.company AS customer_name, c.number AS customer_number
       FROM documents d JOIN customers c ON c.id = d.customer_id WHERE d.id = ?`, [id], conn);
  if (!doc) throw new HttpError(404, 'Beleg nicht gefunden');
  doc.items = await q('SELECT * FROM document_items WHERE document_id = ? ORDER BY position', [id], conn);
  doc.vatLines = computeTotals(doc.items).vatLines;
  doc.payments = doc.type === 'invoice'
    ? await q(`SELECT p.*, a.number AS account_number, a.name AS account_name
                 FROM payments p JOIN accounts a ON a.id = p.account_id WHERE p.document_id = ? ORDER BY p.date, p.id`, [id], conn)
    : [];
  doc.source = doc.source_id ? await one('SELECT id, type, number FROM documents WHERE id = ?', [doc.source_id], conn) : null;
  doc.derived = await q('SELECT id, type, number, status FROM documents WHERE source_id = ? ORDER BY id', [id], conn);
  doc.editable = isEditable(doc);
  return doc;
}

export async function deleteDocument(conn, id) {
  const doc = await lockDocument(conn, id);
  if (!isEditable(doc)) throw new HttpError(400, 'Gebuchte oder abgeschlossene Belege können nicht gelöscht werden – bitte stornieren.');
  const child = await one('SELECT id FROM documents WHERE source_id = ? LIMIT 1', [id], conn);
  if (child) throw new HttpError(400, 'Aus diesem Beleg wurden bereits Folgebelege erstellt.');
  await q('DELETE FROM documents WHERE id = ?', [id], conn);
  // Ursprungsbeleg wieder freigeben
  if (doc.source_id) {
    const src = await one('SELECT * FROM documents WHERE id = ?', [doc.source_id], conn);
    if (src?.type === 'order' && src.status === 'invoiced') {
      await q('UPDATE documents SET status = ? WHERE id = ?', [src.stock_booked ? 'delivered' : 'open', src.id], conn);
    }
  }
  return doc;
}

const QUOTE_STATUS = ['draft', 'sent', 'accepted', 'rejected'];

export async function setStatus(conn, id, status) {
  const doc = await lockDocument(conn, id);
  if (doc.type === 'quote') {
    if (!QUOTE_STATUS.includes(status)) throw new HttpError(400, 'Ungültiger Status');
  } else if (doc.type === 'order') {
    if (status !== 'cancelled' || doc.status !== 'open') throw new HttpError(400, 'Nur offene, nicht ausgelieferte Aufträge können storniert werden.');
  } else {
    throw new HttpError(400, 'Der Status von Rechnungen wird über Buchen, Zahlung und Storno gesteuert.');
  }
  await q('UPDATE documents SET status = ? WHERE id = ?', [status, id], conn);
  return doc;
}

/** Offerte → Auftrag/Rechnung, Auftrag → Rechnung. */
export async function convertDocument(conn, user, id, to) {
  const src = await lockDocument(conn, id);
  const allowed = (src.type === 'quote' && (to === 'order' || to === 'invoice')) || (src.type === 'order' && to === 'invoice');
  if (!allowed) throw new HttpError(400, 'Diese Umwandlung ist nicht möglich.');
  if (src.type === 'quote' && src.status === 'rejected') throw new HttpError(400, 'Abgelehnte Offerten können nicht umgewandelt werden.');
  if (src.type === 'order' && !['open', 'delivered'].includes(src.status)) throw new HttpError(400, 'Der Auftrag wurde bereits verrechnet oder storniert.');
  const items = await q('SELECT * FROM document_items WHERE document_id = ? ORDER BY position', [id], conn);
  const newId = await createDocument(conn, user, {
    type: to, customer_id: src.customer_id, date: today(),
    reference: src.reference || `${TYPES[src.type].label} ${src.number}`,
    items,
  }, { source_id: src.id, stock_booked: src.type === 'order' && src.stock_booked ? 2 : 0 });
  await q('UPDATE documents SET status = ? WHERE id = ?', [src.type === 'quote' ? 'accepted' : 'invoiced', id], conn);
  return newId;
}

/** Auftrag ausliefern: Lagerabgang buchen. */
export async function deliverOrder(conn, user, id) {
  const doc = await lockDocument(conn, id);
  if (doc.type !== 'order' || doc.status !== 'open') throw new HttpError(400, 'Nur offene Aufträge können ausgeliefert werden.');
  await moveDocumentStock(conn, id, -1, doc.number, user?.id);
  await q("UPDATE documents SET status = 'delivered', stock_booked = 1 WHERE id = ?", [id], conn);
  return doc;
}

/** Rechnung buchen: Nummer vergeben, Debitor/Erlös/MwSt buchen, Lagerabgang. */
export async function issueInvoice(conn, user, id) {
  const doc = await lockDocument(conn, id);
  if (doc.type !== 'invoice' || doc.status !== 'draft') throw new HttpError(400, 'Nur Rechnungsentwürfe können gebucht werden.');
  const count = await one('SELECT COUNT(*) AS n FROM document_items WHERE document_id = ?', [id], conn);
  if (!count.n) throw new HttpError(400, 'Die Rechnung enthält keine Positionen.');
  if (doc.total <= 0) throw new HttpError(400, 'Der Rechnungsbetrag muss grösser als 0 sein.');
  const { accounting } = await getSettings(conn);
  const number = await documentNumber(conn, 'invoice', doc.date);
  const customer = await one('SELECT company FROM customers WHERE id = ?', [doc.customer_id], conn);
  await postEntry(conn, {
    date: doc.date, text: `Rechnung ${number} – ${customer.company}`, ref_type: 'invoice', ref_id: id, user_id: user?.id,
    lines: [
      { account: accounting.receivables, debit: doc.total },
      { account: accounting.revenue, credit: doc.subtotal },
      { account: accounting.vatPayable, credit: doc.vat_total },
    ],
  });
  let stock_booked = doc.stock_booked;
  if (!stock_booked) {
    await moveDocumentStock(conn, id, -1, number, user?.id);
    stock_booked = 1;
  }
  await q("UPDATE documents SET number = ?, status = 'open', stock_booked = ? WHERE id = ?", [number, stock_booked, id], conn);
  return number;
}

/** Rechnung stornieren: Gegenbuchung, Lager zurückbuchen. */
export async function cancelInvoice(conn, user, id) {
  const doc = await lockDocument(conn, id);
  if (doc.type !== 'invoice' || !['open', 'partial'].includes(doc.status)) throw new HttpError(400, 'Nur gebuchte, nicht vollständig bezahlte Rechnungen können storniert werden.');
  if (doc.paid_amount > 0) throw new HttpError(400, 'Bitte zuerst die erfassten Zahlungen entfernen.');
  const { accounting } = await getSettings(conn);
  await postEntry(conn, {
    date: today(), text: `Storno Rechnung ${doc.number}`, ref_type: 'invoice_cancel', ref_id: id, user_id: user?.id,
    lines: [
      { account: accounting.receivables, credit: doc.total },
      { account: accounting.revenue, debit: doc.subtotal },
      { account: accounting.vatPayable, debit: doc.vat_total },
    ],
  });
  if (doc.stock_booked === 1) await moveDocumentStock(conn, id, 1, `Storno ${doc.number}`, user?.id);
  await q("UPDATE documents SET status = 'cancelled', stock_booked = 0 WHERE id = ?", [id], conn);
  return doc;
}

const payStatus = (total, paid) => (paid <= 0 ? 'open' : paid + 0.005 >= total ? 'paid' : 'partial');

export async function addInvoicePayment(conn, user, id, data) {
  const doc = await lockDocument(conn, id);
  if (doc.type !== 'invoice' || !['open', 'partial'].includes(doc.status)) throw new HttpError(400, 'Auf diese Rechnung kann keine Zahlung erfasst werden.');
  const amount = round2(data.amount);
  const open = round2(doc.total - doc.paid_amount);
  if (amount <= 0) throw new HttpError(400, 'Der Betrag muss grösser als 0 sein.');
  if (amount > open + 0.005) throw new HttpError(400, `Der Betrag übersteigt den offenen Posten (${open.toFixed(2)}).`);
  const date = data.date ? needDate(data.date, 'Zahlungsdatum') : today();
  const { accounting } = await getSettings(conn);
  const account_id = data.account_id ? Number(data.account_id) : await accountIdByNumber(conn, accounting.bank);
  const res = await q(
    "INSERT INTO payments (kind, document_id, date, amount, account_id, note, created_by) VALUES ('receivable',?,?,?,?,?,?)",
    [id, date, amount, account_id, data.note || null, user?.id ?? null], conn);
  await postEntry(conn, {
    date, text: `Zahlungseingang ${doc.number}`, ref_type: 'payment', ref_id: res.insertId, user_id: user?.id,
    lines: [{ account_id, debit: amount }, { account: accounting.receivables, credit: amount }],
  });
  const paid = round2(doc.paid_amount + amount);
  await q('UPDATE documents SET paid_amount = ?, status = ? WHERE id = ?', [paid, payStatus(doc.total, paid), id], conn);
  return res.insertId;
}

export async function removeInvoicePayment(conn, paymentId) {
  const pay = await one("SELECT * FROM payments WHERE id = ? AND kind = 'receivable'", [paymentId], conn);
  if (!pay) throw new HttpError(404, 'Zahlung nicht gefunden');
  const doc = await lockDocument(conn, pay.document_id);
  await deleteEntriesByRef(conn, 'payment', pay.id);
  await q('DELETE FROM payments WHERE id = ?', [pay.id], conn);
  const paid = round2(doc.paid_amount - pay.amount);
  await q('UPDATE documents SET paid_amount = ?, status = ? WHERE id = ?', [paid, payStatus(doc.total, paid), doc.id], conn);
  return doc;
}
