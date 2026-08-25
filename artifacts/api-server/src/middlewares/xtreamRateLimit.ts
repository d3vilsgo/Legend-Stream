import type { RequestHandler } from "express";

const WINDOW_MS = 60_000;
const MAX_REQUESTS = Math.max(10, Number(process.env.XTREAM_RATE_LIMIT_PER_MINUTE) || 60);
const buckets = new Map<string, { startedAt: number; count: number }>();

export const xtreamRateLimit: RequestHandler = (req, res, next) => {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const current = buckets.get(key);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    buckets.set(key, { startedAt: now, count: 1 });
    next();
    return;
  }
  current.count += 1;
  if (current.count > MAX_REQUESTS) {
    const retryAfter = Math.max(1, Math.ceil((WINDOW_MS - (now - current.startedAt)) / 1000));
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({
      error: {
        code: "RATE_LIMITED",
        message: "Too many Xtream proxy requests. Try again shortly.",
      },
    });
    return;
  }
  if (buckets.size > 10_000) {
    for (const [bucketKey, bucket] of buckets) {
      if (now - bucket.startedAt >= WINDOW_MS) buckets.delete(bucketKey);
    }
  }
  next();
};
