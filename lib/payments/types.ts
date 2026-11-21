// The payment seam. Nothing outside lib/payments/ speaks a gateway's wire format: checkout, the
// webhook, the reconcile path and the sweeper all use this interface.
//
// Only Hexacorp credit-card payments are implemented, and only against the LIVE host: there is no
// test mode in this codebase, so there is no way to take a pretend payment by accident, and no
// way to exercise the real gateway without real money. The unit tests stub `fetch`.

/** The order states the payment path may produce. `pending` is also what an unpaid order is. */
export type PaymentOrderStatus = 'pending' | 'paid' | 'failed' | 'cancelled';

export type ProviderName = 'hexacorp';

/** Configuration is missing or malformed. Checkout fails CLOSED. */
export class PaymentConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentConfigError';
  }
}

/** The provider was reached but rejected or malformed the exchange. */
export class PaymentApiError extends Error {
  status: number;
  body: unknown;
  /**
   * Set when the provider ACCEPTED the transaction (so it now exists on their side) but the
   * exchange could not complete, e.g. a reference_number came back with no payer-facing URL. The
   * caller persists it before failing the order, so a payment that is nonetheless completed can
   * still be found by the webhook or the sweeper.
   */
  providerPaymentId?: string;
  /**
   * True when a CREATE call did not complete (network failure or timeout), so Hexacorp may or may not
   * hold a transaction for our `txn_ref` and we cannot tell which. The caller must NOT declare the
   * order failed on that basis: it stays pending, so the sweeper reports it as unreferenced and a
   * person checks Hexacorp's records.
   */
  indeterminate?: boolean;

  constructor(message: string, status: number, body: unknown, providerPaymentId?: string) {
    super(message);
    this.name = 'PaymentApiError';
    this.status = status;
    this.body = body;
    if (providerPaymentId) this.providerPaymentId = providerPaymentId;
  }
}

export interface CreatePaymentParams {
  /** Our order reference; sent as the provider's `txn_ref`. Unique per transaction. */
  referenceId: string;
  /** WHOLE PHP PESOS, equal to the order total. Never centavos. */
  amountPesos: number;
  customer: { firstName: string; lastName: string; email: string; phone?: string };
  /** Scheme + host of THIS deployment, already vetted by the caller. The webhook URL is built on it. */
  origin: string;
}

export interface CreatePaymentResult {
  /** The provider's own transaction id (`reference_number`). Stored on the order. May be ''. */
  providerPaymentId: string;
  /** Full-page redirect target. Never iframed. */
  checkoutUrl: string;
}

export interface ProviderPaymentStatus {
  /** The provider's own status string, for logging. Undefined when no payment exists yet. */
  rawStatus: string | undefined;
  /** Mapped. `null` means unrecognised or conflicting: a NO-OP, never guessed as success. */
  orderStatus: PaymentOrderStatus | null;
  /** Reported amount in pesos. `null` BLOCKS the `paid` transition. */
  amountPesos: number | null;
  /** The provider's authoritative payment id, when known. */
  providerPaymentId: string | undefined;
  /**
   * The merchant reference the provider says this payment belongs to. Bound against the order's
   * reference before any transition: a webhook body is attacker-reachable, so any id it carries is
   * untrusted, and without this check a genuine success on ANOTHER order could be replayed here
   * whenever two totals happen to match.
   */
  requestReferenceNumber: string | undefined;
  /**
   * True when records for this payment contradict each other (a success that a later record voids,
   * expires or fails). The status is then `null` and the reconcile reports the order as UNRESOLVED
   * even if the contradicting record carries no status string of its own.
   */
  ambiguous?: boolean;
}

export interface PaymentRef {
  /** Our reference. Always available. */
  referenceId: string;
  /** The provider's payment id as STORED ON THE ORDER, never one read from a webhook body. */
  providerPaymentId?: string;
}

export interface PaymentProvider {
  readonly name: ProviderName;
  /** True when this provider's configuration is complete. MUST NOT THROW. */
  isConfigured(): boolean;
  createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult>;
  /**
   * TRUTH. Implementations MUST make an authenticated call to the provider. This is the only
   * permitted producer of a status in the payment path: a webhook body never becomes one.
   */
  getPaymentStatus(ref: PaymentRef): Promise<ProviderPaymentStatus>;
}
