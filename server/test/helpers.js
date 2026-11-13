// Hilfsfunktionen für die API-Tests (laufen gegen eine gestartete Instanz, siehe docker-compose.test.yml).
import assert from 'node:assert/strict';

export const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
let counter = 0;
export const uniq = (prefix) => `${prefix}-${Date.now().toString(36)}${(counter++).toString(36)}`;
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const near = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 0.005, `${message || 'Betrag'}: erwartet ${expected}, erhalten ${actual}`);

export class Client {
  cookie = '';

  async req(method, path, body) {
    const res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.getSetCookie?.() || [];
    if (set.length) this.cookie = set.map((c) => c.split(';')[0]).join('; ');
    const type = res.headers.get('content-type') || '';
    const data = res.status === 204 ? null : type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, type };
  }

  /** Erwartet Erfolg und liefert die Antwortdaten. */
  async ok(method, path, body) {
    const r = await this.req(method, path, body);
    assert.ok(r.status >= 200 && r.status < 300, `${method} ${path} → ${r.status} ${JSON.stringify(r.data)?.slice(0, 300)}`);
    return r.data;
  }

  /** Erwartet einen Fehlerstatus und liefert die Fehlermeldung. */
  async fails(status, method, path, body) {
    const r = await this.req(method, path, body);
    assert.equal(r.status, status, `${method} ${path} sollte ${status} liefern, kam ${r.status} ${JSON.stringify(r.data)?.slice(0, 200)}`);
    return r.data?.error;
  }

  get(path) { return this.ok('GET', path); }
  post(path, body = {}) { return this.ok('POST', path, body); }
  put(path, body = {}) { return this.ok('PUT', path, body); }
  del(path) { return this.ok('DELETE', path); }
}

export async function login(email, password) {
  const c = new Client();
  c.user = await c.post('/auth/login', { email, password });
  return c;
}
export const admin = () => login(process.env.ADMIN_EMAIL || 'admin@example.com', process.env.ADMIN_PASSWORD);

export async function currentYear(c) {
  const years = await c.get('/accounting/fiscal-years');
  const t = today();
  const year = years.find((y) => y.start_date <= t && y.end_date >= t);
  assert.ok(year, 'Geschäftsjahr für heute vorhanden');
  return year;
}

/** Kontensalden (Soll − Haben) des laufenden Jahres als Map Kontonummer → Saldo. */
export async function balances(c) {
  const year = await currentYear(c);
  const { rows } = await c.get(`/accounting/trial-balance?year_id=${year.id}`);
  return new Map(rows.map((r) => [r.number, r.balance]));
}
/** Veränderung eines Kontos zwischen zwei Saldenständen. */
export const delta = (before, after, number) => Math.round(((after.get(number) || 0) - (before.get(number) || 0)) * 100) / 100;

/** Prüft, dass sich kein Kontosaldo verändert hat (Konten ohne Bewegung fehlen in der Saldenliste). */
export function assertNoChange(before, after, message = 'Kontensalden unverändert') {
  for (const number of new Set([...before.keys(), ...after.keys()])) near(delta(before, after, number), 0, `${message} (Konto ${number})`);
}

export async function assertBalanced(c) {
  const year = await currentYear(c);
  const b = await c.get(`/accounting/balance-sheet?year_id=${year.id}`);
  near(b.totalAssets, b.totalLiabilitiesEquity, 'Bilanz ausgeglichen');
}

export const accountId = async (c, number) => (await c.get('/accounting/accounts')).find((a) => a.number === number).id;
export const makeCustomer = (c, extra = {}) => c.post('/customers', { company: uniq('Testkunde'), street: 'Testweg 1', zip: '8000', city: 'Zürich', active: true, ...extra });
export const makeSupplier = (c, extra = {}) => c.post('/suppliers', { company: uniq('Testlieferant'), street: 'Lagerweg 2', zip: '4000', city: 'Basel', active: true, ...extra });
export async function makeProduct(c, { stock = 0, ...extra } = {}) {
  const p = await c.post('/products', { sku: uniq('T'), name: 'Testartikel', unit: 'Stk', sale_price: 100, purchase_price: 60, vat_rate: 8.1, is_stock_item: true, active: true, ...extra });
  if (stock) await c.post(`/products/${p.id}/movements`, { type: 'in', qty: stock, reference: 'Test' });
  return p;
}
export const stockOf = async (c, id) => (await c.get(`/products/${id}`)).stock_qty;
export const item = (p, qty = 1, extra = {}) => ({ product_id: p.id, description: p.name, qty, unit: p.unit, unit_price: p.sale_price, discount_pct: 0, vat_rate: p.vat_rate, ...extra });
