// Zahlungsdatei für das E-Banking: ISO 20022 pain.001.001.09 nach den Swiss Payment Standards (Überweisungen in CHF/EUR per IBAN).
import { HttpError, round2 } from '../util.js';
import { countryCode } from './qrbill.js';
import { isIBANValid } from 'swissqrbill/utils';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
// Erlaubter Zeichensatz der Swiss Payment Standards: Umlaute werden umschrieben, alles Übrige entfernt.
const MAP = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss', é: 'e', è: 'e', ê: 'e', à: 'a', â: 'a', ç: 'c', î: 'i', ô: 'o', û: 'u' };
const text = (s, max) => esc(String(s ?? '').replace(/[äöüÄÖÜßéèêàâçîôû]/g, (c) => MAP[c]).replace(/[^A-Za-z0-9 .,:'+\-/()?]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max));
const iban = (s) => String(s || '').replace(/\s+/g, '').toUpperCase();

/**
 * payments: [{ id, name, street, zip, city, country, iban, amount, currency, message }]
 * debtor: { name, iban, bic }, options: { date, salary }
 */
export function buildPain001(debtor, payments, { date, salary = false, msgId } = {}) {
  if (!isIBANValid(iban(debtor.iban))) throw new HttpError(400, 'In den Firmendaten ist keine gültige IBAN hinterlegt (Administration → Firma & Nummern).');
  if (!payments.length) throw new HttpError(400, 'Keine Zahlungen ausgewählt.');
  for (const p of payments) {
    if (!isIBANValid(iban(p.iban))) throw new HttpError(400, `${p.name}: keine gültige IBAN hinterlegt.`);
    if (!(p.amount > 0)) throw new HttpError(400, `${p.name}: Betrag muss grösser als 0 sein.`);
    if (!['CHF', 'EUR'].includes(p.currency)) throw new HttpError(400, `${p.name}: Zahlungsdateien sind nur für CHF und EUR möglich (Beleg in ${p.currency}).`);
  }
  const id = msgId || `SERP${Date.now().toString(36).toUpperCase()}`;
  const total = round2(payments.reduce((s, p) => s + p.amount, 0));
  const byCurrency = new Map();
  for (const p of payments) byCurrency.set(p.currency, [...(byCurrency.get(p.currency) || []), p]);
  const blocks = [...byCurrency.entries()].map(([cur, list], b) => `
    <PmtInf>
      <PmtInfId>${id}-${b + 1}</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <BtchBookg>true</BtchBookg>
      <NbOfTxs>${list.length}</NbOfTxs>
      <CtrlSum>${round2(list.reduce((s, p) => s + p.amount, 0)).toFixed(2)}</CtrlSum>${salary ? `
      <PmtTpInf><CtgyPurp><Cd>SALA</Cd></CtgyPurp></PmtTpInf>` : ''}
      <ReqdExctnDt><Dt>${date}</Dt></ReqdExctnDt>
      <Dbtr><Nm>${text(debtor.name, 70)}</Nm></Dbtr>
      <DbtrAcct><Id><IBAN>${iban(debtor.iban)}</IBAN></Id></DbtrAcct>
      <DbtrAgt><FinInstnId>${debtor.bic ? `<BICFI>${esc(String(debtor.bic).replace(/\s+/g, '').toUpperCase())}</BICFI>` : '<Othr><Id>NOTPROVIDED</Id></Othr>'}</FinInstnId></DbtrAgt>${list.map((p, i) => `
      <CdtTrfTxInf>
        <PmtId><InstrId>${id}-${b + 1}-${i + 1}</InstrId><EndToEndId>${text(p.endToEnd || `${id}-${p.id}`, 35)}</EndToEndId></PmtId>
        <Amt><InstdAmt Ccy="${cur}">${p.amount.toFixed(2)}</InstdAmt></Amt>
        <Cdtr><Nm>${text(p.name, 70)}</Nm><PstlAdr>${p.street ? `<StrtNm>${text(p.street, 70)}</StrtNm>` : ''}${p.zip ? `<PstCd>${text(p.zip, 16)}</PstCd>` : ''}<TwnNm>${text(p.city || '-', 35)}</TwnNm><Ctry>${countryCode(p.country)}</Ctry></PstlAdr></Cdtr>
        <CdtrAcct><Id><IBAN>${iban(p.iban)}</IBAN></Id></CdtrAcct>
        <RmtInf><Ustrd>${text(p.message, 140)}</Ustrd></RmtInf>
      </CdtTrfTxInf>`).join('')}
    </PmtInf>`).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${id}</MsgId>
      <CreDtTm>${new Date().toISOString().slice(0, 19)}</CreDtTm>
      <NbOfTxs>${payments.length}</NbOfTxs>
      <CtrlSum>${total.toFixed(2)}</CtrlSum>
      <InitgPty><Nm>${text(debtor.name, 70)}</Nm></InitgPty>
    </GrpHdr>${blocks}
  </CstmrCdtTrfInitn>
</Document>
`;
  return { xml, msgId: id, count: payments.length, total };
}
