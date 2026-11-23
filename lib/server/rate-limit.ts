import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { BoundedMemoryCache } from '../aegis/sliding-window';
import { redisCoordinator } from './redis';

interface LocalCounter {
  count: number;
  resetAt: number;
}

const localRateLimitCache = new BoundedMemoryCache<LocalCounter>(5000, 120_000);

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

export function extractRequesterFingerprint(req: NextRequest, userId?: string): string {
  if (userId) return `u:${userId}`;
  const forwarded = req.headers.get('x-forwarded-for');
  const realIp = req.headers.get('x-real-ip');
  const rawIp = forwarded ? forwarded.split(',')[0].trim() : realIp?.trim() || 'local';
  const hash = crypto.createHash('sha256').update(rawIp).digest('hex').slice(0, 16);
  return `ip:${hash}`;
}

export async function checkRateLimit(params: {
  bucket: string;
  identifier: string;
  limit: number;
  windowSeconds: number;
}): Promise<RateLimitResult> {
  const safeLimit = Math.max(1, params.limit);
  const safeWindowSec = Math.max(1, params.windowSeconds);
  const key = `aegis:rl:${params.bucket}:${params.identifier}`;

  if (redisCoordinator.getStatus() === 'CONNECTED') {
    const count = await redisCoordinator.incrementSlidingWindow(key, safeWindowSec);
    if (typeof count === 'number') {
      return {
        allowed: count <= safeLimit,
        limit: safeLimit,
        remaining: Math.max(0, safeLimit - count),
        retryAfterSeconds: count <= safeLimit ? 0 : safeWindowSec,
      };
    }
  }

  const now = Date.now();
  const existing = localRateLimitCache.get(key);
  if (!existing || existing.resetAt <= now) {
    localRateLimitCache.set(
      key,
      { count: 1, resetAt: now + safeWindowSec * 1000 },
      safeWindowSec * 1000
    );
    return {
      allowed: true,
      limit: safeLimit,
      remaining: safeLimit - 1,
      retryAfterSeconds: 0,
    };
  }

  existing.count += 1;
  const remainingTtl = Math.max(1000, existing.resetAt - now);
  localRateLimitCache.set(key, existing, remainingTtl);

  return {
    allowed: existing.count <= safeLimit,
    limit: safeLimit,
    remaining: Math.max(0, safeLimit - existing.count),
    retryAfterSeconds: existing.count <= safeLimit ? 0 : Math.ceil(remainingTtl / 1000),
  };
}

export async function enforceRateLimit(
  req: NextRequest,
  params: {
    bucket: string;
    userId?: string;
    limit: number;
    windowSeconds: number;
    message?: string;
  }
): Promise<NextResponse | null> {
  const identifier = extractRequesterFingerprint(req, params.userId);
  const res = await checkRateLimit({
    bucket: params.bucket,
    identifier,
    limit: params.limit,
    windowSeconds: params.windowSeconds,
  });

  if (res.allowed) return null;

  return NextResponse.json(
    {
      error: 'RATE_LIMITED',
      message:
        params.message ||
        `Demasiadas solicitudes en ${params.bucket}. Reintenta en ${res.retryAfterSeconds}s.`,
      retryAfterSeconds: res.retryAfterSeconds,
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(res.retryAfterSeconds),
        'X-RateLimit-Limit': String(res.limit),
        'X-RateLimit-Remaining': '0',
        'Cache-Control': 'no-store, private',
      },
    }
  );
}
