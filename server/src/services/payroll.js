// Einfache Lohnabrechnung: Monatslauf mit prozentualen Abzügen, Lohnabrechnung, Verbuchung und Auszahlung.
// Mit 13. Monatslohn und Lohnausweis. Nicht enthalten: Quellensteuer, Kinderzulagen, Stundenlöhne, Lohnmeldung (ELM).
import { q, one } from '../db.js';
import { HttpError, round2, today } from '../util.js';
import { getSettings, getLogo } from './settings.js';
import { postEntry, reverseEntriesByRef, accountIdByNumber } from './ledger.js';

const r05 = (n) => Math.round(n * 20) / 20; // Abzüge auf 5 Rappen runden

const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const lastDay = (y, m) => new Date(y, m, 0).getDate();

/**
 * 13. Monatslohn für einen Abrechnungsmonat (JJJJ-MM).
 * mode: 'december' = Auszahlung im Dezember, 'half' = je zur Hälfte im Juni und Dezember.
 * Pro Monat entsteht ein Zwölftel des Monatslohns, bei Ein- oder Austritt im Monat anteilig nach Tagen.
 * Ausbezahlt wird der seit der letzten Auszahlung aufgelaufene Anspruch – im Auszahlungsmonat oder im Austrittsmonat.
 */
export function thirteenthFor(employee, period) {
  const mode = employee.thirteenth;
  if (!mode || mode === 'none') return 0;
  const [y, m] = period.split('-').map(Number);
  const exitsNow = !!employee.exit_date && employee.exit_date.slice(0, 7) === period;
  const payout = m === 12 || (mode === 'half' && m === 6) || exitsNow;
  if (!payout) return 0;
  const from = mode === 'half' && m > 6 ? 7 : 1;
  let months = 0;
  for (let mm = from; mm <= m; mm++) {
    const days = lastDay(y, mm);
    const start = employee.entry_date && employee.entry_date > iso(y, mm, 1) ? employee.entry_date : iso(y, mm, 1);
    const end = employee.exit_date && employee.exit_date < iso(y, mm, days) ? employee.exit_date : iso(y, mm, days);
    if (start > end) continue;
    months += (Number(end.slice(8, 10)) - Number(start.slice(8, 10)) + 1) / days;
  }
  return r05(Number(employee.monthly_gross) * months / 12);
}

/** Berechnet eine Lohnabrechnung aus Monatslohn, 13. Monatslohn, Zulage, Spesen und den eingestellten Sätzen. */
export function computePayslip(employee, rates, { bonus = 0, expenses = 0, thirteenth = 0 } = {}) {
  const base = round2(employee.monthly_gross);
  const gross = round2(base + round2(bonus) + round2(thirteenth));
  const line = (r) => ({ key: r.key, label: r.label, rate: Number(r.rate) || 0, amount: r05(gross * (Number(r.rate) || 0) / 100) });
  const deductions = (rates.employee || []).map(line).filter((l) => l.amount);
  if (employee.bvg_employee > 0) deductions.push({ key: 'bvg', label: 'Pensionskasse (BVG)', rate: null, amount: round2(employee.bvg_employee) });
  const employer = (rates.employer || []).map(line).filter((l) => l.amount);
  if (employee.bvg_employer > 0) employer.push({ key: 'bvg', label: 'Pensionskasse (BVG)', rate: null, amount: round2(employee.bvg_employer) });
  const deduction_total = round2(deductions.reduce((s, l) => s + l.amount, 0));
  const employer_total = round2(employer.reduce((s, l) => s + l.amount, 0));
  return { base, bonus: round2(bonus), thirteenth: round2(thirteenth), expenses: round2(expenses), gross, deductions, employer, deduction_total, employer_total,
    net: round2(gross - deduction_total + round2(expenses)) };
}

const parse = (p) => ({ ...p, deductions: JSON.parse(p.deductions), employer: JSON.parse(p.employer) });

async function writeSlip(conn, runId, employee, rates, extra, slipId) {
  const c = computePayslip(employee, rates, extra);
  const values = [c.base, c.bonus, c.thirteenth, c.expenses, c.gross, JSON.stringify(c.deductions), JSON.stringify(c.employer), c.deduction_total, c.employer_total, c.net];
  if (slipId) await q('UPDATE payslips SET base=?, bonus=?, thirteenth=?, expenses=?, gross=?, deductions=?, employer=?, deduction_total=?, employer_total=?, net=? WHERE id=?', [...values, slipId], conn);
  else await q('INSERT INTO payslips (run_id, employee_id, base, bonus, thirteenth, expenses, gross, deductions, employer, deduction_total, employer_total, net) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [runId, employee.id, ...values], conn);
}

/** Lohnlauf für einen Monat (JJJJ-MM) anlegen: eine Abrechnung je aktive, im Monat angestellte Person. */
export async function createRun(conn, user, period) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(period))) throw new HttpError(400, 'Bitte den Monat im Format JJJJ-MM angeben.');
  if (await one('SELECT id FROM payroll_runs WHERE period = ?', [period], conn)) throw new HttpError(400, `Für ${period} existiert bereits ein Lohnlauf.`);
  const [y, m] = period.split('-').map(Number);
  const first = `${period}-01`, last = `${period}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
  const employees = await q(
    'SELECT * FROM employees WHERE active = 1 AND (entry_date IS NULL OR entry_date <= ?) AND (exit_date IS NULL OR exit_date >= ?) ORDER BY name', [last, first], conn);
  if (!employees.length) throw new HttpError(400, 'Es sind keine aktiven Mitarbeitenden für diesen Monat erfasst.');
  const { payroll } = await getSettings(conn);
  const res = await q('INSERT INTO payroll_runs (period, date, created_by) VALUES (?,?,?)', [period, last, user?.id ?? null], conn);
  for (const e of employees) await writeSlip(conn, res.insertId, e, payroll, { thirteenth: thirteenthFor(e, period) });
  return res.insertId;
}

export async function getRun(conn, id) {
  const run = await one('SELECT * FROM payroll_runs WHERE id = ?', [id], conn);
  if (!run) throw new HttpError(404, 'Lohnlauf nicht gefunden');
  run.slips = (await q(
    `SELECT p.*, e.name, e.number, e.iban, e.cost_center_id FROM payslips p JOIN employees e ON e.id = p.employee_id WHERE p.run_id = ? ORDER BY e.name`, [id], conn)).map(parse);
  const sum = (k) => round2(run.slips.reduce((s, p) => s + p[k], 0));
  run.totals = { gross: sum('gross'), deductions: sum('deduction_total'), employer: sum('employer_total'), expenses: sum('expenses'), net: sum('net') };
  return run;
}

export async function listRuns(conn) {
  return q(
    `SELECT r.*, COUNT(p.id) AS employees, COALESCE(SUM(p.gross), 0) AS gross, COALESCE(SUM(p.net), 0) AS net, COALESCE(SUM(p.employer_total), 0) AS employer
       FROM payroll_runs r LEFT JOIN payslips p ON p.run_id = r.id GROUP BY r.id ORDER BY r.period DESC`, [], conn);
}

async function lockRun(conn, id, status) {
  const run = await one('SELECT * FROM payroll_runs WHERE id = ? FOR UPDATE', [id], conn);
  if (!run) throw new HttpError(404, 'Lohnlauf nicht gefunden');
  if (status && run.status !== status) throw new HttpError(400, { draft: 'Dieser Lohnlauf ist bereits gebucht.', posted: 'Dieser Lohnlauf ist nicht im Status «gebucht».' }[status]);
  return run;
}

/** Zulage und Spesen einer Abrechnung im Entwurf ändern; die Abzüge werden neu gerechnet. */
export async function updateSlip(conn, slipId, { bonus, expenses, thirteenth }) {
  const slip = await one('SELECT * FROM payslips WHERE id = ?', [slipId], conn);
  if (!slip) throw new HttpError(404, 'Abrechnung nicht gefunden');
  await lockRun(conn, slip.run_id, 'draft');
  const employee = await one('SELECT * FROM employees WHERE id = ?', [slip.employee_id], conn);
  const { payroll } = await getSettings(conn);
  await writeSlip(conn, slip.run_id, { ...employee, monthly_gross: slip.base }, payroll, { bonus: Number(bonus) || 0, expenses: Number(expenses) || 0,
    thirteenth: thirteenth === undefined ? slip.thirteenth : Number(thirteenth) || 0 }, slipId);
  return slip.run_id;
}

/** Lohnlauf verbuchen: Lohnaufwand, Sozialaufwand des Arbeitgebers, Verbindlichkeiten gegenüber Kassen und Mitarbeitenden. */
export async function postRun(conn, user, id) {
  const run = await lockRun(conn, id, 'draft');
  const data = await getRun(conn, id);
  const { accounting } = await getSettings(conn);
  const lines = [];
  for (const s of data.slips) {
    lines.push({ account: accounting.wages, debit: round2(s.gross + s.expenses), cost_center_id: s.cost_center_id });
    lines.push({ account: accounting.socialExpense, debit: s.employer_total, cost_center_id: s.cost_center_id });
  }
  lines.push({ account: accounting.socialPayable, credit: round2(data.totals.deductions + data.totals.employer) });
  lines.push({ account: accounting.wagesPayable, credit: data.totals.net });
  await postEntry(conn, { date: run.date, text: `Löhne ${run.period}`, ref_type: 'payroll', ref_id: id, user_id: user?.id, lines });
  await q("UPDATE payroll_runs SET status = 'posted', posted_at = NOW() WHERE id = ?", [id], conn);
  return data.totals;
}

/** Auszahlung der Nettolöhne verbuchen. */
export async function payRun(conn, user, id, { date, account_id } = {}) {
  const run = await lockRun(conn, id, 'posted');
  const data = await getRun(conn, id);
  const { accounting } = await getSettings(conn);
  const bank = account_id ? Number(account_id) : await accountIdByNumber(conn, accounting.bank);
  await postEntry(conn, { date: date || today(), text: `Lohnzahlung ${run.period}`, ref_type: 'payroll_payment', ref_id: id, user_id: user?.id,
    lines: [{ account: accounting.wagesPayable, debit: data.totals.net }, { account_id: bank, credit: data.totals.net }] });
  await q("UPDATE payroll_runs SET status = 'paid', paid_at = NOW() WHERE id = ?", [id], conn);
  return data.totals;
}

/** Lohnlauf stornieren (Gegenbuchungen) bzw. Entwurf löschen. */
export async function cancelRun(conn, user, id) {
  const run = await lockRun(conn, id);
  if (run.status === 'draft') { await q('DELETE FROM payroll_runs WHERE id = ?', [id], conn); return 'deleted'; }
  if (run.status === 'paid') await reverseEntriesByRef(conn, 'payroll_payment', id, { user_id: user?.id, text: `Storno Lohnzahlung ${run.period}` });
  await reverseEntriesByRef(conn, 'payroll', id, { user_id: user?.id, text: `Storno Löhne ${run.period}` });
  await q("UPDATE payroll_runs SET status = 'draft', posted_at = NULL, paid_at = NULL WHERE id = ?", [id], conn);
  return 'reopened';
}

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
export const periodLabel = (period) => `${MONTHS[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;

/** Lohnabrechnung als Beleg für den PDF-Renderer. */
export async function payslipDocument(conn, slipId) {
  const slip = await one('SELECT * FROM payslips WHERE id = ?', [slipId], conn);
  if (!slip) throw new HttpError(404, 'Abrechnung nicht gefunden');
  const p = parse(slip);
  const run = await one('SELECT * FROM payroll_runs WHERE id = ?', [p.run_id], conn);
  const e = await one('SELECT * FROM employees WHERE id = ?', [p.employee_id], conn);
  const settings = await getSettings(conn);
  const line = (description, amount, rate) => ({ description, qty: rate ?? 1, unit: rate != null ? '%' : '', unit_price: rate != null ? p.gross : amount,
    discount_pct: 0, vat_rate: 0, line_total: amount, sku: '' });
  const items = [line('Monatslohn', p.base)];
  if (p.thirteenth) items.push(line('13. Monatslohn', p.thirteenth));
  if (p.bonus) items.push(line('Zulage / Bonus', p.bonus));
  for (const d of p.deductions) items.push(line(`Abzug ${d.label}`, -d.amount, d.rate));
  if (p.expenses) items.push(line('Spesen (nicht beitragspflichtig)', p.expenses));
  const doc = {
    type: 'invoice', title: `Lohnabrechnung ${periodLabel(run.period)}`, titleOnly: true, noQr: true, hideVat: true, language: 'de',
    number: run.period, date: run.date, due_date: null, reference: e.ahv_no ? `AHV-Nr. ${e.ahv_no}` : null, currency: settings.company.currency || 'CHF',
    total: p.net, status: 'open', totalLabel: 'Auszahlung', partnerLabel: 'Personal-Nr.',
    intro_text: `Bruttolohn ${periodLabel(run.period)}: ${p.gross.toFixed(2)}. Arbeitgeberbeiträge (zur Information): ${p.employer_total.toFixed(2)}.`,
    footer_text: e.iban ? `Die Auszahlung erfolgt auf das Konto ${e.iban}.` : ' ',
  };
  const partner = { company: e.name, street: e.street, zip: e.zip, city: e.city, country: 'Schweiz', number: e.number };
  return { doc, items, partner, settings, logo: await getLogo(conn), filename: `Lohnabrechnung-${run.period}-${e.number}.pdf`.replace(/[^\w.\-]/g, '_') };
}

// ---------- Lohnausweis ----------

// Arbeitnehmerbeiträge, die in Ziffer 9 des Lohnausweises gehören (AHV/IV/EO/ALV/NBUV); Krankentaggeld gehört nicht dazu.
const ZIFFER_9 = ['ahv', 'alv', 'nbu'];

/**
 * Jahreswerte je Person aus den gebuchten Lohnläufen eines Kalenderjahrs, gegliedert nach den Ziffern des Lohnausweises (Formular 11).
 */
export async function certificates(conn, year) {
  const y = Number(year);
  if (!(y >= 2000 && y <= 2100)) throw new HttpError(400, 'Bitte ein gültiges Jahr angeben.');
  const runs = await q('SELECT id, period, status FROM payroll_runs WHERE period LIKE ? ORDER BY period', [`${y}-%`], conn);
  const booked = runs.filter((r) => r.status !== 'draft');
  const slips = booked.length
    ? await q(`SELECT p.*, r.period FROM payslips p JOIN payroll_runs r ON r.id = p.run_id WHERE p.run_id IN (?) ORDER BY r.period`, [booked.map((r) => r.id)], conn)
    : [];
  const employees = slips.length ? await q('SELECT * FROM employees WHERE id IN (?) ORDER BY name', [[...new Set(slips.map((s) => s.employee_id))]], conn) : [];
  const rows = employees.map((e) => {
    const mine = slips.filter((s) => s.employee_id === e.id).map(parse);
    const sum = (fn) => round2(mine.reduce((t, s) => t + fn(s), 0));
    const ded = (keys, invert = false) => sum((s) => s.deductions.filter((d) => keys.includes(d.key) !== invert).reduce((t, d) => t + d.amount, 0));
    const z1 = sum((s) => s.base + s.thirteenth), z3 = sum((s) => s.bonus);
    const z8 = round2(z1 + z3), z9 = ded(ZIFFER_9), z10 = ded(['bvg']);
    const from = e.entry_date && e.entry_date > `${y}-01-01` ? e.entry_date : `${y}-01-01`;
    const to = e.exit_date && e.exit_date < `${y}-12-31` ? e.exit_date : `${y}-12-31`;
    return {
      employee: e, year: y, from, to, months: mine.map((s) => s.period),
      z1, z3, z8, z9, z10, z11: round2(z8 - z9 - z10), z13: sum((s) => s.expenses),
      // Abzüge, die nicht in den Ziffern 9 und 10 erscheinen (z.B. Krankentaggeld) – zur Kontrolle
      otherDeductions: ded([...ZIFFER_9, 'bvg'], true),
    };
  });
  return { year: y, runs: runs.length, draftRuns: runs.filter((r) => r.status === 'draft').map((r) => r.period), rows };
}
