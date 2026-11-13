import { Router } from 'express';
import { q, one, tx } from './db.js';
import { can, audit } from './auth.js';
import { HttpError, h } from './util.js';

/**
 * Generischer CRUD-Router für Stammdaten.
 * fields: { spalte: 's' | 'n' | 'b' }  (String, Zahl, Boolean)
 */
export function crudRouter({ table, entity, perm, fields, required = [], search = [], orderBy = 'id DESC', autoNumber }) {
  const r = Router();

  const clean = (body, partial = false) => {
    const out = {};
    for (const [name, kind] of Object.entries(fields)) {
      if (!(name in body)) continue;
      let v = body[name];
      if (kind === 'n') v = v === '' || v == null ? 0 : Number(v);
      else if (kind === 'b') v = v ? 1 : 0;
      else v = v == null || String(v).trim() === '' ? null : String(v).trim();
      if (kind === 'n' && !Number.isFinite(v)) throw new HttpError(400, `Ungültige Zahl im Feld «${name}».`);
      out[name] = v;
    }
    for (const name of required) {
      if ((!partial || name in out) && (out[name] == null || out[name] === '')) throw new HttpError(400, `Pflichtfeld fehlt: ${name}`);
    }
    return out;
  };

  r.get('/', can(`${perm}.read`), h(async (req, res) => {
    const where = [], params = [];
    if (req.query.q && search.length) {
      where.push(`(${search.map((c) => `${c} LIKE ?`).join(' OR ')})`);
      search.forEach(() => params.push(`%${req.query.q}%`));
    }
    if (req.query.active === '1' && 'active' in fields) where.push('active = 1');
    res.json(await q(`SELECT * FROM ${table} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${orderBy} LIMIT 2000`, params));
  }));

  r.get('/:id', can(`${perm}.read`), h(async (req, res) => {
    const row = await one(`SELECT * FROM ${table} WHERE id = ?`, [req.params.id]);
    if (!row) throw new HttpError(404, 'Eintrag nicht gefunden');
    res.json(row);
  }));

  r.post('/', can(`${perm}.write`), h(async (req, res) => {
    const id = await tx(async (conn) => {
      const body = { ...req.body };
      if (autoNumber && !String(body[autoNumber.field] || '').trim()) body[autoNumber.field] = await autoNumber.generate(conn);
      const data = clean(body);
      const result = await q(`INSERT INTO ${table} SET ?`, [data], conn);
      return result.insertId;
    });
    await audit(req, 'create', entity, id);
    res.status(201).json(await one(`SELECT * FROM ${table} WHERE id = ?`, [id]));
  }));

  r.put('/:id', can(`${perm}.write`), h(async (req, res) => {
    const data = clean(req.body, true);
    if (autoNumber && autoNumber.field in data && !data[autoNumber.field]) delete data[autoNumber.field];
    if (!Object.keys(data).length) throw new HttpError(400, 'Keine Änderungen übermittelt');
    const result = await q(`UPDATE ${table} SET ? WHERE id = ?`, [data, req.params.id]);
    if (!result.affectedRows) throw new HttpError(404, 'Eintrag nicht gefunden');
    await audit(req, 'update', entity, req.params.id);
    res.json(await one(`SELECT * FROM ${table} WHERE id = ?`, [req.params.id]));
  }));

  r.delete('/:id', can(`${perm}.write`), h(async (req, res) => {
    const result = await q(`DELETE FROM ${table} WHERE id = ?`, [req.params.id]);
    if (!result.affectedRows) throw new HttpError(404, 'Eintrag nicht gefunden');
    await audit(req, 'delete', entity, req.params.id);
    res.status(204).end();
  }));

  return r;
}
