import { q, one } from '../db.js';
import { HttpError, round2, today, addDays, needDate, isDate } from '../util.js';
import { getSettings } from './settings.js';
import { documentNumber } from './numbering.js';
import { postEntry, deleteEntriesByRef, accountIdByNumber } from './ledger.js';
import { moveDocumentStock, moveStock } from './stock.js';
import { resolveCurrency, toBase, fxLines } from './currency.js';
import { paymentReference } from './qrbill.js';

export const TYPES = {
  quote: { perm: 'quotes', label: 'Offerte', initial: 'draft', partner: 'customer' },
  order: { perm: 'orders', label: 'Auftragsbestätigung', initial: 'open', partner: 'customer' },
  invoice: { perm: 'invoices', label: 'Rechnung', initial: 'draft', partner: 'customer' },
  purchase: { perm: 'purchasing', label: 'Bestellung', initial: 'draft', partner: 'supplier' },
};

const EDITABLE = { quote: ['draft', 'sent'], order: ['open'], invoice: ['draft'], purchase: ['draft'] };
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
  const cur = await resolveCurrency(conn, data.currency ?? current?.currency, data.exchange_rate ?? current?.exchange_rate, partner.currency);
  let cost_center_id = data.cost_center_id === undefined ? current?.cost_center_id ?? null : data.cost_center_id || null;
  if (cost_center_id && !(await one('SELECT id FROM cost_centers WHERE id = ?', [cost_center_id], conn))) cost_center_id = null;
  return {
    date, due_date, valid_until, currency: cur.currency, exchange_rate: cur.exchange_rate, cost_center_id,
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
  const number = type === 'invoice' ? null : await documentNumber(conn, type, hdr.date);
  const res = await q(
    `INSERT INTO documents (type, number, customer_id, supplier_id, date, due_date, valid_until, status, reference, intro_text, footer_text,
                            currency, exchange_rate, cost_center_id, subtotal, vat_total, total, source_id, stock_booked, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [type, number, customer_id, supplier_id, hdr.date, hdr.due_date, hdr.valid_until, TYPES[type].initial, hdr.reference, hdr.intro_text,
      hdr.footer_text, hdr.currency, hdr.exchange_rate, hdr.cost_center_id, t.subtotal, t.vat_total, t.total,
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
            currency=?, exchange_rate=?, cost_center_id=?, subtotal=?, vat_total=?, total=? WHERE id=?`,
    [customer_id, supplier_id, hdr.date, hdr.due_date, hdr.valid_until, hdr.reference, hdr.intro_text, hdr.footer_text,
      hdr.currency, hdr.exchange_rate, hdr.cost_center_id, t.subtotal, t.vat_total, t.total, id], conn);
  await writeItems(conn, id, items);
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
  doc.payments = doc.type === 'invoice'
    ? await q(`SELECT p.*, a.number AS account_number, a.name AS account_name
                 FROM payments p JOIN accounts a ON a.id = p.account_id WHERE p.document_id = ? ORDER BY p.date, p.id`, [id], conn)
    : [];
  doc.source = doc.source_id ? await one('SELECT id, type, number FROM documents WHERE id = ?', [doc.source_id], conn) : null;
  doc.derived = await q('SELECT id, type, number, status FROM documents WHERE source_id = ? ORDER BY id', [id], conn);
  doc.bills = doc.type === 'purchase'
    ? await q('SELECT id, number, total, currency, status FROM supplier_invoices WHERE purchase_order_id = ? ORDER BY id', [id], conn)
    : [];
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
  } else if (doc.type === 'purchase') {
    const ok = (status === 'ordered' && doc.status === 'draft') || (status === 'cancelled' && ['draft', 'ordered'].includes(doc.status))
      || (status === 'received' && doc.status === 'partly'); // Restmenge wird nicht mehr geliefert
    if (!ok) throw new HttpError(400, 'Dieser Statuswechsel ist für die Bestellung nicht möglich.');
    if (status === 'ordered') {
      const count = await one('SELECT COUNT(*) AS n FROM document_items WHERE document_id = ?', [id], conn);
      if (!count.n) throw new HttpError(400, 'Die Bestellung enthält keine Positionen.');
    }
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
    type: to, customer_id: src.customer_id, date: today(), currency: src.currency, cost_center_id: src.cost_center_id,
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

/** Rechnung buchen: Nummer vergeben, Debitor/Erlös/MwSt buchen (in Basiswährung), Lagerabgang. */
export async function issueInvoice(conn, user, id) {
  const doc = await lockDocument(conn, id);
  if (doc.type !== 'invoice' || doc.status !== 'draft') throw new HttpError(400, 'Nur Rechnungsentwürfe können gebucht werden.');
  const items = await q(
    `SELECT i.line_total, p.revenue_account_id FROM document_items i LEFT JOIN products p ON p.id = i.product_id WHERE i.document_id = ?`, [id], conn);
  if (!items.length) throw new HttpError(400, 'Die Rechnung enthält keine Positionen.');
  if (doc.total <= 0) throw new HttpError(400, 'Der Rechnungsbetrag muss grösser als 0 sein.');
  const { accounting } = await getSettings(conn);
  const number = await documentNumber(conn, 'invoice', doc.date);
  const customer = await one('SELECT company, number FROM customers WHERE id = ?', [doc.customer_id], conn);

  // Erlöse nach Erlöskonto des Artikels gruppieren (ohne Zuordnung: Standard-Erlöskonto)
  const defaultRevenue = await accountIdByNumber(conn, accounting.revenue);
  const byAccount = new Map();
  for (const it of items) {
    const acc = it.revenue_account_id || defaultRevenue;
    byAccount.set(acc, (byAccount.get(acc) || 0) + it.line_total);
  }
  const rate = doc.exchange_rate;
  const receivable = toBase(doc.total, rate);
  const revenueLines = [...byAccount.entries()].map(([account_id, amount]) => ({ account_id, credit: toBase(amount, rate), cost_center_id: doc.cost_center_id }));
  const vat = toBase(doc.vat_total, rate);
  // Rundungsdifferenz aus der Umrechnung auf die erste Erlöszeile legen
  const diff = round2(receivable - vat - revenueLines.reduce((s, l) => s + l.credit, 0));
  if (diff) revenueLines[0].credit = round2(revenueLines[0].credit + diff);
  await postEntry(conn, {
    date: doc.date, text: `Rechnung ${number} – ${customer.company}`, ref_type: 'invoice', ref_id: id, user_id: user?.id,
    lines: [{ account: accounting.receivables, debit: receivable }, ...revenueLines, { account: accounting.vatPayable, credit: vat }],
  });
  let stock_booked = doc.stock_booked;
  if (!stock_booked) {
    await moveDocumentStock(conn, id, -1, number, user?.id);
    stock_booked = 1;
  }
  await q("UPDATE documents SET number = ?, status = 'open', stock_booked = ?, payment_reference = ? WHERE id = ?",
    [number, stock_booked, await paymentReference(conn, { id, number, customer_number: customer.number }), id], conn);
  return number;
}

/** Rechnung stornieren: ursprüngliche Buchung spiegeln, Lager zurückbuchen. */
export async function cancelInvoice(conn, user, id) {
  const doc = await lockDocument(conn, id);
  if (doc.type !== 'invoice' || !['open', 'partial'].includes(doc.status)) throw new HttpError(400, 'Nur gebuchte, nicht vollständig bezahlte Rechnungen können storniert werden.');
  if (doc.paid_amount > 0) throw new HttpError(400, 'Bitte zuerst die erfassten Zahlungen entfernen.');
  const original = await q(
    `SELECT l.account_id, l.debit, l.credit, l.cost_center_id FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
      WHERE e.ref_type = 'invoice' AND e.ref_id = ?`, [id], conn);
  if (original.length) {
    await postEntry(conn, {
      date: today(), text: `Storno Rechnung ${doc.number}`, ref_type: 'invoice_cancel', ref_id: id, user_id: user?.id,
      lines: original.map((l) => ({ account_id: l.account_id, debit: l.credit, credit: l.debit, cost_center_id: l.cost_center_id })),
    });
  }
  if (doc.stock_booked === 1) await moveDocumentStock(conn, id, 1, `Storno ${doc.number}`, user?.id);
  await q("UPDATE documents SET status = 'cancelled', stock_booked = 0 WHERE id = ?", [id], conn);
  return doc;
}

const payStatus = (total, paid) => (paid <= 0 ? 'open' : paid + 0.005 >= total ? 'paid' : 'partial');

/**
 * Betrag in Basiswährung, mit dem ein offener Posten bei dieser Zahlung ausgebucht wird (zum Belegkurs).
 * Die Schlusszahlung übernimmt den Rest, damit keine Rundungsrappen stehen bleiben.
 */
export function openItemBase(total, rate, previousPayments, amount) {
  const paidBefore = round2(previousPayments.reduce((s, p) => s + p.amount, 0));
  const clearedBefore = round2(previousPayments.reduce((s, p) => s + toBase(p.amount, rate), 0));
  return paidBefore + amount + 0.005 >= total ? round2(toBase(total, rate) - clearedBefore) : toBase(amount, rate);
}

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
  const payRate = doc.exchange_rate === 1 ? 1 : (Number(data.exchange_rate) > 0 ? Number(data.exchange_rate) : doc.exchange_rate);
  const previous = await q('SELECT amount FROM payments WHERE document_id = ?', [id], conn);
  const cleared = openItemBase(doc.total, doc.exchange_rate, previous, amount);
  const cash = toBase(amount, payRate);
  const res = await q(
    "INSERT INTO payments (kind, document_id, date, amount, exchange_rate, account_id, note, created_by) VALUES ('receivable',?,?,?,?,?,?,?)",
    [id, date, amount, payRate, account_id, data.note || null, user?.id ?? null], conn);
  await postEntry(conn, {
    date, text: `Zahlungseingang ${doc.number}`, ref_type: 'payment', ref_id: res.insertId, user_id: user?.id,
    lines: [{ account_id, debit: cash }, { account: accounting.receivables, credit: cleared }, ...fxLines('receivable', cleared, cash, accounting)],
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

// ---------- Bestellwesen ----------

/** Wareneingang zu einer Bestellung. received: [{ item_id, qty }] – ohne Angabe wird die gesamte Restmenge gebucht. */
export async function receivePurchase(conn, user, id, received) {
  const doc = await lockDocument(conn, id);
  if (doc.type !== 'purchase' || !['ordered', 'partly'].includes(doc.status)) throw new HttpError(400, 'Wareneingänge sind nur für bestellte Ware möglich.');
  const items = await q('SELECT * FROM document_items WHERE document_id = ? ORDER BY position', [id], conn);
  const wanted = Array.isArray(received) && received.length
    ? new Map(received.map((r) => [Number(r.item_id), Number(r.qty) || 0]))
    : new Map(items.map((it) => [it.id, Math.max(0, it.qty - it.qty_received)]));
  let booked = 0;
  for (const it of items) {
    const qty = Math.round((wanted.get(it.id) || 0) * 1000) / 1000;
    if (qty <= 0) continue;
    const rest = Math.round((it.qty - it.qty_received) * 1000) / 1000;
    if (qty > rest + 0.0005) throw new HttpError(400, `Position ${it.position}: Es sind nur noch ${rest} ${it.unit || ''} offen.`);
    await q('UPDATE document_items SET qty_received = qty_received + ? WHERE id = ?', [qty, it.id], conn);
    if (it.product_id) {
      await moveStock(conn, { product_id: it.product_id, delta: qty, type: 'in', reference: doc.number, note: 'Wareneingang Bestellung', user_id: user?.id });
      // Einstandspreis des Artikels auf den letzten Einkaufspreis (in Basiswährung) nachführen
      const net = round2(it.unit_price * (1 - it.discount_pct / 100) * doc.exchange_rate);
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
