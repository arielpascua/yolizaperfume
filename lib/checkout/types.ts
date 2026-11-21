// Client-safe request/response shapes shared by /api/checkout and the checkout UI.
// Field names here are the contract: change them in both places or neither.
// No server imports, and no price anywhere in the REQUEST.

export const ORDER_LIMITS = {
  company: 120, name: 80, email: 200, phone: 40, taxId: 40, line: 160, city: 120, region: 120,
  postal: 20, country: 80, poNumber: 60, notes: 1500, id: 64,
} as const;

export interface OrderLineInput {
  fragranceId: string;
  volumeId: string;
  /** Whole cases. The unit is fixed by the volume's case pack. */
  cases: number;
}

export interface OrderRequest {
  buyer: {
    company: string;
    contactName: string;
    email: string;
    phone: string;
    taxId?: string;
  };
  shipping: {
    line1: string;
    line2?: string;
    city: string;
    region?: string;
    postalCode: string;
    country: string;
  };
  poNumber?: string;
  notes?: string;
  items: OrderLineInput[];
  /** Honeypot: hidden from visitors, must stay empty. */
  website?: string;
}

export interface OrderResponse {
  /** `card`: pay now on Hexacorp's page (redirectUrl is set). `invoice`: an invoice follows. */
  mode: 'card' | 'invoice';
  reference: string;
  totalCases: number;
  totalBottles: number;
  subtotal: number;
  discountPercent: number;
  discount: number;
  total: number;
  /** Card mode only: the hosted payment page. The browser validates it before navigating. */
  redirectUrl?: string;
  /** Card mode only: authorises this browser's own status polling after it returns. */
  token?: string;
}
