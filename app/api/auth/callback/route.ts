import { NextRequest, NextResponse } from 'next/server';
import { SUPER_OWNER_DISCORD_ID } from '@/lib/aegis/rbac';
import { sanitizeHtmlScriptJson } from '@/lib/aegis/security-helpers';
import type { GuildRecord, RbacRole } from '@/lib/aegis/types';
import {
  buildDiscordAvatarUrl,
  buildDiscordGuildIconUrl,
  exchangeDiscordCode,
  fetchBotGuildIdsLive,
  fetchDiscordUser,
  fetchDiscordUserGuilds,
  hasAdminPermission,
  hasManageGuildOrAdmin,
  verifyBotGuildMembership,
} from '@/lib/server/discord-api';
import { getServerEnv } from '@/lib/server/env';
import {
  consumePendingOAuthState,
  createOAuthExchangeCode,
  generateSessionId,
  getIframeSafeCookieOptions,
  OAUTH_STATE_COOKIE_NAME,
  type OAuthStatePayload,
  SESSION_COOKIE_NAME,
  type SessionPayload,
  setUserDiscordAccessToken,
  signPayload,
  verifyPayload,
} from '@/lib/server/session';
import { aegisStore } from '@/lib/server/store';

export const dynamic = 'force-dynamic';

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderPopupCloseHtml(
  ok: boolean,
  message: string,
  exchangeCode?: string,
  targetOrigin?: string
): NextResponse {
  const safeMsg = escapeHtml(message);
  const fallbackHref =
    ok && exchangeCode ? `/dashboard?oauth_exchange=${encodeURIComponent(exchangeCode)}` : '/';
  const resolvedOrigin = targetOrigin || null;

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AEGIS SECURITY — Verificación de Discord</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #07090F;
      background-image:
        radial-gradient(600px 300px at 50% 0%, rgba(88, 101, 242, 0.16), transparent 70%),
        linear-gradient(to right, rgba(148, 163, 184, 0.05) 1px, transparent 1px),
        linear-gradient(to bottom, rgba(148, 163, 184, 0.05) 1px, transparent 1px);
      background-size: 100% 100%, 48px 48px, 48px 48px;
      color: #F1F5F9;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 20px;
    }
    .card {
      max-width: 440px;
      width: 100%;
      padding: 28px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 16px;
      background: #0F1422;
      text-align: center;
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.65);
    }
    .badge {
      display: inline-block;
      font-family: ui-monospace, SFMono-Regular, monospace;
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: ${ok ? '#34D399' : '#FBBF24'};
      margin-bottom: 10px;
    }
    h1 { font-size: 18px; margin: 0 0 10px; font-weight: 700; color: #FFFFFF; }
    p { font-size: 13px; color: #94A3B8; margin: 0 0 20px; line-height: 1.55; }
    .btn {
      display: inline-block;
      padding: 10px 18px;
      border-radius: 8px;
      background: #5865F2;
      color: #FFFFFF;
      text-decoration: none;
      font-size: 13px;
      font-weight: 600;
      border: none;
      cursor: pointer;
    }
    .btn:hover { background: #4752C4; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">${ok ? 'OAUTH2 PKCE · VERIFICADO' : 'OAUTH2 · AVISO DE VERIFICACIÓN'}</div>
    <h1>${ok ? 'AEGIS SECURITY' : 'Autenticación de Discord Fallida'}</h1>
    <p>${safeMsg}</p>
    <a class="btn" href="${escapeHtml(fallbackHref)}" id="aegis-continue-btn">${
      ok ? 'Continuar al Panel' : 'Volver a AEGIS SECURITY'
    }</a>
  </div>
  <script>
    (function() {
      var payload = ${sanitizeHtmlScriptJson({
        type: ok ? 'OAUTH_AUTH_SUCCESS' : 'OAUTH_AUTH_ERROR',
        message,
        exchangeCode: exchangeCode || null,
      })};

      try {
        if (typeof BroadcastChannel !== 'undefined') {
          var ch = new BroadcastChannel('aegis_oauth_channel');
          ch.postMessage(payload);
          ch.close();
        }
      } catch (e) {}

      var deliveredToOpener = false;
      var openerOrigin = ${sanitizeHtmlScriptJson(resolvedOrigin)} || window.location.origin;
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(payload, openerOrigin);
          deliveredToOpener = true;
        }
      } catch (e) {}

      if (deliveredToOpener) {
        setTimeout(function() {
          try { window.close(); } catch (e) {}
        }, ${ok ? 280 : 1200});
      } else if (${ok ? 'true' : 'false'}) {
        setTimeout(function() {
          window.location.href = ${sanitizeHtmlScriptJson(fallbackHref)};
        }, 350);
      }
    })();
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    status: ok ? 200 : 400,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, private',
    },
  });
}

async function runBounded<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit);
    const chunkRes = await Promise.all(chunk.map(worker));
    results.push(...chunkRes);
  }
  return results;
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const stateParam = req.nextUrl.searchParams.get('state');
  const errorParam = req.nextUrl.searchParams.get('error');
  const errorDesc = req.nextUrl.searchParams.get('error_description');

  if (errorParam) {
    return renderPopupCloseHtml(
      false,
      `Discord authorization cancelled (${errorParam})${errorDesc ? `: ${errorDesc}` : '.'}`
    );
  }

  if (!code || !stateParam) {
    return renderPopupCloseHtml(
      false,
      'Missing OAuth2 authorization code or state parameter from Discord callback.'
    );
  }

  // Verify OAuth2 state from either:
  // 1) Server-side single-use pending state registry (resilient to cross-origin iframe cookie partitioning)
  // 2) Signed OAUTH_STATE_COOKIE_NAME cookie (when browser attaches cookie across same top-level context)
  const pendingState = consumePendingOAuthState(stateParam);
  const rawStateCookie = req.cookies.get(OAUTH_STATE_COOKIE_NAME)?.value;
  const cookieState = verifyPayload<OAuthStatePayload>(rawStateCookie);

  if (cookieState && cookieState.state !== stateParam) {
    return renderPopupCloseHtml(
      false,
      'OAuth2 state cookie mismatch detected. Please initiate Discord login again.'
    );
  }

  const resolvedState = pendingState ?? cookieState;
  if (
    !resolvedState ||
    resolvedState.state !== stateParam ||
    Date.now() - resolvedState.issuedAt > 10 * 60_000
  ) {
    return renderPopupCloseHtml(
      false,
      'Invalid or expired OAuth2 state token (10 minute window exceeded). Please try signing in again.'
    );
  }

  try {
    const tokenRes = await exchangeDiscordCode({
      code,
      codeVerifier: resolvedState.codeVerifier,
      redirectUri: resolvedState.redirectUri,
    });
    const discordUser = await fetchDiscordUser(tokenRes.access_token);
    const discordGuilds = await fetchDiscordUserGuilds(tokenRes.access_token);

    const env = getServerEnv();
    const state = await aegisStore.getState();

    // Determine Global Role strictly from backend configuration / moderator registry
    let globalRole: RbacRole = 'SERVER_ADMINISTRATOR';
    if (discordUser.id === SUPER_OWNER_DISCORD_ID || env.ownerIds.includes(discordUser.id)) {
      globalRole = 'OWNER';
    } else if (env.globalAdminIds.includes(discordUser.id)) {
      globalRole = 'GLOBAL_ADMINISTRATOR';
    } else {
      const mod = state.globalModerators.find(
        (m) => m.discordId === discordUser.id && m.status === 'ACTIVE'
      );
      if (mod) globalRole = mod.role;
    }

    const avatarUrl = buildDiscordAvatarUrl(discordUser.id, discordUser.avatar);
    const nowIso = new Date().toISOString();
    const existingUser = Object.hasOwn(state.users, discordUser.id)
      ? state.users[discordUser.id]
      : undefined;
    const userId = existingUser?.id ?? `usr_${discordUser.id}`;

    state.users[discordUser.id] = {
      id: userId,
      discordId: discordUser.id,
      username: discordUser.username,
      globalName: discordUser.global_name,
      avatarUrl,
      globalRole,
      language: existingUser?.language ?? 'es',
      theme: existingUser?.theme ?? 'dark',
      authMode: 'DISCORD_OAUTH',
      createdAt: existingUser?.createdAt ?? nowIso,
      lastLoginAt: nowIso,
    };

    const existingAccount = Object.hasOwn(state.discordAccounts, discordUser.id)
      ? state.discordAccounts[discordUser.id]
      : undefined;
    state.discordAccounts[discordUser.id] = {
      discordId: discordUser.id,
      username: discordUser.username,
      globalName: discordUser.global_name,
      avatarHash: discordUser.avatar,
      scopes: (tokenRes.scope || 'identify guilds').split(/\s+/).filter(Boolean),
      tokenExpiresAt: new Date(Date.now() + (tokenRes.expires_in || 3600) * 1000).toISOString(),
      linkedAt: existingAccount?.linkedAt ?? nowIso,
    };

    // Cache volatile user OAuth token in server memory for live guild roster refreshes
    setUserDiscordAccessToken(userId, tokenRes.access_token, tokenRes.expires_in);

    // 1 single Discord Bot call tells us instantly which guilds have AEGIS installed,
    // avoiding sequential HTTP waterfalls & rate-limit spikes!
    const botGuildSnapshot = env.botConfigured ? await fetchBotGuildIdsLive() : null;
    const accessibleGuildIds: string[] = [];
    const rosterRecords: GuildRecord[] = [];

    const detailedGuildMap = new Map<
      string,
      Awaited<ReturnType<typeof verifyBotGuildMembership>>
    >();
    if (botGuildSnapshot?.ok) {
      const installedSubset = discordGuilds
        .filter((dg) => botGuildSnapshot.guildIds.has(dg.id))
        .slice(0, 20);
      const checked = await runBounded(installedSubset, 4, async (dg) => ({
        guildId: dg.id,
        res: await verifyBotGuildMembership(dg.id),
      }));
      for (const item of checked) {
        detailedGuildMap.set(item.guildId, item.res);
      }
    }

    const secondaryGuildIds = new Set(
      Object.values(state.secondaryOwners)
        .filter((so) => so.discordId === discordUser.id)
        .map((so) => so.guildId)
    );

    for (const dg of discordGuilds) {
      const existingGuild = Object.hasOwn(state.guilds, dg.id) ? state.guilds[dg.id] : undefined;
      const isSecondaryOwner = secondaryGuildIds.has(dg.id);
      const canEnter = Boolean(dg.owner) || isSecondaryOwner;
      const canManageDiscord = hasManageGuildOrAdmin(dg.permissions, dg.owner);
      const isAdmin = hasAdminPermission(dg.permissions, dg.owner);
      const botPresent = botGuildSnapshot?.ok
        ? botGuildSnapshot.guildIds.has(dg.id)
        : existingGuild?.botStatus === 'BOT_CONNECTED';
      const detail = detailedGuildMap.get(dg.id);
      const installed = detail ? detail.installed : botPresent;

      const resolvedMemberCount =
        detail?.memberCount ??
        dg.approximate_member_count ??
        (existingGuild && existingGuild.memberCount > 0 ? existingGuild.memberCount : 0);
      const memberCountKnown =
        typeof detail?.memberCount === 'number' ||
        typeof dg.approximate_member_count === 'number' ||
        Boolean(existingGuild?.memberCountKnown);

      const guildRecord: GuildRecord = {
        guildId: dg.id,
        name: detail?.name ?? dg.name,
        iconUrl: buildDiscordGuildIconUrl(dg.id, detail?.iconHash ?? dg.icon),
        memberCount: resolvedMemberCount,
        memberCountKnown,
        ownerDiscordId: dg.owner ? discordUser.id : existingGuild?.ownerDiscordId ?? '',
        userIsOwner: Boolean(dg.owner),
        userIsSecondaryOwner: isSecondaryOwner,
        userIsAdmin: isAdmin,
        userHasManageGuild: canManageDiscord,
        botStatus: installed ? 'BOT_CONNECTED' : 'BOT_NOT_INSTALLED',
        botPermissionsOk: installed,
        protectionEnabled: installed ? existingGuild?.protectionEnabled ?? false : false,
        lastSyncAt: nowIso,
        linkedAt: installed ? existingGuild?.linkedAt ?? nowIso : null,
      };

      rosterRecords.push(guildRecord);

      if (canEnter) {
        accessibleGuildIds.push(dg.id);
        state.guilds[dg.id] = {
          ...guildRecord,
          ownerDiscordId: dg.owner ? discordUser.id : existingGuild?.ownerDiscordId ?? '',
        };
        aegisStore.ensureGuildStructures(state, dg.id, guildRecord.name);
      }
    }

    for (const secGid of secondaryGuildIds) {
      if (!accessibleGuildIds.includes(secGid) && Object.hasOwn(state.guilds, secGid)) {
        accessibleGuildIds.push(secGid);
      }
    }

    state.userGuildRoster[userId] = rosterRecords;
    state.userGuildAccess[userId] = accessibleGuildIds;

    aegisStore.appendAuditLog(state, {
      guildId: null,
      actorId: discordUser.id,
      actorName: discordUser.username,
      action: 'USER_LOGIN_DISCORD_OAUTH',
      entityType: 'User',
      entityId: userId,
      result: 'SUCCESS',
      metadata: { guildCount: accessibleGuildIds.length },
    });

    await aegisStore.commitMutation('auth:login', undefined, { userId });

    const maxAge = state.systemSettings.sessionMaxAgeSeconds || 86_400;
    const sessionId = generateSessionId();
    const sessionToken = signPayload<SessionPayload>({
      sessionId,
      userId,
      discordId: discordUser.id,
      authMode: 'DISCORD_OAUTH',
      issuedAt: Date.now(),
      expiresAt: Date.now() + maxAge * 1000,
    });

    const exchangeCode = createOAuthExchangeCode({
      userId,
      discordId: discordUser.id,
      sessionId,
      maxAgeSeconds: maxAge,
    });

    let targetOrigin: string | undefined;
    try {
      targetOrigin = new URL(resolvedState.redirectUri).origin;
    } catch {
      targetOrigin = undefined;
    }

    const response = renderPopupCloseHtml(
      true,
      'Identidad de Discord verificada. Sincronizando sesión del panel...',
      exchangeCode,
      targetOrigin
    );
    response.cookies.set(SESSION_COOKIE_NAME, sessionToken, getIframeSafeCookieOptions(maxAge));
    response.cookies.delete(OAUTH_STATE_COOKIE_NAME);
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'OAuth2 verification error';
    return renderPopupCloseHtml(false, message);
  }
}
