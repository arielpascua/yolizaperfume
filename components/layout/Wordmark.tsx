import Link from 'next/link';
import { SITE_NAME, SITE_TAGLINE } from '@/lib/site';

export function Wordmark({ tone = 'dark' }: { tone?: 'dark' | 'light' }) {
  return (
    <Link href="/" className={`group inline-flex flex-col leading-none ${tone === 'dark' ? 'on-dark' : ''}`} aria-label={`${SITE_NAME} ${SITE_TAGLINE}, home`}>
      <span className="font-display text-[1.7rem] italic tracking-tight text-papier">{SITE_NAME}</span>
      <span className="label-on-dark mt-1 text-[0.58rem]">{SITE_TAGLINE}</span>
    </Link>
  );
}
