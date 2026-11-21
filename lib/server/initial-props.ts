import { headers } from 'next/headers';
import { isBotStaff } from '@/lib/server/auth-guard';
import { ensureBotStarted } from '@/lib/server/bot-runner';
import { getServerEnv, resolveCallbackUrl } from '@/lib/server/env';
import { readSessionFromCookies } from '@/lib/server/session';
import { aegisStore } from '@/lib/server/store';

export async function getAegisWorkspaceInitialProps() {
  const headerStore = await headers();
  const env = getServerEnv();
  if (env.botConfigured) {
    ensureBotStarted();
  }
  const expectedCallbackUrl = resolveCallbackUrl({ headers: headerStore });
  const [session, systemHealth] = await Promise.all([
    readSessionFromCookies(),
    aegisStore.getSystemHealth(),
  ]);

  let initialUser = null;
  if (session) {
    const state = await aegisStore.getState();
    initialUser = Object.hasOwn(state.users, session.discordId)
      ? state.users[session.discordId]
      : null;
  }

  return {
    initialUser,
    initialIsStaff: initialUser ? isBotStaff(initialUser) : false,
    initialOauthConfigured: env.oauthConfigured,
    initialExpectedCallbackUrl: expectedCallbackUrl,
    initialSystemHealth: systemHealth,
  };
}
