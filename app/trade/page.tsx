import type { Metadata } from 'next';
import Link from 'next/link';
import { VOLUMES } from '@/lib/catalog/data';
import { VOLUME_IDS } from '@/lib/catalog/types';

export const metadata: Metadata = {
  title: 'Trade accounts',
  description: 'How wholesale ordering with Yoliza works: browse, choose your cases on the order page, pay by card.',
};

const FAQ = [
  {
    q: 'Who do you sell to?',
    a: 'Businesses: retailers, salons and spas, hotels and resorts, online resellers, distributors and corporate gifting buyers. If you buy fragrance to resell, use or give, you are who we sell to.',
  },
  {
    q: 'Why are there no prices in the collection?',
    a: 'The collection is for reading. Trade prices, case sizes and your total are on the order page, where you place the order, so they are always in one place and never out of date.',
  },
  {
    q: 'Do I need an account?',
    a: 'No. Browse the whole collection and order from the order page. Write to us through the trade enquiry if you want samples first or to talk about volume.',
  },
  {
    q: 'Can I order samples first?',
    a: 'Yes. Tick the samples box on the trade enquiry and tell us which fragrances you want to smell.',
  },
  {
    q: 'What happens when I place an order?',
    a: 'You pay by card on a secure Hexacorp page, and we never see your card details. We confirm the order in writing once we have checked stock. Freight and any applicable taxes are invoiced separately.',
  },
];

export default function TradePage() {
  return (
    <>
      <section className="on-dark grain relative overflow-hidden bg-nuit py-20 text-papier">
        <div className="container-page max-w-4xl">
          <p className="label-on-dark">How trade works</p>
          <h1 className="mt-4 text-5xl italic leading-tight sm:text-7xl">One page. Your prices. Your cases.</h1>
          <p className="mt-6 max-w-xl text-lg text-or-soft">
            Yoliza sells to businesses, by the case. Open the order page for trade prices and place your order, or write to us
            first if you would like samples.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/checkout" className="btn-gold">Order by the case</Link>
            <Link href="/enquiry" className="btn-quiet-dark">Open a trade enquiry</Link>
          </div>
        </div>
      </section>

      <section className="container-page grid gap-12 py-20 lg:grid-cols-2">
        <div>
          <h2 className="text-4xl italic">How a case works</h2>
          <p className="mt-4 text-lg text-ink-muted">
            A case is a fixed number of bottles of one fragrance in one volume. You order whole cases, and you can mix
            fragrances and volumes in one order.
          </p>
        </div>
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">Bottles per case by volume</caption>
          <thead>
            <tr className="border-b border-ink">
              <th scope="col" className="label-muted py-2 font-medium">Volume</th>
              <th scope="col" className="label-muted py-2 font-medium">Bottles per case</th>
            </tr>
          </thead>
          <tbody>
            {VOLUME_IDS.map((id) => (
              <tr key={id} className="border-b border-line">
                <td className="py-3 font-display text-xl">{VOLUMES[id].label}</td>
                <td className="py-3 label text-ink">{VOLUMES[id].casePack}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="bg-papier-deep py-20">
        <div className="container-page max-w-3xl">
          <h2 className="text-4xl italic">Questions, answered</h2>
          <dl className="mt-8 divide-y divide-line border-y border-line">
            {FAQ.map((f) => (
              <div key={f.q} className="py-6">
                <dt className="font-display text-2xl">{f.q}</dt>
                <dd className="mt-2 text-lg leading-relaxed text-ink-muted">{f.a}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-8 text-ink-muted">
            The full terms are on the <Link href="/legal/terms" className="text-bordeaux underline underline-offset-4">trade terms</Link> page.
          </p>
        </div>
      </section>
    </>
  );
}
