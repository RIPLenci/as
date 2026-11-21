import { NextRequest, NextResponse } from 'next/server';
import { sanitizeSystemHealthForPublic } from '@/lib/aegis/bot-slash-plan';
import { isBotStaff, resolveAuthoritativeGlobalRole } from '@/lib/server/auth-guard';
import { getServerEnv, resolveCallbackUrl } from '@/lib/server/env';
import { readSessionFromCookies } from '@/lib/server/session';
import { aegisStore } from '@/lib/server/store';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, private' };

export async function GET(req: NextRequest) {
  const env = getServerEnv();
  const expectedCallbackUrl = resolveCallbackUrl({
    headers: req.headers,
    requestedOrigin: req.nextUrl.searchParams.get('origin'),
  });

  const session = await readSessionFromCookies();
  const systemHealth = await aegisStore.getSystemHealth();

  if (!session) {
    return NextResponse.json(
      {
        authenticated: false,
        user: null,
        isStaff: false,
        oauthConfigured: env.oauthConfigured,
        botConfigured: env.botConfigured,
        expectedCallbackUrl,
        systemHealth: sanitizeSystemHealthForPublic(systemHealth),
      },
      { headers: NO_STORE_HEADERS }
    );
  }

  const state = await aegisStore.getState();
  const rawUser = Object.hasOwn(state.users, session.discordId)
    ? state.users[session.discordId]
    : undefined;
  if (!rawUser || rawUser.id !== session.userId) {
    return NextResponse.json(
      {
        authenticated: false,
        user: null,
        isStaff: false,
        oauthConfigured: env.oauthConfigured,
        botConfigured: env.botConfigured,
        expectedCallbackUrl,
        systemHealth: sanitizeSystemHealthForPublic(systemHealth),
      },
      { headers: NO_STORE_HEADERS }
    );
  }

  const authoritativeRole = resolveAuthoritativeGlobalRole(
    state,
    rawUser.discordId,
    rawUser.globalRole
  );
  const user =
    authoritativeRole !== rawUser.globalRole
      ? { ...rawUser, globalRole: authoritativeRole }
      : rawUser;

  return NextResponse.json(
    {
      authenticated: true,
      user,
      isStaff: isBotStaff(user),
      session: {
        sessionId: session.sessionId,
        authMode: session.authMode,
        issuedAt: new Date(session.issuedAt).toISOString(),
        expiresAt: new Date(session.expiresAt).toISOString(),
      },
      oauthConfigured: env.oauthConfigured,
      botConfigured: env.botConfigured,
      expectedCallbackUrl,
      systemHealth,
    },
    { headers: NO_STORE_HEADERS }
  );
}
