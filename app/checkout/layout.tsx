import type { Metadata } from 'next';

// The order page is for buyers, not for search: never indexed, never followed, never cached by a shared cache.
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true, noarchive: true },
  referrer: 'no-referrer',
};

export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
