/** API-Client: JSON über same-origin Cookies. */
export async function api(path, { method = 'GET', body, raw = false } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('serp:unauthorized'));
  if (raw && res.ok) return res;
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Fehler ${res.status}`);
  return data;
}

const chf = new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 3 });

export const money = (n) => chf.format(Number(n) || 0);
export const qty = (n) => qtyFmt.format(Number(n) || 0);
export const fmtDate = (d) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '–');
export const fmtDateTime = (d) => (d ? `${fmtDate(d)} ${d.slice(11, 16)}` : '–');
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const round2 = (n) => Math.round((Number(n) || 0) * 100 + 1e-9) / 100;
/** Kompakte Achsenbeschriftung: 1500 → 1.5k */
export const compact = (v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}k` : String(Math.round(v)));
export const monthLabel = (ym) => {
  const names = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  return `${names[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;
};

/** Belegtypen: Pfade, Bezeichnungen, Berechtigungen. */
export const DOC = {
  quote: { path: 'offerten', title: 'Offerten', single: 'Offerte', perm: 'quotes', dateLabel: 'Gültig bis' },
  order: { path: 'auftraege', title: 'Aufträge', single: 'Auftrag', perm: 'orders' },
  invoice: { path: 'rechnungen', title: 'Rechnungen', single: 'Rechnung', perm: 'invoices', dateLabel: 'Fällig am' },
  credit: { path: 'gutschriften', title: 'Gutschriften', single: 'Gutschrift', perm: 'invoices' },
  purchase: { path: 'bestellungen', title: 'Bestellungen', single: 'Bestellung', perm: 'purchasing' },
};

export const STATUS = {
  draft: ['Entwurf', ''],
  sent: ['Gesendet', 'blue'],
  accepted: ['Akzeptiert', 'green'],
  rejected: ['Abgelehnt', 'red'],
  open: ['Offen', 'blue'],
  delivered: ['Geliefert', 'amber'],
  invoiced: ['Verrechnet', 'green'],
  cancelled: ['Storniert', 'red'],
  partial: ['Teilbezahlt', 'amber'],
  paid: ['Bezahlt', 'green'],
  overdue: ['Überfällig', 'red'],
  ordered: ['Bestellt', 'blue'],
  'order:partly': ['Teilweise geliefert', 'amber'],
  'credit:open': ['Guthaben offen', 'amber'],
  'credit:paid': ['Verrechnet / ausbezahlt', 'green'],
  partly: ['Teilweise erhalten', 'amber'],
  received: ['Erhalten', 'green'],
};

export const LANGUAGES = { de: 'Deutsch', fr: 'Französisch', it: 'Italienisch', en: 'Englisch' };

/**
 * Preis eines Artikels für einen Kunden und eine Menge: kundenspezifischer Preis vor allgemeinem Staffelpreis vor Listenpreis.
 * prices: Zeilen aus product_prices (customer_id leer = gilt für alle).
 */
export function priceFor(product, prices, customerId, qty) {
  const n = Number(qty) || 0;
  const fits = (prices || []).filter((p) => p.product_id === product.id && p.min_qty <= Math.max(n, 0.000001));
  const best = (list) => list.sort((a, b) => b.min_qty - a.min_qty)[0];
  const own = best(fits.filter((p) => p.customer_id && String(p.customer_id) === String(customerId)));
  const general = best(fits.filter((p) => !p.customer_id));
  return (own || general)?.price ?? product.sale_price;
}

export const ACCOUNT_TYPES = { asset: 'Aktiven', liability: 'Fremdkapital', equity: 'Eigenkapital', revenue: 'Ertrag', expense: 'Aufwand' };

/** Exportiert Zeilen als CSV (Excel-kompatibel, Semikolon, UTF-8 BOM). */
export function downloadCsv(filename, columns, rows) {
  const esc = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const lines = [columns.map((c) => esc(c.label)).join(';')];
  for (const row of rows) lines.push(columns.map((c) => esc(c.csv ? c.csv(row) : row[c.key])).join(';'));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
