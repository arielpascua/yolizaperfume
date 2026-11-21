import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HEXACORP_BASE_URL,
  buildCreditCardBody,
  getHexacorpCredentials,
  getWebhookSecret,
  hexacorpProvider,
  mapHexacorpStatus,
  redactForLog,
  toAmountString,
} from './hexacorp';
import { PaymentApiError, PaymentConfigError, type CreatePaymentParams } from './types';

const ENV = {
  HEXACORP_APP_UUID: 'app-uuid',
  HEXACORP_USERNAME: 'merchant-user',
  HEXACORP_SECRET: 'merchant-secret-value',
  HEXACORP_WEBHOOK_SECRET: 'w'.repeat(32),
};

const PARAMS: CreatePaymentParams = {
  referenceId: 'YZ-0123456789',
  amountPesos: 141132,
  customer: { firstName: 'Ana', lastName: 'Reyes', email: 'ana@casabella.example', phone: '0917 123 4567' },
  origin: 'https://shop.example',
};

const AUTH = { status: 200, body: { data: { token: 'tok-1' } } };

function stubFetch(...responses: { status: number; body: unknown }[]) {
  const fetchMock = vi.fn();
  for (const r of responses) {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } }));
  }
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('configuration', () => {
  it('talks to the live host and only the live host', () => {
    expect(HEXACORP_BASE_URL).toBe('https://api.payment.hexacorp.xyz/api/v1');
  });

  it('reads the three credentials and refuses when any is missing', () => {
    expect(getHexacorpCredentials()).toEqual({ appUuid: 'app-uuid', username: 'merchant-user', secret: 'merchant-secret-value' });
    for (const key of ['HEXACORP_APP_UUID', 'HEXACORP_USERNAME', 'HEXACORP_SECRET']) {
      vi.stubEnv(key, '');
      expect(() => getHexacorpCredentials()).toThrow(PaymentConfigError);
      vi.stubEnv(key, ENV[key as keyof typeof ENV]);
    }
  });

  it('requires a webhook secret of 16+ characters', () => {
    expect(getWebhookSecret()).toBe(ENV.HEXACORP_WEBHOOK_SECRET);
    vi.stubEnv('HEXACORP_WEBHOOK_SECRET', 'short');
    expect(() => getWebhookSecret()).toThrow(PaymentConfigError);
    vi.stubEnv('HEXACORP_WEBHOOK_SECRET', '');
    expect(() => getWebhookSecret()).toThrow(PaymentConfigError);
  });

  it('isConfigured never throws and reflects completeness', () => {
    expect(hexacorpProvider.isConfigured()).toBe(true);
    vi.stubEnv('HEXACORP_SECRET', '');
    expect(hexacorpProvider.isConfigured()).toBe(false);
    vi.stubEnv('HEXACORP_SECRET', ENV.HEXACORP_SECRET);
    vi.stubEnv('HEXACORP_WEBHOOK_SECRET', '');
    expect(hexacorpProvider.isConfigured()).toBe(false);
  });

  it('has no sandbox switch: HEXACORP_MODE and test scenarios change nothing', () => {
    vi.stubEnv('HEXACORP_MODE', 'sandbox');
    vi.stubEnv('HEXACORP_TEST_SCENARIO', 'success');
    const body = buildCreditCardBody(PARAMS, 'app-uuid', 'https://x.example/cb');
    expect(body).not.toHaveProperty('test_scenario');
    expect(HEXACORP_BASE_URL).not.toMatch(/sandbox/);
  });
});

describe('amounts', () => {
  it('formats whole pesos as a two-decimal string, never centavos', () => {
    expect(toAmountString(100)).toBe('100.00');
    expect(toAmountString(141132)).toBe('141132.00');
    expect(typeof toAmountString(1)).toBe('string');
  });
});

describe('buildCreditCardBody', () => {
  it('builds the documented body with a string amount and a normalised mobile number', () => {
    const body = buildCreditCardBody(PARAMS, 'app-uuid', 'https://shop.example/api/webhooks/hexacorp?k=abc');
    expect(body).toEqual({
      app_uuid: 'app-uuid',
      callback_url: 'https://shop.example/api/webhooks/hexacorp?k=abc',
      txn_ref: 'YZ-0123456789',
      merchant_details: {
        txn_amount: '141132.00',
        first_name: 'Ana',
        last_name: 'Reyes',
        email: 'ana@casabella.example',
        mobile_number: '09171234567',
      },
      other_details: [],
    });
  });

  it('omits the mobile number rather than inventing or sending a bad one', () => {
    const bad = buildCreditCardBody({ ...PARAMS, customer: { ...PARAMS.customer, phone: '+1 415 555 0100' } }, 'a', 'https://x.example/cb');
    expect((bad.merchant_details as Record<string, unknown>).mobile_number).toBeUndefined();
    const none = buildCreditCardBody({ ...PARAMS, customer: { firstName: 'A', lastName: 'B', email: 'a@b.co' } }, 'a', 'https://x.example/cb');
    expect((none.merchant_details as Record<string, unknown>).mobile_number).toBeUndefined();
  });
});

describe('createPayment', () => {
  const CREATED = { status: 200, body: { status: 'success', message: 'Transaction created.', data: { txn_ref: 'YZ-0123456789', reference_number: 'HX-100', payment_url: 'https://pay.hexacorp.xyz/checkout/HX-100' } } };

  it('authenticates, creates on the live host and returns the hosted page and Hexacorp reference', async () => {
    const fetchMock = stubFetch(AUTH, CREATED);
    const result = await hexacorpProvider.createPayment(PARAMS);
    expect(result).toEqual({ providerPaymentId: 'HX-100', checkoutUrl: 'https://pay.hexacorp.xyz/checkout/HX-100' });

    const [authUrl, authInit] = fetchMock.mock.calls[0];
    expect(authUrl).toBe('https://api.payment.hexacorp.xyz/api/v1/auth/obtain-token/');
    expect(JSON.parse(authInit.body as string)).toEqual({ username: 'merchant-user', secret: 'merchant-secret-value', app_uuid: 'app-uuid' });

    const [payUrl, payInit] = fetchMock.mock.calls[1];
    expect(payUrl).toBe('https://api.payment.hexacorp.xyz/api/v1/payments/credit-card/');
    expect(payInit.headers.Authorization).toBe('Bearer tok-1');
    const body = JSON.parse(payInit.body as string);
    expect(body.callback_url).toBe(`https://shop.example/api/webhooks/hexacorp?k=${ENV.HEXACORP_WEBHOOK_SECRET}`);
    expect(body.merchant_details.txn_amount).toBe('141132.00');
    expect(body.txn_ref).toBe('YZ-0123456789');
  });

  it('url-encodes the webhook secret into the callback URL', async () => {
    vi.stubEnv('HEXACORP_WEBHOOK_SECRET', 'a b&c=d/e?f#g-0123456789');
    const fetchMock = stubFetch(AUTH, CREATED);
    await hexacorpProvider.createPayment(PARAMS);
    const body = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(body.callback_url).toBe('https://shop.example/api/webhooks/hexacorp?k=a%20b%26c%3Dd%2Fe%3Ff%23g-0123456789');
  });

  it('fails before any network call when the webhook secret is missing', async () => {
    vi.stubEnv('HEXACORP_WEBHOOK_SECRET', '');
    const fetchMock = stubFetch(AUTH, CREATED);
    await expect(hexacorpProvider.createPayment(PARAMS)).rejects.toBeInstanceOf(PaymentConfigError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws PaymentApiError, carrying the Hexacorp reference, when no payer URL comes back', async () => {
    stubFetch(AUTH, { status: 200, body: { status: 'success', data: { txn_ref: 'YZ-0123456789', reference_number: 'HX-777' } } });
    const error = await hexacorpProvider.createPayment(PARAMS).catch((e) => e);
    expect(error).toBeInstanceOf(PaymentApiError);
    expect(error.providerPaymentId).toBe('HX-777');
  });

  it('accepts a numeric reference_number, stored as a string', async () => {
    stubFetch(AUTH, { status: 200, body: { data: { reference_number: 4242, payment_url: 'https://pay.hexacorp.xyz/p/4242' } } });
    expect((await hexacorpProvider.createPayment(PARAMS)).providerPaymentId).toBe('4242');
  });

  it('REFUSES a payer URL that comes with no reference_number: a payment we could never match', async () => {
    // An `id` is NOT a reference_number: Transaction Inquiry takes only the latter.
    stubFetch(AUTH, { status: 200, body: { data: { id: 4242, payment_url: 'https://pay.hexacorp.xyz/p/4242' } } });
    const error = await hexacorpProvider.createPayment(PARAMS).catch((e) => e);
    expect(error).toBeInstanceOf(PaymentApiError);
    expect(error.providerPaymentId).toBeUndefined();
    stubFetch(AUTH, { status: 200, body: { data: { reference_number: '  ', payment_url: 'https://pay.hexacorp.xyz/p/1' } } });
    await expect(hexacorpProvider.createPayment(PARAMS)).rejects.toBeInstanceOf(PaymentApiError);
  });

  it('throws on a rejected create and never logs the webhook secret or credentials', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    stubFetch(AUTH, {
      status: 400,
      body: { message: 'Validation Failed!', errors: [{ callback_url: 'Callback URL is not reachable.' }], echoed: { callback_url: `https://shop.example/x?k=${ENV.HEXACORP_WEBHOOK_SECRET}`, secret: 'leak' } },
    });
    await expect(hexacorpProvider.createPayment(PARAMS)).rejects.toBeInstanceOf(PaymentApiError);
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).toContain('not reachable');
    expect(logged).not.toContain(ENV.HEXACORP_WEBHOOK_SECRET);
    expect(logged).not.toContain('leak');
    expect(logged).not.toContain(ENV.HEXACORP_SECRET);
  });

  it('throws when authentication fails or returns no token', async () => {
    stubFetch({ status: 401, body: { message: 'bad credentials' } });
    await expect(hexacorpProvider.createPayment(PARAMS)).rejects.toBeInstanceOf(PaymentApiError);
    stubFetch({ status: 200, body: { data: {} } });
    await expect(hexacorpProvider.createPayment(PARAMS)).rejects.toBeInstanceOf(PaymentApiError);
  });
});

describe('getPaymentStatus', () => {
  const record = (over: Record<string, unknown> = {}) => ({
    id: 'rec-1',
    amount: '141132.00',
    status: 'success',
    AccptncDtTm: '2026-11-21T10:00:00Z',
    ...over,
  });
  const inquiry = (...records: Record<string, unknown>[]) => ({ status: 200, body: { data: { records } } });
  const REF = { referenceId: 'YZ-0123456789', providerPaymentId: 'HX-100' };

  it('queries Transaction Inquiry with the STORED Hexacorp reference_number', async () => {
    const fetchMock = stubFetch(AUTH, inquiry(record()));
    await hexacorpProvider.getPaymentStatus(REF);
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.payment.hexacorp.xyz/api/v1/payments/transactions/inquiry/?reference_number=HX-100');
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer tok-1');
  });

  it('has NO fallback to our own txn_ref: with no stored reference it throws and asks Hexacorp nothing', async () => {
    const fetchMock = stubFetch(AUTH, inquiry(record()));
    await expect(hexacorpProvider.getPaymentStatus({ referenceId: 'YZ-0123456789' })).rejects.toBeInstanceOf(PaymentApiError);
    await expect(hexacorpProvider.getPaymentStatus({ referenceId: 'YZ-0123456789', providerPaymentId: '' })).rejects.toBeInstanceOf(PaymentApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps a success record to paid with the reported amount in pesos', async () => {
    stubFetch(AUTH, inquiry(record()));
    const s = await hexacorpProvider.getPaymentStatus(REF);
    expect(s).toMatchObject({ orderStatus: 'paid', amountPesos: 141132, rawStatus: 'success', providerPaymentId: 'HX-100' });
  });

  it.each([
    ['failed', 'failed'],
    ['pending', 'pending'],
    ['expired', 'cancelled'],
  ])('maps %s to %s', async (raw, expected) => {
    stubFetch(AUTH, inquiry(record({ status: raw })));
    expect((await hexacorpProvider.getPaymentStatus(REF)).orderStatus).toBe(expected);
  });

  it('treats an unrecognised status as no answer, never as paid', async () => {
    stubFetch(AUTH, inquiry(record({ status: 'ACTC' })));
    expect((await hexacorpProvider.getPaymentStatus(REF)).orderStatus).toBeNull();
  });

  it('refuses to resolve when two status fields disagree', async () => {
    stubFetch(AUTH, inquiry(record({ status: 'success', txn_status: 'pending' })));
    expect((await hexacorpProvider.getPaymentStatus(REF)).orderStatus).toBeNull();
  });

  it('blocks the amount when two amount fields disagree or one is unparseable', async () => {
    stubFetch(AUTH, inquiry(record({ amount: '100.00', txn_amount: '200.00' })));
    expect((await hexacorpProvider.getPaymentStatus(REF)).amountPesos).toBeNull();
    stubFetch(AUTH, inquiry(record({ amount: 'lots' })));
    expect((await hexacorpProvider.getPaymentStatus(REF)).amountPesos).toBeNull();
    stubFetch(AUTH, inquiry(record({ amount: undefined })));
    expect((await hexacorpProvider.getPaymentStatus(REF)).amountPesos).toBeNull();
  });

  it('refuses a record carrying a different txn_ref or reference_number', async () => {
    stubFetch(AUTH, inquiry(record({ txn_ref: 'YZ-FFFFFFFFFF' })));
    expect((await hexacorpProvider.getPaymentStatus(REF)).orderStatus).toBeNull();
    stubFetch(AUTH, inquiry(record({ reference_number: 'HX-OTHER' })));
    expect((await hexacorpProvider.getPaymentStatus(REF)).orderStatus).toBeNull();
  });

  it('does NOT refuse a record that simply carries no reference (the documented shape has none)', async () => {
    stubFetch(AUTH, inquiry(record()));
    expect((await hexacorpProvider.getPaymentStatus(REF)).orderStatus).toBe('paid');
  });

  it('treats failed attempts BEFORE a success as normal, and takes the latest record otherwise', async () => {
    stubFetch(AUTH, inquiry(record({ id: 'a', status: 'failed', AccptncDtTm: '2026-11-21T09:00:00Z' }), record({ id: 'b', status: 'success', AccptncDtTm: '2026-11-21T09:30:00Z' })));
    expect((await hexacorpProvider.getPaymentStatus(REF)).orderStatus).toBe('paid');
    stubFetch(AUTH, inquiry(record({ status: 'pending', AccptncDtTm: '2026-11-21T09:00:00Z' }), record({ status: 'failed', AccptncDtTm: '2026-11-21T10:00:00Z' })));
    expect((await hexacorpProvider.getPaymentStatus(REF)).orderStatus).toBe('failed');
  });

  it('refuses to resolve a success that a LATER record contradicts (void, expiry, failure)', async () => {
    for (const later of ['failed', 'expired', 'pending', 'refunded']) {
      stubFetch(AUTH, inquiry(record({ id: 'a', status: 'success', AccptncDtTm: '2026-11-21T09:00:00Z' }), record({ id: 'b', status: later, AccptncDtTm: '2026-11-21T10:00:00Z' })));
      const s = await hexacorpProvider.getPaymentStatus(REF);
      expect(s.orderStatus, later).toBeNull();
      expect(s.rawStatus, later).toBe(later); // reported, so the reconcile can flag it as UNRESOLVED
      expect(s.amountPesos).toBeNull();
    }
  });

  it('treats a 404 as "no transaction yet", not an outage', async () => {
    stubFetch(AUTH, { status: 404, body: { message: 'not found' } });
    const s = await hexacorpProvider.getPaymentStatus(REF);
    expect(s.orderStatus).toBeNull();
    expect(s.amountPesos).toBeNull();
  });

  it.each([
    ['records is null', { data: { records: null } }],
    ['data is empty', { data: {} }],
    ['an error envelope sent with HTTP 200', { message: 'Something went wrong', errors: [{ field: 'x' }] }],
    ['data is a string', { data: 'ok' }],
    ['records contains a non-object', { data: { records: ['x'] } }],
    ['there is no body at all', null],
  ])('THROWS on an unrecognised 200 response (%s) instead of reading it as "no transaction"', async (_label, body) => {
    stubFetch(AUTH, { status: 200, body });
    await expect(hexacorpProvider.getPaymentStatus(REF)).rejects.toBeInstanceOf(PaymentApiError);
  });

  it('does NOT read an error envelope under data as a failed payment: a status alone is not a transaction', async () => {
    for (const data of [{ status: 'error', message: 'upstream unavailable' }, { status: 'success', message: 'x' }]) {
      stubFetch(AUTH, { status: 200, body: { data } });
      await expect(hexacorpProvider.getPaymentStatus(REF)).rejects.toBeInstanceOf(PaymentApiError);
    }
  });

  it('still understands a single record under data that visibly carries a status', async () => {
    stubFetch(AUTH, { status: 200, body: { data: { status: 'success', amount: '141132.00' } } });
    expect(await hexacorpProvider.getPaymentStatus(REF)).toMatchObject({ orderStatus: 'paid', amountPesos: 141132 });
  });

  it('flags a contradicted success as ambiguous even when the later record has no status field', async () => {
    stubFetch(AUTH, inquiry(record({ id: 'a', status: 'success', AccptncDtTm: '2026-11-21T09:00:00Z' }), { id: 'b', AccptncDtTm: '2026-11-21T10:00:00Z' }));
    const s = await hexacorpProvider.getPaymentStatus(REF);
    expect(s).toMatchObject({ orderStatus: null, ambiguous: true, rawStatus: undefined });
  });

  it('treats an empty record list as no transaction', async () => {
    stubFetch(AUTH, inquiry());
    expect((await hexacorpProvider.getPaymentStatus(REF)).orderStatus).toBeNull();
  });

  it('throws on any other failure so the caller can record it', async () => {
    stubFetch(AUTH, { status: 500, body: { message: 'boom' } });
    await expect(hexacorpProvider.getPaymentStatus(REF)).rejects.toBeInstanceOf(PaymentApiError);
  });

  it('logs the shape of a response (key names) but never values', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    stubFetch(AUTH, inquiry(record({ masked_pan: '411111******1111' })));
    await hexacorpProvider.getPaymentStatus(REF);
    const logged = JSON.stringify(infoSpy.mock.calls);
    expect(logged).toContain('masked_pan');
    expect(logged).not.toContain('411111');
  });
});

describe('network failures and timeouts', () => {
  it.each([
    ['authentication', () => hexacorpProvider.createPayment(PARAMS)],
    ['inquiry', () => hexacorpProvider.getPaymentStatus({ referenceId: 'YZ-0123456789', providerPaymentId: 'HX-100' })],
  ])('turn a failed %s call into a PaymentApiError rather than a raw error', async (_name, run) => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Object.assign(new Error('timed out'), { name: 'TimeoutError' })));
    const error = await run().catch((e) => e);
    expect(error).toBeInstanceOf(PaymentApiError);
    expect(error.status).toBe(0);
  });

  it('puts a ceiling on every call and names the order when a CREATE does not complete', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: { token: 'tok' } }), { status: 200 }));
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(hexacorpProvider.createPayment(PARAMS)).rejects.toBeInstanceOf(PaymentApiError);
    for (const call of fetchMock.mock.calls) expect(call[1].signal).toBeInstanceOf(AbortSignal);
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).toContain('YZ-0123456789');
    expect(logged).toMatch(/may still hold a transaction/);
  });
});

describe('an incomplete CREATE is indeterminate; nothing else is', () => {
  const timeout = () => Object.assign(new Error('timed out'), { name: 'TimeoutError' });

  it('marks a create that did not complete as indeterminate: Hexacorp may hold a transaction we cannot see', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: { token: 'tok' } }), { status: 200 }));
    fetchMock.mockRejectedValueOnce(timeout());
    vi.stubGlobal('fetch', fetchMock);
    const error = await hexacorpProvider.createPayment(PARAMS).catch((e) => e);
    expect(error).toBeInstanceOf(PaymentApiError);
    expect(error.indeterminate).toBe(true);
    expect(error.providerPaymentId).toBeUndefined();
  });

  it('does not mark a failed authentication, a failed inquiry or an explicit refusal as indeterminate', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeout()));
    expect((await hexacorpProvider.createPayment(PARAMS).catch((e) => e)).indeterminate).toBeUndefined();
    expect((await hexacorpProvider.getPaymentStatus({ referenceId: 'YZ-0123456789', providerPaymentId: 'HX-1' }).catch((e) => e)).indeterminate).toBeUndefined();
    stubFetch(AUTH, { status: 400, body: { message: 'Validation Failed!' } });
    expect((await hexacorpProvider.createPayment(PARAMS).catch((e) => e)).indeterminate).toBeUndefined();
  });
});

describe('mapHexacorpStatus and redactForLog', () => {
  it('maps documented and synonym statuses case-insensitively and nothing else', () => {
    expect(mapHexacorpStatus(' SUCCESS ')).toBe('paid');
    expect(mapHexacorpStatus('Failed')).toBe('failed');
    expect(mapHexacorpStatus('processing')).toBe('pending');
    expect(mapHexacorpStatus('voided')).toBe('cancelled');
    expect(mapHexacorpStatus('refunded')).toBeNull();
    expect(mapHexacorpStatus('approved')).toBeNull(); // may be an authorisation never captured
    expect(mapHexacorpStatus('captured')).toBeNull();
    expect(mapHexacorpStatus(undefined)).toBeNull();
    expect(mapHexacorpStatus('')).toBeNull();
  });

  it('redacts credential-shaped keys at depth and leaves the rest', () => {
    expect(redactForLog({ message: 'm', callback_url: 'https://x.example/cb?k=1', nested: { password: 'p', ok: 1 }, list: [{ token: 't', x: 2 }] })).toEqual({
      message: 'm',
      callback_url: '[redacted]',
      nested: { password: '[redacted]', ok: 1 },
      list: [{ token: '[redacted]', x: 2 }],
    });
  });

  it('keeps Hexacorp\'s prose about the callback URL, which is the useful diagnostic', () => {
    expect(redactForLog({ errors: [{ callback_url: 'Callback URL is not reachable.' }] })).toEqual({
      errors: [{ callback_url: 'Callback URL is not reachable.' }],
    });
  });

  it('cuts an object nested past the depth limit instead of returning it unredacted', () => {
    const out = JSON.stringify(redactForLog({ a: { b: { c: { d: { secret_in_disguise: 'leak-me-0123456789' } } } } }));
    expect(out).not.toContain('leak-me');
    expect(out).toContain('[truncated]');
  });

  it('scrubs the literal webhook secret and merchant secret out of any string value', () => {
    const out = JSON.stringify(
      redactForLog({ detail: `bad ${ENV.HEXACORP_WEBHOOK_SECRET} and ${ENV.HEXACORP_SECRET}`, enc: encodeURIComponent(ENV.HEXACORP_WEBHOOK_SECRET) }),
    );
    expect(out).not.toContain(ENV.HEXACORP_WEBHOOK_SECRET);
    expect(out).not.toContain(ENV.HEXACORP_SECRET);
  });
});
