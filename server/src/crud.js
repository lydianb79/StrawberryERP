import { Router } from 'express';
import { q, one, tx } from './db.js';
import { can, audit } from './auth.js';
import { HttpError, h } from './util.js';

/**
 * Generischer CRUD-Router für Stammdaten.
 * fields: { spalte: 's' | 'n' | 'b' }  (String, Zahl, Boolean)
 */
export function crudRouter({ table, entity, perm, fields, required = [], search = [], orderBy = 'id DESC', autoNumber, validate, readPerm, afterSave, filters = [] }) {
  const r = Router();
  // perm kann 'modul' (→ modul.read / modul.write) oder ein vollständiges Recht wie 'admin.settings' sein.
  const full = perm.includes('.');
  const writeGuard = can(full ? perm : `${perm}.write`);
  const readGuard = readPerm === null ? (_req, _res, next) => next() : can(readPerm || (full ? perm : `${perm}.read`));

  const clean = (body, partial = false) => {
    const out = {};
    for (const [name, kind] of Object.entries(fields)) {
      if (!(name in body)) continue;
      let v = body[name];
      if (kind === 'n') v = v === '' || v == null ? 0 : Number(v);
      else if (kind === 'i') v = v === '' || v == null ? null : Number(v);
      else if (kind === 'b') v = v ? 1 : 0;
      else v = v == null || String(v).trim() === '' ? null : String(v).trim();
      if ((kind === 'n' || (kind === 'i' && v !== null)) && !Number.isFinite(v)) throw new HttpError(400, `Ungültige Zahl im Feld «${name}».`);
      out[name] = v;
    }
    for (const name of required) {
      if ((!partial || name in out) && (out[name] == null || out[name] === '')) throw new HttpError(400, `Pflichtfeld fehlt: ${name}`);
    }
    if (validate) validate(out);
    return out;
  };

  r.get('/', readGuard, h(async (req, res) => {
    const where = [], params = [];
    if (req.query.q && search.length) {
      where.push(`(${search.map((c) => `${c} LIKE ?`).join(' OR ')})`);
      search.forEach(() => params.push(`%${req.query.q}%`));
    }
    if (req.query.active === '1' && 'active' in fields) where.push('active = 1');
    for (const f of filters) if (req.query[f] !== undefined && req.query[f] !== '') { where.push(`${f} = ?`); params.push(req.query[f]); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    // Mit ?page= wird seitenweise geliefert ({ rows, total }) – für sehr grosse Listen; ohne bleibt es bei der einfachen Liste.
    if (req.query.page !== undefined) {
      const size = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
      const page = Math.max(0, Number(req.query.page) || 0);
      const [{ total }] = await q(`SELECT COUNT(*) AS total FROM ${table} ${clause}`, params);
      const rows = await q(`SELECT * FROM ${table} ${clause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`, [...params, size, page * size]);
      return res.json({ rows, total, page, pageSize: size });
    }
    return res.json(await q(`SELECT * FROM ${table} ${clause} ORDER BY ${orderBy} LIMIT 2000`, params));
  }));

  r.get('/:id', readGuard, h(async (req, res) => {
    const row = await one(`SELECT * FROM ${table} WHERE id = ?`, [req.params.id]);
    if (!row) throw new HttpError(404, 'Eintrag nicht gefunden');
    res.json(row);
  }));

  r.post('/', writeGuard, h(async (req, res) => {
    const id = await tx(async (conn) => {
      const body = { ...req.body };
      if (autoNumber && !String(body[autoNumber.field] || '').trim()) body[autoNumber.field] = await autoNumber.generate(conn);
      const data = clean(body);
      const result = await q(`INSERT INTO ${table} SET ?`, [data], conn);
      return result.insertId;
    });
    await audit(req, 'create', entity, id);
    const row = await one(`SELECT * FROM ${table} WHERE id = ?`, [id]);
    if (afterSave) await afterSave(row, req);
    res.status(201).json(row);
  }));

  r.put('/:id', writeGuard, h(async (req, res) => {
    const data = clean(req.body, true);
    if (autoNumber && autoNumber.field in data && !data[autoNumber.field]) delete data[autoNumber.field];
    if (!Object.keys(data).length) throw new HttpError(400, 'Keine Änderungen übermittelt');
    const result = await q(`UPDATE ${table} SET ? WHERE id = ?`, [data, req.params.id]);
    if (!result.affectedRows) throw new HttpError(404, 'Eintrag nicht gefunden');
    await audit(req, 'update', entity, req.params.id);
    const row = await one(`SELECT * FROM ${table} WHERE id = ?`, [req.params.id]);
    if (afterSave) await afterSave(row, req);
    res.json(row);
  }));

  r.delete('/:id', writeGuard, h(async (req, res) => {
    const result = await q(`DELETE FROM ${table} WHERE id = ?`, [req.params.id]);
    if (!result.affectedRows) throw new HttpError(404, 'Eintrag nicht gefunden');
    await audit(req, 'delete', entity, req.params.id);
    res.status(204).end();
  }));

  return r;
}
