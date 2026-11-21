// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderForm, type Orderable } from './OrderForm';
import { PaymentReturn } from './PaymentReturn';

let search = '';
// Stable per value, like the real hook: a fresh object per render would re-run effects forever.
vi.mock('next/navigation', () => {
  const cache = new Map<string, URLSearchParams>();
  return {
    useSearchParams: () => {
      if (!cache.has(search)) cache.set(search, new URLSearchParams(search));
      return cache.get(search)!;
    },
  };
});

const REF = 'YZ-0123456789';

const CATALOGUE: Orderable[] = [
  { id: 'yz-01', name: 'Sampaguita Nocturne', family: 'floral', volumes: [{ id: '50ml', label: '50 ml', casePack: 12, unitPrice: 880 }] },
];

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

let location: { href: string };

beforeEach(() => {
  location = { href: 'http://localhost/checkout' };
  Object.defineProperty(window, 'location', { value: location, writable: true });
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  sessionStorage.clear();
  search = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, buttonName: RegExp) {
  await user.type(screen.getByLabelText('Sampaguita Nocturne, 50 ml, cases'), '3');
  await user.type(screen.getByLabelText('Company *'), 'Casa Bella');
  await user.type(screen.getByLabelText('Contact name *'), 'Ana Reyes');
  await user.type(screen.getByLabelText('Email *'), 'ana@casabella.example');
  await user.type(screen.getByLabelText(/^(Mobile number|Phone) \*/), '0917 123 4567');
  await user.type(screen.getByLabelText('Street address *'), '1 Rizal St');
  await user.type(screen.getByLabelText('City or municipality *'), 'Cebu City');
  await user.type(screen.getByLabelText('Postal code *'), '6000');
  await user.click(screen.getByRole('button', { name: buttonName }));
}

const props = { catalogue: CATALOGUE, minimumOrder: 20000, paymentInstructions: null };

describe('OrderForm: card mode', () => {
  it('labels the action as card payment and asks for a Philippine mobile number', () => {
    render(<OrderForm {...props} payByCard />);
    expect(screen.getByRole('button', { name: 'Pay by card' })).toBeInTheDocument();
    expect(screen.getByLabelText('Mobile number *')).toBeInTheDocument();
    expect(screen.getByText(/Philippine mobile number/)).toBeInTheDocument();
  });

  it('navigates to a trusted Hexacorp page and keeps what the return page needs in this browser only', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json(200, { mode: 'card', reference: REF, totalCases: 3, totalBottles: 36, subtotal: 31680, discountPercent: 0, discount: 0, total: 31680, redirectUrl: 'https://pay.hexacorp.xyz/checkout/HX-100', token: 'poll-token' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<OrderForm {...props} payByCard />);
    await fillAndSubmit(user, /Pay by card/);

    await waitFor(() => expect(location.href).toBe('https://pay.hexacorp.xyz/checkout/HX-100'));
    expect(sessionStorage.getItem(`yz_pay_token_${REF}`)).toBe('poll-token');
    expect(sessionStorage.getItem('yz_last_ref')).toBe(REF);
    expect(sessionStorage.getItem('yz_order_link')).toBeNull(); // there is no link to remember any more

    // The request carried ids and case counts, never a price.
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sent.items).toEqual([{ fragranceId: 'yz-01', volumeId: '50ml', cases: 3 }]);
    expect(sent).not.toHaveProperty('link');
    expect(JSON.stringify(sent)).not.toMatch(/price|880|31680/i);
  });

  it.each([
    'http://pay.hexacorp.xyz/checkout/1',
    'https://pay.hexacorp.xyz.evil.example/x',
    'javascript:alert(1)',
    'https://evil.example/pay',
  ])('REFUSES to navigate to %s and shows the reference instead', async (redirectUrl) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, { mode: 'card', reference: REF, totalCases: 3, totalBottles: 36, subtotal: 1, discountPercent: 0, discount: 0, total: 1, redirectUrl, token: 't' })));
    const user = userEvent.setup();
    render(<OrderForm {...props} payByCard />);
    await fillAndSubmit(user, /Pay by card/);

    expect(await screen.findByText(/could not reach the payment page/i)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(REF))).toBeInTheDocument();
    expect(location.href).toBe('http://localhost/checkout');
    expect(screen.getByRole('button', { name: 'Pay by card' })).toBeEnabled(); // the buyer can retry
  });

  it('shows the server\'s refusal and stays on the page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(502, { error: 'We could not start the card payment. Nothing has been charged. Please try again in a moment.' })));
    const user = userEvent.setup();
    render(<OrderForm {...props} payByCard />);
    await fillAndSubmit(user, /Pay by card/);
    expect(await screen.findByText(/Nothing has been charged/)).toBeInTheDocument();
    expect(location.href).toBe('http://localhost/checkout');
  });
});

describe('OrderForm: test mode (flat PHP 10 test item)', () => {
  const TEST_CATALOGUE: Orderable[] = [
    { id: 'yz-test', name: 'Test item', family: 'test', volumes: [{ id: '10ml', label: 'Test unit', casePack: 1, unitPrice: 10 }] },
  ];
  const testProps = { catalogue: TEST_CATALOGUE, minimumOrder: 10, volumeDiscounts: false, paymentInstructions: null };

  it('accepts a PHP 10 order: the form applies the SAME minimum as the server, not the real one', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json(200, { mode: 'card', reference: REF, totalCases: 1, totalBottles: 1, subtotal: 10, discountPercent: 0, discount: 0, total: 10, redirectUrl: 'https://pay.hexacorp.xyz/checkout/HX-T', token: 't' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<OrderForm {...testProps} payByCard />);
    await user.type(screen.getByLabelText('Test item, Test unit, cases'), '1');
    expect(screen.getByRole('complementary', { name: 'Order summary' })).toHaveTextContent('₱10');
    await user.type(screen.getByLabelText('Company *'), 'Casa Bella');
    await user.type(screen.getByLabelText('Contact name *'), 'Ana Reyes');
    await user.type(screen.getByLabelText('Email *'), 'ana@casabella.example');
    await user.type(screen.getByLabelText('Mobile number *'), '0917 123 4567');
    await user.type(screen.getByLabelText('Street address *'), '1 Rizal St');
    await user.type(screen.getByLabelText('City or municipality *'), 'Cebu City');
    await user.type(screen.getByLabelText('Postal code *'), '6000');
    await user.click(screen.getByRole('button', { name: 'Pay by card' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByText(/minimum order is/i)).toBeNull();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).items).toEqual([{ fragranceId: 'yz-test', volumeId: '10ml', cases: 1 }]);
  });

  it('shows no volume discount at any quantity, matching the server, and no "add more for X% off" nudge', async () => {
    const user = userEvent.setup();
    render(<OrderForm {...testProps} payByCard />);
    await user.type(screen.getByLabelText('Test item, Test unit, cases'), '70'); // 15% off on real stock
    const docket = screen.getByRole('complementary', { name: 'Order summary' });
    expect(docket).toHaveTextContent('₱700');
    expect(docket).not.toHaveTextContent(/% off|Volume discount \(/);
  });
});

describe('OrderForm: invoice mode', () => {
  it('keeps the original behaviour: no redirect, a confirmation that says nothing was charged', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, { mode: 'invoice', reference: REF, totalCases: 3, totalBottles: 36, subtotal: 31680, discountPercent: 0, discount: 0, total: 31680 })));
    const user = userEvent.setup();
    render(<OrderForm {...props} payByCard={false} />);
    expect(screen.getByRole('button', { name: 'Place order' })).toBeInTheDocument();
    expect(screen.getByLabelText('Phone *')).toBeInTheDocument();
    await fillAndSubmit(user, /Place order/);
    expect(await screen.findByText(/Nothing has been charged/)).toBeInTheDocument();
    expect(location.href).toBe('http://localhost/checkout');
  });
});

describe('PaymentReturn', () => {
  function stubOrder(status: number, body: unknown) {
    const fetchMock = vi.fn().mockResolvedValue(json(status, body));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('polls with the stored token and shows a confirmation only when the SERVER says paid', async () => {
    search = `ref=${REF}`;
    sessionStorage.setItem(`yz_pay_token_${REF}`, 'poll-token');
    const fetchMock = stubOrder(200, { status: 'paid', reference: REF, totalCases: 3, totalBottles: 36 });
    render(<PaymentReturn />);
    expect(await screen.findByText(/Your payment is confirmed/)).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/orders/${REF}?token=poll-token`);
    expect(screen.getByText(/3 cases/)).toBeInTheDocument();
  });

  it('uses the reference this browser stashed when the payer returns without one', async () => {
    sessionStorage.setItem('yz_last_ref', REF);
    sessionStorage.setItem(`yz_pay_token_${REF}`, 'poll-token');
    const fetchMock = stubOrder(200, { status: 'paid', reference: REF, totalCases: 1, totalBottles: 12 });
    render(<PaymentReturn />);
    expect(await screen.findByText(/Your payment is confirmed/)).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toContain(REF);
  });

  it('is NOT fooled by an outcome claimed in the URL: it stays on "confirming" while the server says pending', async () => {
    search = `ref=${REF}&r=success&status=paid`;
    stubOrder(200, { status: 'pending', reference: REF, totalCases: 3, totalBottles: 36 });
    render(<PaymentReturn />);
    expect(await screen.findByText(/Confirming your payment/)).toBeInTheDocument();
    expect(screen.queryByText(/payment is confirmed/i)).toBeNull();
  });

  it('says the payment did not go through when the server reports failed, and offers the way back to the order page', async () => {
    search = `ref=${REF}`;
    stubOrder(200, { status: 'failed', reference: REF, totalCases: 3, totalBottles: 36 });
    render(<PaymentReturn />);
    expect(await screen.findByText(/did not go through/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to the order page/i })).toHaveAttribute('href', '/checkout');
    // `failed` is not final, so the page must not claim the card was not charged or invite a second payment blindly.
    expect(screen.getByText(/do not pay again/i)).toBeInTheDocument();
    expect(screen.queryByText(/was not charged/i)).toBeNull();
    expect(screen.getByText(new RegExp(REF))).toBeInTheDocument();
  });

  it('always offers the same way back, with no stored link needed', async () => {
    search = `ref=${REF}`;
    stubOrder(200, { status: 'failed', reference: REF, totalCases: 3, totalBottles: 36 });
    render(<PaymentReturn />);
    await screen.findByText(/did not go through/);
    expect(screen.getByRole('link', { name: /back to the order page/i })).toHaveAttribute('href', '/checkout');
  });

  it('reports "could not find that payment" for a 404 and for no reference at all', async () => {
    search = `ref=${REF}`;
    stubOrder(404, { error: 'Not found' });
    const first = render(<PaymentReturn />);
    expect(await screen.findByText(/could not find that payment/i)).toBeInTheDocument();
    first.unmount();

    search = '';
    const fetchMock = stubOrder(200, {});
    render(<PaymentReturn />);
    expect(await screen.findByText(/could not find that payment/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignores a malformed reference in the URL', async () => {
    search = 'ref=../../etc/passwd';
    const fetchMock = stubOrder(200, {});
    render(<PaymentReturn />);
    expect(await screen.findByText(/could not find that payment/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
