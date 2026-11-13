import { q, one } from './db.js';

/**
 * Versionierte Schema-Migrationen. schema.sql ist der Stand 1.0 (Version 1);
 * jede spätere Änderung kommt hier als neue Version dazu und wird beim Serverstart
 * automatisch und genau einmal ausgeführt. Bestehende Einträge nie nachträglich ändern.
 */
export const MIGRATIONS = [
  {
    version: 2,
    name: '1.1: Währungen, Kostenstellen, Erlöskonten pro Artikel, Bestellwesen, QR-Rechnung, E-Mail',
    statements: [
      `CREATE TABLE currencies (
         id INT AUTO_INCREMENT PRIMARY KEY,
         code CHAR(3) NOT NULL UNIQUE,
         name VARCHAR(60) NOT NULL,
         rate DECIMAL(14,6) NOT NULL DEFAULT 1,
         active TINYINT(1) NOT NULL DEFAULT 1
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `INSERT IGNORE INTO currencies (code, name, rate) VALUES
         ('CHF', 'Schweizer Franken', 1), ('EUR', 'Euro', 0.95), ('USD', 'US-Dollar', 0.88), ('GBP', 'Britisches Pfund', 1.12)`,
      `CREATE TABLE cost_centers (
         id INT AUTO_INCREMENT PRIMARY KEY,
         code VARCHAR(20) NOT NULL UNIQUE,
         name VARCHAR(120) NOT NULL,
         active TINYINT(1) NOT NULL DEFAULT 1
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `ALTER TABLE customers ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'CHF'`,
      `ALTER TABLE suppliers ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'CHF'`,
      `ALTER TABLE products
         ADD COLUMN revenue_account_id INT NULL,
         ADD COLUMN supplier_id INT NULL,
         ADD CONSTRAINT fk_prod_revacc FOREIGN KEY (revenue_account_id) REFERENCES accounts(id),
         ADD CONSTRAINT fk_prod_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id)`,
      `ALTER TABLE documents
         MODIFY type ENUM('quote','order','invoice','purchase') NOT NULL,
         MODIFY customer_id INT NULL,
         ADD COLUMN supplier_id INT NULL,
         ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'CHF',
         ADD COLUMN exchange_rate DECIMAL(14,6) NOT NULL DEFAULT 1,
         ADD COLUMN cost_center_id INT NULL,
         ADD COLUMN sent_at DATETIME NULL,
         ADD COLUMN payment_reference VARCHAR(40) NULL,
         ADD CONSTRAINT fk_doc_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
         ADD CONSTRAINT fk_doc_cc FOREIGN KEY (cost_center_id) REFERENCES cost_centers(id)`,
      `ALTER TABLE document_items ADD COLUMN qty_received DECIMAL(14,3) NOT NULL DEFAULT 0`,
      `ALTER TABLE supplier_invoices
         ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'CHF',
         ADD COLUMN exchange_rate DECIMAL(14,6) NOT NULL DEFAULT 1,
         ADD COLUMN cost_center_id INT NULL,
         ADD COLUMN purchase_order_id INT NULL,
         ADD CONSTRAINT fk_si_cc FOREIGN KEY (cost_center_id) REFERENCES cost_centers(id),
         ADD CONSTRAINT fk_si_po FOREIGN KEY (purchase_order_id) REFERENCES documents(id)`,
      `ALTER TABLE payments ADD COLUMN exchange_rate DECIMAL(14,6) NOT NULL DEFAULT 1`,
      `ALTER TABLE journal_lines
         ADD COLUMN cost_center_id INT NULL,
         ADD CONSTRAINT fk_jl_cc FOREIGN KEY (cost_center_id) REFERENCES cost_centers(id)`,
      `INSERT IGNORE INTO accounts (number, name, type) VALUES
         ('6940', 'Kursverluste (Währungsdifferenzen)', 'expense'), ('6990', 'Kursgewinne (Währungsdifferenzen)', 'revenue')`,
      // Neue Berechtigungen für die vordefinierten Rollen
      `INSERT IGNORE INTO role_permissions (role_id, permission)
         SELECT id, 'purchasing.read' FROM roles WHERE name IN ('Buchhaltung', 'Lager', 'Nur Lesen')`,
      `INSERT IGNORE INTO role_permissions (role_id, permission)
         SELECT id, 'purchasing.write' FROM roles WHERE name IN ('Lager')`,
    ],
  },
  {
    version: 3,
    name: '1.2: Mahnwesen, Gutschriften, Teillieferung, Abo-Rechnungen, Zahlungsabgleich, Storno statt Löschen, 2FA, Belegablage, Preislisten, Sprachen',
    statements: [
      `ALTER TABLE documents
         MODIFY type ENUM('quote','order','invoice','purchase','credit') NOT NULL,
         ADD COLUMN dunning_level TINYINT NOT NULL DEFAULT 0,
         ADD COLUMN dunning_date DATE NULL,
         ADD COLUMN dunning_fees DECIMAL(14,2) NOT NULL DEFAULT 0,
         ADD COLUMN language CHAR(2) NOT NULL DEFAULT 'de'`,
      `ALTER TABLE document_items
         ADD COLUMN qty_delivered DECIMAL(14,3) NOT NULL DEFAULT 0,
         ADD COLUMN qty_invoiced DECIMAL(14,3) NOT NULL DEFAULT 0,
         ADD COLUMN source_item_id INT NULL`,
      // Bestehende Aufträge: bisher galt «ganz oder gar nicht»
      `UPDATE document_items i JOIN documents d ON d.id = i.document_id
          SET i.qty_delivered = i.qty WHERE d.type = 'order' AND d.status IN ('delivered', 'invoiced') AND i.qty_delivered = 0`,
      `UPDATE document_items i JOIN documents d ON d.id = i.document_id
          SET i.qty_invoiced = i.qty WHERE d.type = 'order' AND d.status = 'invoiced' AND i.qty_invoiced = 0`,
      `CREATE TABLE dunning_notices (
         id INT AUTO_INCREMENT PRIMARY KEY,
         document_id INT NOT NULL,
         level TINYINT NOT NULL,
         date DATE NOT NULL,
         due_date DATE NOT NULL,
         fee DECIMAL(14,2) NOT NULL DEFAULT 0,
         open_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
         sent_at DATETIME NULL,
         created_by INT NULL,
         created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
         KEY idx_dn_doc (document_id),
         CONSTRAINT fk_dn_doc FOREIGN KEY (document_id) REFERENCES documents(id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `ALTER TABLE payments
         MODIFY account_id INT NULL,
         ADD COLUMN reversed_at DATETIME NULL,
         ADD COLUMN bank_ref VARCHAR(80) NULL,
         ADD COLUMN credit_note_id INT NULL,
         ADD KEY idx_pay_bankref (bank_ref)`,
      `ALTER TABLE journal_entries ADD COLUMN reversed_by INT NULL`,
      `CREATE TABLE recurring_invoices (
         id INT AUTO_INCREMENT PRIMARY KEY,
         name VARCHAR(160) NOT NULL,
         customer_id INT NOT NULL,
         period ENUM('monthly','quarterly','halfyearly','yearly') NOT NULL DEFAULT 'monthly',
         next_date DATE NOT NULL,
         end_date DATE NULL,
         auto_issue TINYINT(1) NOT NULL DEFAULT 0,
         active TINYINT(1) NOT NULL DEFAULT 1,
         template LONGTEXT NOT NULL,
         last_document_id INT NULL,
         last_run DATE NULL,
         created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
         CONSTRAINT fk_ri_customer FOREIGN KEY (customer_id) REFERENCES customers(id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `ALTER TABLE users
         ADD COLUMN token_version INT NOT NULL DEFAULT 0,
         ADD COLUMN totp_secret VARCHAR(64) NULL,
         ADD COLUMN totp_enabled TINYINT(1) NOT NULL DEFAULT 0,
         ADD COLUMN reset_token_hash CHAR(64) NULL,
         ADD COLUMN reset_expires DATETIME NULL`,
      `CREATE TABLE attachments (
         id INT AUTO_INCREMENT PRIMARY KEY,
         entity VARCHAR(30) NOT NULL,
         entity_id INT NOT NULL,
         filename VARCHAR(190) NOT NULL,
         mime VARCHAR(80) NOT NULL,
         size INT NOT NULL,
         data LONGBLOB NOT NULL,
         uploaded_by INT NULL,
         created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
         KEY idx_att_entity (entity, entity_id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `ALTER TABLE customers
         ADD COLUMN discount_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
         ADD COLUMN language CHAR(2) NOT NULL DEFAULT 'de'`,
      `ALTER TABLE suppliers ADD COLUMN language CHAR(2) NOT NULL DEFAULT 'de'`,
      `CREATE TABLE product_prices (
         id INT AUTO_INCREMENT PRIMARY KEY,
         product_id INT NOT NULL,
         customer_id INT NULL,
         min_qty DECIMAL(14,3) NOT NULL DEFAULT 1,
         price DECIMAL(14,2) NOT NULL,
         KEY idx_pp_product (product_id),
         CONSTRAINT fk_pp_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
         CONSTRAINT fk_pp_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `INSERT IGNORE INTO accounts (number, name, type) VALUES
         ('3890', 'Mahngebühren und übrige Erlöse', 'revenue'), ('4800', 'Bestandesänderungen Handelswaren', 'expense')`,
      `INSERT IGNORE INTO role_permissions (role_id, permission) SELECT id, 'banking.import' FROM roles WHERE name IN ('Buchhaltung')`,
    ],
  },
  {
    version: 4,
    name: '1.3: Projekte/Zeiterfassung, Lagerorte/Chargen/Inventur, Kontakte, Bankabstimmung, Lohn, Zahlungsdateien, Verzugszins, Kurshistorie',
    statements: [
      `CREATE TABLE user_recovery_codes (
         id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, code_hash CHAR(64) NOT NULL, used_at DATETIME NULL,
         KEY idx_urc_user (user_id), CONSTRAINT fk_urc_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `ALTER TABLE supplier_invoices ADD COLUMN payment_exported_at DATETIME NULL`,
      `ALTER TABLE dunning_notices ADD COLUMN interest DECIMAL(14,2) NOT NULL DEFAULT 0`,
      // Projekte und Zeiterfassung
      `CREATE TABLE projects (
         id INT AUTO_INCREMENT PRIMARY KEY, number VARCHAR(30) NOT NULL UNIQUE, name VARCHAR(190) NOT NULL, customer_id INT NULL,
         status ENUM('open','closed') NOT NULL DEFAULT 'open', hourly_rate DECIMAL(14,2) NOT NULL DEFAULT 0, budget_hours DECIMAL(10,2) NULL,
         cost_center_id INT NULL, notes TEXT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
         CONSTRAINT fk_prj_customer FOREIGN KEY (customer_id) REFERENCES customers(id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE time_entries (
         id INT AUTO_INCREMENT PRIMARY KEY, project_id INT NOT NULL, user_id INT NOT NULL, date DATE NOT NULL, hours DECIMAL(8,2) NOT NULL,
         description VARCHAR(500) NULL, billable TINYINT(1) NOT NULL DEFAULT 1, rate DECIMAL(14,2) NOT NULL DEFAULT 0,
         invoiced_document_id INT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
         KEY idx_te_project (project_id, date), KEY idx_te_user (user_id, date),
         CONSTRAINT fk_te_project FOREIGN KEY (project_id) REFERENCES projects(id),
         CONSTRAINT fk_te_user FOREIGN KEY (user_id) REFERENCES users(id),
         CONSTRAINT fk_te_doc FOREIGN KEY (invoiced_document_id) REFERENCES documents(id) ON DELETE SET NULL
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      // Lager: Lagerorte, Chargen/Seriennummern, Durchschnittspreis, Inventur
      `CREATE TABLE warehouses (
         id INT AUTO_INCREMENT PRIMARY KEY, code VARCHAR(20) NOT NULL UNIQUE, name VARCHAR(120) NOT NULL, active TINYINT(1) NOT NULL DEFAULT 1
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `INSERT IGNORE INTO warehouses (id, code, name) VALUES (1, 'HL', 'Hauptlager')`,
      `CREATE TABLE product_stock (
         product_id INT NOT NULL, warehouse_id INT NOT NULL, qty DECIMAL(14,3) NOT NULL DEFAULT 0, PRIMARY KEY (product_id, warehouse_id),
         CONSTRAINT fk_ps_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
         CONSTRAINT fk_ps_wh FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `INSERT IGNORE INTO product_stock (product_id, warehouse_id, qty) SELECT id, 1, stock_qty FROM products WHERE is_stock_item = 1`,
      `ALTER TABLE stock_movements
         MODIFY type ENUM('in','out','adjust','transfer') NOT NULL,
         ADD COLUMN warehouse_id INT NOT NULL DEFAULT 1, ADD COLUMN batch VARCHAR(60) NULL, ADD COLUMN unit_cost DECIMAL(14,4) NULL`,
      `ALTER TABLE products
         ADD COLUMN tracking ENUM('none','batch','serial') NOT NULL DEFAULT 'none', ADD COLUMN avg_cost DECIMAL(14,4) NOT NULL DEFAULT 0`,
      `UPDATE products SET avg_cost = purchase_price WHERE avg_cost = 0`,
      `CREATE TABLE product_batches (
         id INT AUTO_INCREMENT PRIMARY KEY, product_id INT NOT NULL, warehouse_id INT NOT NULL, batch VARCHAR(60) NOT NULL,
         qty DECIMAL(14,3) NOT NULL DEFAULT 0, expiry DATE NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
         UNIQUE KEY uq_pb (product_id, warehouse_id, batch),
         CONSTRAINT fk_pb_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
         CONSTRAINT fk_pb_wh FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE stocktakes (
         id INT AUTO_INCREMENT PRIMARY KEY, number VARCHAR(30) NOT NULL, warehouse_id INT NOT NULL, date DATE NOT NULL,
         status ENUM('open','posted') NOT NULL DEFAULT 'open', note VARCHAR(255) NULL, created_by INT NULL, posted_at DATETIME NULL,
         CONSTRAINT fk_st_wh FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE stocktake_items (
         id INT AUTO_INCREMENT PRIMARY KEY, stocktake_id INT NOT NULL, product_id INT NOT NULL,
         expected_qty DECIMAL(14,3) NOT NULL DEFAULT 0, counted_qty DECIMAL(14,3) NULL,
         UNIQUE KEY uq_sti (stocktake_id, product_id),
         CONSTRAINT fk_sti_st FOREIGN KEY (stocktake_id) REFERENCES stocktakes(id) ON DELETE CASCADE,
         CONSTRAINT fk_sti_product FOREIGN KEY (product_id) REFERENCES products(id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      // Kontakte, Notizen und Aufgaben
      `CREATE TABLE contacts (
         id INT AUTO_INCREMENT PRIMARY KEY, customer_id INT NULL, supplier_id INT NULL, name VARCHAR(160) NOT NULL, role VARCHAR(120) NULL,
         email VARCHAR(190) NULL, phone VARCHAR(60) NULL, mobile VARCHAR(60) NULL, is_primary TINYINT(1) NOT NULL DEFAULT 0, notes TEXT NULL,
         CONSTRAINT fk_ct_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
         CONSTRAINT fk_ct_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE crm_items (
         id INT AUTO_INCREMENT PRIMARY KEY, customer_id INT NULL, document_id INT NULL, kind ENUM('note','task') NOT NULL DEFAULT 'note',
         text TEXT NOT NULL, due_date DATE NULL, done_at DATETIME NULL, assigned_to INT NULL, created_by INT NULL,
         created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
         KEY idx_crm_customer (customer_id), KEY idx_crm_doc (document_id), KEY idx_crm_assigned (assigned_to, done_at),
         CONSTRAINT fk_crm_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
         CONSTRAINT fk_crm_doc FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      // Bankabstimmung
      `ALTER TABLE journal_lines ADD COLUMN reconciled_at DATETIME NULL`,
      `CREATE TABLE bank_reconciliations (
         id INT AUTO_INCREMENT PRIMARY KEY, account_id INT NOT NULL, date DATE NOT NULL, statement_balance DECIMAL(14,2) NOT NULL,
         book_balance DECIMAL(14,2) NOT NULL, open_items DECIMAL(14,2) NOT NULL DEFAULT 0, note VARCHAR(255) NULL, created_by INT NULL,
         created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
         CONSTRAINT fk_br_account FOREIGN KEY (account_id) REFERENCES accounts(id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      // Lohn
      `CREATE TABLE employees (
         id INT AUTO_INCREMENT PRIMARY KEY, number VARCHAR(30) NOT NULL UNIQUE, name VARCHAR(160) NOT NULL, street VARCHAR(190) NULL,
         zip VARCHAR(20) NULL, city VARCHAR(120) NULL, ahv_no VARCHAR(20) NULL, birth_date DATE NULL, entry_date DATE NULL, exit_date DATE NULL,
         monthly_gross DECIMAL(14,2) NOT NULL DEFAULT 0, bvg_employee DECIMAL(14,2) NOT NULL DEFAULT 0, bvg_employer DECIMAL(14,2) NOT NULL DEFAULT 0,
         iban VARCHAR(40) NULL, cost_center_id INT NULL, active TINYINT(1) NOT NULL DEFAULT 1
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE payroll_runs (
         id INT AUTO_INCREMENT PRIMARY KEY, period CHAR(7) NOT NULL UNIQUE, date DATE NOT NULL,
         status ENUM('draft','posted','paid') NOT NULL DEFAULT 'draft', created_by INT NULL, posted_at DATETIME NULL, paid_at DATETIME NULL
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE payslips (
         id INT AUTO_INCREMENT PRIMARY KEY, run_id INT NOT NULL, employee_id INT NOT NULL, base DECIMAL(14,2) NOT NULL DEFAULT 0,
         bonus DECIMAL(14,2) NOT NULL DEFAULT 0, expenses DECIMAL(14,2) NOT NULL DEFAULT 0, gross DECIMAL(14,2) NOT NULL DEFAULT 0,
         deductions TEXT NOT NULL, employer TEXT NOT NULL, deduction_total DECIMAL(14,2) NOT NULL DEFAULT 0,
         employer_total DECIMAL(14,2) NOT NULL DEFAULT 0, net DECIMAL(14,2) NOT NULL DEFAULT 0,
         UNIQUE KEY uq_ps (run_id, employee_id),
         CONSTRAINT fk_psl_run FOREIGN KEY (run_id) REFERENCES payroll_runs(id) ON DELETE CASCADE,
         CONSTRAINT fk_psl_emp FOREIGN KEY (employee_id) REFERENCES employees(id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `INSERT IGNORE INTO accounts (number, name, type) VALUES
         ('2270', 'Verbindlichkeiten Sozialversicherungen', 'liability'), ('2275', 'Geschuldete Löhne', 'liability')`,
      // Kurshistorie
      `CREATE TABLE currency_rates (
         id INT AUTO_INCREMENT PRIMARY KEY, code CHAR(3) NOT NULL, date DATE NOT NULL, rate DECIMAL(14,6) NOT NULL, source VARCHAR(40) NULL,
         UNIQUE KEY uq_cr (code, date)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `INSERT IGNORE INTO currency_rates (code, date, rate, source) SELECT code, CURDATE(), rate, 'Übernahme' FROM currencies WHERE rate <> 1`,
      `INSERT IGNORE INTO role_permissions (role_id, permission)
         SELECT r.id, x.p FROM roles r JOIN (SELECT 'projects.read' AS p UNION SELECT 'projects.write' UNION SELECT 'time.write') x
          WHERE r.name IN ('Verkauf', 'Buchhaltung')`,
      `INSERT IGNORE INTO role_permissions (role_id, permission) SELECT id, 'projects.read' FROM roles WHERE name = 'Nur Lesen'`,
    ],
  },
  {
    version: 5,
    name: '1.4: 13. Monatslohn, Lohnausweis',
    statements: [
      `ALTER TABLE employees
         ADD COLUMN thirteenth ENUM('none','december','half') NOT NULL DEFAULT 'none',
         ADD COLUMN free_transport TINYINT(1) NOT NULL DEFAULT 0,
         ADD COLUMN canteen TINYINT(1) NOT NULL DEFAULT 0,
         ADD COLUMN certificate_remarks VARCHAR(500) NULL`,
      `ALTER TABLE payslips ADD COLUMN thirteenth DECIMAL(14,2) NOT NULL DEFAULT 0`,
    ],
  },
  {
    version: 6,
    name: '1.5: zusätzliche vordefinierte Rollen',
    statements: [],
    // Neue Rollen nur anlegen, wenn es noch keine mit diesem Namen gibt – bestehende, angepasste Rollen bleiben unberührt.
    run: async () => {
      for (const role of EXTRA_ROLES) {
        if (await one('SELECT id FROM roles WHERE name = ?', [role.name])) continue;
        const res = await q('INSERT INTO roles (name, description) VALUES (?, ?)', [role.name, role.description]);
        await q('INSERT INTO role_permissions (role_id, permission) VALUES ?', [role.permissions.map((p) => [res.insertId, p])]);
      }
      // Beschreibungen der bisherigen Standardrollen präzisieren, sofern sie nicht geändert wurden
      for (const [name, before, after] of ROLE_TEXTS) await q('UPDATE roles SET description = ? WHERE name = ? AND description = ?', [after, name, before]);
    },
  },
];

const ROLE_TEXTS = [
  ['Buchhaltung', 'Rechnungen, Debitoren/Kreditoren, Buchhaltung, Abschluss', 'Ganze Finanzseite: Rechnungen, Debitoren, Kreditoren, Buchhaltung, Jahresabschluss, Auswertungen – ohne Lohn'],
  ['Verkauf', 'Kunden, Offerten, Aufträge, Rechnungen', 'Sachbearbeitung Verkauf: Kunden, Offerten, Aufträge, Rechnungen, Projekte – ohne Zahlungen und Buchhaltung'],
  ['Lager', 'Artikel und Lagerbewegungen', 'Artikel, Lagerbewegungen, Inventur und Wareneingänge aus Bestellungen'],
  ['Nur Lesen', 'Lesezugriff auf alle Bereiche', 'Alles ansehen, nichts ändern – ohne Lohn und Administration'],
];

export const EXTRA_ROLES = [
  { name: 'Geschäftsleitung', description: 'Sieht alles inklusive Lohn und Auswertungen, ändert aber nichts – für Inhaber und Geschäftsführung',
    permissions: ['customers.read', 'suppliers.read', 'quotes.read', 'orders.read', 'invoices.read', 'receivables.read', 'inventory.read', 'purchasing.read',
      'payables.read', 'projects.read', 'accounting.read', 'payroll.read', 'reports.read'] },
  { name: 'Verkaufsleitung', description: 'Verkauf mit Auswertungen, Mahnwesen und Projektabrechnung',
    permissions: ['customers.write', 'quotes.write', 'orders.write', 'invoices.write', 'receivables.write', 'inventory.read', 'projects.write', 'reports.read'] },
  { name: 'Einkauf', description: 'Lieferanten, Bestellungen und Wareneingang; sieht Lager und Kreditoren',
    permissions: ['suppliers.write', 'purchasing.write', 'inventory.read', 'payables.read'] },
  { name: 'Debitorenbuchhaltung', description: 'Zahlungseingänge, Mahnwesen und Zahlungsabgleich; sieht Kunden und Rechnungen',
    permissions: ['customers.read', 'invoices.read', 'receivables.write', 'banking.import', 'reports.read'] },
  { name: 'Kreditorenbuchhaltung', description: 'Lieferantenrechnungen, Zahlungen und Zahlungsdateien; pflegt Lieferanten',
    permissions: ['suppliers.write', 'payables.write', 'purchasing.read'] },
  { name: 'Personal', description: 'Lohnabrechnung: Mitarbeitende, Lohnläufe, Lohnausweise – sonst nichts',
    permissions: ['payroll.write'] },
  { name: 'Projektleitung', description: 'Projekte führen, Zeiten aller Personen sehen und offene Stunden verrechnen',
    permissions: ['customers.read', 'projects.write', 'quotes.read', 'invoices.write'] },
  { name: 'Zeiterfassung', description: 'Nur eigene Arbeitszeit auf Projekte buchen – für Mitarbeitende ohne weitere Aufgaben im System',
    permissions: ['time.write'] },
  { name: 'Treuhand', description: 'Externer Lesezugriff auf Buchhaltung, offene Posten, Rechnungen und Auswertungen inklusive Journal-Export',
    permissions: ['accounting.read', 'invoices.read', 'receivables.read', 'payables.read', 'reports.read'] },
];

export const SCHEMA_VERSION = MIGRATIONS.at(-1)?.version ?? 1;

// Fehler, die bedeuten «wurde bereits angewendet» – erlauben das Wiederaufsetzen nach einem Abbruch.
const ALREADY_APPLIED = new Set(['ER_DUP_FIELDNAME', 'ER_TABLE_EXISTS_ERROR', 'ER_DUP_KEYNAME', 'ER_FK_DUP_NAME', 'ER_CANT_DROP_FIELD_OR_KEY']);

export async function runMigrations() {
  await q(`CREATE TABLE IF NOT EXISTS schema_migrations (
             version INT PRIMARY KEY, name VARCHAR(255) NOT NULL, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
           ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await q("INSERT IGNORE INTO schema_migrations (version, name) VALUES (1, '1.0: Grundschema')");
  const current = (await one('SELECT MAX(version) AS v FROM schema_migrations')).v;
  for (const m of MIGRATIONS.filter((x) => x.version > current)) {
    console.log(`[migration] Version ${m.version}: ${m.name}`);
    for (const sql of m.statements) {
      try {
        await q(sql);
      } catch (err) {
        if (!ALREADY_APPLIED.has(err.code)) {
          console.error(`[migration] Fehler in Version ${m.version}: ${err.message}\n${sql}`);
          throw err;
        }
      }
    }
    if (m.run) await m.run();
    await q('INSERT INTO schema_migrations (version, name) VALUES (?, ?)', [m.version, m.name]);
  }
  return (await one('SELECT MAX(version) AS v FROM schema_migrations')).v;
}
