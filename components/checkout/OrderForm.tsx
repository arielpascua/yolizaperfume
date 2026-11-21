'use client';

import { useId, useMemo, useState } from 'react';
import { formatPeso } from '@/lib/format';
import { isTrustedPaymentUrl } from '@/lib/payments/trusted-url';
import { MAX_CASES_PER_LINE, VOLUME_BREAKS, discountPercentFor, totalsFor } from '@/lib/pricing-math';
import { ORDER_LIMITS as L, type OrderRequest, type OrderResponse } from '@/lib/checkout/types';

export interface OrderableVolume {
  id: string;
  label: string;
  casePack: number;
  unitPrice: number;
}
export interface Orderable {
  id: string;
  name: string;
  family: string;
  volumes: OrderableVolume[];
}

const FALLBACK = 'We could not place your order just now. Nothing has been sent. Please try again in a moment.';

async function send(req: OrderRequest): Promise<{ ok: true; order: OrderResponse } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    });
    const json = (await res.json()) as Partial<OrderResponse> & { error?: string };
    if (res.ok && typeof json.reference === 'string') return { ok: true, order: json as OrderResponse };
    return { ok: false, error: typeof json.error === 'string' ? json.error : FALLBACK };
  } catch {
    return { ok: false, error: FALLBACK };
  }
}

export function OrderForm({
  catalogue,
  minimumOrder,
  volumeDiscounts = true,
  paymentInstructions,
  payByCard,
}: {
  catalogue: Orderable[];
  minimumOrder: number;
  /** False in test mode: the flat-price test item gets no volume discount, exactly as on the server. */
  volumeDiscounts?: boolean;
  paymentInstructions: string | null;
  /** True when the server takes card payment (PAYMENT_PROVIDERS): the buyer pays on Hexacorp's page. */
  payByCard: boolean;
}) {
  const uid = useId();
  const f = (n: string) => `${uid}-${n}`;
  const [cases, setCases] = useState<Record<string, number>>({});
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<OrderResponse | null>(null);

  const key = (fid: string, vid: string) => `${fid}:${vid}`;

  const lines = useMemo(
    () =>
      catalogue.flatMap((fr) =>
        fr.volumes.flatMap((v) => {
          const n = cases[key(fr.id, v.id)] ?? 0;
          return n > 0 ? [{ fr, v, cases: n }] : [];
        }),
      ),
    [catalogue, cases],
  );
  // The SAME minimum and discount rule the server applies (it recomputes everything anyway).
  const totals = totalsFor(
    lines.map((l) => ({ cases: l.cases, casePack: l.v.casePack, unitPrice: l.v.unitPrice })),
    minimumOrder,
    volumeDiscounts,
  );

  const nextBreak = !volumeDiscounts ? undefined : VOLUME_BREAKS.find((b) => b.minCases > totals.totalCases && b.percent > discountPercentFor(totals.totalCases));

  function setQty(fid: string, vid: string, raw: number) {
    const n = Math.max(0, Math.min(MAX_CASES_PER_LINE, Math.floor(Number.isFinite(raw) ? raw : 0)));
    setCases((c) => ({ ...c, [key(fid, vid)]: n }));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state === 'sending') return;
    if (lines.length === 0) {
      setError('Add at least one case to your order.');
      return;
    }
    if (!totals.meetsMinimum) {
      setError(`The minimum order is ${formatPeso(minimumOrder)}. Your order is ${formatPeso(totals.total)}.`);
      return;
    }
    const form = new FormData(e.currentTarget);
    const t = (k: string) => String(form.get(k) ?? '');
    setState('sending');
    setError(null);
    const result = await send({
      buyer: { company: t('company'), contactName: t('contactName'), email: t('email'), phone: t('phone'), taxId: t('taxId') },
      shipping: { line1: t('line1'), line2: t('line2'), city: t('city'), region: t('region'), postalCode: t('postalCode'), country: t('country') },
      poNumber: t('poNumber'),
      notes: t('notes'),
      website: t('website'),
      items: lines.map((l) => ({ fragranceId: l.fr.id, volumeId: l.v.id, cases: l.cases })),
    });
    if (result.ok && result.order.mode === 'card') {
      // Only ever navigate to an https page on Hexacorp's own domain. Validate the SERVER's answer.
      if (!isTrustedPaymentUrl(result.order.redirectUrl)) {
        setError(
          `We could not reach the payment page. Nothing has been charged. Please try again. If this continues, quote reference ${result.order.reference}.`,
        );
        setState('idle');
        return;
      }
      // The browser is about to leave this origin, so React state will not survive. Keep, in THIS
      // browser only, what the return page needs: the poll token and the reference.
      try {
        sessionStorage.setItem(`yz_pay_token_${result.order.reference}`, result.order.token ?? '');
        sessionStorage.setItem('yz_last_ref', result.order.reference);
      } catch {
        // Private mode: the payment still settles through the webhook; only the on-page status is lost.
      }
      window.location.href = result.order.redirectUrl;
      return; // stays in `sending`: the page is navigating away
    }
    if (result.ok) {
      setPlaced(result.order);
      setState('done');
      window.scrollTo({ top: 0 });
    } else {
      setError(result.error);
      setState('idle');
    }
  }

  if (state === 'done' && placed) {
    return (
      <div role="status" className="mx-auto max-w-2xl border border-ink bg-papier-deep p-8 sm:p-12">
        <p className="label-muted">Order received</p>
        <h2 className="mt-3 text-4xl italic leading-tight">Your order is with us.</h2>
        <p className="mt-4 text-lg">
          Reference <strong className="font-label font-medium tracking-wide">{placed.reference}</strong>
        </p>
        <dl className="mt-6 grid grid-cols-2 gap-4 border-y border-line py-5">
          <div><dt className="label-muted">Cases</dt><dd className="font-display text-2xl">{placed.totalCases}</dd></div>
          <div><dt className="label-muted">Bottles</dt><dd className="font-display text-2xl">{placed.totalBottles}</dd></div>
          <div className="col-span-2"><dt className="label-muted">Order total, before freight and taxes</dt><dd className="font-display text-3xl">{formatPeso(placed.total)}</dd></div>
        </dl>
        <p className="mt-5 text-ink-muted">
          Nothing has been charged. We will check stock and email you an invoice with freight, any applicable taxes and
          payment instructions. Your order is confirmed when we confirm it in writing.
        </p>
        {paymentInstructions ? (
          <p className="mt-4 whitespace-pre-line border-l-4 border-bordeaux bg-white p-4 text-sm">{paymentInstructions}</p>
        ) : null}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-10 lg:grid-cols-[1.5fr_1fr]">
      <div className="space-y-14">
        {/* 1. THE MATRIX */}
        <section aria-labelledby={f('h-cases')}>
          <h2 id={f('h-cases')} className="font-display text-3xl italic"><span className="label-muted mr-3 not-italic">01</span>Choose your cases</h2>
          <p className="mt-2 text-ink-muted">Enter whole cases. Prices are per bottle; a case is the number of bottles shown.</p>
          <ul className="mt-6 divide-y divide-line border-y border-ink">
            {catalogue.map((fr) => (
              <li key={fr.id} className="grid gap-3 py-5 sm:grid-cols-[minmax(0,1fr)_2fr] sm:items-center">
                <p className="font-display text-2xl leading-tight">{fr.name}</p>
                <div className={`grid gap-3 ${fr.volumes.length === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
                  {fr.volumes.map((v) => {
                    const id = f(`${fr.id}-${v.id}`);
                    const n = cases[key(fr.id, v.id)] ?? 0;
                    return (
                      <div key={v.id} className={`border p-2 ${n > 0 ? 'border-bordeaux bg-white' : 'border-line'}`}>
                        <label htmlFor={id} className="label-muted block">{v.label}</label>
                        <p className="mt-1 font-display text-lg leading-none">{formatPeso(v.unitPrice)}</p>
                        <p className="label-muted mt-1 text-[0.62rem]">{v.casePack} per case</p>
                        <input
                          id={id}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={MAX_CASES_PER_LINE}
                          value={n === 0 ? '' : n}
                          placeholder="0"
                          aria-label={`${fr.name}, ${v.label}, cases`}
                          onChange={(e) => setQty(fr.id, v.id, Number(e.target.value))}
                          className="field mt-2 !px-2 !py-2 text-center"
                        />
                      </div>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* 2. BUYER */}
        <section aria-labelledby={f('h-buyer')} className="space-y-5">
          <h2 id={f('h-buyer')} className="font-display text-3xl italic"><span className="label-muted mr-3 not-italic">02</span>Your business</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor={f('company')} className="field-label">Company *</label>
              <input id={f('company')} name="company" required maxLength={L.company} autoComplete="organization" className="field" />
            </div>
            <div>
              <label htmlFor={f('contactName')} className="field-label">Contact name *</label>
              <input id={f('contactName')} name="contactName" required maxLength={L.name} autoComplete="name" className="field" />
            </div>
            <div>
              <label htmlFor={f('email')} className="field-label">Email *</label>
              <input id={f('email')} name="email" type="email" required maxLength={L.email} autoComplete="email" className="field" />
            </div>
            <div>
              <label htmlFor={f('phone')} className="field-label">{payByCard ? 'Mobile number *' : 'Phone *'}</label>
              <input
                id={f('phone')}
                name="phone"
                type="tel"
                required
                maxLength={L.phone}
                autoComplete="tel"
                placeholder={payByCard ? '0917 123 4567' : undefined}
                aria-describedby={payByCard ? f('phone-hint') : undefined}
                className="field"
              />
              {payByCard ? (
                <p id={f('phone-hint')} className="mt-1 text-xs text-ink-muted">A Philippine mobile number: the card payment requires one.</p>
              ) : null}
            </div>
            <div>
              <label htmlFor={f('taxId')} className="field-label">Tax ID</label>
              <input id={f('taxId')} name="taxId" maxLength={L.taxId} className="field" />
            </div>
            <div>
              <label htmlFor={f('poNumber')} className="field-label">Your PO number</label>
              <input id={f('poNumber')} name="poNumber" maxLength={L.poNumber} className="field" />
            </div>
          </div>
        </section>

        {/* 3. DELIVERY */}
        <section aria-labelledby={f('h-ship')} className="space-y-5">
          <h2 id={f('h-ship')} className="font-display text-3xl italic"><span className="label-muted mr-3 not-italic">03</span>Deliver to</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor={f('line1')} className="field-label">Street address *</label>
              <input id={f('line1')} name="line1" required maxLength={L.line} autoComplete="address-line1" className="field" />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor={f('line2')} className="field-label">Address line 2</label>
              <input id={f('line2')} name="line2" maxLength={L.line} autoComplete="address-line2" className="field" />
            </div>
            <div>
              <label htmlFor={f('city')} className="field-label">City or municipality *</label>
              <input id={f('city')} name="city" required maxLength={L.city} autoComplete="address-level2" className="field" />
            </div>
            <div>
              <label htmlFor={f('region')} className="field-label">Province or region</label>
              <input id={f('region')} name="region" maxLength={L.region} autoComplete="address-level1" className="field" />
            </div>
            <div>
              <label htmlFor={f('postalCode')} className="field-label">Postal code *</label>
              <input id={f('postalCode')} name="postalCode" required maxLength={L.postal} autoComplete="postal-code" className="field" />
            </div>
            <div>
              <label htmlFor={f('country')} className="field-label">Country *</label>
              <input id={f('country')} name="country" required maxLength={L.country} defaultValue="Philippines" autoComplete="country-name" className="field" />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor={f('notes')} className="field-label">Delivery notes</label>
              <textarea id={f('notes')} name="notes" rows={3} maxLength={L.notes} className="field" />
            </div>
          </div>
          <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
            <label htmlFor={f('website')}>Leave this field empty</label>
            <input id={f('website')} name="website" tabIndex={-1} autoComplete="off" />
          </div>
        </section>
      </div>

      {/* THE DOCKET */}
      <aside aria-label="Order summary" className="on-dark h-fit bg-nuit p-6 text-papier sm:p-8 lg:sticky lg:top-24">
        <p className="label-on-dark">Order docket</p>
        <h2 className="mt-2 font-display text-3xl italic">Your order</h2>

        {lines.length === 0 ? (
          <p className="mt-6 border border-dashed border-papier/30 p-4 text-sm text-or-soft">Nothing yet. Enter cases on the left.</p>
        ) : (
          <ul className="mt-6 divide-y divide-papier/15 border-y border-papier/15">
            {lines.map((l) => (
              <li key={`${l.fr.id}-${l.v.id}`} className="flex items-baseline justify-between gap-3 py-3">
                <span>
                  <span className="block font-display text-lg leading-tight">{l.fr.name}</span>
                  <span className="label-on-dark">{l.v.label} · {l.cases} {l.cases === 1 ? 'case' : 'cases'} · {l.cases * l.v.casePack} btl</span>
                </span>
                <span className="font-label text-sm">{formatPeso(l.cases * l.v.casePack * l.v.unitPrice)}</span>
              </li>
            ))}
          </ul>
        )}

        <dl className="mt-5 space-y-2 font-label text-sm">
          <div className="flex justify-between"><dt className="text-or-soft">Cases / bottles</dt><dd>{totals.totalCases} / {totals.totalBottles}</dd></div>
          <div className="flex justify-between"><dt className="text-or-soft">Subtotal</dt><dd>{formatPeso(totals.subtotal)}</dd></div>
          <div className="flex justify-between">
            <dt className="text-or-soft">Volume discount{totals.discountPercent ? ` (${totals.discountPercent}%)` : ''}</dt>
            <dd>{totals.discount ? `−${formatPeso(totals.discount)}` : '—'}</dd>
          </div>
          <div className="flex items-baseline justify-between border-t border-papier/30 pt-3 text-base">
            <dt>Total</dt>
            <dd className="font-display text-3xl italic text-or">{formatPeso(totals.total)}</dd>
          </div>
        </dl>

        {nextBreak ? (
          <p className="mt-4 border-l-2 border-or pl-3 text-sm text-or-soft">
            Add {nextBreak.minCases - totals.totalCases} more {nextBreak.minCases - totals.totalCases === 1 ? 'case' : 'cases'} for {nextBreak.percent}% off the whole order.
          </p>
        ) : null}
        <p className="mt-4 text-sm text-or-soft">
          Minimum order {formatPeso(minimumOrder)}. Totals are before freight and any applicable taxes, which we confirm on your invoice.
        </p>

        <div aria-live="polite" className="mt-4">
          {error ? <p role="alert" className="border-l-4 border-or bg-nuit-raised p-3 text-sm text-papier">{error}</p> : null}
        </div>
        <button type="submit" disabled={state === 'sending'} className="btn-gold mt-4 w-full">
          {state === 'sending' ? (payByCard ? 'Opening the payment page…' : 'Placing order…') : payByCard ? 'Pay by card' : 'Place order'}
        </button>
        <p className="mt-3 text-xs text-or-soft">
          {payByCard
            ? 'You will be taken to Hexacorp to pay by card, then your order is confirmed by us in writing. Freight and any applicable taxes are invoiced separately.'
            : 'Placing an order sends it to us. Nothing is charged until we invoice you.'}
        </p>
      </aside>
    </form>
  );
}
