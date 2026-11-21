// The one checkout, at /checkout, open to anyone. There is no /checkout/<anything> and no order link:
// the old signed-link gate is gone, so this page shows the trade prices to every visitor.
//
// It is rendered per request (never prerendered) because what it offers depends on the environment at
// request time: card or invoice mode, and test mode (CHECKOUT_TEST_ITEM), in which the ONLY thing on the
// page is a PHP 10 test item. It is noindex (see layout.tsx): it is for buyers, not for search.

import type { Metadata } from 'next';
import { OrderForm } from '@/components/checkout/OrderForm';
import { paymentMode } from '@/lib/payments/config';
import { minimumOrderPesos, orderableCatalogue, testItemOnly } from '@/lib/pricing';
import { PAYMENT_INSTRUCTIONS } from '@/lib/site';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Order' };

export default function CheckoutPage() {
  const payByCard = paymentMode() === 'card';
  const testMode = testItemOnly();

  return (
    <div className="container-page py-12">
      <header className="mb-10 max-w-2xl">
        <p className="label-muted">The order page</p>
        <h1 className="mt-3 text-5xl italic leading-tight sm:text-6xl">Order by the case.</h1>
        <p className="mt-4 text-lg text-ink-muted">
          Prices on this page are trade prices, per bottle, before freight and any applicable taxes. Orders are placed in
          whole cases.
        </p>
        {testMode ? (
          <p role="note" className="mt-6 border-l-4 border-bordeaux bg-papier-deep p-4 text-base">
            <strong className="font-label text-xs uppercase tracking-label">Test mode.</strong> Only a single test item is
            available right now, so a payment can be checked end to end. It is a real payment: the card is charged.
          </p>
        ) : null}
      </header>
      <OrderForm
        catalogue={orderableCatalogue()}
        minimumOrder={minimumOrderPesos()}
        volumeDiscounts={!testMode}
        paymentInstructions={payByCard ? null : PAYMENT_INSTRUCTIONS}
        payByCard={payByCard}
      />
    </div>
  );
}
