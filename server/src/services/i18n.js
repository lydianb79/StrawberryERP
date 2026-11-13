// Beschriftungen der Belege in den vier Sprachen. Deutsch ist Standard und Rückfallsprache.
export const LABELS = {
  de: {
    doc: { quote: 'Offerte', order: 'Auftragsbestätigung', invoice: 'Rechnung', credit: 'Gutschrift', purchase: 'Bestellung' },
    no: { quote: 'Offert-Nr.', order: 'Auftrags-Nr.', invoice: 'Rechnungs-Nr.', credit: 'Gutschrift-Nr.', purchase: 'Bestell-Nr.' },
    draft: 'Entwurf', date: 'Datum', customerNo: 'Kunden-Nr.', supplierNo: 'Lieferanten-Nr.', payableUntil: 'Zahlbar bis', validUntil: 'Gültig bis',
    deliveryDate: 'Liefertermin', reference: 'Referenz', vatNo: 'MwSt-Nr.', phone: 'Tel.',
    pos: 'Pos.', sku: 'Art.-Nr.', description: 'Bezeichnung', qty: 'Menge', unit: 'Einh.', price: 'Preis', discount: 'Rabatt', amount: 'Betrag',
    subtotal: 'Zwischensumme', vat: 'MwSt', on: 'auf', total: 'Total', bank: 'Bankverbindung', accountOf: 'Lautend auf', page: 'Seite',
    dunningInvoice: 'Rechnung {nummer} vom {datum}, fällig am {faellig}', dunningPaid: 'Bereits bezahlt', dunningFees: 'Mahngebühren', dunningInterest: 'Verzugszins', collective: 'Sammelmahnung',
  },
  fr: {
    doc: { quote: 'Offre', order: 'Confirmation de commande', invoice: 'Facture', credit: 'Note de crédit', purchase: 'Commande' },
    no: { quote: 'N° d’offre', order: 'N° de commande', invoice: 'N° de facture', credit: 'N° de note de crédit', purchase: 'N° de commande' },
    draft: 'Projet', date: 'Date', customerNo: 'N° client', supplierNo: 'N° fournisseur', payableUntil: 'Payable jusqu’au', validUntil: 'Valable jusqu’au',
    deliveryDate: 'Date de livraison', reference: 'Référence', vatNo: 'N° TVA', phone: 'Tél.',
    pos: 'Pos.', sku: 'N° art.', description: 'Désignation', qty: 'Quantité', unit: 'Unité', price: 'Prix', discount: 'Rabais', amount: 'Montant',
    subtotal: 'Sous-total', vat: 'TVA', on: 'sur', total: 'Total', bank: 'Coordonnées bancaires', accountOf: 'Au nom de', page: 'Page',
    dunningInvoice: 'Facture {nummer} du {datum}, échue le {faellig}', dunningPaid: 'Déjà payé', dunningFees: 'Frais de rappel', dunningInterest: 'Intérêts moratoires', collective: 'Rappel collectif',
    text: {
      quoteIntro: 'Nous vous remercions de votre demande et vous soumettons l’offre suivante :',
      quoteClosing: 'Nous nous réjouissons de votre commande. Cette offre est valable jusqu’au {gueltig}.',
      orderIntro: 'Nous vous remercions de votre commande, que nous confirmons comme suit :', orderClosing: '',
      invoiceIntro: 'Nous nous permettons de vous facturer les prestations suivantes :',
      invoiceClosing: 'Payable net jusqu’au {faellig}. Nous vous remercions de votre confiance.',
      creditIntro: 'Nous vous créditons le montant suivant :', creditClosing: 'Le montant sera compensé avec des factures ouvertes ou vous sera versé.',
      purchaseIntro: 'Nous vous commandons les articles suivants :', purchaseClosing: 'Veuillez nous confirmer la commande et le délai de livraison.',
      dunning: ['Rappel de paiement', '1er rappel', '2e rappel'],
      dunningText: 'La facture ci-dessous est encore ouverte. Nous vous prions de régler le montant total jusqu’au {frist}. Si votre paiement a croisé ce courrier, veuillez le considérer comme sans objet.',
    },
  },
  it: {
    doc: { quote: 'Offerta', order: 'Conferma d’ordine', invoice: 'Fattura', credit: 'Nota di credito', purchase: 'Ordinazione' },
    no: { quote: 'N. offerta', order: 'N. ordine', invoice: 'N. fattura', credit: 'N. nota di credito', purchase: 'N. ordinazione' },
    draft: 'Bozza', date: 'Data', customerNo: 'N. cliente', supplierNo: 'N. fornitore', payableUntil: 'Pagabile entro il', validUntil: 'Valida fino al',
    deliveryDate: 'Data di consegna', reference: 'Riferimento', vatNo: 'N. IVA', phone: 'Tel.',
    pos: 'Pos.', sku: 'N. art.', description: 'Descrizione', qty: 'Quantità', unit: 'Unità', price: 'Prezzo', discount: 'Sconto', amount: 'Importo',
    subtotal: 'Subtotale', vat: 'IVA', on: 'su', total: 'Totale', bank: 'Coordinate bancarie', accountOf: 'Intestato a', page: 'Pagina',
    dunningInvoice: 'Fattura {nummer} del {datum}, scaduta il {faellig}', dunningPaid: 'Già pagato', dunningFees: 'Spese di sollecito', dunningInterest: 'Interessi di mora', collective: 'Sollecito collettivo',
    text: {
      quoteIntro: 'Vi ringraziamo per la vostra richiesta e vi sottoponiamo la seguente offerta:',
      quoteClosing: 'Saremo lieti di ricevere il vostro ordine. L’offerta è valida fino al {gueltig}.',
      orderIntro: 'Vi ringraziamo per il vostro ordine, che confermiamo come segue:', orderClosing: '',
      invoiceIntro: 'Ci permettiamo di fatturarvi le seguenti prestazioni:',
      invoiceClosing: 'Pagabile netto entro il {faellig}. Vi ringraziamo per la fiducia.',
      creditIntro: 'Vi accreditiamo il seguente importo:', creditClosing: 'L’importo sarà compensato con fatture aperte oppure vi sarà versato.',
      purchaseIntro: 'Vi ordiniamo quanto segue:', purchaseClosing: 'Vogliate confermarci l’ordine e il termine di consegna.',
      dunning: ['Promemoria di pagamento', '1° sollecito', '2° sollecito'],
      dunningText: 'La fattura sottostante risulta ancora aperta. Vi preghiamo di saldare l’importo totale entro il {frist}. Se il pagamento è già stato effettuato, vogliate considerare nulla la presente.',
    },
  },
  en: {
    doc: { quote: 'Quotation', order: 'Order confirmation', invoice: 'Invoice', credit: 'Credit note', purchase: 'Purchase order' },
    no: { quote: 'Quotation no.', order: 'Order no.', invoice: 'Invoice no.', credit: 'Credit note no.', purchase: 'Order no.' },
    draft: 'Draft', date: 'Date', customerNo: 'Customer no.', supplierNo: 'Supplier no.', payableUntil: 'Payable by', validUntil: 'Valid until',
    deliveryDate: 'Delivery date', reference: 'Reference', vatNo: 'VAT no.', phone: 'Phone',
    pos: 'Pos.', sku: 'Item no.', description: 'Description', qty: 'Quantity', unit: 'Unit', price: 'Price', discount: 'Discount', amount: 'Amount',
    subtotal: 'Subtotal', vat: 'VAT', on: 'on', total: 'Total', bank: 'Bank details', accountOf: 'Account holder', page: 'Page',
    dunningInvoice: 'Invoice {nummer} dated {datum}, due {faellig}', dunningPaid: 'Already paid', dunningFees: 'Reminder fees', dunningInterest: 'Default interest', collective: 'Collective reminder',
    text: {
      quoteIntro: 'Thank you for your enquiry. We are pleased to submit the following quotation:',
      quoteClosing: 'We look forward to receiving your order. This quotation is valid until {gueltig}.',
      orderIntro: 'Thank you for your order, which we confirm as follows:', orderClosing: '',
      invoiceIntro: 'We invoice the following services and goods:',
      invoiceClosing: 'Payable net by {faellig}. Thank you for your business.',
      creditIntro: 'We credit you the following amount:', creditClosing: 'The amount will be offset against open invoices or refunded to you.',
      purchaseIntro: 'We would like to order the following:', purchaseClosing: 'Please confirm the order and the delivery date.',
      dunning: ['Payment reminder', '1st reminder', '2nd reminder'],
      dunningText: 'The invoice below is still outstanding. Please settle the total amount by {frist}. If your payment has crossed with this letter, please disregard it.',
    },
  },
};

export const labelsFor = (lang) => LABELS[lang] || LABELS.de;

/** Standardtext eines Belegs: Deutsch aus dem Beleglayout, andere Sprachen aus den mitgelieferten Übersetzungen. */
export function defaultText(lang, layout, key) {
  if (lang && lang !== 'de' && LABELS[lang]?.text && key in LABELS[lang].text) return LABELS[lang].text[key];
  return layout[key] || '';
}
