import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PaymentReturn } from '@/components/checkout/PaymentReturn';

// Private to the buyer's own payment: never indexed, never followed.
export const metadata: Metadata = {
  title: 'Payment status',
  robots: { index: false, follow: false, nocache: true, noarchive: true },
  referrer: 'no-referrer',
};

export default function PaymentReturnPage() {
  return (
    <div className="container-page py-16">
      <Suspense fallback={<p className="text-center text-ink-muted">Loading…</p>}>
        <PaymentReturn />
      </Suspense>
    </div>
  );
}
