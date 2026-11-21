// Brand facts live here once so no page invents its own.

export const SITE_NAME = 'Yoliza';
export const SITE_TAGLINE = 'Wholesale perfumery';
export const SITE_FULL_NAME = `${SITE_NAME} ${SITE_TAGLINE}`;

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://yolizaperfume.example';

/** SITE_URL without trailing slashes, ready to have a path appended. */
export function siteBase(siteUrl: string = SITE_URL): string {
  return siteUrl.replace(/\/+$/, '');
}

/** Hidden wherever it is used when unset. No invented contact details. */
export const CONTACT_EMAIL: string | null = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || null;

/** Shown on the order confirmation when set (bank details, payment terms). Never invented. */
export const PAYMENT_INSTRUCTIONS: string | null = process.env.PAYMENT_INSTRUCTIONS?.trim() || null;

export const NO_PRICE_NOTE =
  'The collection shows no prices. Trade prices, case sizes and your total are on the order page.';
