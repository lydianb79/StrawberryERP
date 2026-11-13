import { Router } from 'express';
import { q, one } from '../db.js';
import { can, has } from '../auth.js';
import { h, today, isDate, round2 } from '../util.js';
import { getSettings } from '../services/settings.js';

const r = Router();
// Umsatz = gebuchte Rechnungen abzüglich gebuchter Gutschriften
const BILLED = "d.type IN ('invoice','credit') AND d.status IN ('open','partial','paid')";
const SIGN = "(CASE WHEN d.type = 'credit' THEN -1 ELSE 1 END)";

const range = (req) => {
  const year = new Date().getFullYear();
  return [isDate(req.query.from) ? req.query.from : `${year}-01-01`, isDate(req.query.to) ? req.query.to : `${year}-12-31`];
};

/** Auswahllisten für Formulare – für alle angemeldeten Benutzer. */
r.get('/lookup', h(async (_req, res) => {
  const [customers, suppliers, products, accounts, years, currencies, costCenters, prices] = await Promise.all([
    q('SELECT id, number, company, payment_terms_days, currency, email, discount_pct, language FROM customers WHERE active = 1 ORDER BY company'),
    q('SELECT id, number, company, payment_terms_days, currency, email, language FROM suppliers WHERE active = 1 ORDER BY company'),
    q('SELECT id, sku, name, description, unit, sale_price, purchase_price, vat_rate, stock_qty, min_stock, is_stock_item, supplier_id FROM products WHERE active = 1 ORDER BY sku'),
    q('SELECT id, number, name, type FROM accounts WHERE active = 1 ORDER BY number'),
    q('SELECT id, name, start_date, end_date, status FROM fiscal_years ORDER BY start_date DESC'),
    q('SELECT code, name, rate FROM currencies WHERE active = 1 ORDER BY code'),
    q('SELECT id, code, name FROM cost_centers WHERE active = 1 ORDER BY code'),
    q('SELECT product_id, customer_id, min_qty, price FROM product_prices'),
  ]);
  res.json({ customers, suppliers, products, accounts, years, currencies, costCenters, prices });
}));

r.get('/dashboard', h(async (req, res) => {
  const t = today();
  const out = { finance: null };
  const [quotes, orders, lowStock] = await Promise.all([
    one("SELECT COUNT(*) AS n, COALESCE(SUM(total * exchange_rate),0) AS amount FROM documents WHERE type='quote' AND status IN ('draft','sent')"),
    one("SELECT COUNT(*) AS n, COALESCE(SUM(total * exchange_rate),0) AS amount FROM documents WHERE type='order' AND status IN ('open','partly','delivered')"),
    q('SELECT id, sku, name, unit, stock_qty, min_stock FROM products WHERE active = 1 AND is_stock_item = 1 AND stock_qty <= min_stock ORDER BY (stock_qty - min_stock) LIMIT 8'),
  ]);
  const purchases = await one("SELECT COUNT(*) AS n, COALESCE(SUM(total * exchange_rate),0) AS amount FROM documents WHERE type='purchase' AND status IN ('ordered','partly')");
  Object.assign(out, { openQuotes: quotes, openOrders: orders, openPurchases: purchases, lowStock });

  if (has(req.user, 'reports.read')) {
    const fy = (await one('SELECT * FROM fiscal_years WHERE ? BETWEEN start_date AND end_date', [t]))
      || (await one('SELECT * FROM fiscal_years ORDER BY start_date DESC LIMIT 1'));
    const [revenue, receivables, payables, stock, monthly, recent] = await Promise.all([
      one(`SELECT COALESCE(SUM(${SIGN} * d.subtotal * d.exchange_rate),0) AS amount, COALESCE(SUM(d.type = 'invoice'),0) AS n FROM documents d WHERE ${BILLED} AND d.date BETWEEN ? AND ?`,
        [fy?.start_date || t, fy?.end_date || t]),
      one(`SELECT COALESCE(SUM((total + dunning_fees - paid_amount) * exchange_rate),0) AS amount, COUNT(*) AS n,
                  COALESCE(SUM(CASE WHEN due_date < ? THEN (total + dunning_fees - paid_amount) * exchange_rate ELSE 0 END),0) AS overdue
             FROM documents WHERE type='invoice' AND status IN ('open','partial')`, [t]),
      one(`SELECT COALESCE(SUM((total - paid_amount) * exchange_rate),0) AS amount, COUNT(*) AS n,
                  COALESCE(SUM(CASE WHEN due_date < ? THEN (total - paid_amount) * exchange_rate ELSE 0 END),0) AS overdue
             FROM supplier_invoices WHERE status IN ('open','partial')`, [t]),
      one('SELECT COALESCE(SUM(stock_qty * purchase_price),0) AS amount FROM products WHERE is_stock_item = 1 AND active = 1'),
      q(`SELECT DATE_FORMAT(d.date, '%Y-%m') AS month, SUM(${SIGN} * d.subtotal * d.exchange_rate) AS amount FROM documents d
          WHERE ${BILLED} AND d.date >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 11 MONTH)
          GROUP BY month ORDER BY month`),
      q(`SELECT d.id, d.number, d.date, d.total, d.currency, d.status, c.company AS customer_name,
                (d.status IN ('open','partial') AND d.due_date < CURDATE()) AS overdue
           FROM documents d JOIN customers c ON c.id = d.customer_id
          WHERE d.type = 'invoice' ORDER BY d.id DESC LIMIT 6`),
    ]);
    out.finance = { fiscalYear: fy?.name || null, revenue, receivables, payables, stockValue: stock.amount, monthly, recent };
  }
  res.json(out);
}));

r.get('/sales', can('reports.read'), h(async (req, res) => {
  const [from, to] = range(req);
  const [monthly, customers, products, totals] = await Promise.all([
    q(`SELECT DATE_FORMAT(d.date, '%Y-%m') AS month, SUM(${SIGN} * d.subtotal * d.exchange_rate) AS net, SUM(${SIGN} * d.total * d.exchange_rate) AS gross, SUM(d.type = 'invoice') AS n
         FROM documents d WHERE ${BILLED} AND d.date BETWEEN ? AND ? GROUP BY month ORDER BY month`, [from, to]),
    q(`SELECT c.number, c.company, SUM(${SIGN} * d.subtotal * d.exchange_rate) AS net, SUM(d.type = 'invoice') AS n
         FROM documents d JOIN customers c ON c.id = d.customer_id
        WHERE ${BILLED} AND d.date BETWEEN ? AND ? GROUP BY c.id, c.number, c.company ORDER BY net DESC LIMIT 20`, [from, to]),
    q(`SELECT MAX(COALESCE(i.sku, '–')) AS sku, MAX(COALESCE(p.name, SUBSTRING(i.description, 1, 60))) AS name, SUM(${SIGN} * i.qty) AS qty, SUM(${SIGN} * i.line_total * d.exchange_rate) AS net
         FROM document_items i JOIN documents d ON d.id = i.document_id LEFT JOIN products p ON p.id = i.product_id
        WHERE ${BILLED} AND d.date BETWEEN ? AND ? GROUP BY i.sku, i.product_id ORDER BY net DESC LIMIT 20`, [from, to]),
    one(`SELECT COALESCE(SUM(${SIGN} * d.subtotal * d.exchange_rate),0) AS net, COALESCE(SUM(${SIGN} * d.total * d.exchange_rate),0) AS gross, COALESCE(SUM(d.type = 'invoice'),0) AS n
           FROM documents d WHERE ${BILLED} AND d.date BETWEEN ? AND ?`, [from, to]),
  ]);
  res.json({ from, to, monthly, customers, products, totals });
}));

const AGING = `CASE WHEN due_date >= CURDATE() THEN 'current'
                    WHEN DATEDIFF(CURDATE(), due_date) <= 30 THEN 'd30'
                    WHEN DATEDIFF(CURDATE(), due_date) <= 60 THEN 'd60'
                    ELSE 'd90' END`;

r.get('/receivables', can('reports.read', 'receivables.read'), h(async (_req, res) => {
  res.json(await q(
    `SELECT d.id, d.number, d.date, d.due_date, d.total, d.paid_amount, d.total + d.dunning_fees - d.paid_amount AS open_amount, d.status, d.currency, d.exchange_rate, d.dunning_level, d.dunning_fees,
            ROUND((d.total + d.dunning_fees - d.paid_amount) * d.exchange_rate, 2) AS base_open,
            c.company AS partner, c.number AS partner_number, GREATEST(DATEDIFF(CURDATE(), d.due_date), 0) AS days_overdue, ${AGING} AS bucket
       FROM documents d JOIN customers c ON c.id = d.customer_id
      WHERE d.type = 'invoice' AND d.status IN ('open','partial') ORDER BY d.due_date`));
}));

r.get('/payables', can('reports.read', 'payables.read'), h(async (_req, res) => {
  res.json(await q(
    `SELECT si.id, si.number, si.date, si.due_date, si.total, si.paid_amount, si.total - si.paid_amount AS open_amount, si.status, si.currency, si.exchange_rate,
            ROUND((si.total - si.paid_amount) * si.exchange_rate, 2) AS base_open,
            s.company AS partner, s.number AS partner_number, GREATEST(DATEDIFF(CURDATE(), si.due_date), 0) AS days_overdue, ${AGING} AS bucket
       FROM supplier_invoices si JOIN suppliers s ON s.id = si.supplier_id
      WHERE si.status IN ('open','partial') ORDER BY si.due_date`));
}));

r.get('/stock', can('reports.read', 'inventory.read'), h(async (_req, res) => {
  res.json(await q(
    `SELECT id, sku, name, unit, location, stock_qty, min_stock, purchase_price, sale_price,
            stock_qty * purchase_price AS stock_value, (stock_qty <= min_stock) AS low
       FROM products WHERE is_stock_item = 1 AND active = 1 ORDER BY sku`));
}));

const ZIFFER = { 8.1: '303', 2.6: '313', 3.8: '343', 7.7: '302', 2.5: '312', 3.7: '342' };

/**
 * MwSt-Abrechnung nach der in den Firmendaten gewählten Methode:
 * agreed = vereinbartes Entgelt (Rechnungsdatum), received = vereinnahmtes Entgelt (Zahlungsdatum), net = Saldosteuersatz.
 */
r.get('/vat', can('reports.read'), h(async (req, res) => {
  const [from, to] = range(req);
  const { company } = await getSettings();
  const method = ['agreed', 'received', 'net'].includes(req.query.method) ? req.query.method : company.vat_method || 'agreed';
  let output, input;
  if (method === 'received') {
    // Anteil jeder Zahlung an der Rechnung × MwSt der Rechnung je Satz
    output = await q(
      `SELECT x.rate, ROUND(SUM(x.base * x.share), 2) AS base, ROUND(SUM(x.base * x.share) * x.rate / 100, 2) AS vat FROM (
         SELECT i.vat_rate AS rate, SUM(i.line_total) * d.exchange_rate AS base, pay.share
           FROM documents d JOIN document_items i ON i.document_id = d.id
           JOIN (SELECT p.document_id, SUM(p.amount) / MAX(dd.total) AS share
                   FROM payments p JOIN documents dd ON dd.id = p.document_id
                  WHERE p.kind = 'receivable' AND p.reversed_at IS NULL AND p.credit_note_id IS NULL AND dd.type = 'invoice' AND dd.total > 0
                    AND p.date BETWEEN ? AND ? GROUP BY p.document_id) pay ON pay.document_id = d.id
          GROUP BY d.id, i.vat_rate, d.exchange_rate, pay.share) x
        GROUP BY x.rate ORDER BY x.rate DESC`, [from, to]);
    input = await one(
      `SELECT COALESCE(ROUND(SUM(p.amount / si.total * si.net * si.exchange_rate), 2), 0) AS base,
              COALESCE(ROUND(SUM(p.amount / si.total * si.vat * si.exchange_rate), 2), 0) AS vat, COUNT(DISTINCT si.id) AS n
         FROM payments p JOIN supplier_invoices si ON si.id = p.supplier_invoice_id
        WHERE p.kind = 'payable' AND p.reversed_at IS NULL AND si.total > 0 AND p.date BETWEEN ? AND ?`, [from, to]);
  } else {
    output = await q(
      `SELECT i.vat_rate AS rate, ROUND(SUM(${SIGN} * i.line_total * d.exchange_rate), 2) AS base,
              ROUND(SUM(${SIGN} * i.line_total * d.exchange_rate) * i.vat_rate / 100, 2) AS vat
         FROM document_items i JOIN documents d ON d.id = i.document_id
        WHERE ${BILLED} AND d.date BETWEEN ? AND ? GROUP BY i.vat_rate ORDER BY i.vat_rate DESC`, [from, to]);
    input = await one(
      `SELECT COALESCE(ROUND(SUM(net * exchange_rate), 2),0) AS base, COALESCE(ROUND(SUM(vat * exchange_rate), 2),0) AS vat, COUNT(*) AS n
         FROM supplier_invoices WHERE status <> 'cancelled' AND date BETWEEN ? AND ?`, [from, to]);
  }
  for (const o of output) o.ziffer = ZIFFER[o.rate] || null;
  const turnover = round2(output.reduce((s, x) => s + x.base, 0));
  const outputVat = round2(output.reduce((s, x) => s + x.vat, 0));
  if (method === 'net') {
    // Saldosteuersatz: Steuer = Bruttoumsatz × Satz, kein Vorsteuerabzug
    const gross = round2(turnover + outputVat);
    const rate = Number(company.vat_net_rate) || 0;
    const tax = round2(gross * rate / 100);
    return res.json({ from, to, method, output, turnover, gross, netRate: rate, outputVat: tax, input: { base: 0, vat: 0, n: 0 }, payable: tax });
  }
  return res.json({ from, to, method, output, turnover, input, outputVat, payable: round2(outputVat - input.vat) });
}));

export default r;
