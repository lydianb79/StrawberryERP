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
    vat_method: 'agreed', // agreed = vereinbartes Entgelt | received = vereinnahmtes Entgelt | net = Saldosteuersatz
    vat_net_rate: 0,
    auto_rates: false,
    app_url: '',
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
    showQrBill: true,
    quoteIntro: 'Vielen Dank für Ihre Anfrage. Gerne unterbreiten wir Ihnen folgendes Angebot:',
    quoteClosing: 'Wir freuen uns auf Ihren Auftrag. Diese Offerte ist gültig bis {gueltig}.',
    orderIntro: 'Vielen Dank für Ihren Auftrag, den wir wie folgt bestätigen:',
    orderClosing: '',
    invoiceIntro: 'Wir erlauben uns, Ihnen folgende Leistungen in Rechnung zu stellen:',
    invoiceClosing: 'Zahlbar bis {faellig} netto. Vielen Dank für Ihr Vertrauen.',
    creditIntro: 'Wir schreiben Ihnen folgenden Betrag gut:',
    creditClosing: 'Der Betrag wird mit offenen Rechnungen verrechnet oder Ihnen überwiesen.',
    purchaseIntro: 'Wir bestellen bei Ihnen gemäss nachstehender Aufstellung:',
    purchaseClosing: 'Bitte bestätigen Sie uns den Auftrag mit Liefertermin.',
    footerText: '',
  },
  numbering: {
    quotePrefix: 'OF',
    orderPrefix: 'AB',
    invoicePrefix: 'RE',
    purchasePrefix: 'BE',
    creditPrefix: 'GS',
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
    fxGain: '6990',
    fxLoss: '6940',
    dunningFees: '3890',
    inventory: '1200',
    inventoryChange: '4800',
  },
  dunning: {
    paymentDays: 10, // neue Zahlungsfrist ab Mahndatum
    levels: [
      { title: 'Zahlungserinnerung', days: 10, fee: 0,
        text: 'Sicher ist es Ihrer Aufmerksamkeit entgangen, dass die nachstehende Rechnung noch offen ist. Wir bitten Sie, den Betrag bis {frist} zu begleichen. Sollte sich Ihre Zahlung mit diesem Schreiben gekreuzt haben, betrachten Sie es bitte als gegenstandslos.' },
      { title: '1. Mahnung', days: 10, fee: 20,
        text: 'Trotz unserer Zahlungserinnerung ist die nachstehende Rechnung weiterhin offen. Wir bitten Sie, den Gesamtbetrag inklusive Mahngebühr bis {frist} zu überweisen.' },
      { title: '2. Mahnung', days: 10, fee: 30,
        text: 'Leider haben wir auf unsere bisherigen Schreiben keine Zahlung erhalten. Wir fordern Sie letztmals auf, den Gesamtbetrag bis {frist} zu begleichen. Andernfalls sehen wir uns gezwungen, rechtliche Schritte einzuleiten.' },
    ],
  },
  mail: {
    host: '',
    port: 587,
    secure: false, // true = TLS direkt (Port 465), false = STARTTLS
    user: '',
    password: '',
    fromName: '',
    fromAddress: '',
    replyTo: '',
    bcc: '',
    quoteSubject: 'Offerte {nummer}',
    quoteBody: 'Guten Tag\n\nIm Anhang erhalten Sie unsere Offerte {nummer}. Bei Fragen stehen wir Ihnen gerne zur Verfügung.\n\nFreundliche Grüsse\n{firma}',
    orderSubject: 'Auftragsbestätigung {nummer}',
    orderBody: 'Guten Tag\n\nVielen Dank für Ihren Auftrag. Im Anhang erhalten Sie die Auftragsbestätigung {nummer}.\n\nFreundliche Grüsse\n{firma}',
    invoiceSubject: 'Rechnung {nummer}',
    invoiceBody: 'Guten Tag\n\nIm Anhang erhalten Sie unsere Rechnung {nummer} über {waehrung} {total}, zahlbar bis {faellig}.\n\nFreundliche Grüsse\n{firma}',
    creditSubject: 'Gutschrift {nummer}',
    creditBody: 'Guten Tag\n\nIm Anhang erhalten Sie unsere Gutschrift {nummer} über {waehrung} {total}.\n\nFreundliche Grüsse\n{firma}',
    dunningSubject: '{titel} zu Rechnung {nummer}',
    dunningBody: 'Guten Tag\n\nIm Anhang erhalten Sie unsere {titel} zur Rechnung {nummer}. Der offene Betrag beträgt {waehrung} {total}.\n\nFreundliche Grüsse\n{firma}',
    purchaseSubject: 'Bestellung {nummer}',
    purchaseBody: 'Guten Tag\n\nIm Anhang erhalten Sie unsere Bestellung {nummer}. Bitte bestätigen Sie uns den Liefertermin.\n\nFreundliche Grüsse\n{firma}',
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
