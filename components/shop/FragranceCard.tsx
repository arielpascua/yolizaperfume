import Link from 'next/link';
import { CONCENTRATION_LABEL, FAMILY_LABEL } from '@/lib/catalog/labels';
import type { PublicFragrance } from '@/lib/catalog/types';
import { Bottle } from '@/components/ui/Bottle';

/** A fragrance as a perfumer's blotter strip. Accepts ONLY the public shape: it has no price. */
export function FragranceCard({ fragrance: f, index }: { fragrance: PublicFragrance; index?: number }) {
  const code = typeof index === 'number' ? `No. ${String(index + 1).padStart(2, '0')}` : undefined;
  const mls = f.volumes.map((v) => v.ml).join(' · ');
  return (
    <Link href={`/fragrance/${f.slug}`} className="strip-wrap" aria-label={`${f.name}, ${FAMILY_LABEL[f.family]}`}>
      <article className="strip px-5 pt-12">
        <div className="mx-auto w-[68%]">
          <Bottle shape={f.bottle.shape} liquid={f.bottle.liquid} cap={f.bottle.cap} uid={`card-${f.slug}`} code={code} />
        </div>
        <p className="label-muted mt-5">{FAMILY_LABEL[f.family]}</p>
        <h3 className="mt-1 font-display text-2xl leading-tight text-ink">{f.name}</h3>
        <p className="mt-2 min-h-[2.75rem] text-sm leading-snug text-ink-muted">{f.tagline}</p>
        <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
          <span className="label-muted">{CONCENTRATION_LABEL[f.concentration]}</span>
          <span className="label text-ink">{mls} ml</span>
        </div>
        {f.inStock ? null : <p className="label mt-2 text-bordeaux">Between batches</p>}
      </article>
    </Link>
  );
}
