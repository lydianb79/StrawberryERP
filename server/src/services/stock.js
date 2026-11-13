import { q, one } from '../db.js';
import { HttpError } from '../util.js';

/**
 * Bucht eine Lagerbewegung. delta > 0 = Zugang, delta < 0 = Abgang.
 * Dienstleistungen (is_stock_item = 0) werden ignoriert.
 */
export async function moveStock(conn, { product_id, delta, type, reference = null, note = null, user_id = null, strict = false }) {
  const p = await one('SELECT id, name, stock_qty, is_stock_item FROM products WHERE id = ? FOR UPDATE', [product_id], conn);
  if (!p) throw new HttpError(404, 'Artikel nicht gefunden');
  if (!p.is_stock_item) {
    if (strict) throw new HttpError(400, `«${p.name}» ist kein Lagerartikel.`);
    return null;
  }
  const d = Math.round(Number(delta) * 1000) / 1000;
  if (!d) return null;
  const balance = Math.round((p.stock_qty + d) * 1000) / 1000;
  if (strict && balance < 0) throw new HttpError(400, `Lagerbestand von «${p.name}» reicht nicht aus (verfügbar: ${p.stock_qty}).`);
  await q('UPDATE products SET stock_qty = ? WHERE id = ?', [balance, p.id], conn);
  await q(
    'INSERT INTO stock_movements (product_id, type, qty, balance_after, reference, note, user_id) VALUES (?,?,?,?,?,?,?)',
    [p.id, type, d, balance, reference, note, user_id], conn,
  );
  return balance;
}

/** Bucht alle Lagerpositionen eines Belegs (sign = -1 Abgang, +1 Rücknahme). */
export async function moveDocumentStock(conn, docId, sign, reference, user_id) {
  const items = await q(
    'SELECT product_id, SUM(qty) AS qty FROM document_items WHERE document_id = ? AND product_id IS NOT NULL GROUP BY product_id',
    [docId], conn);
  for (const it of items) {
    await moveStock(conn, {
      product_id: it.product_id, delta: sign * it.qty, type: sign < 0 ? 'out' : 'in',
      reference, note: sign < 0 ? 'Warenausgang' : 'Storno / Rücknahme', user_id,
    });
  }
}
