import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FragranceCard } from '@/components/shop/FragranceCard';
import { NotesLadder } from '@/components/shop/NotesLadder';
import { Bottle } from '@/components/ui/Bottle';
import { CONCENTRATION_LABEL, FAMILY_LABEL, WEAR_LABEL } from '@/lib/catalog/labels';
import { getPublicFragrance, listPublicFragrances, relatedFragrances } from '@/lib/catalog/public';

export const dynamicParams = false;

export function generateStaticParams() {
  return listPublicFragrances().map((f) => ({ slug: f.slug }));
}

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const f = getPublicFragrance((await params).slug);
  if (!f) return {};
  return { title: f.name, description: `${f.name}: ${f.tagline} ${CONCENTRATION_LABEL[f.concentration]}, ${FAMILY_LABEL[f.family].toLowerCase()} family. Available to trade accounts by the case.` };
}

export default async function FragrancePage({ params }: { params: Params }) {
  const { slug } = await params;
  const f = getPublicFragrance(slug);
  if (!f) notFound();
  const all = listPublicFragrances();
  const related = relatedFragrances(slug, 3);

  return (
    <>
      <div className="grid lg:grid-cols-2">
        <section aria-label={`${f.name} bottle`} className="on-dark grain relative overflow-hidden bg-nuit px-6 py-16 lg:min-h-[44rem]">
          <div className="relative mx-auto w-[58%] max-w-xs lg:sticky lg:top-28">
            <div
              aria-hidden="true"
              className="absolute left-1/2 top-1/2 h-[28rem] w-[28rem] -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ background: `radial-gradient(closest-side, ${f.bottle.liquid}55, ${f.bottle.liquid}00 70%)` }}
            />
            <div className="relative">
              <Bottle shape={f.bottle.shape} liquid={f.bottle.liquid} cap={f.bottle.cap} uid={`pdp-${f.slug}`} code={`No. ${String(all.findIndex((x) => x.slug === f.slug) + 1).padStart(2, '0')}`} />
            </div>
          </div>
        </section>

        <section className="px-4 py-12 sm:px-8 lg:px-14 lg:py-16">
          <nav aria-label="Breadcrumb" className="label-muted">
            <Link href="/collection" className="hover:text-bordeaux">Collection</Link>
            <span aria-hidden="true"> / </span>
            <Link href={`/collection?family=${f.family}`} className="hover:text-bordeaux">{FAMILY_LABEL[f.family]}</Link>
          </nav>
          <h1 className="mt-5 text-5xl italic leading-[1.02] sm:text-6xl">{f.name}</h1>
          <p className="mt-4 max-w-lg font-display text-xl leading-snug text-ink-muted">{f.tagline}</p>

          <dl className="mt-8 grid grid-cols-3 gap-px border border-line bg-line">
            {[
              ['Strength', CONCENTRATION_LABEL[f.concentration]],
              ['Family', FAMILY_LABEL[f.family]],
              ['Wear', WEAR_LABEL[f.wear]],
            ].map(([k, v]) => (
              <div key={k} className="bg-papier p-4">
                <dt className="label-muted">{k}</dt>
                <dd className="mt-1 font-display text-lg leading-tight">{v}</dd>
              </div>
            ))}
          </dl>

          <h2 className="label-muted mt-12">The notes</h2>
          <div className="mt-6"><NotesLadder notes={f.notes} /></div>

          <div className="mt-12 space-y-4 text-lg leading-relaxed">
            {f.story.map((p) => <p key={p}>{p}</p>)}
          </div>

          <h2 className="label-muted mt-12">Bottles and cases</h2>
          <table className="mt-4 w-full border-collapse text-left">
            <caption className="sr-only">Volumes and case packs for {f.name}</caption>
            <thead>
              <tr className="border-b border-ink">
                <th scope="col" className="label-muted py-2 pr-4 font-medium">Volume</th>
                <th scope="col" className="label-muted py-2 font-medium">Bottles per case</th>
              </tr>
            </thead>
            <tbody>
              {f.volumes.map((v) => (
                <tr key={v.id} className="border-b border-line">
                  <td className="py-3 pr-4 font-display text-xl">{v.label}</td>
                  <td className="py-3 label text-ink">{v.casePack}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-sm text-ink-muted">Orders are placed in whole cases. Trade prices are on the order page.</p>

          <div className="mt-10 flex flex-wrap items-center gap-4">
            <Link href="/checkout" className="btn-primary">Order by the case</Link>
            <Link href={`/enquiry?add=${f.slug}`} className="btn-quiet">Ask about samples</Link>
            {f.inStock ? null : <p className="label text-bordeaux">Between batches: ask us about the next one.</p>}
          </div>
        </section>
      </div>

      <section className="bg-papier-deep py-16">
        <div className="container-page">
          <h2 className="text-4xl italic">Also on the shelf</h2>
          <ul className="mt-10 grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3">
            {related.map((r) => (
              <li key={r.slug}><FragranceCard fragrance={r} index={all.findIndex((x) => x.slug === r.slug)} /></li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
