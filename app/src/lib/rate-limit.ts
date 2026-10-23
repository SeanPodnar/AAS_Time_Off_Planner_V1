/**
 * Fixed-window limiter held in memory. Enough for one app server in v1; when the app
 * runs on more than one server this moves to the database or a shared cache.
 */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  constructor(private limit: number, private windowMs: number) {}

  /** Records an attempt and returns whether it is allowed. */
  take(key: string, now = Date.now()): boolean {
    const cur = this.hits.get(key);
    if (!cur || cur.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      this.sweep(now);
      return true;
    }
    cur.count += 1;
    return cur.count <= this.limit;
  }

  private sweep(now: number) {
    if (this.hits.size < 10_000) return;
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
  }
}

// 5 links per address and 30 per network address every 15 minutes.
export const linkByEmail = new RateLimiter(5, 15 * 60_000);
export const linkByIp = new RateLimiter(30, 15 * 60_000);
