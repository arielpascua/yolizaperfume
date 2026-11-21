'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { NAV_LINKS, ORDER_HREF } from './nav';

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        ref={toggle}
        type="button"
        className="on-dark flex min-h-[44px] min-w-[44px] items-center justify-center text-papier"
        aria-expanded={open}
        aria-controls="mobile-nav"
        aria-label={open ? 'Close menu' : 'Open menu'}
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          {open ? <path d="M5 5l14 14M19 5L5 19" /> : <path d="M3 8h18M3 16h12" />}
        </svg>
      </button>
      {open ? (
        <nav id="mobile-nav" aria-label="Mobile" className="on-dark absolute inset-x-0 top-full border-t border-papier/15 bg-nuit px-4 pb-8 pt-4">
          <ul className="flex flex-col">
            {NAV_LINKS.map((l) => (
              <li key={l.href} className="border-b border-papier/10">
                <Link href={l.href} onClick={() => setOpen(false)} className="block py-4 font-display text-3xl italic text-papier">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          <Link href={ORDER_HREF} onClick={() => setOpen(false)} className="btn-gold mt-6 w-full">
            Order by the case
          </Link>
        </nav>
      ) : null}
    </div>
  );
}
