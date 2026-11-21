import type { Metadata } from 'next';
import { EnquiryForm } from '@/components/enquiry/EnquiryForm';
import { listPublicFragrances } from '@/lib/catalog/public';

export const metadata: Metadata = {
  title: 'Trade enquiry',
  description: 'Tell us about your business and the fragrances you would stock. Ask about samples, volume or anything else before you order.',
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function EnquiryPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = (await searchParams).add;
  const slug = Array.isArray(raw) ? raw[0] : raw;
  const fragrances = listPublicFragrances();
  const initial = fragrances.find((f) => f.slug === slug);

  // Only what the picker needs: names, ids and volumes. No price exists in this tree.
  const options = fragrances.map((f) => ({
    id: f.id,
    name: f.name,
    volumes: f.volumes.map((v) => ({ id: v.id, label: v.label, casePack: v.casePack })),
  }));

  return (
    <div className="container-page py-14">
      <header className="mb-12 max-w-2xl">
        <p className="label-muted">Trade enquiry</p>
        <h1 className="mt-3 text-5xl italic leading-tight sm:text-6xl">Tell us about your shelf.</h1>
        <p className="mt-4 text-lg text-ink-muted">
          One short form, for samples or a conversation about volume. You do not need to enquire first: you can order any time on the order page.
        </p>
      </header>
      <EnquiryForm fragrances={options} initialFragranceId={initial?.id} />
    </div>
  );
}
