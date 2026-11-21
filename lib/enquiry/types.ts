// Client-safe: no server imports. Shared by the form and the API route.

export const BUSINESS_TYPES = [
  { id: 'boutique', label: 'Boutique or concept store' },
  { id: 'department-store', label: 'Department store or chain' },
  { id: 'salon-spa', label: 'Salon or spa' },
  { id: 'hotel-resort', label: 'Hotel or resort' },
  { id: 'online', label: 'Online reseller' },
  { id: 'gifting', label: 'Corporate gifting or events' },
  { id: 'distributor', label: 'Distributor' },
  { id: 'other', label: 'Something else' },
] as const;

export type BusinessType = (typeof BUSINESS_TYPES)[number]['id'];

export const ENQUIRY_LIMITS = {
  company: 120, name: 80, email: 200, phone: 40, city: 120, message: 2000, website: 200,
  maxLines: 20, maxCases: 200, id: 64,
} as const;

export interface EnquiryLineInput {
  fragranceId: string;
  volumeId: string;
  /** Indicative, in whole cases. */
  cases: number;
}

export interface EnquiryRequest {
  company: string;
  contactName: string;
  email: string;
  phone?: string;
  city?: string;
  businessType: BusinessType;
  /** The buyer's own shop or site, so the team can see where the range would sit. */
  storeWebsite?: string;
  wantsSamples: boolean;
  message?: string;
  items: EnquiryLineInput[];
  /** Honeypot: hidden from visitors, must stay empty. */
  website?: string;
}

export interface EnquiryResponse {
  reference: string;
}
