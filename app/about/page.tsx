import type { Metadata } from 'next';
import Link from 'next/link';
import { Bottle } from '@/components/ui/Bottle';
import { listPublicFragrances } from '@/lib/catalog/public';

export const metadata: Metadata = {
  title: 'The house',
  description: 'Yoliza is a wholesale perfumery for trade buyers. How the collection is organised and how we work.',
};

const PRINCIPLES = [
  { t: 'Scents with a place', b: 'Every fragrance is named for an ingredient, a flower or a landscape, so a salesperson can describe it in one sentence.' },
  { t: 'Sold by the case', b: 'Fixed case packs keep ordering simple and the shelf stocked. There are no half measures and no hidden unit rules.' },
  { t: 'Prices in one place', b: 'Trade prices are shown on the order page and nowhere else, never scattered across the catalogue, so they are always current.' },
];

export default function AboutPage() {
  const f = listPublicFragrances();
  const trio = [f[0], f[6], f[9]].filter(Boolean);
  return (
    <>
      <section className="container-page grid items-center gap-12 py-20 lg:grid-cols-2">
        <div>
          <p className="label-muted">The house</p>
          <h1 className="mt-4 text-5xl italic leading-tight sm:text-6xl">A perfumery that only talks to the trade.</h1>
          <p className="mt-6 text-lg leading-relaxed text-ink-muted">
            Yoliza is a wholesale perfumery. We offer a focused collection of {f.length} fragrances in seven families, and we sell
            it to businesses: boutiques, salons, hotels, online shops and gifting buyers.
          </p>
          <p className="mt-4 text-lg leading-relaxed text-ink-muted">
            This site is built around that. You can read about every scent without signing in, and when you are ready you order
            by the case on the order page. Write to us first if you would like samples.
          </p>
          <Link href="/checkout" className="btn-primary mt-8">Order by the case</Link>
        </div>
        <div className="on-dark grain relative flex items-end justify-center gap-0 overflow-hidden bg-nuit px-6 pt-16" aria-hidden="true">
          {trio.map((x, i) => (
            <div key={x.slug} className="w-1/3" style={{ marginLeft: i ? '-3%' : 0, marginBottom: i === 1 ? '2rem' : 0 }}>
              <Bottle shape={x.bottle.shape} liquid={x.bottle.liquid} cap={x.bottle.cap} uid={`about-${x.slug}`} />
            </div>
          ))}
        </div>
      </section>

      <section className="bg-papier-deep py-20">
        <div className="container-page">
          <h2 className="text-4xl italic">How we work</h2>
          <ul className="mt-10 grid gap-8 md:grid-cols-3">
            {PRINCIPLES.map((p, i) => (
              <li key={p.t} className="border-t border-ink pt-5">
                <p className="label-muted">0{i + 1}</p>
                <h3 className="mt-3 text-2xl">{p.t}</h3>
                <p className="mt-2 text-ink-muted">{p.b}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
