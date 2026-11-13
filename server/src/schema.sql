-- StrawberryERP – Datenbankschema (MySQL 8 / MariaDB 10.6+)
-- Wird beim Serverstart idempotent ausgeführt.

CREATE TABLE IF NOT EXISTS roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  description VARCHAR(255) NULL,
  is_system TINYINT(1) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INT NOT NULL,
  permission VARCHAR(60) NOT NULL,
  PRIMARY KEY (role_id, permission),
  CONSTRAINT fk_rp_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(190) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  role_id INT NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  last_login DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_role FOREIGN KEY (role_id) REFERENCES roles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS settings (
  `key` VARCHAR(60) PRIMARY KEY,
  value LONGTEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS counters (
  name VARCHAR(40) NOT NULL,
  year INT NOT NULL DEFAULT 0,
  value INT NOT NULL DEFAULT 0,
  PRIMARY KEY (name, year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS customers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  number VARCHAR(30) NOT NULL UNIQUE,
  company VARCHAR(190) NOT NULL,
  contact_name VARCHAR(120) NULL,
  email VARCHAR(190) NULL,
  phone VARCHAR(60) NULL,
  street VARCHAR(190) NULL,
  zip VARCHAR(20) NULL,
  city VARCHAR(120) NULL,
  country VARCHAR(80) NULL DEFAULT 'Schweiz',
  vat_no VARCHAR(40) NULL,
  payment_terms_days INT NOT NULL DEFAULT 30,
  notes TEXT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS suppliers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  number VARCHAR(30) NOT NULL UNIQUE,
  company VARCHAR(190) NOT NULL,
  contact_name VARCHAR(120) NULL,
  email VARCHAR(190) NULL,
  phone VARCHAR(60) NULL,
  street VARCHAR(190) NULL,
  zip VARCHAR(20) NULL,
  city VARCHAR(120) NULL,
  country VARCHAR(80) NULL DEFAULT 'Schweiz',
  vat_no VARCHAR(40) NULL,
  iban VARCHAR(40) NULL,
  payment_terms_days INT NOT NULL DEFAULT 30,
  notes TEXT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sku VARCHAR(60) NOT NULL UNIQUE,
  name VARCHAR(190) NOT NULL,
  description TEXT NULL,
  unit VARCHAR(20) NOT NULL DEFAULT 'Stk',
  sale_price DECIMAL(14,2) NOT NULL DEFAULT 0,
  purchase_price DECIMAL(14,2) NOT NULL DEFAULT 0,
  vat_rate DECIMAL(5,2) NOT NULL DEFAULT 8.10,
  is_stock_item TINYINT(1) NOT NULL DEFAULT 1,
  stock_qty DECIMAL(14,3) NOT NULL DEFAULT 0,
  min_stock DECIMAL(14,3) NOT NULL DEFAULT 0,
  location VARCHAR(80) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS stock_movements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  type ENUM('in','out','adjust') NOT NULL,
  qty DECIMAL(14,3) NOT NULL,
  balance_after DECIMAL(14,3) NOT NULL,
  reference VARCHAR(120) NULL,
  note VARCHAR(255) NULL,
  user_id INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sm_product (product_id, created_at),
  CONSTRAINT fk_sm_product FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fiscal_years (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(40) NOT NULL UNIQUE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status ENUM('open','closed') NOT NULL DEFAULT 'open',
  closed_at DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS accounts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  number VARCHAR(10) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  type ENUM('asset','liability','equity','revenue','expense') NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS journal_entries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  fiscal_year_id INT NOT NULL,
  date DATE NOT NULL,
  text VARCHAR(255) NOT NULL,
  ref_type VARCHAR(30) NOT NULL DEFAULT 'manual',
  ref_id INT NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_je_ref (ref_type, ref_id),
  KEY idx_je_year (fiscal_year_id, date),
  CONSTRAINT fk_je_year FOREIGN KEY (fiscal_year_id) REFERENCES fiscal_years(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS journal_lines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  entry_id INT NOT NULL,
  account_id INT NOT NULL,
  debit DECIMAL(14,2) NOT NULL DEFAULT 0,
  credit DECIMAL(14,2) NOT NULL DEFAULT 0,
  KEY idx_jl_account (account_id),
  CONSTRAINT fk_jl_entry FOREIGN KEY (entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE,
  CONSTRAINT fk_jl_account FOREIGN KEY (account_id) REFERENCES accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Offerten, Aufträge und Rechnungen teilen sich eine Tabelle (type).
CREATE TABLE IF NOT EXISTS documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  type ENUM('quote','order','invoice') NOT NULL,
  number VARCHAR(30) NULL,
  customer_id INT NOT NULL,
  date DATE NOT NULL,
  due_date DATE NULL,
  valid_until DATE NULL,
  status VARCHAR(20) NOT NULL,
  reference VARCHAR(190) NULL,
  intro_text TEXT NULL,
  footer_text TEXT NULL,
  subtotal DECIMAL(14,2) NOT NULL DEFAULT 0,
  vat_total DECIMAL(14,2) NOT NULL DEFAULT 0,
  total DECIMAL(14,2) NOT NULL DEFAULT 0,
  paid_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  source_id INT NULL,
  -- 0 = kein Lagerabgang, 1 = durch diesen Beleg gebucht, 2 = durch Vorgängerbeleg gebucht
  stock_booked TINYINT NOT NULL DEFAULT 0,
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_doc_number (type, number),
  KEY idx_doc_type (type, date),
  KEY idx_doc_customer (customer_id),
  CONSTRAINT fk_doc_customer FOREIGN KEY (customer_id) REFERENCES customers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS document_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  document_id INT NOT NULL,
  position INT NOT NULL,
  product_id INT NULL,
  sku VARCHAR(60) NULL,
  description TEXT NOT NULL,
  qty DECIMAL(14,3) NOT NULL DEFAULT 1,
  unit VARCHAR(20) NULL,
  unit_price DECIMAL(14,2) NOT NULL DEFAULT 0,
  discount_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
  vat_rate DECIMAL(5,2) NOT NULL DEFAULT 0,
  line_total DECIMAL(14,2) NOT NULL DEFAULT 0,
  KEY idx_di_doc (document_id, position),
  CONSTRAINT fk_di_doc FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  CONSTRAINT fk_di_product FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS supplier_invoices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  supplier_id INT NOT NULL,
  number VARCHAR(60) NOT NULL,
  date DATE NOT NULL,
  due_date DATE NOT NULL,
  description VARCHAR(255) NULL,
  expense_account_id INT NOT NULL,
  net DECIMAL(14,2) NOT NULL DEFAULT 0,
  vat DECIMAL(14,2) NOT NULL DEFAULT 0,
  total DECIMAL(14,2) NOT NULL DEFAULT 0,
  paid_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_si_supplier (supplier_id),
  CONSTRAINT fk_si_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_si_account FOREIGN KEY (expense_account_id) REFERENCES accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  kind ENUM('receivable','payable') NOT NULL,
  document_id INT NULL,
  supplier_invoice_id INT NULL,
  date DATE NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  account_id INT NOT NULL,
  note VARCHAR(255) NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_pay_doc (document_id),
  KEY idx_pay_si (supplier_invoice_id),
  CONSTRAINT fk_pay_doc FOREIGN KEY (document_id) REFERENCES documents(id),
  CONSTRAINT fk_pay_si FOREIGN KEY (supplier_invoice_id) REFERENCES supplier_invoices(id),
  CONSTRAINT fk_pay_account FOREIGN KEY (account_id) REFERENCES accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS audit_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  user_name VARCHAR(120) NULL,
  action VARCHAR(40) NOT NULL,
  entity VARCHAR(40) NULL,
  entity_id VARCHAR(40) NULL,
  details VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
