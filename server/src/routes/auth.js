import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { q, one } from '../db.js';
import { authenticate, signToken, cookieOptions, loadUser, COOKIE, audit } from '../auth.js';
import { HttpError, h } from '../util.js';

const r = Router();
const DUMMY_HASH = bcrypt.hashSync('strawberry-dummy', 12);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.LOGIN_RATE_LIMIT) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Anmeldeversuche. Bitte in einigen Minuten erneut versuchen.' },
});

export const validatePassword = (pw) => {
  if (typeof pw !== 'string' || pw.length < 10) throw new HttpError(400, 'Das Passwort muss mindestens 10 Zeichen lang sein.');
};

r.post('/login', loginLimiter, h(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const row = await one('SELECT id, password_hash, active FROM users WHERE email = ?', [email]);
  // Immer vergleichen, damit die Antwortzeit keine Rückschlüsse auf existierende Konten zulässt.
  const ok = await bcrypt.compare(password, row?.password_hash || DUMMY_HASH);
  if (!row || !ok || !row.active) throw new HttpError(401, 'E-Mail oder Passwort ist falsch.');
  await q('UPDATE users SET last_login = NOW() WHERE id = ?', [row.id]);
  res.cookie(COOKIE, signToken(row.id), cookieOptions());
  const user = await loadUser(row.id);
  req.user = user;
  await audit(req, 'login', 'user', row.id);
  res.json(user);
}));

r.post('/logout', (req, res) => {
  res.clearCookie(COOKIE, { path: '/' });
  res.status(204).end();
});

r.get('/me', authenticate, (req, res) => res.json(req.user));

r.post('/password', authenticate, h(async (req, res) => {
  const { current, password } = req.body || {};
  validatePassword(password);
  const row = await one('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  if (!(await bcrypt.compare(String(current || ''), row.password_hash))) throw new HttpError(400, 'Das aktuelle Passwort ist falsch.');
  await q('UPDATE users SET password_hash = ? WHERE id = ?', [await bcrypt.hash(password, 12), req.user.id]);
  await audit(req, 'password-change', 'user', req.user.id);
  res.status(204).end();
}));

export default r;
