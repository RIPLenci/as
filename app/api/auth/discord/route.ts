import { NextRequest, NextResponse } from 'next/server';
import { buildDiscordOAuthUrl } from '@/lib/server/discord-api';
import { getServerEnv, normalizeOrigin, resolveCallbackUrl } from '@/lib/server/env';
import {
  generatePkcePair,
  generateRandomState,
  getIframeSafeCookieOptions,
  OAUTH_STATE_COOKIE_NAME,
  savePendingOAuthState,
  signPayload,
} from '@/lib/server/session';

export const dynamic = 'force-dynamic';

function createOAuthResponse(req: NextRequest, allowDirectRedirect: boolean) {
  const env = getServerEnv();
  const explicitOrigin = req.nextUrl.searchParams.get('origin');
  const refererOrigin = normalizeOrigin(req.headers.get('referer'));

  const redirectUri = resolveCallbackUrl({
    headers: req.headers,
    requestedOrigin: explicitOrigin || refererOrigin,
  });

  const NO_STORE = { 'Cache-Control': 'no-store, private' };
  const wantsRedirect =
    allowDirectRedirect &&
    (req.nextUrl.searchParams.get('redirect') === '1' ||
      req.nextUrl.searchParams.get('mode') === 'redirect');

  if (!env.oauthConfigured) {
    return NextResponse.json(
      {
        error: 'OAUTH_NOT_CONFIGURED',
        message:
          'Discord OAuth2 credentials (DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET) are not configured on the server.',
        expectedCallbackUrl: redirectUri,
      },
      { status: 503, headers: NO_STORE }
    );
  }

  const state = generateRandomState();
  const { codeVerifier, codeChallenge } = generatePkcePair();
  const issuedAt = Date.now();
  const authUrl = buildDiscordOAuthUrl({
    state,
    codeChallenge,
    redirectUri,
  });

  // Persist pending PKCE verifier & redirectUri server-side (single-use, 10m TTL)
  // so OAuth state verification succeeds even when AI Studio iframe cookies partition
  // separately from the top-level OAuth popup window.
  savePendingOAuthState({
    state,
    codeVerifier,
    redirectUri,
    issuedAt,
  });

  const signedStateCookie = signPayload({
    state,
    codeVerifier,
    redirectUri,
    issuedAt,
  });

  let baseOrigin = '';
  try {
    baseOrigin = new URL(redirectUri).origin;
  } catch {
    baseOrigin = '';
  }

  if (wantsRedirect) {
    const res = NextResponse.redirect(authUrl, { status: 302, headers: NO_STORE });
    res.cookies.set(OAUTH_STATE_COOKIE_NAME, signedStateCookie, getIframeSafeCookieOptions(600));
    return res;
  }

  const res = NextResponse.json(
    {
      url: authUrl,
      redirectUri,
      directLoginUrl: baseOrigin ? `${baseOrigin}/api/auth/discord?redirect=1` : '/api/auth/discord?redirect=1',
    },
    { headers: NO_STORE }
  );
  res.cookies.set(OAUTH_STATE_COOKIE_NAME, signedStateCookie, getIframeSafeCookieOptions(600));
  return res;
}

export async function GET(req: NextRequest) {
  return createOAuthResponse(req, true);
}

export async function POST(req: NextRequest) {
  return createOAuthResponse(req, false);
}
