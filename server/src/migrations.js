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
    await q('INSERT INTO schema_migrations (version, name) VALUES (?, ?)', [m.version, m.name]);
  }
  return (await one('SELECT MAX(version) AS v FROM schema_migrations')).v;
}
