import type { MetadataRoute } from 'next';
import { siteBase } from '@/lib/site';

// /checkout is private. Disallowing it here is a courtesy; the real protection is that nothing links to it
// and the page itself is noindex and needs a signed token.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/checkout', '/payment', '/api/'] }],
    sitemap: `${siteBase()}/sitemap.xml`,
  };
}
