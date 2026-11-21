import { MAX_CASES_PER_LINE, MAX_LINES, type RequestedLine } from '@/lib/pricing';
import { CheckoutError, asObject, readEmail, readMessage, readString } from './parse';
import { ORDER_LIMITS as L } from './types';

export interface ParsedOrder {
  buyer: { company: string; contactName: string; email: string; phone: string; taxId: string };
  shipping: { line1: string; line2: string; city: string; region: string; postalCode: string; country: string };
  poNumber: string;
  notes: string;
  lines: RequestedLine[];
}

/**
 * REJECTS RATHER THAN REPAIRS: a case count of "3", 3.5 or -1 means caller and server disagree
 * about what is being bought. Lines are keyed by fragrance AND volume; a repeated pair is
 * merged. Any price in the body is never read: the result is rebuilt from known fields only.
 */
export function parseLines(raw: unknown): RequestedLine[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new CheckoutError('Add at least one fragrance to your order', 400);
  if (raw.length > MAX_LINES) throw new CheckoutError(`An order may not contain more than ${MAX_LINES} lines`, 400);

  const byKey = new Map<string, RequestedLine>();
  for (const entry of raw) {
    const e = asObject(entry, 'Each line');
    const fragranceId = readString(e.fragranceId, 'Fragrance', L.id, true);
    const volumeId = readString(e.volumeId, 'Volume', L.id, true);
    const cases = e.cases;
    if (typeof cases !== 'number' || !Number.isInteger(cases) || cases < 1 || cases > MAX_CASES_PER_LINE) {
      throw new CheckoutError(`Cases must be a whole number from 1 to ${MAX_CASES_PER_LINE}`, 400);
    }
    const key = `${fragranceId}\u0000${volumeId}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.cases += cases;
      if (existing.cases > MAX_CASES_PER_LINE) {
        throw new CheckoutError(`Cases for one fragrance and volume may not exceed ${MAX_CASES_PER_LINE}`, 400);
      }
    } else {
      byKey.set(key, { fragranceId, volumeId, cases });
    }
  }
  return [...byKey.values()];
}

export function parseOrder(body: unknown): ParsedOrder {
  const b = asObject(body, 'Request body');
  // Honeypot: a real buyer never sees this field. Generic message on purpose.
  if (b.website !== undefined && b.website !== null && b.website !== '') throw new CheckoutError('Invalid request', 400);

  const buyerRaw = asObject(b.buyer, 'Buyer details');
  const buyer = {
    company: readString(buyerRaw.company, 'Company', L.company, true),
    contactName: readString(buyerRaw.contactName, 'Contact name', L.name, true),
    email: readEmail(buyerRaw.email, L.email),
    phone: readString(buyerRaw.phone, 'Phone', L.phone, true),
    taxId: readString(buyerRaw.taxId, 'Tax ID', L.taxId, false),
  };

  const shipRaw = asObject(b.shipping, 'Shipping address');
  const shipping = {
    line1: readString(shipRaw.line1, 'Street address', L.line, true),
    line2: readString(shipRaw.line2, 'Address line 2', L.line, false),
    city: readString(shipRaw.city, 'City or municipality', L.city, true),
    region: readString(shipRaw.region, 'Province or region', L.region, false),
    postalCode: readString(shipRaw.postalCode, 'Postal code', L.postal, true),
    country: readString(shipRaw.country, 'Country', L.country, true),
  };

  return {
    buyer,
    shipping,
    poNumber: readString(b.poNumber, 'PO number', L.poNumber, false),
    notes: readMessage(b.notes, 'Notes', L.notes),
    lines: parseLines(b.items),
  };
}
