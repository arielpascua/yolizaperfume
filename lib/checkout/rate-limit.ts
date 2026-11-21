// A best-effort, in-memory fixed-window limiter. PER SERVER INSTANCE: behind
// several instances the effective limit is multiplied, and x-forwarded-for is
// only as trustworthy as the proxy in front. It exists to blunt a script that
// would otherwise create unlimited order rows, not to be a security boundary.
//
// Its own memory is bounded, because the key is attacker-influenced (a header):
//   - keys are truncated to MAX_KEY_LENGTH characters;
//   - at most MAX_KEYS keys are tracked, oldest first out;
//   - expired entries are pruned at most once per window, not on every call.

export interface Limiter {
  allow(key: string): boolean;
  /** Number of keys currently tracked. For tests and diagnostics. */
  size(): number;
}

export const MAX_KEY_LENGTH = 64;
export const MAX_KEYS = 10_000;

export function createLimiter(opts: { limit: number; windowMs: number; now?: () => number }): Limiter {
  // Map iteration is insertion order; entries are re-inserted when their window
  // restarts, so the first key is always the one whose window opened longest ago.
  const hits = new Map<string, { count: number; resetAt: number }>();
  const now = opts.now ?? Date.now;
  let lastPrune = now();
  return {
    allow(rawKey) {
      const key = rawKey.slice(0, MAX_KEY_LENGTH);
      const t = now();

      if (t - lastPrune >= opts.windowMs) {
        lastPrune = t;
        for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
      }

      const entry = hits.get(key);
      if (!entry || entry.resetAt <= t) {
        hits.delete(key);
        while (hits.size >= MAX_KEYS) {
          const oldest = hits.keys().next().value;
          if (oldest === undefined) break;
          hits.delete(oldest);
        }
        hits.set(key, { count: 1, resetAt: t + opts.windowMs });
        return true;
      }
      if (entry.count >= opts.limit) return false;
      entry.count += 1;
      return true;
    },
    size() {
      return hits.size;
    },
  };
}

export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || headers.get('x-real-ip')?.trim() || 'unknown';
}

function limitFromEnv(): number {
  const n = Number(process.env.CHECKOUT_RATE_LIMIT_PER_MIN);
  return Number.isInteger(n) && n > 0 ? n : 20;
}

/** The effective per-minute limit (CHECKOUT_RATE_LIMIT_PER_MIN, default 20). */
export const CHECKOUT_RATE_LIMIT = limitFromEnv();

export const checkoutLimiter = createLimiter({ limit: CHECKOUT_RATE_LIMIT, windowMs: 60_000 });
