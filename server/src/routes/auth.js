import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import rateLimit from 'express-rate-limit';
import { q, one } from '../db.js';
import { authenticate, signToken, cookieOptions, loadUser, COOKIE, audit } from '../auth.js';
import { HttpError, h } from '../util.js';
import { generateSecret, verifyTotp, otpauthUrl } from '../services/totp.js';
import { getSettings } from '../services/settings.js';
import { sendMail, isMailConfigured } from '../services/mail.js';

const r = Router();
const DUMMY_HASH = bcrypt.hashSync('strawberry-dummy', 12);

const limiter = (limit) => rateLimit({
  windowMs: 15 * 60 * 1000, limit, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Zu viele Versuche. Bitte in einigen Minuten erneut versuchen.' },
});
const loginLimiter = limiter(Number(process.env.LOGIN_RATE_LIMIT) || 20);
const resetLimiter = limiter(Number(process.env.LOGIN_RATE_LIMIT) || 6);

export const validatePassword = (pw) => {
  if (typeof pw !== 'string' || pw.length < 10) throw new HttpError(400, 'Das Passwort muss mindestens 10 Zeichen lang sein.');
};
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const normCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Erzeugt zehn Einmalcodes (Format XXXX-XXXX); gespeichert werden nur Hashwerte. Alte Codes verfallen. */
async function newRecoveryCodes(userId) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne verwechselbare Zeichen
  const codes = Array.from({ length: 10 }, () => {
    const raw = Array.from(crypto.randomBytes(8), (b) => alphabet[b % alphabet.length]).join('');
    return `${raw.slice(0, 4)}-${raw.slice(4)}`;
  });
  await q('DELETE FROM user_recovery_codes WHERE user_id = ?', [userId]);
  await q('INSERT INTO user_recovery_codes (user_id, code_hash) VALUES ?', [codes.map((c) => [userId, sha256(normCode(c))])]);
  return codes;
}

/** Löst einen Wiederherstellungscode ein (einmalig). */
async function useRecoveryCode(userId, code) {
  const n = normCode(code);
  if (n.length !== 8) return false;
  const result = await q('UPDATE user_recovery_codes SET used_at = NOW() WHERE user_id = ? AND code_hash = ? AND used_at IS NULL', [userId, sha256(n)]);
  return result.affectedRows === 1;
}

r.post('/login', loginLimiter, h(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const row = await one('SELECT id, password_hash, active, token_version, totp_enabled, totp_secret FROM users WHERE email = ?', [email]);
  // Immer vergleichen, damit die Antwortzeit keine Rückschlüsse auf existierende Konten zulässt.
  const ok = await bcrypt.compare(password, row?.password_hash || DUMMY_HASH);
  if (!row || !ok || !row.active) throw new HttpError(401, 'E-Mail oder Passwort ist falsch.');
  if (row.totp_enabled) {
    const code = String(req.body?.code || '').trim();
    if (!code) return res.status(401).json({ error: 'Bitte den Code aus der Authenticator-App eingeben.', twoFactorRequired: true });
    const recovery = !verifyTotp(row.totp_secret, code) && await useRecoveryCode(row.id, code);
    if (!verifyTotp(row.totp_secret, code) && !recovery) return res.status(401).json({ error: 'Der Code ist falsch oder abgelaufen.', twoFactorRequired: true });
    if (recovery) { req.user = { id: row.id, name: email }; await audit(req, '2fa-recovery-code', 'user', row.id); }
  }
  await q('UPDATE users SET last_login = NOW() WHERE id = ?', [row.id]);
  res.cookie(COOKIE, signToken(row.id, row.token_version), cookieOptions());
  const user = await loadUser(row.id);
  req.user = user;
  await audit(req, 'login', 'user', row.id);
  return res.json(user);
}));

r.post('/logout', (req, res) => {
  res.clearCookie(COOKIE, { path: '/' });
  res.status(204).end();
});

r.get('/me', authenticate, (req, res) => res.json(req.user));

/** Passwort ändern: beendet alle anderen Sitzungen dieses Benutzers. */
r.post('/password', authenticate, h(async (req, res) => {
  const { current, password } = req.body || {};
  validatePassword(password);
  const row = await one('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  if (!(await bcrypt.compare(String(current || ''), row.password_hash))) throw new HttpError(400, 'Das aktuelle Passwort ist falsch.');
  await q('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?', [await bcrypt.hash(password, 12), req.user.id]);
  res.cookie(COOKIE, signToken(req.user.id, req.user.token_version + 1), cookieOptions());
  await audit(req, 'password-change', 'user', req.user.id);
  res.status(204).end();
}));

// ---------- Zwei-Faktor-Anmeldung (TOTP) ----------
r.post('/2fa/setup', authenticate, h(async (req, res) => {
  if (req.user.totp_enabled) throw new HttpError(400, 'Die Zwei-Faktor-Anmeldung ist bereits aktiv.');
  const secret = generateSecret();
  await q('UPDATE users SET totp_secret = ? WHERE id = ?', [secret, req.user.id]);
  const url = otpauthUrl(secret, req.user.email);
  const svg = await QRCode.toString(url, { type: 'svg', margin: 1, width: 220 });
  res.json({ secret, url, qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` });
}));

r.post('/2fa/enable', authenticate, h(async (req, res) => {
  const row = await one('SELECT totp_secret, totp_enabled FROM users WHERE id = ?', [req.user.id]);
  if (row.totp_enabled) throw new HttpError(400, 'Die Zwei-Faktor-Anmeldung ist bereits aktiv.');
  if (!row.totp_secret || !verifyTotp(row.totp_secret, req.body?.code)) throw new HttpError(400, 'Der Code stimmt nicht. Bitte den aktuellen Code aus der App eingeben.');
  await q('UPDATE users SET totp_enabled = 1 WHERE id = ?', [req.user.id]);
  await audit(req, '2fa-enable', 'user', req.user.id);
  // Die Codes werden genau einmal angezeigt
  res.json({ recoveryCodes: await newRecoveryCodes(req.user.id) });
}));

r.post('/2fa/disable', authenticate, h(async (req, res) => {
  const row = await one('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  if (!(await bcrypt.compare(String(req.body?.password || ''), row.password_hash))) throw new HttpError(400, 'Das Passwort ist falsch.');
  await q('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?', [req.user.id]);
  await q('DELETE FROM user_recovery_codes WHERE user_id = ?', [req.user.id]);
  await audit(req, '2fa-disable', 'user', req.user.id);
  res.status(204).end();
}));

r.get('/2fa/recovery-codes', authenticate, h(async (req, res) => {
  const row = await one('SELECT COUNT(*) AS total, COALESCE(SUM(used_at IS NULL), 0) AS unused FROM user_recovery_codes WHERE user_id = ?', [req.user.id]);
  res.json({ total: row.total, unused: Number(row.unused) });
}));

r.post('/2fa/recovery-codes', authenticate, h(async (req, res) => {
  if (!req.user.totp_enabled) throw new HttpError(400, 'Die Zwei-Faktor-Anmeldung ist nicht aktiv.');
  const row = await one('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  if (!(await bcrypt.compare(String(req.body?.password || ''), row.password_hash))) throw new HttpError(400, 'Das Passwort ist falsch.');
  await audit(req, '2fa-recovery-codes-new', 'user', req.user.id);
  res.json({ recoveryCodes: await newRecoveryCodes(req.user.id) });
}));

// ---------- Passwort vergessen ----------
/** Antwortet immer gleich, damit sich nicht herausfinden lässt, welche E-Mail-Adressen ein Konto haben. */
r.post('/forgot', resetLimiter, h(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const user = await one('SELECT id, name, email FROM users WHERE email = ? AND active = 1', [email]);
  if (user && await isMailConfigured()) {
    const token = crypto.randomBytes(32).toString('base64url');
    await q('UPDATE users SET reset_token_hash = ?, reset_expires = DATE_ADD(NOW(), INTERVAL 60 MINUTE) WHERE id = ?', [sha256(token), user.id]);
    const { company } = await getSettings();
    // Die Adresse aus den Einstellungen hat Vorrang – der Host-Header der Anfrage ist nicht vertrauenswürdig.
    const base = String(company.app_url || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    try {
      await sendMail(undefined, {
        to: user.email, subject: 'StrawberryERP – Passwort zurücksetzen',
        text: `Guten Tag ${user.name}\n\nFür Ihr Konto wurde das Zurücksetzen des Passworts angefordert. Über den folgenden Link können Sie in den nächsten 60 Minuten ein neues Passwort setzen:\n\n${base}/passwort-zuruecksetzen?token=${token}\n\nFalls Sie das nicht waren, können Sie diese Nachricht ignorieren – Ihr Passwort bleibt unverändert.\n\n${company.name}`,
      });
      req.user = { id: user.id, name: user.name };
      await audit(req, 'password-reset-request', 'user', user.id);
    } catch (err) {
      console.error('[auth] Reset-Mail fehlgeschlagen:', err.message);
    }
  }
  res.status(204).end();
}));

r.post('/reset', resetLimiter, h(async (req, res) => {
  const token = String(req.body?.token || '');
  validatePassword(req.body?.password);
  const user = token ? await one('SELECT id, name FROM users WHERE reset_token_hash = ? AND reset_expires > NOW() AND active = 1', [sha256(token)]) : null;
  if (!user) throw new HttpError(400, 'Der Link ist ungültig oder abgelaufen. Bitte fordern Sie einen neuen an.');
  await q('UPDATE users SET password_hash = ?, token_version = token_version + 1, reset_token_hash = NULL, reset_expires = NULL WHERE id = ?',
    [await bcrypt.hash(req.body.password, 12), user.id]);
  req.user = user;
  await audit(req, 'password-reset', 'user', user.id);
  res.status(204).end();
}));

export default r;
