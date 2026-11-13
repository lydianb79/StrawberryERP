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
  const rate = Number(dunning.interestRate) || 0;
  // Verzugszins seit der letzten Mahnung bzw. seit Fälligkeit, auf dem offenen Rechnungsbetrag ohne Gebühren
  const principal = Math.max(0, round2(doc.total - doc.paid_amount));
  const next_interest = next.interest && rate > 0 ? round2(principal * rate / 100 * Math.max(0, since) / 365) : 0;
  return { next_level: doc.dunning_level + 1, next_title: next.title, next_fee: Number(next.fee) || 0, next_interest,
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
    const fee = round2(step.next_fee), interest = round2(step.next_interest);
    const fees = round2(doc.dunning_fees + fee + interest);
    const res = await q('INSERT INTO dunning_notices (document_id, level, date, due_date, fee, interest, open_amount, created_by) VALUES (?,?,?,?,?,?,?,?)',
      [id, step.next_level, t, addDays(t, Number(dunning.paymentDays) || 10), fee, interest, round2(doc.total + fees - doc.paid_amount), user?.id ?? null], conn);
    if (fee > 0) {
      const base = toBase(fee, doc.exchange_rate);
      await postEntry(conn, { date: t, text: `Mahngebühr ${step.next_title} – Rechnung ${doc.number}`, ref_type: 'dunning', ref_id: id, user_id: user?.id,
        lines: [{ account: accounting.receivables, debit: base }, { account: accounting.dunningFees, credit: base }] });
    }
    if (interest > 0) {
      const base = toBase(interest, doc.exchange_rate);
      await postEntry(conn, { date: t, text: `Verzugszins ${step.next_title} – Rechnung ${doc.number}`, ref_type: 'dunning', ref_id: id, user_id: user?.id,
        lines: [{ account: accounting.receivables, debit: base }, { account: accounting.dunningInterest, credit: base }] });
    }
    await q('UPDATE documents SET dunning_level = ?, dunning_date = ?, dunning_fees = ? WHERE id = ?', [step.next_level, t, fees, id], conn);
    created.push({ id: res.insertId, document_id: id, number: doc.number, level: step.next_level, fee, interest });
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
  const sums = await one('SELECT COALESCE(SUM(fee), 0) AS fee, COALESCE(SUM(interest), 0) AS interest FROM dunning_notices WHERE document_id = ?', [inv.id], conn);
  if (sums.fee > 0) items.push(line(T.dunningFees, sums.fee));
  if (sums.interest > 0) items.push(line(T.dunningInterest, sums.interest));
  const doc = {
    ...inv, type: 'invoice', title, hideVat: true, date: notice.date, due_date: notice.due_date, reference: null,
    intro_text: inv.language !== 'de' && T.text ? T.text.dunningText : level.text, footer_text: ' ',
    total: openAmount(inv), status: 'open', partner_name: partner.company, partner_email: partner.email,
  };
  const filename = `${title}-${inv.number}.pdf`.replace(/[^\w.\-]/g, '_');
  return { notice, invoice: inv, doc, items, partner, settings, logo: await getLogo(conn), title, filename };
}

/** Kunden mit überfälligen Rechnungen – Grundlage für Sammelmahnungen. */
export async function collectiveCandidates(conn) {
  return q(
    `SELECT c.id, c.number, c.company, c.email, COUNT(*) AS invoices, MAX(d.dunning_level) AS max_level, MIN(d.due_date) AS oldest_due,
            ROUND(SUM((d.total + d.dunning_fees - d.paid_amount) * d.exchange_rate), 2) AS base_open
       FROM documents d JOIN customers c ON c.id = d.customer_id
      WHERE d.type = 'invoice' AND d.status IN ('open','partial') AND d.due_date < CURDATE()
      GROUP BY c.id, c.number, c.company, c.email ORDER BY base_open DESC`, [], conn);
}

/** Sammelmahnung: alle überfälligen Rechnungen eines Kunden auf einem Schreiben (ohne QR-Zahlteil, da mehrere Referenzen). */
export async function collectiveDocument(conn, customerId) {
  const partner = await one('SELECT * FROM customers WHERE id = ?', [customerId], conn);
  if (!partner) throw new HttpError(404, 'Kunde nicht gefunden');
  const invoices = await q(
    `SELECT * FROM documents WHERE customer_id = ? AND type = 'invoice' AND status IN ('open','partial') AND due_date < CURDATE() ORDER BY due_date`, [customerId], conn);
  if (!invoices.length) throw new HttpError(400, 'Dieser Kunde hat keine überfälligen Rechnungen.');
  const currencies = [...new Set(invoices.map((i) => i.currency))];
  if (currencies.length > 1) throw new HttpError(400, `Die überfälligen Rechnungen lauten auf mehrere Währungen (${currencies.join(', ')}) – bitte einzeln mahnen.`);
  const settings = await getSettings(conn);
  const lang = partner.language || 'de';
  const T = labelsFor(lang);
  const t = today();
  const level = settings.dunning.levels[Math.max(0, Math.max(...invoices.map((i) => i.dunning_level)) - 1)] || settings.dunning.levels[0];
  const items = invoices.map((inv) => ({
    description: T.dunningInvoice.replace('{nummer}', inv.number).replace('{datum}', fmt(inv.date)).replace('{faellig}', fmt(inv.due_date)),
    qty: 1, unit: '', unit_price: openAmount(inv), discount_pct: 0, vat_rate: 0, line_total: openAmount(inv), sku: '',
  }));
  const total = round2(items.reduce((s, i) => s + i.line_total, 0));
  const doc = {
    type: 'invoice', title: T.collective, titleOnly: true, noQr: true, hideVat: true, language: lang, number: partner.number, date: t,
    due_date: addDays(t, Number(settings.dunning.paymentDays) || 10), currency: currencies[0], total, status: 'open', reference: null,
    intro_text: lang !== 'de' && T.text ? T.text.dunningText : level.text, footer_text: ' ', partner_name: partner.company,
  };
  return { doc, items, partner, settings, logo: await getLogo(conn), title: T.collective, invoices: invoices.length,
    filename: `${T.collective}-${partner.number}.pdf`.replace(/[^\w.\-]/g, '_') };
}
