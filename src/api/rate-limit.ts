import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

interface RateLimitOptions {
  limit: number;
  windowMs: number;
  key: string;
}

interface Counter {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Counter>();

function currentTime(): number {
  return Date.now();
}

export function enforceRateLimit(c: Context, options: RateLimitOptions): void {
  const now = currentTime();
  const bucketKey = `${options.key}:${c.req.header("x-forwarded-for") ?? c.req.header("cf-connecting-ip") ?? c.req.header("x-real-ip") ?? "unknown"}`;
  const existing = buckets.get(bucketKey);
  if (!existing || existing.resetAt <= now) {
    buckets.set(bucketKey, { count: 1, resetAt: now + options.windowMs });
    return;
  }
  if (existing.count >= options.limit) {
    const retryAfter = Math.max(0, Math.ceil((existing.resetAt - now) / 1000));
    throw new HTTPException(429, {
      message: "RATE_LIMIT",
      res: new Response(
        JSON.stringify({ code: "RATE_LIMIT", message: "Write requests exceeded the allowed rate." }),
        {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": String(retryAfter),
          },
        },
      ),
    });
  }
  existing.count += 1;
}
