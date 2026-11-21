import type { MetadataRoute } from 'next';
import { listPublicFragrances } from '@/lib/catalog/public';
import { LEGAL_PAGES } from '@/lib/legal';
import { siteBase } from '@/lib/site';

// Public pages only. The private checkout is never listed.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteBase();
  const fixed = ['', '/collection', '/trade', '/about', '/enquiry'];
  return [
    ...fixed.map((p) => ({ url: `${base}${p}` })),
    ...listPublicFragrances().map((f) => ({ url: `${base}/fragrance/${f.slug}` })),
    ...LEGAL_PAGES.map((p) => ({ url: `${base}/legal/${p.slug}` })),
  ];
}
