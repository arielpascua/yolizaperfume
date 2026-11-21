// Plain-language legal pages. They describe only what this site actually does. THE OWNER MUST
// REVIEW THEM (and have them checked against local law) before real orders are taken.

export interface LegalPage {
  slug: 'privacy' | 'terms';
  title: string;
  intro: string;
  sections: { heading: string; body: string[] }[];
}

export const LEGAL_PAGES: LegalPage[] = [
  {
    slug: 'privacy',
    title: 'Privacy',
    intro: 'What this site collects, why, and what it does not do.',
    sections: [
      {
        heading: 'What we collect',
        body: [
          'A trade enquiry collects your company, your name and email, and optionally a phone number, city, the address of your shop or site, and a message. An order also collects a delivery address, a mobile number, a PO number if you give one, and a tax ID if you give one.',
          'The enquiry and order forms do not use accounts, and this site sets no advertising or tracking cookies.',
          'Card payments are taken by our payment processor, Hexacorp, on its own secure page. We never see or store your card number. Hexacorp receives the amount of the order and your name, email and mobile number so that it can take the payment and send a receipt.',
        ],
      },
      {
        heading: 'Why we collect it',
        body: ['To reply to your enquiry, to take payment, to confirm and deliver an order and to issue an invoice for freight and any taxes. We do not sell or share it for marketing.'],
      },
      {
        heading: 'How it is kept',
        body: [
          'Enquiries and orders are saved in a private database that only the Yoliza team can read. Contact details are never written to the server log.',
          'To ask for your details to be corrected or removed, write to us from the address you used.',
        ],
      },
    ],
  },
  {
    slug: 'terms',
    title: 'Trade terms',
    intro: 'How wholesale ordering with Yoliza works.',
    sections: [
      {
        heading: 'Trade accounts only',
        body: ['Yoliza sells to businesses that resell, use or gift our fragrances. We do not sell to the public through this site.'],
      },
      {
        heading: 'Prices and the order page',
        body: [
          'The collection shows no prices. Trade prices, case sizes and your order total are shown on the order page, where you place the order. Prices are per bottle, before freight and any applicable taxes.',
        ],
      },
      {
        heading: 'Cases and minimums',
        body: [
          'Orders are placed in whole cases of a fixed number of bottles (6 to 24, depending on the volume). A minimum order value applies and is stated on your order page. A volume discount applies automatically to larger orders and is shown there too.',
        ],
      },
      {
        heading: 'Payment, freight and taxes',
        body: [
          'You pay by card on a secure page provided by Hexacorp when you place the order. The order total on that page is the merchandise total after any volume discount. Freight and any applicable taxes are not part of it: we invoice them separately.',
          'An order is confirmed when we confirm it to you in writing after checking stock. If we cannot supply an item we will contact you about the order.',
        ],
      },
    ],
  },
];

export function legalPage(slug: string): LegalPage | null {
  return LEGAL_PAGES.find((p) => p.slug === slug) ?? null;
}
