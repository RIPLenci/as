import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { enforceRateLimit } from '@/lib/server/rate-limit';
import {
  consumeOAuthExchangeCode,
  getIframeSafeCookieOptions,
  SESSION_COOKIE_NAME,
  type SessionPayload,
  signPayload,
} from '@/lib/server/session';
import { aegisStore } from '@/lib/server/store';

export const dynamic = 'force-dynamic';

const exchangeSchema = z.object({
  exchangeCode: z.string().min(10).max(256),
});

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, private' };

export async function POST(req: NextRequest) {
  const rlErr = await enforceRateLimit(req, {
    bucket: 'oauth_exchange',
    limit: 20,
    windowSeconds: 60,
  });
  if (rlErr) return rlErr;

  const body = await req.json().catch(() => null);
  const parsed = exchangeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', message: 'Missing or invalid exchangeCode.' },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const record = await consumeOAuthExchangeCode(parsed.data.exchangeCode);
  if (!record) {
    return NextResponse.json(
      {
        error: 'INVALID_EXCHANGE_CODE',
        message: 'OAuth2 session exchange code is invalid or expired.',
      },
      { status: 401, headers: NO_STORE_HEADERS }
    );
  }

  const state = await aegisStore.getState();
  const user = Object.hasOwn(state.users, record.discordId)
    ? state.users[record.discordId]
    : undefined;
  if (!user || user.id !== record.userId) {
    return NextResponse.json(
      { error: 'USER_NOT_FOUND', message: 'Authenticated Discord account no longer exists.' },
      { status: 401, headers: NO_STORE_HEADERS }
    );
  }

  const sessionToken = signPayload<SessionPayload>({
    sessionId: record.sessionId,
    userId: record.userId,
    discordId: record.discordId,
    authMode: 'DISCORD_OAUTH',
    issuedAt: Date.now(),
    expiresAt: Date.now() + record.maxAgeSeconds * 1000,
  });

  const res = NextResponse.json(
    {
      ok: true,
      user,
      sessionToken,
    },
    { headers: NO_STORE_HEADERS }
  );
  res.cookies.set(
    SESSION_COOKIE_NAME,
    sessionToken,
    getIframeSafeCookieOptions(record.maxAgeSeconds)
  );
  return res;
}
