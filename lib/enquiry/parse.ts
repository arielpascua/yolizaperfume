import { CheckoutError, asObject, readEmail, readMessage, readString } from '@/lib/checkout/parse';
import { BUSINESS_TYPES, ENQUIRY_LIMITS as L, type BusinessType, type EnquiryLineInput } from './types';

export interface ParsedEnquiry {
  company: string;
  contactName: string;
  email: string;
  phone: string;
  city: string;
  businessType: BusinessType;
  storeWebsite: string;
  wantsSamples: boolean;
  message: string;
  lines: EnquiryLineInput[];
}

function parseLines(raw: unknown): EnquiryLineInput[] {
  // An open application with no fragrances picked is allowed: a buyer may just want the range sent.
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new CheckoutError('Fragrances must be a list', 400);
  if (raw.length > L.maxLines) throw new CheckoutError(`An enquiry may not list more than ${L.maxLines} fragrances`, 400);
  const seen = new Set<string>();
  return raw.map((entry) => {
    const e = asObject(entry, 'Each fragrance');
    const fragranceId = readString(e.fragranceId, 'Fragrance', L.id, true);
    const volumeId = readString(e.volumeId, 'Volume', L.id, true);
    const cases = e.cases;
    if (typeof cases !== 'number' || !Number.isInteger(cases) || cases < 1 || cases > L.maxCases) {
      throw new CheckoutError(`Cases must be a whole number from 1 to ${L.maxCases}`, 400);
    }
    const key = `${fragranceId}\u0000${volumeId}`;
    if (seen.has(key)) throw new CheckoutError('A fragrance and volume may not be listed more than once', 400);
    seen.add(key);
    // Rebuilt from the three known fields: nothing else the caller sent (a price, say) is carried through.
    return { fragranceId, volumeId, cases };
  });
}

export function parseEnquiry(body: unknown): ParsedEnquiry {
  const b = asObject(body, 'Request body');
  // Honeypot: a real visitor never sees this field. Generic message on purpose.
  if (b.website !== undefined && b.website !== null && b.website !== '') throw new CheckoutError('Invalid request', 400);

  const businessType = readString(b.businessType, 'Type of business', 40, true);
  if (!BUSINESS_TYPES.some((t) => t.id === businessType)) throw new CheckoutError('Choose a type of business from the list', 400);
  if (b.wantsSamples !== undefined && typeof b.wantsSamples !== 'boolean') {
    throw new CheckoutError('Samples must be yes or no', 400);
  }

  return {
    company: readString(b.company, 'Company', L.company, true),
    contactName: readString(b.contactName, 'Contact name', L.name, true),
    email: readEmail(b.email, L.email),
    phone: readString(b.phone, 'Phone', L.phone, false),
    city: readString(b.city, 'City or region', L.city, false),
    businessType: businessType as BusinessType,
    storeWebsite: readString(b.storeWebsite, 'Shop or site address', L.website, false),
    wantsSamples: b.wantsSamples === true,
    message: readMessage(b.message, 'Message', L.message),
    lines: parseLines(b.items),
  };
}
