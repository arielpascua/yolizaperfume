// lib/payments/hexacorp.ts
//
// Hexacorp Core Payments API client: credit card only, LIVE only.
//
// There is deliberately NO test environment in this file: no second host, no mode switch, no
// simulated outcome. Every call here reaches the production API and a successful create is a real
// charge waiting for a real card. The unit tests stub `fetch`; nothing automated ever calls out.
//
// AUTH is token-based. POST /auth/obtain-token/ with {username, secret, app_uuid} returns a
// bearer token. This module authenticates FRESH on every create/inquiry call rather than caching
// it: one extra round trip per operation, in exchange for zero persisted state and no
// cache-invalidation edge case.
//
// CALLBACK URL is validated by Hexacorp for reachability, SYNCHRONOUSLY, at create time: a
// callback_url it cannot reach is rejected with a 400 before the payment exists. So
// `/api/webhooks/hexacorp` must already be a live, public route on this deployment when
// createPayment runs (it exports a bare GET for exactly that probe). A localhost origin will
// never pass; test against a public deployment.
//
// AMOUNT is decimal PHP pesos as a STRING with two places ("100.00"). `orders.total` is already
// whole pesos. There is no centavo conversion anywhere and there must never be one: getting the
// direction wrong charges the buyer 100x or 1/100x the price.
//
// STATUS comes ONLY from Transaction Inquiry, queried with HEXACORP's `reference_number` (stored
// on the order at create time), never with an id read out of a webhook body. Everything that
// could be ambiguous (two status fields that disagree, two amounts that disagree, an inquiry
// record for a different reference) resolves to "no answer", never to "paid".

import {
  PaymentApiError,
  PaymentConfigError,
  type CreatePaymentParams,
  type CreatePaymentResult,
  type PaymentOrderStatus,
  type PaymentProvider,
  type PaymentRef,
  type ProviderPaymentStatus,
} from './types';
import { normalizePhMobileNumber } from '@/lib/phone';

export const HEXACORP_BASE_URL = 'https://api.payment.hexacorp.xyz/api/v1';

/** Credentials. All three are server-only; never prefix any with NEXT_PUBLIC_. */
export function getHexacorpCredentials(env: Record<string, string | undefined> = process.env): {
  appUuid: string;
  username: string;
  secret: string;
} {
  const appUuid = env.HEXACORP_APP_UUID?.trim();
  const username = env.HEXACORP_USERNAME?.trim();
  const secret = env.HEXACORP_SECRET?.trim();
  if (!appUuid || !username || !secret) {
    throw new PaymentConfigError('HEXACORP_APP_UUID / HEXACORP_USERNAME / HEXACORP_SECRET are not set');
  }
  return { appUuid, username, secret };
}

export function getWebhookSecret(env: Record<string, string | undefined> = process.env): string {
  const secret = env.HEXACORP_WEBHOOK_SECRET?.trim();
  if (!secret) throw new PaymentConfigError('HEXACORP_WEBHOOK_SECRET is not set');
  if (secret.length < 16) throw new PaymentConfigError('HEXACORP_WEBHOOK_SECRET must be at least 16 characters');
  return secret;
}

async function parseJsonSafe(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** Whole/decimal pesos, two places, as the STRING the API takes. */
export function toAmountString(amountPesos: number): string {
  return amountPesos.toFixed(2);
}

const CREDENTIAL_KEY_PATTERN = /username|secret|password|token/i;
const URL_KEY_PATTERN = /callback_url/i;

/**
 * Redacts what must never reach a log if a response ever echoes the request: credential-shaped
 * keys always; a `callback_url` VALUE when it is a URL (it carries `?k=<webhook secret>`) but not
 * when it is Hexacorp's prose about it ("Callback URL is not reachable."), which is exactly the
 * diagnostic worth keeping; and, in any string, the literal secrets this process holds.
 */
export function redactForLog(value: unknown, depth = 3): unknown {
  if (typeof value === 'string') return scrubKnownSecrets(value);
  if (value === null || typeof value !== 'object') return value;
  // Past the depth limit an object is NOT returned as-is: it could carry anything, so it is cut.
  if (depth < 0) return '[truncated]';
  if (Array.isArray(value)) return value.map((item) => redactForLog(item, depth - 1));
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (CREDENTIAL_KEY_PATTERN.test(key)) out[key] = '[redacted]';
    else if (URL_KEY_PATTERN.test(key) && typeof val === 'string' && val.includes('://')) out[key] = '[redacted]';
    else if (URL_KEY_PATTERN.test(key) && typeof val !== 'string') out[key] = '[redacted]';
    else out[key] = redactForLog(val, depth - 1);
  }
  return out;
}

function scrubKnownSecrets(text: string): string {
  let out = text;
  for (const secret of [process.env.HEXACORP_WEBHOOK_SECRET, process.env.HEXACORP_SECRET]) {
    const s = secret?.trim();
    if (s && s.length >= 8) out = out.split(s).join('[redacted]').split(encodeURIComponent(s)).join('[redacted]');
  }
  return out;
}

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * fetch with a ceiling. Without one a hung gateway holds the buyer's checkout request (and the
 * sweeper) until the platform kills it. A network failure or timeout becomes a PaymentApiError with
 * status 0, so callers handle it like any other refusal.
 *
 * A timeout on CREATE is the one awkward case: Hexacorp may have created the transaction after we
 * stopped waiting, and with no reference_number there is nothing to look it up by. The order is
 * failed and the buyer is told nothing was charged; the log line below names the order so a person
 * can check Hexacorp's own records for that txn_ref if a buyer later reports a charge.
 */
async function hexacorpFetch(url: string, init: RequestInit, what: string, context?: Record<string, unknown>): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    console.error(`[hexacorp] ${what} did not complete`, { ...context, name: err instanceof Error ? err.name : 'unknown' });
    const error = new PaymentApiError(`Hexacorp ${what} did not complete (network failure or timeout)`, 0, null);
    // Only a CREATE is indeterminate: an auth or inquiry call that fails created nothing.
    if (what === 'payment create') error.indeterminate = true;
    throw error;
  }
}

async function obtainToken(): Promise<string> {
  const { appUuid, username, secret } = getHexacorpCredentials();
  const res = await hexacorpFetch(
    `${HEXACORP_BASE_URL}/auth/obtain-token/`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, secret, app_uuid: appUuid }) },
    'authentication',
  );
  const parsed = await parseJsonSafe(res);

  if (!res.ok) {
    // JSON.stringify, not a nested object: console's default formatter prints `[Object]` past two
    // levels, which hides an array of per-field validation errors.
    console.error('[hexacorp] authentication failed', JSON.stringify({ status: res.status, body: redactForLog(parsed) }));
    throw new PaymentApiError(`Hexacorp POST /auth/obtain-token/ failed (${res.status})`, res.status, parsed);
  }

  const record = (parsed ?? {}) as Record<string, unknown>;
  const data = (record.data ?? {}) as Record<string, unknown>;
  const token = typeof data.token === 'string' ? data.token : '';
  if (!token) {
    console.error('[hexacorp] auth response missing data.token', { status: res.status, keys: Object.keys(record) });
    throw new PaymentApiError('Hexacorp auth response missing data.token', res.status, parsed);
  }
  return token;
}

const authHeader = (token: string) => `Bearer ${token}`;

/**
 * The POST /payments/credit-card/ body. `merchant_details.mobile_number` is REQUIRED by Hexacorp
 * and accepted only as 09XXXXXXXXX or 639XXXXXXXXX; it is normalised here (and by checkout) and
 * OMITTED rather than invented if it cannot be.
 */
export function buildCreditCardBody(
  params: CreatePaymentParams,
  appUuid: string,
  callbackUrl: string,
): Record<string, unknown> {
  const merchantDetails: Record<string, unknown> = {
    txn_amount: toAmountString(params.amountPesos),
    first_name: params.customer.firstName,
    last_name: params.customer.lastName,
    email: params.customer.email,
  };
  const phone = params.customer.phone ? normalizePhMobileNumber(params.customer.phone) : null;
  if (phone) merchantDetails.mobile_number = phone;
  else if (params.customer.phone) {
    console.warn('[hexacorp] phone could not be normalised to a PH mobile shape: omitting mobile_number', {
      referenceId: params.referenceId,
    });
  }
  return {
    app_uuid: appUuid,
    callback_url: callbackUrl,
    txn_ref: params.referenceId,
    merchant_details: merchantDetails,
    other_details: [],
  };
}

/** Candidate keys for the hosted payment page, tried against `data` then the top level. */
const CHECKOUT_URL_KEYS = ['payment_url', 'checkout_url', 'redirect_url', 'checkoutUrl', 'redirectUrl', 'hosted_url', 'url'];
/**
 * TWO DIFFERENT IDENTIFIERS. `txn_ref` is OURS (the order reference); `reference_number` is
 * HEXACORP's, stored as the provider payment id and the only key Transaction Inquiry takes.
 */
const HEXACORP_REFERENCE_KEY = 'reference_number';

function firstStringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return undefined;
}

/** Like `firstStringField` but also accepts a finite number (an integer `id`), stringified. */
function firstIdField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function candidateRecords(parsed: unknown): Record<string, unknown>[] {
  const top = (parsed ?? {}) as Record<string, unknown>;
  const records: Record<string, unknown>[] = [];
  if (top.data && typeof top.data === 'object' && !Array.isArray(top.data)) {
    records.push(top.data as Record<string, unknown>);
  }
  records.push(top);
  return records;
}

async function createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
  const { appUuid } = getHexacorpCredentials();
  // Checked BEFORE the auth round trip: a missing webhook secret should not cost a network call.
  const webhookSecret = getWebhookSecret();
  const token = await obtainToken();

  const callbackUrl = `${params.origin}/api/webhooks/hexacorp?k=${encodeURIComponent(webhookSecret)}`;
  const body = buildCreditCardBody(params, appUuid, callbackUrl);

  const res = await hexacorpFetch(
    `${HEXACORP_BASE_URL}/payments/credit-card/`,
    { method: 'POST', headers: { Authorization: authHeader(token), 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    'payment create',
    { referenceId: params.referenceId, note: 'Hexacorp may still hold a transaction for this txn_ref' },
  );
  const parsed = await parseJsonSafe(res);

  if (!res.ok) {
    console.error(
      '[hexacorp] createPayment failed',
      JSON.stringify({ status: res.status, referenceId: params.referenceId, body: redactForLog(parsed) }),
    );
    throw new PaymentApiError(`Hexacorp POST /payments/credit-card/ failed (${res.status})`, res.status, parsed);
  }

  const records = candidateRecords(parsed);
  let checkoutUrl: string | undefined;
  let providerPaymentId: string | undefined;
  for (const record of records) {
    checkoutUrl ??= firstStringField(record, CHECKOUT_URL_KEYS);
    // ONLY Hexacorp's `reference_number`. No other `id` is accepted: Transaction Inquiry is keyed on
    // this one value, so any other id would store something the sweeper can never look up.
    providerPaymentId ??= firstIdField(record, [HEXACORP_REFERENCE_KEY]);
  }

  if (!checkoutUrl) {
    // Hexacorp ACCEPTED the transaction (a reference_number came back) but gave the payer nowhere
    // to go. It now exists on their side, pending. Logged with the reference so it can be found,
    // and carried on the thrown error so the caller stores it before failing the order.
    console.error(
      '[hexacorp] createPayment returned no payer-facing URL',
      JSON.stringify({
        referenceId: params.referenceId,
        hexacorpReferenceNumber: providerPaymentId ?? null,
        topLevelKeys: Object.keys((parsed ?? {}) as Record<string, unknown>),
        triedKeys: CHECKOUT_URL_KEYS,
      }),
    );
    throw new PaymentApiError('Hexacorp response contains no payer-facing URL', res.status, parsed, providerPaymentId);
  }

  if (!providerPaymentId) {
    // A payer page with NO reference we can store is a payment we could never match: a buyer could
    // pay and nothing would ever settle the order. Refuse to hand the page out.
    console.error(
      '[hexacorp] createPayment returned a payer URL but no reference_number: refusing to use it',
      JSON.stringify({ referenceId: params.referenceId, topLevelKeys: Object.keys((parsed ?? {}) as Record<string, unknown>) }),
    );
    throw new PaymentApiError('Hexacorp response contains no reference_number', res.status, parsed);
  }

  return { providerPaymentId, checkoutUrl };
}

// ---------------------------------------------------------------------------
// Status: Transaction Inquiry, keyed on HEXACORP's `reference_number`.
// ---------------------------------------------------------------------------

// `APPROVED` is deliberately NOT here: on card rails it can mean an authorisation that was never
// captured. An unlisted status is not lost, it surfaces as an "unresolved" sweeper outcome.
const STATUS_SUCCESS = ['SUCCESS', 'SUCCESSFUL', 'PAID', 'COMPLETED'];
const STATUS_PENDING = ['PENDING', 'PROCESSING', 'ONGOING', 'INITIATED'];
const STATUS_FAILED = ['FAILED', 'FAILURE', 'DECLINED', 'REJECTED', 'ERROR'];
const STATUS_CANCELLED = ['CANCELLED', 'CANCELED', 'VOID', 'VOIDED', 'EXPIRED'];

/**
 * `success` and `failed` are the documented values; the rest are common synonyms. Anything
 * unrecognised maps to `null` (a logged no-op), never to success.
 */
export function mapHexacorpStatus(raw: string | undefined): PaymentOrderStatus | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toUpperCase();
  if (STATUS_SUCCESS.includes(s)) return 'paid';
  if (STATUS_PENDING.includes(s)) return 'pending';
  if (STATUS_FAILED.includes(s)) return 'failed';
  if (STATUS_CANCELLED.includes(s)) return 'cancelled';
  return null;
}

function toAmountPesos(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const STATUS_FIELD_KEYS = ['status', 'txn_status', 'transaction_status', 'payment_status'];
const AMOUNT_FIELD_KEYS = ['txn_amount', 'amount', 'amount_paid'];
/** OUR reference only: Hexacorp's own `reference_number` is checked separately against the stored one. */
const REFERENCE_FIELD_KEYS = ['txn_ref'];
/** ISO-20022-style names, inconsistent casing and all: map exactly as given. */
const OCCURRED_AT_KEYS = ['AccptncDtTm', 'CreDtTM', 'created_at', 'txn_date', 'transaction_date', 'updated_at'];

const presentKeys = (record: Record<string, unknown>, keys: string[]) =>
  keys.filter((key) => record[key] !== undefined && record[key] !== null);

/**
 * Resolves the status from EVERY candidate field present, never just the first. Candidates that
 * map to the same outcome are redundant; candidates that map to DIFFERENT outcomes are
 * unresolvable and refuse (`null`), never picked by key order: a generic `status: success` next to
 * a more specific `txn_status: pending` must not read as paid.
 */
function resolveStatus(record: Record<string, unknown>): { rawStatus: string | undefined; orderStatus: PaymentOrderStatus | null } {
  const raws = presentKeys(record, STATUS_FIELD_KEYS)
    .map((key) => record[key])
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '');
  if (raws.length === 0) return { rawStatus: undefined, orderStatus: null };
  const mapped = raws.map(mapHexacorpStatus);
  if (new Set(mapped).size > 1) {
    console.error('[hexacorp] conflicting status fields in response: refusing to resolve a status', {
      keys: presentKeys(record, STATUS_FIELD_KEYS),
    });
    return { rawStatus: raws[0], orderStatus: null };
  }
  return { rawStatus: raws[0], orderStatus: mapped[0] };
}

/**
 * Same rule for the amount. An echo of the REQUESTED amount is not evidence of what was
 * collected, so any unparseable candidate, or two that disagree, resolves to `null`, which BLOCKS
 * the `paid` transition rather than falling back to a different key.
 */
function resolveAmountPesos(record: Record<string, unknown>): number | null {
  const present = presentKeys(record, AMOUNT_FIELD_KEYS);
  if (present.length === 0) return null;
  const parsed = present.map((key) => toAmountPesos(record[key]));
  if (parsed.some((v) => v === null)) {
    console.error('[hexacorp] an amount field was present but unparseable: refusing to trust any amount', { present });
    return null;
  }
  if (new Set(parsed as number[]).size > 1) {
    console.error('[hexacorp] conflicting amount fields in response: refusing to trust any of them', { present });
    return null;
  }
  return parsed[0] as number;
}

function resolveReference(record: Record<string, unknown>): string | undefined {
  const raws = presentKeys(record, REFERENCE_FIELD_KEYS)
    .map((key) => record[key])
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '');
  if (raws.length === 0) return undefined;
  if (new Set(raws).size > 1) {
    console.error('[hexacorp] conflicting reference fields in response: refusing to trust any of them');
    return undefined;
  }
  return raws[0];
}

function toStatus(record: Record<string, unknown>, expectedReferenceId: string, expectedHexacorpReference?: string) {
  // Key NAMES only, never values: nothing that could be card data may reach a log.
  console.info('[hexacorp] transaction inquiry response shape', { referenceId: expectedReferenceId, keys: Object.keys(record) });

  const { rawStatus, orderStatus: resolved } = resolveStatus(record);
  if (rawStatus && resolved === null) {
    console.warn('[hexacorp] unmapped or conflicting transaction status: leaving the order untouched', {
      rawStatus,
      referenceId: expectedReferenceId,
    });
  }
  let orderStatus = resolved;

  const reportedReference = resolveReference(record);
  const reportedHexacorpReference = firstStringField(record, [HEXACORP_REFERENCE_KEY]);

  // Identity binding. A mismatch means the inquiry returned data for a different transaction than
  // asked, which is untrustworthy. ABSENCE refuses nothing: the documented record shape carries no
  // reference at all, and the query itself is already scoped to the stored reference_number.
  if (typeof reportedReference === 'string' && reportedReference !== expectedReferenceId) {
    console.error('[hexacorp] REFUSING to map status: inquiry record carries a different txn_ref', {
      expectedReferenceId,
      reportedReference,
    });
    orderStatus = null;
  } else if (
    expectedHexacorpReference &&
    typeof reportedHexacorpReference === 'string' &&
    reportedHexacorpReference !== expectedHexacorpReference
  ) {
    console.error('[hexacorp] REFUSING to map status: inquiry record carries a different reference_number', {
      expectedReferenceId,
      expectedHexacorpReference,
      reportedHexacorpReference,
    });
    orderStatus = null;
  }

  return {
    rawStatus,
    orderStatus,
    amountPesos: resolveAmountPesos(record),
    requestReferenceNumber: reportedReference,
    occurredAt: firstStringField(record, OCCURRED_AT_KEYS),
    recordReference: reportedHexacorpReference,
  };
}

const NO_TRANSACTION: ProviderPaymentStatus = {
  rawStatus: undefined,
  orderStatus: null,
  amountPesos: null,
  providerPaymentId: undefined,
  requestReferenceNumber: undefined,
};

async function getPaymentStatus(ref: PaymentRef): Promise<ProviderPaymentStatus> {
  // The query key is HEXACORP's reference_number, stored on the order. It comes from OUR database
  // (the sweeper reads it from the row; the webhook passes the row's own value), never from a
  // webhook body, so an unauthenticated delivery cannot choose what is queried.
  //
  // THERE IS NO FALLBACK to our own txn_ref. Inquiry is documented to take Hexacorp's reference
  // only; asking with ours would answer "no transaction" for a payment that exists, and a green
  // sweeper over an unsettled order is the worst outcome this module can produce. An order with no
  // stored reference is therefore an ERROR the caller must surface, not a quiet empty result.
  const queryReference = ref.providerPaymentId;
  if (!queryReference) {
    throw new PaymentApiError('No Hexacorp reference_number is stored for this order: it cannot be reconciled', 0, null);
  }

  const token = await obtainToken();
  const res = await hexacorpFetch(
    `${HEXACORP_BASE_URL}/payments/transactions/inquiry/?reference_number=${encodeURIComponent(queryReference)}`,
    { method: 'GET', headers: { Authorization: authHeader(token) } },
    'transaction inquiry',
    { referenceId: ref.referenceId },
  );
  const parsed = await parseJsonSafe(res);

  // 404 is "no transaction for that reference yet": nothing to reconcile, not an outage. Throwing
  // would put every abandoned checkout into the sweeper's error list forever.
  if (res.status === 404) {
    console.info('[hexacorp] transaction inquiry found no transaction', JSON.stringify({ referenceId: ref.referenceId }));
    return NO_TRANSACTION;
  }

  if (!res.ok) {
    console.error(
      '[hexacorp] status fetch failed',
      JSON.stringify({ referenceId: ref.referenceId, status: res.status, body: redactForLog(parsed) }),
    );
    throw new PaymentApiError(`Hexacorp GET /payments/transactions/inquiry/ failed (${res.status})`, res.status, parsed);
  }

  const top = (parsed ?? {}) as Record<string, unknown>;
  const data = top.data;
  const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

  // ONLY two shapes are understood: the documented { data: { records: [...] } }, and a single record
  // under `data` that visibly carries a status field. Anything else (records: null, an empty `data`,
  // an error envelope sent with HTTP 200) is NOT "no transaction": it throws, so the webhook logs it
  // and the sweeper lists it as an error. Only a 404 or an explicit empty records array means nothing
  // exists yet. A quiet "no transaction" over an unrecognised answer is how a paid order stays unpaid.
  let list: Record<string, unknown>[];
  if (isPlainObject(data) && Array.isArray(data.records)) {
    if (!data.records.every(isPlainObject)) {
      throw new PaymentApiError('Hexacorp inquiry returned a record that is not an object', res.status, parsed);
    }
    list = data.records as Record<string, unknown>[];
  } else if (
    isPlainObject(data) &&
    presentKeys(data, STATUS_FIELD_KEYS).length > 0 &&
    // A status ALONE is not a transaction: an error envelope under `data` ({status: 'error'}) carries one
    // too. Require something only a real transaction has next to it.
    (presentKeys(data, AMOUNT_FIELD_KEYS).length > 0 || firstStringField(data, [HEXACORP_REFERENCE_KEY]) !== undefined)
  ) {
    list = [data];
  } else {
    console.error('[hexacorp] transaction inquiry returned a shape that is not understood', {
      referenceId: ref.referenceId,
      keys: Object.keys(top),
      dataKeys: isPlainObject(data) ? Object.keys(data) : typeof data,
    });
    throw new PaymentApiError('Hexacorp inquiry response has an unrecognised shape', res.status, parsed);
  }

  if (list.length === 0) {
    console.info('[hexacorp] transaction inquiry returned no records', { referenceId: ref.referenceId });
    return NO_TRANSACTION;
  }

  const attempts = list
    .map((record) => toStatus(record, ref.referenceId, ref.providerPaymentId))
    .sort((a, b) => String(a.occurredAt ?? '').localeCompare(String(b.occurredAt ?? '')));

  // The latest record is the current truth, with ONE exception that cuts the other way: a success
  // that a LATER record contradicts (void, expiry, failure, a refund status we do not know) is
  // ambiguous, so it resolves to no answer for a person to look at, never to `paid` and never
  // silently to the later state. Failed attempts BEFORE a success are normal (a declined card, then
  // another) and do not matter.
  const latest = attempts[attempts.length - 1];
  const firstSuccess = attempts.findIndex((a) => a.orderStatus === 'paid');
  if (firstSuccess >= 0 && latest.orderStatus !== 'paid') {
    console.error('[hexacorp] a success record is contradicted by a later record: refusing to resolve a status', {
      referenceId: ref.referenceId,
      latestRawStatus: latest.rawStatus,
    });
    return {
      rawStatus: latest.rawStatus,
      orderStatus: null,
      amountPesos: null,
      providerPaymentId: ref.providerPaymentId,
      requestReferenceNumber: latest.requestReferenceNumber,
      // Explicit, because the contradicting record may carry no status string at all, and the
      // reconcile would otherwise read "no status" as "nothing to do".
      ambiguous: true,
    };
  }
  const current = latest;

  return {
    rawStatus: current.rawStatus,
    orderStatus: current.orderStatus,
    amountPesos: current.amountPesos,
    // The ORDER-level id is Hexacorp's reference_number, because the next inquiry is keyed on it.
    providerPaymentId: ref.providerPaymentId || current.recordReference || undefined,
    requestReferenceNumber: current.requestReferenceNumber,
  };
}

/** Never throws: it is called while rendering the order page, and a throw would take it down. */
function isConfigured(): boolean {
  try {
    getHexacorpCredentials();
    getWebhookSecret();
    return true;
  } catch {
    return false;
  }
}

export const hexacorpProvider: PaymentProvider = {
  name: 'hexacorp',
  isConfigured,
  createPayment,
  getPaymentStatus,
};
