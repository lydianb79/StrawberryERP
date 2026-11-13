import { q, one, tx } from '../db.js';
import { HttpError, today, isDate, needDate } from '../util.js';
import * as docs from './documents.js';

export const PERIODS = { monthly: 1, quarterly: 3, halfyearly: 6, yearly: 12 };

/** Nächster Termin; der Monatstag des Starts bleibt erhalten (31. → letzter Tag kürzerer Monate). */
export function advance(dateStr, period, anchorDay) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const day = anchorDay || d;
  const total = (m - 1) + (PERIODS[period] || 1);
  const ny = y + Math.floor(total / 12), nm = total % 12;
  const last = new Date(ny, nm + 1, 0).getDate();
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

export async function createFromInvoice(conn, invoiceId, data) {
  const inv = await docs.getDocument(conn, invoiceId);
  if (inv.type !== 'invoice') throw new HttpError(400, 'Abo-Rechnungen werden aus einer Rechnung erstellt.');
  if (!PERIODS[data.period]) throw new HttpError(400, 'Bitte einen Rhythmus wählen.');
  const next_date = needDate(data.next_date, 'Nächste Rechnung am');
  const template = {
    anchor_day: Number(next_date.slice(8, 10)), reference: inv.reference, intro_text: inv.intro_text, footer_text: inv.footer_text,
    currency: inv.currency, cost_center_id: inv.cost_center_id, language: inv.language,
    items: inv.items.map((i) => ({ product_id: i.product_id, description: i.description, qty: i.qty, unit: i.unit, unit_price: i.unit_price,
      discount_pct: i.discount_pct, vat_rate: i.vat_rate })),
  };
  const res = await q(
    'INSERT INTO recurring_invoices (name, customer_id, period, next_date, end_date, auto_issue, template) VALUES (?,?,?,?,?,?,?)',
    [String(data.name || '').trim().slice(0, 160) || `Abo ${inv.partner_name}`, inv.customer_id, data.period, next_date,
      isDate(data.end_date) ? data.end_date : null, data.auto_issue ? 1 : 0, JSON.stringify(template)], conn);
  return res.insertId;
}

export async function list(conn) {
  const rows = await q(
    `SELECT r.*, c.company AS customer_name, d.number AS last_number FROM recurring_invoices r
       JOIN customers c ON c.id = r.customer_id LEFT JOIN documents d ON d.id = r.last_document_id ORDER BY r.active DESC, r.next_date`, [], conn);
  for (const r of rows) {
    const t = JSON.parse(r.template);
    const items = (t.items || []).map((i) => ({ ...i, line_total: Math.round(i.qty * i.unit_price * (1 - (i.discount_pct || 0) / 100) * 100) / 100 }));
    Object.assign(r, { currency: t.currency, total: docs.computeTotals(items).total, positions: items.length });
    delete r.template;
  }
  return rows;
}

/**
 * Erzeugt alle fälligen Abo-Rechnungen (nächster Termin ≤ Stichtag). Jede Vorlage läuft in einer eigenen Transaktion,
 * damit ein Fehler bei einem Kunden die übrigen nicht blockiert.
 */
export async function runDue(user, { onlyId = null, date = today() } = {}) {
  const due = await q(
    `SELECT id FROM recurring_invoices WHERE active = 1 AND next_date <= ? AND (end_date IS NULL OR next_date <= end_date) ${onlyId ? 'AND id = ?' : ''} ORDER BY next_date`,
    onlyId ? [date, onlyId] : [date]);
  const created = [], errors = [];
  for (const { id } of due) {
    try {
      await tx(async (conn) => {
        const r = await one('SELECT * FROM recurring_invoices WHERE id = ? FOR UPDATE', [id], conn);
        if (!r.active || r.next_date > date) return;
        const t = JSON.parse(r.template);
        const docId = await docs.createDocument(conn, user, {
          type: 'invoice', customer_id: r.customer_id, date: r.next_date, reference: t.reference, intro_text: t.intro_text, footer_text: t.footer_text,
          currency: t.currency, cost_center_id: t.cost_center_id, language: t.language, items: t.items,
        });
        let number = null;
        if (r.auto_issue) number = await docs.issueInvoice(conn, user, docId);
        const next = advance(r.next_date, r.period, t.anchor_day);
        const finished = r.end_date && next > r.end_date;
        await q('UPDATE recurring_invoices SET next_date = ?, last_document_id = ?, last_run = ?, active = ? WHERE id = ?',
          [next, docId, date, finished ? 0 : 1, id], conn);
        created.push({ recurring_id: id, name: r.name, document_id: docId, number, date: r.next_date, issued: !!r.auto_issue });
      });
    } catch (err) {
      errors.push({ recurring_id: id, error: err.message });
    }
  }
  return { created, errors };
}
