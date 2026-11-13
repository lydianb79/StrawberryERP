import { q, one } from '../db.js';
import { HttpError, round2, today, addDays, needDate, isDate } from '../util.js';
import { getSettings } from './settings.js';
import { postEntry, deleteEntriesByRef, accountIdByNumber } from './ledger.js';

const payStatus = (total, paid) => (paid <= 0 ? 'open' : paid + 0.005 >= total ? 'paid' : 'partial');

async function validate(conn, data) {
  const supplier = await one('SELECT * FROM suppliers WHERE id = ?', [data.supplier_id], conn);
  if (!supplier) throw new HttpError(400, 'Bitte einen Lieferanten auswählen.');
  const number = String(data.number || '').trim();
  if (!number) throw new HttpError(400, 'Rechnungsnummer des Lieferanten fehlt.');
  const account = await one('SELECT id, type FROM accounts WHERE id = ?', [data.expense_account_id], conn);
  if (!account) throw new HttpError(400, 'Bitte ein Aufwand-/Gegenkonto auswählen.');
  const date = data.date ? needDate(data.date, 'Rechnungsdatum') : today();
  const due_date = isDate(data.due_date) ? data.due_date : addDays(date, supplier.payment_terms_days);
  const net = round2(data.net), vat = round2(data.vat);
  if (net <= 0 || vat < 0) throw new HttpError(400, 'Nettobetrag muss grösser als 0 sein.');
  return {
    supplier, number: number.slice(0, 60), date, due_date, description: data.description ? String(data.description).slice(0, 255) : null,
    expense_account_id: account.id, net, vat, total: round2(net + vat),
  };
}

async function post(conn, user, id, v) {
  const { accounting } = await getSettings(conn);
  await postEntry(conn, {
    date: v.date, text: `Lieferantenrechnung ${v.number} – ${v.supplier.company}`, ref_type: 'supplier_invoice', ref_id: id, user_id: user?.id,
    lines: [
      { account_id: v.expense_account_id, debit: v.net },
      { account: accounting.vatInput, debit: v.vat },
      { account: accounting.payables, credit: v.total },
    ],
  });
}

export async function createSupplierInvoice(conn, user, data) {
  const v = await validate(conn, data);
  const res = await q(
    `INSERT INTO supplier_invoices (supplier_id, number, date, due_date, description, expense_account_id, net, vat, total, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [v.supplier.id, v.number, v.date, v.due_date, v.description, v.expense_account_id, v.net, v.vat, v.total, user?.id ?? null], conn);
  await post(conn, user, res.insertId, v);
  return res.insertId;
}

async function lock(conn, id) {
  const si = await one('SELECT * FROM supplier_invoices WHERE id = ? FOR UPDATE', [id], conn);
  if (!si) throw new HttpError(404, 'Lieferantenrechnung nicht gefunden');
  return si;
}

export async function updateSupplierInvoice(conn, user, id, data) {
  const si = await lock(conn, id);
  if (si.paid_amount > 0) throw new HttpError(400, 'Rechnungen mit Zahlungen können nicht mehr geändert werden.');
  const v = await validate(conn, data);
  await deleteEntriesByRef(conn, 'supplier_invoice', id);
  await q(
    `UPDATE supplier_invoices SET supplier_id=?, number=?, date=?, due_date=?, description=?, expense_account_id=?, net=?, vat=?, total=? WHERE id=?`,
    [v.supplier.id, v.number, v.date, v.due_date, v.description, v.expense_account_id, v.net, v.vat, v.total, id], conn);
  await post(conn, user, id, v);
}

export async function deleteSupplierInvoice(conn, id) {
  const si = await lock(conn, id);
  if (si.paid_amount > 0) throw new HttpError(400, 'Bitte zuerst die erfassten Zahlungen entfernen.');
  await deleteEntriesByRef(conn, 'supplier_invoice', id);
  await q('DELETE FROM supplier_invoices WHERE id = ?', [id], conn);
  return si;
}

export async function addSupplierPayment(conn, user, id, data) {
  const si = await lock(conn, id);
  if (si.status === 'paid') throw new HttpError(400, 'Diese Rechnung ist bereits bezahlt.');
  const amount = round2(data.amount);
  const open = round2(si.total - si.paid_amount);
  if (amount <= 0) throw new HttpError(400, 'Der Betrag muss grösser als 0 sein.');
  if (amount > open + 0.005) throw new HttpError(400, `Der Betrag übersteigt den offenen Posten (${open.toFixed(2)}).`);
  const date = data.date ? needDate(data.date, 'Zahlungsdatum') : today();
  const { accounting } = await getSettings(conn);
  const account_id = data.account_id ? Number(data.account_id) : await accountIdByNumber(conn, accounting.bank);
  const res = await q(
    "INSERT INTO payments (kind, supplier_invoice_id, date, amount, account_id, note, created_by) VALUES ('payable',?,?,?,?,?,?)",
    [id, date, amount, account_id, data.note || null, user?.id ?? null], conn);
  await postEntry(conn, {
    date, text: `Zahlung Lieferantenrechnung ${si.number}`, ref_type: 'payment', ref_id: res.insertId, user_id: user?.id,
    lines: [{ account: accounting.payables, debit: amount }, { account_id, credit: amount }],
  });
  const paid = round2(si.paid_amount + amount);
  await q('UPDATE supplier_invoices SET paid_amount = ?, status = ? WHERE id = ?', [paid, payStatus(si.total, paid), id], conn);
  return res.insertId;
}

export async function removeSupplierPayment(conn, paymentId) {
  const pay = await one("SELECT * FROM payments WHERE id = ? AND kind = 'payable'", [paymentId], conn);
  if (!pay) throw new HttpError(404, 'Zahlung nicht gefunden');
  const si = await lock(conn, pay.supplier_invoice_id);
  await deleteEntriesByRef(conn, 'payment', pay.id);
  await q('DELETE FROM payments WHERE id = ?', [pay.id], conn);
  const paid = round2(si.paid_amount - pay.amount);
  await q('UPDATE supplier_invoices SET paid_amount = ?, status = ? WHERE id = ?', [paid, payStatus(si.total, paid), si.id], conn);
  return si;
}
