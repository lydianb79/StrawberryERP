import { q, one } from '../db.js';
import { HttpError } from '../util.js';

const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

/** Standard-Lagerort: der erste aktive (bei der Installation «Hauptlager»). */
export async function defaultWarehouse(conn) {
  const w = await one('SELECT id FROM warehouses WHERE active = 1 ORDER BY id LIMIT 1', [], conn);
  if (!w) throw new HttpError(400, 'Es ist kein aktiver Lagerort vorhanden.');
  return w.id;
}

/** SQL-Ausdruck für den Wert einer Einheit gemäss Bewertungsmethode (letzter Einstandspreis oder gleitender Durchschnitt). */
export const unitValueSql = (method, alias = '') => (method === 'average' ? `${alias}avg_cost` : `${alias}purchase_price`);

/**
 * Bucht eine Lagerbewegung. delta > 0 = Zugang, delta < 0 = Abgang. Dienstleistungen (is_stock_item = 0) werden ignoriert.
 * - warehouse_id: Lagerort (Standard: Hauptlager)
 * - unit_cost: Einstandspreis des Zugangs in Basiswährung → führt den gleitenden Durchschnittspreis nach
 * - batch: Charge oder Seriennummer. Bei chargengeführten Artikeln werden Abgänge ohne Angabe nach FIFO den ältesten Chargen entnommen.
 */
export async function moveStock(conn, { product_id, delta, type, reference = null, note = null, user_id = null, strict = false,
  warehouse_id = null, batch = null, unit_cost = null, expiry = null }) {
  const p = await one('SELECT id, name, stock_qty, is_stock_item, tracking, avg_cost FROM products WHERE id = ? FOR UPDATE', [product_id], conn);
  if (!p) throw new HttpError(404, 'Artikel nicht gefunden');
  if (!p.is_stock_item) {
    if (strict) throw new HttpError(400, `«${p.name}» ist kein Lagerartikel.`);
    return null;
  }
  const d = r3(delta);
  if (!d) return null;
  const wh = warehouse_id ? Number(warehouse_id) : await defaultWarehouse(conn);
  await q('INSERT IGNORE INTO product_stock (product_id, warehouse_id, qty) VALUES (?, ?, 0)', [p.id, wh], conn);
  const ps = await one('SELECT qty FROM product_stock WHERE product_id = ? AND warehouse_id = ? FOR UPDATE', [p.id, wh], conn);
  const whBalance = r3(ps.qty + d);
  if (strict && whBalance < 0) throw new HttpError(400, `Lagerbestand von «${p.name}» reicht nicht aus (verfügbar an diesem Lagerort: ${ps.qty}).`);
  const total = r3(p.stock_qty + d);

  const cost = Number(unit_cost) > 0 ? Number(unit_cost) : null;
  if (d > 0 && cost) {
    // Gleitender Durchschnitt: (alter Bestand × alter Schnitt + Zugang × Einstandspreis) / neuer Bestand
    const avg = p.stock_qty > 0 ? (p.stock_qty * p.avg_cost + d * cost) / (p.stock_qty + d) : cost;
    await q('UPDATE products SET avg_cost = ? WHERE id = ?', [Math.round(avg * 10000) / 10000, p.id], conn);
  }
  await q('UPDATE products SET stock_qty = ? WHERE id = ?', [total, p.id], conn);
  await q('UPDATE product_stock SET qty = ? WHERE product_id = ? AND warehouse_id = ?', [whBalance, p.id, wh], conn);

  // Chargen / Seriennummern
  const name = batch ? String(batch).trim().slice(0, 60) : null;
  let parts = [{ batch: name, qty: d }];
  if (p.tracking !== 'none') {
    if (d > 0) {
      if (strict && !name) throw new HttpError(400, `«${p.name}» ist chargengeführt – bitte Charge bzw. Seriennummer angeben.`);
      if (name) {
        await q(`INSERT INTO product_batches (product_id, warehouse_id, batch, qty, expiry) VALUES (?,?,?,?,?)
                 ON DUPLICATE KEY UPDATE qty = qty + VALUES(qty), expiry = COALESCE(VALUES(expiry), expiry)`, [p.id, wh, name, d, expiry || null], conn);
      }
    } else if (name) {
      const b = await one('SELECT id, qty FROM product_batches WHERE product_id = ? AND warehouse_id = ? AND batch = ? FOR UPDATE', [p.id, wh, name], conn);
      if (!b || (strict && b.qty + d < -0.0005)) throw new HttpError(400, `Charge «${name}» von «${p.name}» hat nicht genügend Bestand (${b?.qty ?? 0}).`);
      await q('UPDATE product_batches SET qty = qty + ? WHERE id = ?', [d, b.id], conn);
    } else {
      // FIFO: älteste Chargen zuerst
      let rest = -d;
      parts = [];
      const rows = await q('SELECT id, batch, qty FROM product_batches WHERE product_id = ? AND warehouse_id = ? AND qty > 0 ORDER BY id FOR UPDATE', [p.id, wh], conn);
      for (const b of rows) {
        if (rest <= 0.0005) break;
        const take = Math.min(rest, b.qty);
        await q('UPDATE product_batches SET qty = qty - ? WHERE id = ?', [take, b.id], conn);
        parts.push({ batch: b.batch, qty: -r3(take) });
        rest = r3(rest - take);
      }
      if (rest > 0.0005) parts.push({ batch: null, qty: -rest });
    }
  }
  let running = p.stock_qty;
  for (const part of parts) {
    running = r3(running + part.qty);
    await q(
      'INSERT INTO stock_movements (product_id, warehouse_id, type, qty, balance_after, reference, note, batch, unit_cost, user_id) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [p.id, wh, type, part.qty, running, reference, note, part.batch, d > 0 ? cost : null, user_id], conn);
  }
  return total;
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

/** Umlagerung zwischen zwei Lagerorten: Gesamtbestand bleibt gleich. */
export async function transferStock(conn, { product_id, from, to, qty, batch = null, note = null, user_id = null }) {
  const amount = r3(qty);
  if (!(amount > 0)) throw new HttpError(400, 'Bitte eine Menge grösser als 0 angeben.');
  if (!from || !to || Number(from) === Number(to)) throw new HttpError(400, 'Bitte zwei verschiedene Lagerorte wählen.');
  const names = await q('SELECT id, code FROM warehouses WHERE id IN (?)', [[from, to]], conn);
  if (names.length !== 2) throw new HttpError(400, 'Lagerort existiert nicht.');
  const code = (id) => names.find((w) => w.id === Number(id)).code;
  await moveStock(conn, { product_id, delta: -amount, type: 'transfer', warehouse_id: from, batch, strict: true, user_id, reference: `Umlagerung nach ${code(to)}`, note });
  await moveStock(conn, { product_id, delta: amount, type: 'transfer', warehouse_id: to, batch, user_id, reference: `Umlagerung von ${code(from)}`, note });
}

// ---------- Geführte Inventur ----------

export async function createStocktake(conn, user, { warehouse_id, date, note }) {
  const wh = warehouse_id ? Number(warehouse_id) : await defaultWarehouse(conn);
  if (await one("SELECT id FROM stocktakes WHERE warehouse_id = ? AND status = 'open'", [wh], conn)) {
    throw new HttpError(400, 'Für diesen Lagerort läuft bereits eine Inventur.');
  }
  const n = (await one('SELECT COUNT(*) AS n FROM stocktakes', [], conn)).n + 1;
  const res = await q('INSERT INTO stocktakes (number, warehouse_id, date, note, created_by) VALUES (?,?,?,?,?)',
    [`INV-${String(n).padStart(4, '0')}`, wh, date, note || null, user?.id ?? null], conn);
  // Sollbestand aller aktiven Lagerartikel zum Zeitpunkt der Eröffnung festhalten
  await q(
    `INSERT INTO stocktake_items (stocktake_id, product_id, expected_qty)
     SELECT ?, p.id, COALESCE(ps.qty, 0) FROM products p LEFT JOIN product_stock ps ON ps.product_id = p.id AND ps.warehouse_id = ?
      WHERE p.is_stock_item = 1 AND p.active = 1`, [res.insertId, wh], conn);
  return res.insertId;
}

export async function getStocktake(conn, id) {
  const st = await one('SELECT s.*, w.code AS warehouse_code, w.name AS warehouse_name FROM stocktakes s JOIN warehouses w ON w.id = s.warehouse_id WHERE s.id = ?', [id], conn);
  if (!st) throw new HttpError(404, 'Inventur nicht gefunden');
  st.items = await q(
    `SELECT i.*, p.sku, p.name, p.unit, p.location, p.purchase_price, p.avg_cost FROM stocktake_items i JOIN products p ON p.id = i.product_id
      WHERE i.stocktake_id = ? ORDER BY p.location, p.sku`, [id], conn);
  return st;
}

export async function saveCounts(conn, id, counts) {
  const st = await one('SELECT * FROM stocktakes WHERE id = ? FOR UPDATE', [id], conn);
  if (!st) throw new HttpError(404, 'Inventur nicht gefunden');
  if (st.status !== 'open') throw new HttpError(400, 'Diese Inventur ist bereits abgeschlossen.');
  for (const c of counts || []) {
    const v = c.counted_qty === '' || c.counted_qty == null ? null : Number(c.counted_qty);
    if (v !== null && !(v >= 0)) throw new HttpError(400, 'Gezählte Mengen dürfen nicht negativ sein.');
    await q('UPDATE stocktake_items SET counted_qty = ? WHERE id = ? AND stocktake_id = ?', [v, c.id, id], conn);
  }
  return st;
}

/** Inventur abschliessen: Differenzen zwischen gezähltem und aktuellem Bestand als Inventurkorrektur buchen. */
export async function postStocktake(conn, user, id) {
  const st = await one('SELECT * FROM stocktakes WHERE id = ? FOR UPDATE', [id], conn);
  if (!st) throw new HttpError(404, 'Inventur nicht gefunden');
  if (st.status !== 'open') throw new HttpError(400, 'Diese Inventur ist bereits abgeschlossen.');
  const items = await q('SELECT * FROM stocktake_items WHERE stocktake_id = ? AND counted_qty IS NOT NULL', [id], conn);
  if (!items.length) throw new HttpError(400, 'Es wurde noch nichts gezählt.');
  let corrections = 0;
  for (const it of items) {
    const ps = await one('SELECT qty FROM product_stock WHERE product_id = ? AND warehouse_id = ?', [it.product_id, st.warehouse_id], conn);
    const delta = r3(it.counted_qty - (ps?.qty ?? 0));
    if (!delta) continue;
    await moveStock(conn, { product_id: it.product_id, delta, type: 'adjust', warehouse_id: st.warehouse_id, reference: st.number, note: 'Inventurdifferenz', user_id: user?.id });
    corrections += 1;
  }
  await q("UPDATE stocktakes SET status = 'posted', posted_at = NOW() WHERE id = ?", [id], conn);
  return { number: st.number, counted: items.length, corrections };
}
