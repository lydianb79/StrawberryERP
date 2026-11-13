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
