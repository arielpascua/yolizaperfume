import Link from 'next/link';
import { Bottle } from '@/components/ui/Bottle';
import { FragranceCard } from '@/components/shop/FragranceCard';
import { FAMILY_BLURB, FAMILY_HUE, FAMILY_LABEL } from '@/lib/catalog/labels';
import { listPublicFragrances } from '@/lib/catalog/public';
import { FAMILIES } from '@/lib/catalog/types';
import { VOLUME_IDS } from '@/lib/catalog/types';
import { VOLUMES } from '@/lib/catalog/data';

const HERO_SLUGS = ['salt-and-siargao', 'sampaguita-nocturne', 'narra-oud'] as const;
const FEATURED_SLUGS = ['sampaguita-nocturne', 'barako-smoke', 'dalandan-sol', 'tabon-amber'] as const;

const STEPS = [
  { n: '01', title: 'Browse the collection', body: 'Read the notes and see the volumes and case sizes. The catalogue shows no prices, so you can browse freely.' },
  { n: '02', title: 'Choose your cases', body: 'Open the order page: trade prices, case sizes and your total update as you go.' },
  { n: '03', title: 'Pay and we confirm', body: 'Pay by card on a secure page. We confirm your order in writing once we have checked stock.' },
] as const;

export default function HomePage() {
  const all = listPublicFragrances();
  const bySlug = new Map(all.map((f) => [f.slug, f]));
  const hero = HERO_SLUGS.map((s) => bySlug.get(s)!).filter(Boolean);
  const featured = FEATURED_SLUGS.map((s) => bySlug.get(s)!).filter(Boolean);
  const familyCount = (fam: string) => all.filter((f) => f.family === fam).length;
  const packs = VOLUME_IDS.map((id) => VOLUMES[id].casePack);

  return (
    <>
      {/* HERO */}
      <section className="on-dark grain relative overflow-hidden bg-nuit text-papier">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 top-1/2 h-[34rem] w-[34rem] -translate-y-1/2 rounded-full"
          style={{ background: 'radial-gradient(closest-side, rgba(228,174,85,0.30), rgba(228,174,85,0) 70%)' }}
        />
        <div className="container-page relative grid items-center gap-10 py-16 sm:py-20 lg:grid-cols-[1.1fr_1fr] lg:py-24">
          <div>
            <p className="label-on-dark">Wholesale perfumery · Trade only</p>
            <h1 className="mt-6 text-[clamp(3rem,8vw,6.5rem)] font-normal italic leading-[0.95] tracking-tight">
              Scent, sold
              <br />
              by the case.
            </h1>
            <p className="mt-7 max-w-md text-lg leading-relaxed text-or-soft">
              {all.length} fragrances in seven families, bottled for boutiques, salons, hotels and gifting buyers. Browse
              freely, then order by the case. Trade prices are on the order page.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/checkout" className="btn-gold">Order by the case</Link>
              <Link href="/collection" className="btn-quiet-dark">Browse the collection</Link>
            </div>
          </div>

          <div className="relative mx-auto flex w-full max-w-lg items-end justify-center" aria-hidden="true">
            {hero.map((f, i) => (
              <div
                key={f.slug}
                className="drift w-1/3"
                style={{
                  ['--r' as string]: `${(i - 1) * 4}deg`,
                  marginLeft: i === 0 ? 0 : '-4%',
                  marginBottom: i === 1 ? '3rem' : 0,
                  zIndex: i === 1 ? 2 : 1,
                  animationDelay: `${i * -2.4}s`,
                  width: i === 1 ? '40%' : '34%',
                }}
              >
                <Bottle shape={f.bottle.shape} liquid={f.bottle.liquid} cap={f.bottle.cap} uid={`hero-${f.slug}`} code={`No. 0${i + 1}`} />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* LEDGER */}
      <section aria-label="At a glance" className="border-y border-line bg-papier-deep">
        <dl className="container-page grid grid-cols-2 gap-y-6 py-7 md:grid-cols-4">
          {[
            [String(all.length), 'fragrances in the house'],
            ['7', 'scent families'],
            [`${Math.min(...packs)}–${Math.max(...packs)}`, 'bottles to a case'],
            ['1', 'order page, with trade prices'],
          ].map(([v, l]) => (
            <div key={l} className="px-2">
              <dt className="font-display text-4xl italic text-bordeaux">{v}</dt>
              <dd className="label-muted mt-1">{l}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* FAMILY INDEX */}
      <section className="container-page py-20">
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="label-muted">The index of scents</p>
            <h2 className="mt-3 text-4xl italic leading-tight sm:text-5xl">Seven families, one shelf.</h2>
            <p className="mt-4 max-w-sm text-ink-muted">
              Start with the families that already sell at your counter, then widen the range.
            </p>
          </div>
          <ul className="divide-y divide-line border-y border-line">
            {FAMILIES.map((fam) => (
              <li key={fam}>
                <Link href={`/collection?family=${fam}`} className="group flex items-center gap-4 py-5">
                  <span aria-hidden="true" className="h-10 w-1.5 shrink-0" style={{ background: FAMILY_HUE[fam] }} />
                  <span className="flex-1">
                    <span className="block font-display text-2xl text-ink group-hover:text-bordeaux">{FAMILY_LABEL[fam]}</span>
                    <span className="block text-sm text-ink-muted">{FAMILY_BLURB[fam]}</span>
                  </span>
                  <span className="label-muted whitespace-nowrap">{familyCount(fam)} {familyCount(fam) === 1 ? 'scent' : 'scents'}</span>
                  <span aria-hidden="true" className="text-bordeaux transition-transform group-hover:translate-x-1">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* FEATURED STRIPS */}
      <section className="bg-papier-deep py-20">
        <div className="container-page">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="label-muted">From the cabinet</p>
              <h2 className="mt-3 text-4xl italic sm:text-5xl">Four to start with.</h2>
            </div>
            <Link href="/collection" className="label border-b border-bordeaux pb-1 text-bordeaux">See all {all.length}</Link>
          </div>
          <ul className="mt-12 grid grid-cols-2 gap-x-5 gap-y-10 lg:grid-cols-4">
            {featured.map((f) => (
              <li key={f.slug}><FragranceCard fragrance={f} index={all.findIndex((x) => x.slug === f.slug)} /></li>
            ))}
          </ul>
        </div>
      </section>

      {/* HOW TRADE WORKS */}
      <section className="on-dark bg-nuit py-20 text-papier">
        <div className="container-page">
          <p className="label-on-dark">How trade works</p>
          <h2 className="mt-3 max-w-xl text-4xl italic sm:text-5xl">Browse here. Order there.</h2>
          <ol className="mt-12 grid gap-px bg-papier/15 md:grid-cols-3">
            {STEPS.map((s) => (
              <li key={s.n} className="bg-nuit p-7 md:p-9">
                <p className="font-display text-6xl italic text-or">{s.n}</p>
                <h3 className="mt-6 text-2xl">{s.title}</h3>
                <p className="mt-3 text-or-soft">{s.body}</p>
              </li>
            ))}
          </ol>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link href="/checkout" className="btn-gold">Order by the case</Link>
            <Link href="/enquiry" className="btn-quiet-dark">Open a trade enquiry</Link>
          </div>
        </div>
      </section>
    </>
  );
}
