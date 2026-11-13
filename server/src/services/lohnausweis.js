// Lohnausweis als PDF, gegliedert nach den Buchstaben und Ziffern des Formulars 11 der Schweizerischen Steuerkonferenz.
// Der Aufbau folgt dem offiziellen Formular; vor dem ersten Versand sollte der Treuhänder Inhalt und Darstellung prüfen.
import PDFDocument from 'pdfkit';

const money = (n) => {
  const v = Math.round(Number(n) || 0); // Lohnausweis: ganze Franken
  return v === 0 ? '' : String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, "'");
};
const date = (d) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '');

export function renderLohnausweis({ data, company, logo }, stream) {
  const e = data.employee;
  const pdf = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Lohnausweis ${data.year} ${e.name}`, Author: company.name } });
  pdf.pipe(stream);
  const L = 40, R = 555, W = R - L, INK = '#111111', MUTED = '#555555', LINE = '#999999';
  const F = 'Helvetica', FB = 'Helvetica-Bold';
  const box = (x, y, w, h) => pdf.rect(x, y, w, h).lineWidth(0.6).strokeColor(LINE).stroke();
  const check = (x, y, on) => { box(x, y, 9, 9); if (on) pdf.font(FB).fontSize(9).fillColor(INK).text('X', x + 1.6, y + 0.6, { lineBreak: false }); };
  const label = (t, x, y, w = 200) => pdf.font(F).fontSize(7).fillColor(MUTED).text(t, x, y, { width: w, lineBreak: false });
  const value = (t, x, y, w = 200, bold = false) => pdf.font(bold ? FB : F).fontSize(10).fillColor(INK).text(String(t ?? ''), x, y, { width: w, lineBreak: false });

  // ---------- Kopf: A–G ----------
  let y = 40;
  if (logo?.buffer?.length) { try { pdf.image(logo.buffer, R - 110, y - 6, { fit: [110, 40], align: 'right' }); } catch { /* Bildformat nicht lesbar */ } }
  pdf.font(FB).fontSize(15).fillColor(INK).text('Lohnausweis', L, y);
  pdf.font(F).fontSize(8).fillColor(MUTED).text('Certificat de salaire  ·  Certificato di salario', L, y + 18);
  y += 44;
  box(L, y, W, 74);
  pdf.font(FB).fontSize(8).fillColor(INK).text('A', L + 6, y + 7); check(L + 18, y + 6, true); label('Lohnausweis', L + 32, y + 8);
  pdf.font(FB).fontSize(8).fillColor(INK).text('B', L + 110, y + 7); check(L + 122, y + 6, false); label('Rentenbescheinigung', L + 136, y + 8);
  pdf.font(FB).fontSize(8).fillColor(INK).text('F', L + 260, y + 7); check(L + 272, y + 6, !!e.free_transport); label('Unentgeltliche Beförderung zwischen Wohn- und Arbeitsort', L + 286, y + 8, 220);
  pdf.font(FB).fontSize(8).fillColor(INK).text('G', L + 260, y + 23); check(L + 272, y + 22, !!e.canteen); label('Kantinenverpflegung / Lunch-Checks', L + 286, y + 24, 220);
  pdf.font(FB).fontSize(8).fillColor(INK).text('C', L + 6, y + 30); label('AHV-Nr.', L + 18, y + 31); value(e.ahv_no || '–', L + 18, y + 41, 150, true);
  pdf.font(FB).fontSize(8).fillColor(INK).text('D', L + 180, y + 30); label('Jahr', L + 192, y + 31); value(data.year, L + 192, y + 41, 60, true);
  pdf.font(FB).fontSize(8).fillColor(INK).text('E', L + 260, y + 40); label('von – bis', L + 272, y + 41); value(`${date(data.from)} – ${date(data.to)}`, L + 272, y + 51, 200, true);
  y += 86;

  // ---------- H: Adresse ----------
  pdf.font(FB).fontSize(8).fillColor(INK).text('H', L, y);
  pdf.font(F).fontSize(11).fillColor(INK).text([e.name, e.street, `${e.zip || ''} ${e.city || ''}`.trim()].filter(Boolean).join('\n'), L + 290, y + 4, { width: 220, lineGap: 2 });
  y += 78;

  // Ganze Franken: Summen aus den gerundeten Einzelwerten bilden, damit das Formular in sich aufgeht
  const r = (n) => Math.round(Number(n) || 0);
  const z8 = r(data.z1) + r(data.z3), z11 = z8 - r(data.z9) - r(data.z10);

  // ---------- Ziffern 1–15 ----------
  const AMT = 100;
  const row = (no, text, amount, { bold = false, sub = null, sign = '' } = {}) => {
    const h = sub ? 30 : 20;
    box(L, y, W, h);
    pdf.moveTo(R - AMT, y).lineTo(R - AMT, y + h).lineWidth(0.6).strokeColor(LINE).stroke();
    pdf.font(FB).fontSize(8.5).fillColor(INK).text(no, L + 6, y + 6, { width: 30, lineBreak: false });
    pdf.font(bold ? FB : F).fontSize(8.5).fillColor(INK).text(text, L + 40, y + 6, { width: W - AMT - 70, lineBreak: false });
    if (sub) pdf.font(F).fontSize(7).fillColor(MUTED).text(sub, L + 40, y + 18, { width: W - AMT - 46, height: 9, ellipsis: true });
    if (sign) pdf.font(FB).fontSize(9).fillColor(INK).text(sign, R - AMT - 16, y + 5, { lineBreak: false });
    pdf.font(bold ? FB : F).fontSize(10).fillColor(INK).text(money(amount), R - AMT + 4, y + 5, { width: AMT - 10, align: 'right', lineBreak: false });
    y += h;
  };
  pdf.font(F).fontSize(7).fillColor(MUTED).text('Nur ganze Frankenbeträge', R - AMT, y - 10, { width: AMT, align: 'right', lineBreak: false });
  row('1.', 'Lohn (soweit nicht unter Ziffer 2–7 aufzuführen), inkl. 13. Monatslohn', data.z1);
  row('2.', 'Gehaltsnebenleistungen (Verpflegung, Unterkunft, Privatanteil Geschäftswagen, andere)', 0, { sign: '+' });
  row('3.', 'Unregelmässige Leistungen', data.z3, { sub: data.z3 ? 'Art: Zulagen / Bonus' : 'Art:', sign: '+' });
  row('4.', 'Kapitalleistungen', 0, { sign: '+' });
  row('5.', 'Beteiligungsrechte gemäss Beiblatt', 0, { sign: '+' });
  row('6.', 'Verwaltungsratsentschädigungen', 0, { sign: '+' });
  row('7.', 'Andere Leistungen', 0, { sign: '+' });
  row('8.', 'Bruttolohn total / Rente', z8, { bold: true, sign: '=' });
  row('9.', 'Beiträge AHV/IV/EO/ALV/NBUV', data.z9, { sign: '–' });
  row('10.', 'Berufliche Vorsorge (2. Säule): 10.1 Ordentliche Beiträge', data.z10, { sub: '10.2 Beiträge für den Einkauf: –', sign: '–' });
  row('11.', 'Nettolohn / Rente – in die Steuererklärung übertragen', z11, { bold: true, sign: '=' });
  row('12.', 'Quellensteuerabzug', 0);
  row('13.', 'Spesenvergütungen (nicht im Bruttolohn enthalten)', data.z13,
    { sub: '13.1.1 Effektive Spesen (Reise, Verpflegung, Übernachtung) · 13.1.2 Übrige – · 13.2 Pauschal – · 13.3 Weiterbildung –' });
  row('14.', 'Weitere Gehaltsnebenleistungen', 0, { sub: 'Art:' });
  // Ziffer 15: Bemerkungen
  const remarks = [e.certificate_remarks, data.otherDeductions ? `Nicht in Ziffer 9/10 enthaltene Abzüge (z.B. Krankentaggeld): CHF ${money(data.otherDeductions)}` : null].filter(Boolean).join('  ·  ');
  box(L, y, W, 44);
  pdf.font(FB).fontSize(8.5).fillColor(INK).text('15.', L + 6, y + 6, { lineBreak: false });
  pdf.font(F).fontSize(8.5).fillColor(INK).text('Bemerkungen', L + 40, y + 6, { lineBreak: false });
  pdf.font(F).fontSize(8.5).fillColor(INK).text(remarks || '–', L + 40, y + 19, { width: W - 50, height: 22, ellipsis: true });
  y += 56;

  // ---------- I: Arbeitgeber ----------
  box(L, y, W, 92);
  pdf.font(FB).fontSize(8).fillColor(INK).text('I', L + 6, y + 7);
  label('Ort und Datum', L + 18, y + 8);
  value(`${company.city || ''}, ${date(new Date().toISOString().slice(0, 10))}`, L + 18, y + 20, 220);
  label('Die Richtigkeit und Vollständigkeit bestätigt (Anschrift und Telefon des Arbeitgebers)', L + 250, y + 8, 290);
  pdf.font(F).fontSize(10).fillColor(INK).text([company.name, company.street, `${company.zip || ''} ${company.city || ''}`.trim(), company.phone && `Tel. ${company.phone}`].filter(Boolean).join('\n'),
    L + 250, y + 22, { width: 250, lineGap: 1.5 });
  pdf.font(F).fontSize(7).fillColor(MUTED).text(`Erstellt mit StrawberryERP aus ${data.months.length} gebuchten Lohnläufen (${data.months.map((m) => m.slice(5)).join(', ')}).`, L, 800, { width: W, lineBreak: false });
  pdf.end();
}
