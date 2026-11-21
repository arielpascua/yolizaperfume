import type { Metadata } from 'next';
import Link from 'next/link';
import { FragranceCard } from '@/components/shop/FragranceCard';
import { CONCENTRATION_LABEL, FAMILY_HUE, FAMILY_LABEL, WEAR_LABEL } from '@/lib/catalog/labels';
import { listPublicFragrances } from '@/lib/catalog/public';
import { CONCENTRATIONS, FAMILIES, WEARS } from '@/lib/catalog/types';
import { applyFilters, collectionHref, parseFilters, type Filters } from '@/lib/shop/filters';

export const metadata: Metadata = {
  title: 'The collection',
  description: 'Every Yoliza fragrance by family, concentration and wear. Trade prices are on the order page.',
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function Chip({ href, active, children, swatch }: { href: string; active: boolean; children: React.ReactNode; swatch?: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={`inline-flex min-h-[40px] items-center gap-2 border px-4 label transition-colors ${
        active ? 'border-ink bg-ink text-papier' : 'border-ink-muted text-ink hover:bg-papier-deep'
      }`}
    >
      {swatch ? <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: swatch }} /> : null}
      {children}
    </Link>
  );
}

export default async function CollectionPage({ searchParams }: { searchParams: SearchParams }) {
  const filters = parseFilters(await searchParams);
  const all = listPublicFragrances();
  const shown = applyFilters(all, filters);
  const without = (key: keyof Filters): Filters => ({ ...filters, [key]: undefined });
  const active = Boolean(filters.family || filters.wear || filters.concentration || filters.q);

  return (
    <div className="container-page py-14">
      <header className="max-w-2xl">
        <p className="label-muted">The collection</p>
        <h1 className="mt-3 text-5xl italic leading-tight sm:text-6xl">
          {filters.family ? FAMILY_LABEL[filters.family] : 'Every fragrance in the house'}
        </h1>
        <p className="mt-4 text-ink-muted">
          No prices on this page, by design: the collection is for reading. Trade prices, case sizes and your total are on
          the order page.
        </p>
      </header>

      <section aria-label="Filters" className="mt-10 space-y-5 border-y border-line py-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="label-muted w-24">Family</span>
          <Chip href={collectionHref(without('family'))} active={!filters.family}>All</Chip>
          {FAMILIES.map((f) => (
            <Chip key={f} href={collectionHref({ ...filters, family: f })} active={filters.family === f} swatch={FAMILY_HUE[f]}>
              {FAMILY_LABEL[f]}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="label-muted w-24">Wear</span>
          <Chip href={collectionHref(without('wear'))} active={!filters.wear}>All</Chip>
          {WEARS.map((w) => (
            <Chip key={w} href={collectionHref({ ...filters, wear: w })} active={filters.wear === w}>{WEAR_LABEL[w]}</Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="label-muted w-24">Strength</span>
          <Chip href={collectionHref(without('concentration'))} active={!filters.concentration}>All</Chip>
          {CONCENTRATIONS.map((c) => (
            <Chip key={c} href={collectionHref({ ...filters, concentration: c })} active={filters.concentration === c}>
              {CONCENTRATION_LABEL[c]}
            </Chip>
          ))}
        </div>
        <form action="/collection" method="get" role="search" className="flex flex-wrap items-center gap-2">
          <label htmlFor="q" className="label-muted w-24">Search notes</label>
          <input id="q" name="q" defaultValue={filters.q ?? ''} placeholder="Jasmine, vetiver, amber…" maxLength={60} className="field max-w-xs" />
          {filters.family ? <input type="hidden" name="family" value={filters.family} /> : null}
          {filters.wear ? <input type="hidden" name="wear" value={filters.wear} /> : null}
          {filters.concentration ? <input type="hidden" name="concentration" value={filters.concentration} /> : null}
          <button type="submit" className="btn-quiet">Search</button>
          {active ? <Link href="/collection" className="label ml-2 border-b border-bordeaux text-bordeaux">Clear all</Link> : null}
        </form>
      </section>

      <p className="label-muted mt-8" role="status">{shown.length} of {all.length} fragrances</p>

      {shown.length === 0 ? (
        <div className="mt-8 border border-line bg-papier-deep p-10 text-center">
          <p className="font-display text-3xl italic">Nothing on the shelf matches that.</p>
          <p className="mt-2 text-ink-muted">Try a broader family, or search for a single note such as “musk”.</p>
          <Link href="/collection" className="btn-quiet mt-6">See the whole collection</Link>
        </div>
      ) : (
        <ul className="mt-8 grid grid-cols-2 gap-x-5 gap-y-12 md:grid-cols-3 lg:grid-cols-4">
          {shown.map((f) => (
            <li key={f.slug}><FragranceCard fragrance={f} index={all.findIndex((x) => x.slug === f.slug)} /></li>
          ))}
        </ul>
      )}
    </div>
  );
}
