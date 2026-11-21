import { afterEach, describe, expect, it, vi } from 'vitest';
import { paymentMode, requestedProviders, resolveOrigin } from './config';
import { isTrustedPaymentUrl } from './trusted-url';

afterEach(() => vi.restoreAllMocks());

describe('paymentMode', () => {
  it('is invoice mode unless a known provider is listed', () => {
    expect(paymentMode({})).toBe('invoice');
    expect(paymentMode({ PAYMENT_PROVIDERS: '' })).toBe('invoice');
    expect(paymentMode({ PAYMENT_PROVIDERS: '  ' })).toBe('invoice');
    expect(paymentMode({ PAYMENT_PROVIDERS: 'hexacorp' })).toBe('card');
    expect(paymentMode({ PAYMENT_PROVIDERS: ' Hexacorp , other' })).toBe('card');
  });

  it('ignores an unknown provider (a typo must not select a gateway) and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(requestedProviders({ PAYMENT_PROVIDERS: 'maya, hexacorpp' })).toEqual([]);
    expect(paymentMode({ PAYMENT_PROVIDERS: 'maya' })).toBe('invoice');
    expect(warn).toHaveBeenCalled();
  });
});

describe('resolveOrigin', () => {
  it('uses NEXT_PUBLIC_SITE_URL, never the request, when it is set', () => {
    expect(resolveOrigin('https://evil.example', { NEXT_PUBLIC_SITE_URL: 'https://shop.example/', NODE_ENV: 'production' })).toBe('https://shop.example');
  });

  it.each(['production', 'development', 'test', undefined])('refuses when it is unset, invalid or not https (NODE_ENV=%s)', (nodeEnv) => {
    const base = { NODE_ENV: nodeEnv };
    expect(() => resolveOrigin('https://evil.example', base)).toThrow(/not set/);
    expect(() => resolveOrigin('https://x.example', { ...base, NEXT_PUBLIC_SITE_URL: 'not a url' })).toThrow();
    expect(() => resolveOrigin('https://x.example', { ...base, NEXT_PUBLIC_SITE_URL: 'http://shop.example' })).toThrow(/https/);
  });

  it('NEVER falls back to the request origin, in any environment', () => {
    expect(() => resolveOrigin('https://abc.ngrok.example', { NODE_ENV: 'development' })).toThrow();
    expect(resolveOrigin('https://evil.example', { NEXT_PUBLIC_SITE_URL: 'https://tunnel.example', NODE_ENV: 'development' })).toBe('https://tunnel.example');
  });
});

describe('isTrustedPaymentUrl', () => {
  it.each([
    'https://pay.hexacorp.xyz/checkout/1',
    'https://hexacorp.xyz/p',
    'https://a.b.hexacorp.xyz/p?x=1',
  ])('accepts %s', (url) => expect(isTrustedPaymentUrl(url)).toBe(true));

  it.each([
    'http://pay.hexacorp.xyz/checkout/1',
    'https://hexacorp.xyz.evil.example/p',
    'https://evilhexacorp.xyz/p',
    'https://user:pw@pay.hexacorp.xyz/p',
    'javascript:alert(1)',
    'data:text/html,hi',
    '//pay.hexacorp.xyz/p',
    'not a url',
    '',
    undefined,
    null,
    42,
  ])('refuses %s', (url) => expect(isTrustedPaymentUrl(url)).toBe(false));
});
