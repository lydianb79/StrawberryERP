import { q, one } from '../db.js';

export const DEFAULTS = {
  company: {
    name: 'Meine Firma AG',
    addition: '',
    street: 'Musterstrasse 1',
    zip: '8000',
    city: 'Zürich',
    country: 'Schweiz',
    phone: '',
    email: '',
    website: '',
    vat_no: '',
    bank_name: '',
    iban: '',
    bic: '',
    currency: 'CHF',
    default_payment_terms: 30,
    default_vat: 8.1,
    quote_validity_days: 30,
    vat_rates: [8.1, 2.6, 3.8, 0],
  },
  layout: {
    template: 'classic', // classic | modern | minimal
    accentColor: '#d6294a',
    font: 'Helvetica', // Helvetica | Times | Courier
    showLogo: true,
    logoPosition: 'left', // left | center | right
    logoWidth: 150,
    addressPosition: 'left', // left | right (Fenstercouvert)
    showSenderLine: true,
    showSku: true,
    showUnit: true,
    showDiscount: true,
    showBankDetails: true,
    quoteIntro: 'Vielen Dank für Ihre Anfrage. Gerne unterbreiten wir Ihnen folgendes Angebot:',
    quoteClosing: 'Wir freuen uns auf Ihren Auftrag. Diese Offerte ist gültig bis {gueltig}.',
    orderIntro: 'Vielen Dank für Ihren Auftrag, den wir wie folgt bestätigen:',
    orderClosing: '',
    invoiceIntro: 'Wir erlauben uns, Ihnen folgende Leistungen in Rechnung zu stellen:',
    invoiceClosing: 'Zahlbar bis {faellig} netto. Vielen Dank für Ihr Vertrauen.',
    footerText: '',
  },
  numbering: {
    quotePrefix: 'OF',
    orderPrefix: 'AB',
    invoicePrefix: 'RE',
    digits: 4,
    includeYear: true,
  },
  accounting: {
    receivables: '1100',
    payables: '2000',
    bank: '1020',
    revenue: '3200',
    vatPayable: '2200',
    vatInput: '1170',
    retainedEarnings: '2970',
    yearResult: '2979',
  },
};

export const SETTING_KEYS = Object.keys(DEFAULTS);

export async function getSettings(conn) {
  const rows = await q("SELECT `key`, value FROM settings WHERE `key` <> 'logo'", [], conn);
  const out = structuredClone(DEFAULTS);
  for (const row of rows) {
    if (!(row.key in out)) continue;
    try {
      Object.assign(out[row.key], JSON.parse(row.value));
    } catch { /* defekter Eintrag: Standardwerte verwenden */ }
  }
  return out;
}

export async function saveSetting(key, value, conn) {
  await q('INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
    [key, JSON.stringify(value)], conn);
}

/** Liefert das Logo als { mime, buffer } oder null. */
export async function getLogo(conn) {
  const row = await one("SELECT value FROM settings WHERE `key` = 'logo'", [], conn);
  if (!row) return null;
  try {
    const { mime, data } = JSON.parse(row.value);
    return { mime, buffer: Buffer.from(data, 'base64') };
  } catch {
    return null;
  }
}
