import type { BottleShape, CapFinish } from '@/lib/catalog/types';

// Every bottle on the site is drawn here, in SVG, from three facts: a silhouette, a liquid
// colour and a cap finish. There are no photographs, so no image is ever a stand-in for a
// different product, and the bottle's colour is exactly the liquid it is named for.

interface Geometry {
  body: string;
  neck: { x: number; y: number; w: number; h: number };
  cap: string;
  liquidTop: number;
  label: { x: number; y: number; w: number; h: number };
  glint: { x: number; y1: number; y2: number };
}

const GEOMETRY: Record<BottleShape, Geometry> = {
  flacon: {
    body: 'M55 110 H145 Q155 110 155 120 V250 Q155 260 145 260 H55 Q45 260 45 250 V120 Q45 110 55 110 Z',
    neck: { x: 86, y: 88, w: 28, h: 26 },
    cap: 'M81 44 H119 Q122 44 122 47 V89 H78 V47 Q78 44 81 44 Z',
    liquidTop: 138,
    label: { x: 63, y: 158, w: 74, h: 62 },
    glint: { x: 56, y1: 124, y2: 246 },
  },
  sphere: {
    body: 'M28 190 A72 72 0 1 0 172 190 A72 72 0 1 0 28 190 Z',
    neck: { x: 88, y: 104, w: 24, h: 22 },
    cap: 'M100 62 Q120 62 120 84 V108 H80 V84 Q80 62 100 62 Z',
    liquidTop: 158,
    label: { x: 70, y: 168, w: 60, h: 52 },
    glint: { x: 46, y1: 168, y2: 214 },
  },
  column: {
    body: 'M74 96 H126 Q132 96 132 102 V260 Q132 266 126 266 H74 Q68 266 68 260 V102 Q68 96 74 96 Z',
    neck: { x: 90, y: 80, w: 20, h: 20 },
    cap: 'M84 28 H116 V84 H84 Z',
    liquidTop: 128,
    label: { x: 76, y: 150, w: 48, h: 84 },
    glint: { x: 77, y1: 108, y2: 250 },
  },
  facet: {
    body: 'M100 100 L158 128 V226 L100 262 L42 226 V128 Z',
    neck: { x: 88, y: 84, w: 24, h: 20 },
    cap: 'M82 40 H118 L122 86 H78 Z',
    liquidTop: 140,
    label: { x: 66, y: 156, w: 68, h: 64 },
    glint: { x: 52, y1: 142, y2: 214 },
  },
  arch: {
    body: 'M44 262 V150 A56 56 0 0 1 156 150 V256 Q156 262 150 262 H50 Q44 262 44 256 Z',
    neck: { x: 88, y: 80, w: 24, h: 20 },
    cap: 'M84 40 H116 Q122 40 122 46 V84 H78 V46 Q78 40 84 40 Z',
    liquidTop: 150,
    label: { x: 64, y: 176, w: 72, h: 60 },
    glint: { x: 54, y1: 160, y2: 246 },
  },
  drop: {
    body: 'M100 96 C100 96 42 168 42 214 A58 58 0 0 0 158 214 C158 168 100 96 100 96 Z',
    neck: { x: 91, y: 76, w: 18, h: 26 },
    cap: 'M78 58 A22 22 0 1 0 122 58 A22 22 0 1 0 78 58 Z',
    liquidTop: 168,
    label: { x: 72, y: 184, w: 56, h: 46 },
    glint: { x: 58, y1: 198, y2: 234 },
  },
};

const CAP_COLOURS: Record<CapFinish, [string, string, string]> = {
  gold: ['#F3D58F', '#B98A34', '#8A6420'],
  noir: ['#3A3042', '#17111B', '#08060A'],
  wood: ['#B07F55', '#7A4F2E', '#4F301A'],
  silver: ['#F4F4F7', '#B5B5C0', '#7E7E8C'],
};

export interface BottleProps {
  shape: BottleShape;
  liquid: string;
  cap: CapFinish;
  /** Unique per instance on a page: it namespaces the gradient and clip ids. */
  uid: string;
  /** The small print on the label, e.g. "No. 04". */
  code?: string;
  className?: string;
}

export function Bottle({ shape, liquid, cap, uid, code, className }: BottleProps) {
  const g = GEOMETRY[shape];
  const [c1, c2, c3] = CAP_COLOURS[cap];
  const id = (s: string) => `${uid}-${s}`;
  const { label } = g;
  const cx = label.x + label.w / 2;

  return (
    <svg viewBox="0 0 200 290" className={className} role="presentation" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={id('body')}>
          <path d={g.body} />
        </clipPath>
        <linearGradient id={id('liquid')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={liquid} stopOpacity="0.92" />
          <stop offset="1" stopColor={liquid} stopOpacity="1" />
        </linearGradient>
        <linearGradient id={id('shade')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity="0.18" />
          <stop offset="0.3" stopColor="#000" stopOpacity="0" />
          <stop offset="0.75" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.28" />
        </linearGradient>
        <linearGradient id={id('cap')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={c2} />
          <stop offset="0.25" stopColor={c1} />
          <stop offset="0.6" stopColor={c2} />
          <stop offset="1" stopColor={c3} />
        </linearGradient>
      </defs>

      {/* ground shadow */}
      <ellipse cx="100" cy="270" rx="62" ry="6" fill="#000" opacity="0.22" />

      {/* neck, then glass body */}
      <rect x={g.neck.x} y={g.neck.y} width={g.neck.w} height={g.neck.h} fill="#D9D3DE" fillOpacity="0.55" stroke="#8C8294" strokeOpacity="0.6" />
      <path d={g.body} fill="#FFFFFF" fillOpacity="0.28" stroke="#8C8294" strokeOpacity="0.7" strokeWidth="1.5" />

      {/* liquid, clipped to the body */}
      <g clipPath={`url(#${id('body')})`}>
        <rect x="0" y={g.liquidTop} width="200" height="200" fill={`url(#${id('liquid')})`} />
        <rect x="0" y={g.liquidTop} width="200" height="3" fill="#FFFFFF" opacity="0.35" />
        <rect x="0" y="0" width="200" height="290" fill={`url(#${id('shade')})`} />
      </g>

      {/* the paper label */}
      <rect x={label.x} y={label.y} width={label.w} height={label.h} fill="#F6EFE2" stroke="#1B1520" strokeOpacity="0.35" strokeWidth="0.6" />
      <text x={cx} y={label.y + label.h * 0.52} textAnchor="middle" fontFamily="var(--font-display), Georgia, serif" fontStyle="italic" fontSize={Math.min(label.w * 0.5, 34)} fill="#1B1520">
        Y
      </text>
      <text x={cx} y={label.y + label.h * 0.78} textAnchor="middle" fontFamily="var(--font-label), monospace" fontSize="6.5" letterSpacing="1.4" fill="#1B1520" opacity="0.8">
        YOLIZA
      </text>
      {code ? (
        <text x={cx} y={label.y + label.h * 0.92} textAnchor="middle" fontFamily="var(--font-label), monospace" fontSize="5.5" letterSpacing="1" fill="#5B5062">
          {code}
        </text>
      ) : null}

      {/* glint */}
      <line x1={g.glint.x} y1={g.glint.y1} x2={g.glint.x} y2={g.glint.y2} stroke="#FFFFFF" strokeOpacity="0.55" strokeWidth="4" strokeLinecap="round" />

      {/* cap */}
      <path d={g.cap} fill={`url(#${id('cap')})`} stroke="#000" strokeOpacity="0.25" strokeWidth="0.8" />
    </svg>
  );
}
