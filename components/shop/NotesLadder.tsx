import type { Notes } from '@/lib/catalog/types';

const RUNGS: { key: keyof Notes; label: string; hint: string }[] = [
  { key: 'top', label: 'Top', hint: 'The first minutes' },
  { key: 'heart', label: 'Heart', hint: 'The body of the scent' },
  { key: 'base', label: 'Base', hint: 'What stays' },
];

/** The scent pyramid, laid out as a ladder: what you smell first, then next, then last. */
export function NotesLadder({ notes, tone = 'light' }: { notes: Notes; tone?: 'light' | 'dark' }) {
  const dark = tone === 'dark';
  return (
    <ol className="ladder space-y-7 pl-9">
      {RUNGS.map((r) => (
        <li key={r.key} className="relative">
          <span
            aria-hidden="true"
            className={`absolute -left-9 top-1.5 block h-3 w-3 rounded-full border-2 ${dark ? 'border-or bg-nuit' : 'border-bordeaux bg-papier'}`}
          />
          <p className={dark ? 'label-on-dark' : 'label-muted'}>
            {r.label} <span className="normal-case tracking-normal opacity-80">· {r.hint}</span>
          </p>
          <p className={`mt-1 font-display text-2xl leading-snug ${dark ? 'text-papier' : 'text-ink'}`}>{notes[r.key].join(', ')}</p>
        </li>
      ))}
    </ol>
  );
}
