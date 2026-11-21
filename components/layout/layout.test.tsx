// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Footer } from './Footer';
import { Header } from './Header';
import { MobileNav } from './MobileNav';
import { NAV_LINKS } from './nav';

const hrefs = (root: HTMLElement) => [...root.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');

describe('layout', () => {
  it('header links the public pages, and the order page is the call to action', () => {
    const { container } = render(<Header />);
    const all = hrefs(container);
    for (const l of NAV_LINKS) expect(all).toContain(l.href);
    expect(all).toContain('/checkout');
    expect(within(container as HTMLElement).getByRole('link', { name: 'Order' })).toHaveAttribute('href', '/checkout');
  });

  it('footer lists every family and offers the order page', () => {
    const { container } = render(<Footer />);
    const all = hrefs(container);
    expect(all.filter((h) => h.startsWith('/collection?family=')).length).toBe(7);
    expect(all).toContain('/checkout');
  });

  it('mobile menu opens, lists the pages, offers the order page and closes on Escape', async () => {
    const user = userEvent.setup();
    render(<MobileNav />);
    const toggle = screen.getByRole('button', { name: /open menu/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    const nav = screen.getByRole('navigation', { name: /mobile/i });
    for (const l of NAV_LINKS) expect(within(nav).getByRole('link', { name: l.label })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: /order by the case/i })).toHaveAttribute('href', '/checkout');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('navigation', { name: /mobile/i })).toBeNull();
  });
});
