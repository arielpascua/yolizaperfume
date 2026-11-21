// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Bottle } from '@/components/ui/Bottle';
import { listPublicFragrances } from '@/lib/catalog/public';
import { BOTTLE_SHAPES, CAP_FINISHES } from '@/lib/catalog/types';
import { FragranceCard } from './FragranceCard';
import { NotesLadder } from './NotesLadder';

const all = listPublicFragrances();

describe('Bottle', () => {
  it.each(BOTTLE_SHAPES)('draws the %s silhouette with every cap finish', (shape) => {
    for (const cap of CAP_FINISHES) {
      const { container, unmount } = render(<Bottle shape={shape} liquid="#C77A2A" cap={cap} uid={`t-${shape}-${cap}`} />);
      const svg = container.querySelector('svg')!;
      expect(svg).toHaveAttribute('aria-hidden', 'true');
      expect(svg.querySelectorAll('path').length).toBeGreaterThanOrEqual(3);
      unmount();
    }
  });

  it('namespaces its gradient ids so two bottles on a page do not collide', () => {
    const { container } = render(
      <>
        <Bottle shape="flacon" liquid="#fff" cap="gold" uid="a" />
        <Bottle shape="flacon" liquid="#000" cap="gold" uid="b" />
      </>,
    );
    const ids = [...container.querySelectorAll('[id]')].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses the liquid colour it is given', () => {
    const { container } = render(<Bottle shape="drop" liquid="#B7D76A" cap="silver" uid="c" />);
    expect(container.innerHTML).toContain('#B7D76A');
  });
});

describe('FragranceCard', () => {
  it('links to the fragrance page and shows its name, family and volumes, but no price', () => {
    const f = all.find((x) => x.slug === 'barako-smoke')!;
    const { container } = render(<FragranceCard fragrance={f} index={2} />);
    const link = screen.getByRole('link', { name: /Barako Smoke/ });
    expect(link).toHaveAttribute('href', '/fragrance/barako-smoke');
    expect(screen.getByText('Gourmand')).toBeInTheDocument();
    expect(container.textContent).toMatch(/30 · 50 · 100 ml/);
    expect(container.textContent).not.toMatch(/₱|price/i);
  });

  it('flags a fragrance that is between batches', () => {
    const f = all.find((x) => !x.inStock)!;
    render(<FragranceCard fragrance={f} />);
    expect(screen.getByText(/between batches/i)).toBeInTheDocument();
  });
});

describe('NotesLadder', () => {
  it('lists top, heart and base in order', () => {
    const f = all[0];
    render(<NotesLadder notes={f.notes} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent(/Top/);
    expect(items[0]).toHaveTextContent(f.notes.top.join(', '));
    expect(items[2]).toHaveTextContent(f.notes.base.join(', '));
  });
});
