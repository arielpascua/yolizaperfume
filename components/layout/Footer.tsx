import Link from 'next/link';
import { FAMILIES } from '@/lib/catalog/types';
import { FAMILY_LABEL } from '@/lib/catalog/labels';
import { CONTACT_EMAIL, SITE_NAME, SITE_TAGLINE } from '@/lib/site';
import { ENQUIRY_HREF, ORDER_HREF } from './nav';

export function Footer() {
  return (
    <footer className="on-dark relative overflow-hidden bg-nuit text-papier">
      <div className="container-page grid gap-12 py-16 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <p className="font-display text-5xl italic leading-none sm:text-6xl">{SITE_NAME}</p>
          <p className="label-on-dark mt-3">{SITE_TAGLINE}</p>
          <p className="mt-6 max-w-sm text-sm leading-relaxed text-or-soft">
            Fragrance for retailers, salons, hotels and gifting buyers, sold by the case. Browse freely; trade prices and
            ordering are on the order page.
          </p>
          <Link href={ORDER_HREF} className="btn-gold mt-8">
            Order by the case
          </Link>
        </div>

        <nav aria-label="Collection by family">
          <p className="label-on-dark mb-4">The collection</p>
          <ul className="space-y-2.5 text-sm">
            {FAMILIES.map((f) => (
              <li key={f}>
                <Link href={`/collection?family=${f}`} className="text-papier hover:text-or">
                  {FAMILY_LABEL[f]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label="House">
          <p className="label-on-dark mb-4">The house</p>
          <ul className="space-y-2.5 text-sm">
            <li><Link href={ORDER_HREF} className="text-papier hover:text-or">Order by the case</Link></li>
            <li><Link href="/trade" className="text-papier hover:text-or">How trade works</Link></li>
            <li><Link href={ENQUIRY_HREF} className="text-papier hover:text-or">Trade enquiry</Link></li>
            <li><Link href="/about" className="text-papier hover:text-or">About Yoliza</Link></li>
            <li><Link href="/legal/privacy" className="text-papier hover:text-or">Privacy</Link></li>
            <li><Link href="/legal/terms" className="text-papier hover:text-or">Trade terms</Link></li>
            {CONTACT_EMAIL ? (
              <li><a href={`mailto:${CONTACT_EMAIL}`} className="text-papier hover:text-or">{CONTACT_EMAIL}</a></li>
            ) : null}
          </ul>
        </nav>
      </div>
      <div className="border-t border-papier/10">
        <div className="container-page flex flex-col gap-2 py-5 sm:flex-row sm:justify-between">
          <p className="label-on-dark">© {new Date().getFullYear()} {SITE_NAME}. Trade only.</p>
          <p className="label-on-dark">Bottles shown are illustrations of each fragrance.</p>
        </div>
      </div>
    </footer>
  );
}
