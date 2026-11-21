import { NextResponse } from 'next/server';
import {
  clearUserDiscordAccessToken,
  getIframeSafeCookieOptions,
  readSessionFromCookies,
  revokeSessionId,
  SESSION_COOKIE_NAME,
} from '@/lib/server/session';
import { aegisStore } from '@/lib/server/store';

export async function POST() {
  const session = await readSessionFromCookies();
  if (session) {
    revokeSessionId(session.sessionId, session.expiresAt);
    clearUserDiscordAccessToken(session.userId);
    const state = await aegisStore.getState();
    const user = Object.hasOwn(state.users, session.discordId)
      ? state.users[session.discordId]
      : undefined;
    if (user) {
      aegisStore.appendAuditLog(state, {
        guildId: null,
        actorId: user.discordId,
        actorName: user.username,
        action: 'USER_LOGOUT',
        entityType: 'User',
        entityId: user.id,
        result: 'SUCCESS',
        metadata: { sessionId: session.sessionId },
      });
      await aegisStore.commitMutation('auth:logout', undefined, { userId: user.id });
    }
  }

  const res = NextResponse.json(
    { success: true },
    { headers: { 'Cache-Control': 'no-store, private' } }
  );
  res.cookies.set(SESSION_COOKIE_NAME, '', {
    ...getIframeSafeCookieOptions(0),
    maxAge: 0,
  });
  return res;
}
