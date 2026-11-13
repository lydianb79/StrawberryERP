import nodemailer from 'nodemailer';
import { PassThrough } from 'node:stream';
import { HttpError } from '../util.js';
import { getSettings, getLogo } from './settings.js';
import { renderDocumentPdf } from './pdf.js';
import { TYPES, getDocument, getPartner } from './documents.js';

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

export function parseRecipients(value, label, required = false) {
  const list = String(value || '').split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
  for (const addr of list) if (!EMAIL.test(addr)) throw new HttpError(400, `${label}: «${addr}» ist keine gültige E-Mail-Adresse.`);
  if (required && !list.length) throw new HttpError(400, `${label}: Bitte mindestens eine E-Mail-Adresse angeben.`);
  return list;
}

export function mailConfigured(mail) {
  return !!(mail.host && mail.fromAddress);
}

function transport(mail) {
  if (!mailConfigured(mail)) throw new HttpError(400, 'Der E-Mail-Versand ist noch nicht eingerichtet (Administration → E-Mail).');
  return nodemailer.createTransport({
    host: mail.host,
    port: Number(mail.port) || 587,
    secure: !!mail.secure,
    auth: mail.user ? { user: mail.user, pass: mail.password } : undefined,
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
  });
}

async function deliver(mail, message) {
  try {
    return await transport(mail).sendMail({
      from: mail.fromName ? { name: mail.fromName, address: mail.fromAddress } : mail.fromAddress,
      replyTo: mail.replyTo || undefined,
      bcc: mail.bcc || undefined,
      ...message,
    });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error('[mail]', err.message);
    throw new HttpError(502, `E-Mail konnte nicht gesendet werden: ${err.message}`);
  }
}

const money = (n) => {
  const [i, d] = Math.abs(Number(n) || 0).toFixed(2).split('.');
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, "'")}.${d}`;
};
const date = (d) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '');

export function fillTemplate(text, doc, company) {
  return String(text || '')
    .replaceAll('{nummer}', doc.number || '')
    .replaceAll('{kunde}', doc.partner_name || '')
    .replaceAll('{datum}', date(doc.date))
    .replaceAll('{faellig}', date(doc.due_date))
    .replaceAll('{gueltig}', date(doc.valid_until))
    .replaceAll('{total}', money(doc.total))
    .replaceAll('{waehrung}', doc.currency || '')
    .replaceAll('{firma}', company.name || '')
    .replaceAll('{titel}', doc.title || '');
}

/** Vorschlag für Empfänger, Betreff und Text eines Belegs. */
export async function mailDraft(conn, id) {
  const doc = await getDocument(conn, id);
  const { mail, company } = await getSettings(conn);
  return {
    configured: mailConfigured(mail),
    to: doc.partner_email || '',
    subject: fillTemplate(mail[`${doc.type}Subject`], doc, company),
    message: fillTemplate(mail[`${doc.type}Body`], doc, company),
  };
}

export async function documentPdfBuffer(conn, id) {
  const doc = await getDocument(conn, id);
  const partner = await getPartner(conn, doc);
  const settings = await getSettings(conn);
  const stream = new PassThrough();
  const chunks = [];
  const done = new Promise((resolve, reject) => {
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
  renderDocumentPdf({ doc, items: doc.items, customer: partner, settings, logo: await getLogo(conn) }, stream);
  const filename = `${TYPES[doc.type].label}-${doc.number || 'Entwurf'}.pdf`.replace(/[^\w.\-]/g, '_');
  return { doc, buffer: await done, filename };
}

export async function sendDocument(conn, id, { to, cc, subject, message }) {
  const { mail } = await getSettings(conn);
  const recipients = parseRecipients(to, 'Empfänger', true);
  const copies = parseRecipients(cc, 'Kopie');
  if (!String(subject || '').trim()) throw new HttpError(400, 'Bitte einen Betreff angeben.');
  const { doc, buffer, filename } = await documentPdfBuffer(conn, id);
  if (doc.type === 'invoice' && doc.status === 'draft') throw new HttpError(400, 'Rechnungsentwürfe bitte zuerst buchen, dann versenden.');
  await deliver(mail, {
    to: recipients, cc: copies.length ? copies : undefined, subject: String(subject).slice(0, 200), text: String(message || ''),
    attachments: [{ filename, content: buffer, contentType: 'application/pdf' }],
  });
  return { doc, recipients };
}

/** Allgemeiner Versand (Passwort-Reset, Mahnungen). */
export async function sendMail(conn, { to, cc, subject, text, attachments }) {
  const { mail } = await getSettings(conn);
  const recipients = parseRecipients(to, 'Empfänger', true);
  const copies = parseRecipients(cc, 'Kopie');
  if (!String(subject || '').trim()) throw new HttpError(400, 'Bitte einen Betreff angeben.');
  await deliver(mail, { to: recipients, cc: copies.length ? copies : undefined, subject: String(subject).slice(0, 200), text: String(text || ''), attachments });
  return recipients;
}

export async function isMailConfigured(conn) {
  return mailConfigured((await getSettings(conn)).mail);
}

export async function sendTestMail(conn, to) {
  const { mail, company } = await getSettings(conn);
  const recipients = parseRecipients(to, 'Empfänger', true);
  await deliver(mail, {
    to: recipients, subject: 'StrawberryERP – Test des E-Mail-Versands',
    text: `Diese Nachricht bestätigt, dass der E-Mail-Versand von StrawberryERP (${company.name}) funktioniert.`,
  });
}
