export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Async-Handler-Wrapper: leitet Fehler an die Express-Fehlerbehandlung weiter. */
export const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const round2 = (n) => {
  const v = Number(n) || 0;
  return Math.sign(v) * Math.round(Math.abs(v) * 100 + 1e-9) / 100;
};

const pad = (n) => String(n).padStart(2, '0');
export const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => isoDate(new Date());

export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return isoDate(new Date(y, m - 1, d + Number(days || 0)));
}

/** Gültiges Kalenderdatum im Format JJJJ-MM-TT (der 30. Februar wird abgelehnt). */
export const isDate = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
};

export function needDate(value, label) {
  if (!isDate(value)) throw new HttpError(400, `${label}: ungültiges Datum`);
  return value;
}
