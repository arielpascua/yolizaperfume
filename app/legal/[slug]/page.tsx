import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LEGAL_PAGES, legalPage } from '@/lib/legal';

export const dynamicParams = false;

export function generateStaticParams() {
  return LEGAL_PAGES.map((p) => ({ slug: p.slug }));
}

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const page = legalPage((await params).slug);
  return page ? { title: page.title, description: page.intro } : {};
}

export default async function LegalPage({ params }: { params: Params }) {
  const page = legalPage((await params).slug);
  if (!page) notFound();
  return (
    <article className="container-page max-w-3xl py-16">
      <p className="label-muted">The house</p>
      <h1 className="mt-3 text-5xl italic leading-tight sm:text-6xl">{page.title}</h1>
      <p className="mt-4 text-xl text-ink-muted">{page.intro}</p>
      {page.sections.map((s) => (
        <section key={s.heading} className="mt-10 border-t border-line pt-6">
          <h2 className="text-2xl">{s.heading}</h2>
          <div className="mt-3 space-y-3 text-lg leading-relaxed">
            {s.body.map((p) => <p key={p}>{p}</p>)}
          </div>
        </section>
      ))}
    </article>
  );
}
