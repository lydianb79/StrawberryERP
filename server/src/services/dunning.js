import { q, one } from '../db.js';
import { HttpError, round2, today, addDays } from '../util.js';
import { getSettings, getLogo } from './settings.js';
import { postEntry } from './ledger.js';
import { toBase } from './currency.js';
import { openAmount, getPartner } from './documents.js';
import { labelsFor } from './i18n.js';

const daysBetween = (from, to) => Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000);
const fmt = (d) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '');

function nextStep(doc, dunning, date) {
  const next = dunning.levels[doc.dunning_level];
  if (!next) return { next_level: null, eligible: false };
  const since = daysBetween(doc.dunning_date || doc.due_date, date);
  return { next_level: doc.dunning_level + 1, next_title: next.title, next_fee: Number(next.fee) || 0,
    eligible: since >= (Number(next.days) || 0), wait_days: Math.max(0, (Number(next.days) || 0) - since) };
}

/** Überfällige Rechnungen mit der nächsten fälligen Mahnstufe. */
export async function proposals(conn) {
  const { dunning } = await getSettings(conn);
  const t = today();
  const rows = await q(
    `SELECT d.id, d.number, d.date, d.due_date, d.total, d.paid_amount, d.dunning_fees, d.dunning_level, d.dunning_date, d.currency,
            c.company AS customer_name, c.email, DATEDIFF(CURDATE(), d.due_date) AS days_overdue
       FROM documents d JOIN customers c ON c.id = d.customer_id
      WHERE d.type = 'invoice' AND d.status IN ('open','partial') AND d.due_date < ? ORDER BY d.due_date`, [t], conn);
  return rows.map((r) => ({ ...r, open_amount: openAmount(r), ...nextStep(r, dunning, t) }));
}

/** Mahnlauf: erzeugt für die gewählten Rechnungen die nächste Mahnstufe und verbucht die Mahngebühr. */
export async function createNotices(conn, user, invoiceIds) {
  const { dunning, accounting } = await getSettings(conn);
  const t = today();
  const created = [];
  for (const id of [...new Set((invoiceIds || []).map(Number))]) {
    const doc = await one("SELECT * FROM documents WHERE id = ? AND type = 'invoice' FOR UPDATE", [id], conn);
    if (!doc || !['open', 'partial'].includes(doc.status) || !(doc.due_date < t)) throw new HttpError(400, `Rechnung ${doc?.number || id} ist nicht überfällig.`);
    const step = nextStep(doc, dunning, t);
    if (!step.next_level) throw new HttpError(400, `Rechnung ${doc.number} hat bereits die höchste Mahnstufe erreicht.`);
    if (!step.eligible) throw new HttpError(400, `Rechnung ${doc.number}: Die nächste Mahnstufe ist erst in ${step.wait_days} Tagen fällig.`);
    const fee = round2(step.next_fee);
    const fees = round2(doc.dunning_fees + fee);
    const res = await q('INSERT INTO dunning_notices (document_id, level, date, due_date, fee, open_amount, created_by) VALUES (?,?,?,?,?,?,?)',
      [id, step.next_level, t, addDays(t, Number(dunning.paymentDays) || 10), fee, round2(doc.total + fees - doc.paid_amount), user?.id ?? null], conn);
    if (fee > 0) {
      const base = toBase(fee, doc.exchange_rate);
      await postEntry(conn, { date: t, text: `Mahngebühr ${step.next_title} – Rechnung ${doc.number}`, ref_type: 'dunning', ref_id: id, user_id: user?.id,
        lines: [{ account: accounting.receivables, debit: base }, { account: accounting.dunningFees, credit: base }] });
    }
    await q('UPDATE documents SET dunning_level = ?, dunning_date = ?, dunning_fees = ? WHERE id = ?', [step.next_level, t, fees, id], conn);
    created.push({ id: res.insertId, document_id: id, number: doc.number, level: step.next_level, fee });
  }
  if (!created.length) throw new HttpError(400, 'Bitte mindestens eine Rechnung auswählen.');
  return created;
}

export async function listNotices(conn) {
  return q(
    `SELECT n.*, d.number, d.currency, d.status AS invoice_status, c.company AS customer_name, c.email
       FROM dunning_notices n JOIN documents d ON d.id = n.document_id JOIN customers c ON c.id = d.customer_id
      ORDER BY n.id DESC LIMIT 500`, [], conn);
}

/** Daten für das Mahnschreiben: wird wie ein Beleg gerendert (Rechnung, Zahlungen und Gebühren als Zeilen, QR-Zahlteil über den offenen Betrag). */
export async function noticeDocument(conn, noticeId) {
  const notice = await one('SELECT * FROM dunning_notices WHERE id = ?', [noticeId], conn);
  if (!notice) throw new HttpError(404, 'Mahnung nicht gefunden');
  const inv = await one('SELECT * FROM documents WHERE id = ?', [notice.document_id], conn);
  const partner = await getPartner(conn, inv);
  const settings = await getSettings(conn);
  const T = labelsFor(inv.language);
  const level = settings.dunning.levels[notice.level - 1] || { title: `${notice.level}. Mahnung`, text: '' };
  const title = inv.language !== 'de' && T.text ? (T.text.dunning[notice.level - 1] || T.text.dunning.at(-1)) : level.title;
  const line = (description, amount) => ({ description, qty: 1, unit: '', unit_price: amount, discount_pct: 0, vat_rate: 0, line_total: amount, sku: '' });
  const items = [line(T.dunningInvoice.replace('{nummer}', inv.number).replace('{datum}', fmt(inv.date)).replace('{faellig}', fmt(inv.due_date)), inv.total)];
  if (inv.paid_amount > 0) items.push(line(T.dunningPaid, -inv.paid_amount));
  if (inv.dunning_fees > 0) items.push(line(T.dunningFees, inv.dunning_fees));
  const doc = {
    ...inv, type: 'invoice', title, hideVat: true, date: notice.date, due_date: notice.due_date, reference: null,
    intro_text: inv.language !== 'de' && T.text ? T.text.dunningText : level.text, footer_text: ' ',
    total: openAmount(inv), status: 'open', partner_name: partner.company, partner_email: partner.email,
  };
  const filename = `${title}-${inv.number}.pdf`.replace(/[^\w.\-]/g, '_');
  return { notice, invoice: inv, doc, items, partner, settings, logo: await getLogo(conn), title, filename };
}
