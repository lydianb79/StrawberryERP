import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { q, one, tx, runScript } from './db.js';
import { addDays, today } from './util.js';
import * as docs from './services/documents.js';
import * as payables from './services/payables.js';
import { moveStock } from './services/stock.js';
import { partnerNumber } from './services/numbering.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROLES = [
  { name: 'Administrator', description: 'Vollzugriff auf alle Funktionen', is_system: 1, permissions: ['*'] },
  { name: 'Buchhaltung', description: 'Rechnungen, Debitoren/Kreditoren, Buchhaltung, Abschluss',
    permissions: ['customers.read', 'suppliers.read', 'suppliers.write', 'inventory.read', 'quotes.read', 'orders.read',
      'invoices.read', 'invoices.write', 'receivables.read', 'receivables.write', 'payables.read', 'payables.write',
      'accounting.read', 'accounting.write', 'accounting.close', 'reports.read'] },
  { name: 'Verkauf', description: 'Kunden, Offerten, Aufträge, Rechnungen',
    permissions: ['customers.read', 'customers.write', 'inventory.read', 'quotes.read', 'quotes.write', 'orders.read',
      'orders.write', 'invoices.read', 'invoices.write', 'receivables.read', 'reports.read'] },
  { name: 'Lager', description: 'Artikel und Lagerbewegungen',
    permissions: ['inventory.read', 'inventory.write', 'suppliers.read', 'orders.read'] },
  { name: 'Nur Lesen', description: 'Lesezugriff auf alle Bereiche',
    permissions: ['customers.read', 'suppliers.read', 'inventory.read', 'quotes.read', 'orders.read', 'invoices.read',
      'receivables.read', 'payables.read', 'accounting.read', 'reports.read'] },
];

// Kontenplan in Anlehnung an den Schweizer Kontenrahmen KMU
const ACCOUNTS = [
  ['1000', 'Kasse', 'asset'], ['1020', 'Bankguthaben', 'asset'], ['1100', 'Forderungen aus Lieferungen und Leistungen (Debitoren)', 'asset'],
  ['1170', 'Vorsteuer MwSt', 'asset'], ['1200', 'Handelswaren (Vorräte)', 'asset'], ['1300', 'Aktive Rechnungsabgrenzung', 'asset'],
  ['1500', 'Maschinen und Apparate', 'asset'], ['1510', 'Mobiliar und Einrichtungen', 'asset'], ['1520', 'Büromaschinen, Informatik', 'asset'],
  ['1530', 'Fahrzeuge', 'asset'],
  ['2000', 'Verbindlichkeiten aus Lieferungen und Leistungen (Kreditoren)', 'liability'], ['2200', 'Geschuldete MwSt (Umsatzsteuer)', 'liability'],
  ['2300', 'Passive Rechnungsabgrenzung', 'liability'], ['2400', 'Bankdarlehen', 'liability'],
  ['2800', 'Eigenkapital / Aktienkapital', 'equity'], ['2950', 'Gesetzliche Gewinnreserve', 'equity'],
  ['2970', 'Gewinnvortrag / Verlustvortrag', 'equity'], ['2979', 'Jahresgewinn / Jahresverlust', 'equity'],
  ['3000', 'Produktionserlöse', 'revenue'], ['3200', 'Handelserlöse', 'revenue'], ['3400', 'Dienstleistungserlöse', 'revenue'],
  ['3800', 'Erlösminderungen', 'revenue'], ['6950', 'Finanzertrag', 'revenue'],
  ['4000', 'Materialaufwand', 'expense'], ['4200', 'Handelswarenaufwand', 'expense'], ['4400', 'Aufwand für bezogene Dienstleistungen', 'expense'],
  ['5000', 'Lohnaufwand', 'expense'], ['5700', 'Sozialversicherungsaufwand', 'expense'], ['5800', 'Übriger Personalaufwand', 'expense'],
  ['6000', 'Raumaufwand', 'expense'], ['6100', 'Unterhalt, Reparaturen, Ersatz', 'expense'], ['6200', 'Fahrzeug- und Transportaufwand', 'expense'],
  ['6300', 'Sachversicherungen, Abgaben, Gebühren', 'expense'], ['6400', 'Energie- und Entsorgungsaufwand', 'expense'],
  ['6500', 'Verwaltungsaufwand', 'expense'], ['6570', 'Informatikaufwand', 'expense'], ['6600', 'Werbeaufwand', 'expense'],
  ['6800', 'Abschreibungen', 'expense'], ['6900', 'Finanzaufwand', 'expense'], ['8900', 'Direkte Steuern', 'expense'],
];

export async function migrate() {
  await runScript(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

  if (!(await one('SELECT id FROM roles LIMIT 1'))) {
    for (const role of ROLES) {
      const res = await q('INSERT INTO roles (name, description, is_system) VALUES (?,?,?)', [role.name, role.description, role.is_system || 0]);
      await q('INSERT INTO role_permissions (role_id, permission) VALUES ?', [role.permissions.map((p) => [res.insertId, p])]);
    }
    console.log('[seed] Rollen angelegt');
  }
  if (!(await one('SELECT id FROM accounts LIMIT 1'))) {
    await q('INSERT INTO accounts (number, name, type) VALUES ?', [ACCOUNTS]);
    console.log('[seed] Kontenplan angelegt');
  }
  if (!(await one('SELECT id FROM fiscal_years LIMIT 1'))) {
    const y = new Date().getFullYear();
    await q('INSERT INTO fiscal_years (name, start_date, end_date) VALUES (?,?,?)', [String(y), `${y}-01-01`, `${y}-12-31`]);
    console.log(`[seed] Geschäftsjahr ${y} angelegt`);
  }
  if (!(await one('SELECT id FROM users LIMIT 1'))) {
    const email = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase();
    let password = process.env.ADMIN_PASSWORD;
    const generated = !password;
    if (generated) password = crypto.randomBytes(12).toString('base64url');
    const role = await one("SELECT id FROM roles WHERE name = 'Administrator'");
    await q('INSERT INTO users (email, name, password_hash, role_id) VALUES (?,?,?,?)',
      [email, 'Administrator', await bcrypt.hash(password, 12), role.id]);
    console.log(`[seed] Administrator angelegt: ${email}`);
    if (generated) console.log(`[seed] Initialpasswort (bitte sofort ändern): ${password}`);
    if (process.env.SEED_DEMO === 'true') await seedDemo();
  }
}

/** Beispieldaten für Test und Demo (SEED_DEMO=true beim allerersten Start). */
async function seedDemo() {
  const admin = await one('SELECT id FROM users ORDER BY id LIMIT 1');
  const user = { id: admin.id };
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const ago = (days) => { const d = addDays(today(), -days); return d < yearStart ? yearStart : d; };

  await tx(async (conn) => {
    const customers = [
      ['Alpenblick Hotel AG', 'Herr Marco Steiner', 'Seestrasse 14', '6002', 'Luzern', 30],
      ['Bäckerei Hug GmbH', 'Frau Petra Hug', 'Dorfplatz 3', '8700', 'Küsnacht', 20],
      ['Müller Treuhand AG', 'Herr Daniel Müller', 'Bahnhofstrasse 88', '8001', 'Zürich', 30],
      ['Velo Keller', 'Herr Urs Keller', 'Industrieweg 7', '3018', 'Bern', 10],
      ['Praxis Dr. Frei', 'Frau Dr. Sabine Frei', 'Marktgasse 21', '9000', 'St. Gallen', 30],
      ['Schreinerei Wenger & Söhne', 'Herr Thomas Wenger', 'Gewerbestrasse 5', '4410', 'Liestal', 30],
    ];
    const cid = [];
    for (const [company, contact, street, zip, city, terms] of customers) {
      const number = await partnerNumber(conn, 'customer', 'K');
      const res = await q('INSERT INTO customers (number, company, contact_name, street, zip, city, payment_terms_days, email) VALUES (?,?,?,?,?,?,?,?)',
        [number, company, contact, street, zip, city, terms, `info@${company.toLowerCase().replace(/[^a-z]+/g, '')}.example`], conn);
      cid.push(res.insertId);
    }
    const suppliers = [
      ['Bürobedarf Zentral AG', 'Lagerstrasse 40', '8004', 'Zürich'],
      ['TechImport Schweiz GmbH', 'Hafenweg 2', '4057', 'Basel'],
      ['Immobilien Seefeld AG', 'Seefeldstrasse 120', '8008', 'Zürich'],
    ];
    const sid = [];
    for (const [company, street, zip, city] of suppliers) {
      const number = await partnerNumber(conn, 'supplier', 'L');
      const res = await q('INSERT INTO suppliers (number, company, street, zip, city) VALUES (?,?,?,?,?)', [number, company, street, zip, city], conn);
      sid.push(res.insertId);
    }
    const products = [
      ['HW-1001', 'Notebook Business 14"', 'Stk', 1490, 1080, 8.1, 1, 12, 5, 'A-01'],
      ['HW-1002', 'Monitor 27" QHD', 'Stk', 389, 265, 8.1, 1, 20, 6, 'A-02'],
      ['HW-1003', 'Dockingstation USB-C', 'Stk', 219, 140, 8.1, 1, 4, 5, 'A-03'],
      ['HW-1010', 'Laserdrucker Color A4', 'Stk', 549, 395, 8.1, 1, 6, 2, 'B-01'],
      ['ZB-2001', 'Tastatur CH-Layout', 'Stk', 79, 42, 8.1, 1, 35, 10, 'C-01'],
      ['ZB-2002', 'Maus kabellos', 'Stk', 45, 21, 8.1, 1, 3, 10, 'C-02'],
      ['ZB-2010', 'Toner schwarz XL', 'Stk', 129, 78, 8.1, 1, 18, 8, 'C-05'],
      ['DL-3001', 'Installation und Konfiguration', 'Std', 145, 0, 8.1, 0, 0, 0, null],
      ['DL-3002', 'IT-Support vor Ort', 'Std', 165, 0, 8.1, 0, 0, 0, null],
      ['DL-3010', 'Wartungsvertrag Basic (Monat)', 'Mt', 290, 0, 8.1, 0, 0, 0, null],
    ];
    const pid = {};
    for (const [sku, name, unit, sale, purchase, vat, stockItem, stock, min, location] of products) {
      const res = await q('INSERT INTO products (sku, name, unit, sale_price, purchase_price, vat_rate, is_stock_item, min_stock, location) VALUES (?,?,?,?,?,?,?,?,?)',
        [sku, name, unit, sale, purchase, vat, stockItem, min, location], conn);
      pid[sku] = { id: res.insertId, name, unit, sale, vat };
      if (stockItem && stock) await moveStock(conn, { product_id: res.insertId, delta: stock + 6, type: 'in', reference: 'Anfangsbestand', user_id: user.id });
    }
    const item = (sku, qty, discount = 0) => ({ product_id: pid[sku].id, description: pid[sku].name, qty, unit: pid[sku].unit,
      unit_price: pid[sku].sale, discount_pct: discount, vat_rate: pid[sku].vat });

    // Eröffnungsbuchung: Kapitaleinlage
    const { postEntry } = await import('./services/ledger.js');
    await postEntry(conn, { date: yearStart, text: 'Kapitaleinlage', user_id: user.id,
      lines: [{ account: '1020', debit: 60000 }, { account: '2800', credit: 60000 }] });

    const invoice = async (customer, days, items, pay) => {
      const id = await docs.createDocument(conn, user, { type: 'invoice', customer_id: customer, date: ago(days), items });
      await docs.issueInvoice(conn, user, id);
      if (pay) {
        const d = await one('SELECT total, date FROM documents WHERE id = ?', [id], conn);
        await docs.addInvoicePayment(conn, user, id, { amount: pay === 'full' ? d.total : Math.round(d.total / 2), date: addDays(d.date, Math.min(days, 12)) });
      }
      return id;
    };
    await invoice(cid[0], 290, [item('HW-1001', 3), item('DL-3001', 6)], 'full');
    await invoice(cid[2], 250, [item('HW-1002', 4), item('ZB-2001', 4)], 'full');
    await invoice(cid[1], 205, [item('HW-1010', 1), item('ZB-2010', 2)], 'full');
    await invoice(cid[4], 160, [item('DL-3002', 5), item('DL-3010', 3)], 'full');
    await invoice(cid[5], 120, [item('HW-1001', 2, 5), item('HW-1003', 2)], 'full');
    await invoice(cid[3], 75, [item('HW-1002', 2), item('ZB-2002', 3)], 'half');
    await invoice(cid[0], 48, [item('DL-3010', 3), item('DL-3002', 2)], null);
    await invoice(cid[2], 20, [item('HW-1001', 1), item('ZB-2001', 1), item('DL-3001', 2)], null);
    await docs.createDocument(conn, user, { type: 'invoice', customer_id: cid[4], date: today(), items: [item('ZB-2010', 4)] });

    const q1 = await docs.createDocument(conn, user, { type: 'quote', customer_id: cid[1], date: ago(9), reference: 'Erneuerung Kassenarbeitsplätze',
      items: [item('HW-1001', 2), item('HW-1002', 2), item('DL-3001', 4)] });
    await docs.setStatus(conn, q1, 'sent');
    await docs.createDocument(conn, user, { type: 'quote', customer_id: cid[5], date: ago(3), items: [item('HW-1010', 1), item('ZB-2010', 3, 10)] });
    const q3 = await docs.createDocument(conn, user, { type: 'quote', customer_id: cid[3], date: ago(15), items: [item('HW-1003', 3), item('DL-3002', 2)] });
    await docs.convertDocument(conn, user, q3, 'order');
    await docs.createDocument(conn, user, { type: 'order', customer_id: cid[0], date: ago(5), reference: 'Zimmer-Arbeitsplätze 2. OG',
      items: [item('HW-1002', 6), item('ZB-2001', 6), item('ZB-2002', 6)] });

    const acc = async (number) => (await one('SELECT id FROM accounts WHERE number = ?', [number], conn)).id;
    const bill = async (supplier, number, days, account, net, description, pay) => {
      const id = await payables.createSupplierInvoice(conn, user, { supplier_id: supplier, number, date: ago(days), expense_account_id: await acc(account),
        net, vat: Math.round(net * 8.1) / 100, description });
      if (pay) {
        const b = await one('SELECT total, date FROM supplier_invoices WHERE id = ?', [id], conn);
        await payables.addSupplierPayment(conn, user, id, { amount: b.total, date: addDays(b.date, Math.min(days, 10)) });
      }
    };
    await bill(sid[1], 'TI-88213', 280, '4200', 3200, 'Wareneinkauf Hardware Q1', true);
    await bill(sid[2], 'M-2026-01', 270, '6000', 1500, 'Miete Büro 1. Quartal', true);
    await bill(sid[2], 'M-2026-02', 180, '6000', 1500, 'Miete Büro 2. Quartal', true);
    await bill(sid[1], 'TI-90455', 130, '4200', 2400, 'Wareneinkauf Hardware Q3', true);
    await bill(sid[0], 'BZ-55102', 60, '6500', 640, 'Büromaterial', true);
    await bill(sid[2], 'M-2026-04', 40, '6000', 1500, 'Miete Büro 4. Quartal', false);
    await bill(sid[1], 'TI-91870', 12, '4200', 1850, 'Wareneinkauf Hardware Q4', false);
  });
  console.log('[seed] Demodaten angelegt');
}
