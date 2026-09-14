// Fixed-window request counters held in this process's memory. The app runs as
// a single pm2 fork, so one Map sees every request. Counts reset on restart,
// which is acceptable for a waitlist.
export function createLimiter({ limit, windowMs, maxKeys = 10_000 }) {
  const windows = new Map(); // key -> { count, resetAt }

  function prune(now) {
    for (const [key, w] of windows) if (w.resetAt <= now) windows.delete(key);
  }

  return function hit(key, now = Date.now()) {
    let w = windows.get(key);
    if (!w || w.resetAt <= now) {
      if (!w && windows.size >= maxKeys) {
        prune(now);
        // Still full after pruning means a flood of distinct keys. Refuse
        // rather than let the Map grow without bound.
        if (windows.size >= maxKeys) return { ok: false, retryAfter: Math.ceil(windowMs / 1000) };
      }
      w = { count: 0, resetAt: now + windowMs };
      windows.set(key, w);
    }
    w.count += 1;
    return { ok: w.count <= limit, retryAfter: Math.max(1, Math.ceil((w.resetAt - now) / 1000)) };
  };
}
