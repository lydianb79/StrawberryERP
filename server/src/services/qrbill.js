import { SwissQRBill } from 'swissqrbill/pdf';
import { calculateQRReferenceChecksum, calculateSCORReferenceChecksum, isIBANValid, isQRIBAN } from 'swissqrbill/utils';
import { getSettings } from './settings.js';

const COUNTRIES = {
  schweiz: 'CH', suisse: 'CH', svizzera: 'CH', switzerland: 'CH', liechtenstein: 'LI', deutschland: 'DE', germany: 'DE',
  österreich: 'AT', oesterreich: 'AT', austria: 'AT', frankreich: 'FR', france: 'FR', italien: 'IT', italia: 'IT',
};

export function countryCode(name) {
  const v = String(name || '').trim();
  if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
  return COUNTRIES[v.toLowerCase()] || 'CH';
}

const cleanIban = (iban) => String(iban || '').replace(/\s+/g, '').toUpperCase();

/**
 * Zahlungsreferenz einer Rechnung:
 * QR-IBAN → 27-stellige QR-Referenz (Kundennummer + Beleg-ID), sonst Creditor Reference nach ISO 11649 (RF…).
 */
export function referenceFor(iban, { id, number, customer_number }) {
  if (isQRIBAN(cleanIban(iban))) {
    const customer = String(customer_number || '').replace(/\D/g, '').slice(-10).padStart(10, '0');
    const body = `${customer}${String(id).padStart(16, '0')}`;
    return `${body}${calculateQRReferenceChecksum(body)}`;
  }
  const body = String(number || id).replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 21);
  return `RF${calculateSCORReferenceChecksum(body)}${body}`;
}

export async function paymentReference(conn, doc) {
  const { company } = await getSettings(conn);
  if (!isIBANValid(cleanIban(company.iban))) return null;
  try {
    return referenceFor(company.iban, doc);
  } catch {
    return null;
  }
}

/**
 * Erstellt den QR-Zahlteil für eine gebuchte Rechnung – oder null mit Begründung,
 * wenn die Voraussetzungen fehlen (IBAN, Währung CHF/EUR, Adressen).
 */
export function buildQrBill({ doc, partner, company, language = 'de' }) {
  const iban = cleanIban(company.iban);
  if (!iban) return { bill: null, reason: 'Keine IBAN in den Firmendaten hinterlegt.' };
  if (!isIBANValid(iban)) return { bill: null, reason: 'Die IBAN in den Firmendaten ist ungültig.' };
  if (!/^(CH|LI)/.test(iban)) return { bill: null, reason: 'Die QR-Rechnung benötigt eine IBAN aus der Schweiz oder Liechtenstein.' };
  if (!['CHF', 'EUR'].includes(doc.currency)) return { bill: null, reason: 'QR-Rechnungen sind nur in CHF oder EUR möglich.' };
  try {
    const bill = new SwissQRBill({
      amount: Number(doc.total),
      currency: doc.currency,
      creditor: {
        account: iban, name: company.name, address: company.street || '-', zip: company.zip || '', city: company.city || '',
        country: countryCode(company.country),
      },
      debtor: {
        name: partner.company, address: partner.street || '-', zip: partner.zip || '', city: partner.city || '',
        country: countryCode(partner.country),
      },
      reference: referenceFor(iban, { id: doc.id, number: doc.number, customer_number: partner.number }),
      message: doc.number,
    }, { language: { fr: 'FR', it: 'IT', en: 'EN' }[language] || 'DE' });
    return { bill, reason: null };
  } catch (err) {
    return { bill: null, reason: `QR-Zahlteil nicht möglich: ${err.message}` };
  }
}
