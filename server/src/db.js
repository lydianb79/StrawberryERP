import mysql from 'mysql2/promise';

const config = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'strawberry',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'strawberryerp',
  charset: 'utf8mb4',
  decimalNumbers: true,
  dateStrings: true,
  connectionLimit: 10,
};

export const pool = mysql.createPool(config);

/** Führt eine Abfrage aus und liefert die Zeilen (oder das Result-Objekt bei Schreibzugriffen). */
export const q = async (sql, params = [], conn = pool) => (await conn.query(sql, params))[0];

export const one = async (sql, params = [], conn = pool) => (await q(sql, params, conn))[0] || null;

/** Führt fn in einer Transaktion aus. */
export async function tx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** Wartet beim Start, bis die Datenbank erreichbar ist. */
export async function waitForDb(retries = 40, delayMs = 3000) {
  for (let i = 1; i <= retries; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (i === retries) throw err;
      console.log(`[db] Datenbank noch nicht erreichbar (${err.code || err.message}) – Versuch ${i}/${retries}`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

/** Führt ein SQL-Skript mit mehreren Statements aus. */
export async function runScript(sql) {
  const conn = await mysql.createConnection({ ...config, multipleStatements: true });
  try {
    await conn.query(sql);
  } finally {
    await conn.end();
  }
}
