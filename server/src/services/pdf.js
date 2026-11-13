import PDFDocument from 'pdfkit';
import { computeTotals, TYPES } from './documents.js';
import { buildQrBill } from './qrbill.js';
import { labelsFor, defaultText } from './i18n.js';

const FONTS = {
  Helvetica: ['Helvetica', 'Helvetica-Bold'],
  Times: ['Times-Roman', 'Times-Bold'],
  Courier: ['Courier', 'Courier-Bold'],
};

const money = (n) => {
  const v = Number(n) || 0;
  const [i, d] = Math.abs(v).toFixed(2).split('.');
  return `${v < 0 ? '-' : ''}${i.replace(/\B(?=(\d{3})+(?!\d))/g, "'")}.${d}`;
};
const date = (d) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '');
const qty = (n) => String(Math.round(Number(n) * 1000) / 1000);
const validColor = (c, fallback) => (/^#[0-9a-fA-F]{6}$/.test(c || '') ? c : fallback);

/**
 * Erzeugt das PDF eines Belegs (Offerte, Auftragsbestätigung, Rechnung) gemäss Layout-Einstellungen.
 * Schreibt in den übergebenen Stream.
 */
export function renderDocumentPdf({ doc, items, customer, settings, logo }, stream) {
  const { company: c, layout } = settings;
  const [F, FB] = FONTS[layout.font] || FONTS.Helvetica;
  const tpl = ['classic', 'modern', 'minimal'].includes(layout.template) ? layout.template : 'classic';
  const accent = tpl === 'minimal' ? '#222222' : validColor(layout.accentColor, '#d6294a');
  const INK = '#1a1d23', MUTED = '#6b7280', LINE = '#d5d9e0';
  const L = 50, R = 545, W = R - L;
  const lang = ['de', 'fr', 'it', 'en'].includes(doc.language) ? doc.language : 'de';
  const T = labelsFor(lang);
  const label = doc.title || T.doc[doc.type] || TYPES[doc.type].label;
  const cur = doc.currency || c.currency || 'CHF';
  const title = `${label} ${doc.number || `(${T.draft})`}`;

  const pdf = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true, info: { Title: title, Author: c.name } });
  pdf.pipe(stream);

  // ---------- Kopf ----------
  if (tpl === 'modern') pdf.rect(0, 0, 595.28, 16).fill(accent);
  const top = 42;
  const hasLogo = layout.showLogo && logo?.buffer?.length;
  const pos = ['left', 'center', 'right'].includes(layout.logoPosition) ? layout.logoPosition : 'left';
  const contact = [c.addition, c.street, `${c.zip || ''} ${c.city || ''}`.trim(), c.phone && `${T.phone} ${c.phone}`, c.email, c.website].filter(Boolean);
  let logoDrawn = false;
  if (hasLogo) {
    const w = Math.min(300, Math.max(40, Number(layout.logoWidth) || 150));
    const x = pos === 'left' ? L : pos === 'right' ? R - w : (595.28 - w) / 2;
    try {
      pdf.image(logo.buffer, x, top, { fit: [w, 78], align: pos, valign: 'top' });
      logoDrawn = true;
    } catch { /* nicht unterstütztes Bildformat */ }
  }
  if (!logoDrawn) {
    pdf.font(FB).fontSize(19).fillColor(accent).text(c.name || '', L, top, { width: W * 0.6 });
    pdf.font(F).fontSize(8.5).fillColor(MUTED).text(contact.join('\n'), L + W * 0.6, top + 2, { width: W * 0.4, align: 'right' });
  } else if (pos !== 'center') {
    const align = pos === 'left' ? 'right' : 'left';
    pdf.font(FB).fontSize(10).fillColor(INK).text(c.name || '', L, top + 2, { width: W, align });
    pdf.font(F).fontSize(8.5).fillColor(MUTED).text(contact.join('\n'), L, pdf.y + 2, { width: W, align });
  }

  // ---------- Adresse & Belegdaten ----------
  const addrRight = layout.addressPosition === 'right';
  const addrX = addrRight ? 330 : L, metaX = addrRight ? L : 330;
  let y = 150;
  if (layout.showSenderLine) {
    pdf.font(F).fontSize(7).fillColor(MUTED)
      .text([c.name, c.street, `${c.zip || ''} ${c.city || ''}`.trim()].filter(Boolean).join(' · '), addrX, y, { width: 215, lineBreak: false });
  }
  const addr = [customer.company, customer.contact_name, customer.street, `${customer.zip || ''} ${customer.city || ''}`.trim(),
    customer.country && customer.country !== 'Schweiz' ? customer.country : null].filter(Boolean);
  pdf.font(F).fontSize(10.5).fillColor(INK).text(addr.join('\n'), addrX, y + 14, { width: 215, lineGap: 2 });

  const meta = [
    [T.date, date(doc.date)],
    [T.no[doc.type], doc.number || T.draft],
    [doc.type === 'purchase' ? T.supplierNo : T.customerNo, customer.number],
    doc.type === 'purchase' && doc.due_date ? [T.deliveryDate, date(doc.due_date)] : null,
    doc.type === 'invoice' && doc.due_date ? [T.payableUntil, date(doc.due_date)] : null,
    doc.type === 'quote' && doc.valid_until ? [T.validUntil, date(doc.valid_until)] : null,
    doc.reference ? [T.reference, doc.reference] : null,
    c.vat_no ? [T.vatNo, c.vat_no] : null,
  ].filter(Boolean);
  let my = y + 14;
  for (const [k, v] of meta) {
    pdf.font(F).fontSize(9).fillColor(MUTED).text(k, metaX, my, { width: 75, lineBreak: false });
    pdf.font(F).fontSize(9).fillColor(INK).text(String(v), metaX + 80, my, { width: 135 });
    my = Math.max(my + 14, pdf.y + 2);
  }

  // ---------- Titel ----------
  y = Math.max(268, pdf.y + 24, my + 16);
  pdf.font(FB).fontSize(tpl === 'minimal' ? 14 : 16).fillColor(tpl === 'modern' ? accent : INK).text(title, L, y, { width: W });
  y = pdf.y + 4;
  if (tpl === 'classic') pdf.moveTo(L, y).lineTo(R, y).lineWidth(1.2).strokeColor(accent).stroke();
  y += 12;

  const fill = (s) => String(s || '')
    .replaceAll('{kunde}', customer.company || '')
    .replaceAll('{nummer}', doc.number || '')
    .replaceAll('{datum}', date(doc.date))
    .replaceAll('{faellig}', date(doc.due_date))
    .replaceAll('{gueltig}', date(doc.valid_until))
    .replaceAll('{total}', money(doc.total))
    .replaceAll('{frist}', date(doc.due_date));

  const intro = fill(doc.intro_text || defaultText(lang, layout, `${doc.type}Intro`));
  if (intro) {
    pdf.font(F).fontSize(10).fillColor(INK).text(intro, L, y, { width: W, lineGap: 2 });
    y = pdf.y + 14;
  }

  // ---------- Positionen ----------
  const showDiscount = layout.showDiscount && items.some((i) => Number(i.discount_pct) > 0);
  const cols = [
    { key: 'pos', label: T.pos, w: 28, align: 'left' },
    layout.showSku && { key: 'sku', label: T.sku, w: 62, align: 'left' },
    { key: 'desc', label: T.description, w: 0, align: 'left' },
    { key: 'qty', label: T.qty, w: 46, align: 'right' },
    layout.showUnit && { key: 'unit', label: T.unit, w: 36, align: 'left' },
    { key: 'price', label: T.price, w: 62, align: 'right' },
    showDiscount && { key: 'disc', label: T.discount, w: 42, align: 'right' },
    { key: 'amount', label: `${T.amount} ${cur}`, w: 74, align: 'right' },
  ].filter(Boolean);
  const descCol = cols.find((col) => col.key === 'desc');
  descCol.w = W - cols.reduce((s, col) => s + col.w, 0);
  let cx = L;
  for (const col of cols) { col.x = cx; cx += col.w; }
  const PADX = 5;

  const tableHeader = () => {
    const hh = 20;
    if (tpl === 'modern') pdf.rect(L, y, W, hh).fill(accent);
    pdf.font(FB).fontSize(8.5).fillColor(tpl === 'modern' ? '#ffffff' : tpl === 'minimal' ? MUTED : INK);
    for (const col of cols) pdf.text(col.label, col.x + PADX, y + 6, { width: col.w - 2 * PADX, align: col.align, lineBreak: false });
    y += hh;
    if (tpl !== 'modern') pdf.moveTo(L, y).lineTo(R, y).lineWidth(tpl === 'classic' ? 0.9 : 0.5).strokeColor(tpl === 'classic' ? INK : LINE).stroke();
    y += 5;
  };
  const BOTTOM = 742;
  const ensure = (need, withHeader = false) => {
    if (y + need <= BOTTOM) return;
    pdf.addPage();
    y = 56;
    if (withHeader) tableHeader();
  };

  tableHeader();
  items.forEach((it, idx) => {
    pdf.font(F).fontSize(9.5);
    const rowH = Math.max(14, pdf.heightOfString(it.description || '', { width: descCol.w - 2 * PADX, lineGap: 1.5 })) + 7;
    ensure(rowH, true);
    if (tpl === 'modern' && idx % 2 === 1) pdf.rect(L, y - 3, W, rowH).fill('#f5f6f8');
    pdf.font(F).fontSize(9.5).fillColor(INK);
    const cell = { pos: String(idx + 1), sku: it.sku || '', qty: qty(it.qty), unit: it.unit || '', price: money(it.unit_price),
      disc: Number(it.discount_pct) ? `${qty(it.discount_pct)}%` : '', amount: money(it.line_total) };
    for (const col of cols) {
      if (col.key === 'desc') pdf.text(it.description || '', col.x + PADX, y, { width: col.w - 2 * PADX, lineGap: 1.5 });
      else pdf.text(cell[col.key], col.x + PADX, y, { width: col.w - 2 * PADX, align: col.align, lineBreak: false });
    }
    y += rowH;
    if (tpl !== 'modern') pdf.moveTo(L, y - 4).lineTo(R, y - 4).lineWidth(0.4).strokeColor(LINE).stroke();
  });

  // ---------- Summen ----------
  const t = computeTotals(items);
  ensure(30 + 15 * (2 + t.vatLines.length));
  y += 6;
  const tx = 335, tw = R - tx;
  const sumRow = (k, v, bold = false) => {
    pdf.font(bold ? FB : F).fontSize(bold ? 11 : 9.5).fillColor(INK);
    pdf.text(k, tx, y, { width: tw - 90, lineBreak: false });
    pdf.text(v, R - 90, y, { width: 90 - PADX, align: 'right', lineBreak: false });
    y += bold ? 18 : 15;
  };
  if (!doc.hideVat) {
    sumRow(T.subtotal, money(t.subtotal));
    for (const v of t.vatLines) sumRow(`${T.vat} ${qty(v.rate)}% ${T.on} ${money(v.base)}`, money(v.vat));
    if (!t.vatLines.length) sumRow(T.vat, money(0));
  }
  y += 2;
  if (tpl === 'modern') {
    pdf.rect(tx - 8, y - 4, tw + 8, 24).fill(accent);
    pdf.font(FB).fontSize(11).fillColor('#ffffff');
    pdf.text(`${T.total} ${cur}`, tx, y + 3, { width: tw - 90, lineBreak: false });
    pdf.text(money(t.total), R - 90, y + 3, { width: 90 - PADX, align: 'right', lineBreak: false });
    y += 30;
  } else {
    pdf.moveTo(tx, y - 3).lineTo(R, y - 3).lineWidth(0.9).strokeColor(tpl === 'classic' ? accent : INK).stroke();
    y += 3;
    sumRow(`${T.total} ${cur}`, money(t.total), true);
    pdf.moveTo(tx, y - 2).lineTo(R, y - 2).lineWidth(0.9).strokeColor(tpl === 'classic' ? accent : INK).stroke();
    y += 8;
  }

  // ---------- Schlusstext & Bankverbindung ----------
  const closing = fill(doc.footer_text || defaultText(lang, layout, `${doc.type}Closing`)).trim();
  if (closing) {
    pdf.font(F).fontSize(10);
    ensure(pdf.heightOfString(closing, { width: W, lineGap: 2 }) + 20);
    y += 10;
    pdf.fillColor(INK).text(closing, L, y, { width: W, lineGap: 2 });
    y = pdf.y + 8;
  }
  // QR-Zahlteil (Swiss QR Bill) für gebuchte Rechnungen
  const qr = doc.type === 'invoice' && layout.showQrBill && doc.number && doc.status !== 'cancelled'
    ? buildQrBill({ doc, partner: customer, company: c, language: lang }).bill : null;
  if (doc.type === 'invoice' && layout.showBankDetails && c.iban && !qr) {
    ensure(50);
    y += 8;
    pdf.font(FB).fontSize(9).fillColor(INK).text(T.bank, L, y);
    const bank = [c.bank_name, `IBAN ${c.iban}`, c.bic && `BIC ${c.bic}`, `${T.accountOf} ${c.name}`].filter(Boolean).join('  ·  ');
    pdf.font(F).fontSize(9).fillColor(INK).text(bank, L, pdf.y + 2, { width: W });
  }

  if (qr) {
    // Der Zahlteil belegt die untersten 105 mm; reicht der Platz nicht, legt die Bibliothek eine eigene Seite an.
    pdf.x = L;
    pdf.y = y + 14;
    qr.attachTo(pdf);
  }

  // ---------- Fusszeile auf jeder Seite (nicht auf der Seite mit dem Zahlteil) ----------
  const range = pdf.bufferedPageRange();
  const footer = layout.footerText
    || [c.name, c.street, `${c.zip || ''} ${c.city || ''}`.trim(), c.phone, c.email, c.vat_no].filter(Boolean).join('  ·  ');
  for (let i = 0; i < range.count; i++) {
    if (qr && i === range.count - 1) continue;
    pdf.switchToPage(range.start + i);
    pdf.page.margins.bottom = 0;
    pdf.moveTo(L, 790).lineTo(R, 790).lineWidth(0.5).strokeColor(tpl === 'minimal' ? LINE : accent).stroke();
    pdf.font(F).fontSize(7.5).fillColor(MUTED);
    pdf.text(footer, L, 797, { width: W - 70, height: 20, ellipsis: true });
    pdf.text(`${T.page} ${i + 1} / ${range.count}`, R - 70, 797, { width: 70, align: 'right', lineBreak: false });
  }
  pdf.end();
}

/** Beispielbeleg für die Layout-Vorschau. */
export function sampleDocument(settings) {
  const items = [
    { sku: 'ART-1001', description: 'Beratung und Konzeption\nAnalyse der Anforderungen, Workshop vor Ort', qty: 8, unit: 'Std', unit_price: 165, discount_pct: 0, vat_rate: 8.1 },
    { sku: 'ART-2040', description: 'Bürostuhl ergonomisch, Modell «Comfort»', qty: 4, unit: 'Stk', unit_price: 489, discount_pct: 10, vat_rate: 8.1 },
    { sku: 'ART-3300', description: 'Fachliteratur', qty: 2, unit: 'Stk', unit_price: 58.5, discount_pct: 0, vat_rate: 2.6 },
    { sku: 'ART-9000', description: 'Lieferung und Montage', qty: 1, unit: 'Psch', unit_price: 120, discount_pct: 0, vat_rate: 8.1 },
  ].map((i) => ({ ...i, line_total: Math.round(i.qty * i.unit_price * (1 - i.discount_pct / 100) * 100) / 100 }));
  const t = computeTotals(items);
  const year = new Date().getFullYear();
  return {
    doc: { id: 42, status: 'open', currency: settings.company.currency || 'CHF', type: 'invoice', number: `${settings.numbering.invoicePrefix}-${year}-0042`, date: `${year}-03-15`, due_date: `${year}-04-14`,
      reference: 'Projekt Büroausbau', ...t },
    items,
    customer: { number: 'K-10042', company: 'Muster Handels AG', contact_name: 'Frau Anna Beispiel', street: 'Bahnhofstrasse 12', zip: '3000', city: 'Bern', country: 'Schweiz' },
  };
}
