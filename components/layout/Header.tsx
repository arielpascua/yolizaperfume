import Link from 'next/link';
import { MobileNav } from './MobileNav';
import { Wordmark } from './Wordmark';
import { NAV_LINKS, ORDER_HREF } from './nav';

export function Header() {
  return (
    <header className="on-dark sticky top-0 z-40 border-b border-papier/10 bg-nuit/95 backdrop-blur">
      <div className="container-page relative flex h-16 items-center justify-between">
        <Wordmark />
        <nav aria-label="Primary" className="hidden items-center gap-9 md:flex">
          {NAV_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="label text-papier transition-colors hover:text-or">
              {l.label}
            </Link>
          ))}
          <Link href={ORDER_HREF} className="btn-gold min-h-[40px] px-5">
            Order
          </Link>
        </nav>
        <MobileNav />
      </div>
    </header>
  );
}
