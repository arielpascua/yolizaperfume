// The public navigation, defined once. The order page is the site's main action, so it is the gold
// call-to-action in the header and the mobile menu; the catalogue and the trade enquiry sit beside it.
export const ORDER_HREF = '/checkout';
export const ENQUIRY_HREF = '/enquiry';

export const NAV_LINKS = [
  { href: '/collection', label: 'Collection' },
  { href: '/trade', label: 'Trade' },
  { href: '/about', label: 'House' },
  { href: ENQUIRY_HREF, label: 'Enquire' },
] as const;
