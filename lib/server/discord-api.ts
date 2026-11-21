import { getServerEnv } from './env';

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const DISCORD_FETCH_TIMEOUT_MS = 10_000;

export interface DiscordOAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

export interface DiscordUserProfile {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

export interface DiscordUserGuild {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
  approximate_member_count?: number;
}

export type BotCheckReason =
  | 'OK'
  | 'UNCONFIGURED'
  | 'INVALID_BOT_TOKEN'
  | 'NOT_IN_GUILD'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR';

// Required Discord permissions bitmask for AEGIS:
// ManageGuild (0x20) + ManageRoles (0x10000000) + ManageChannels (0x10) +
// KickMembers (0x2) + BanMembers (0x4) + ModerateMembers (0x10000000000) +
// ViewAuditLog (0x80) + SendMessages (0x800) + ManageWebhooks (0x20000000)
export const AEGIS_REQUIRED_BOT_PERMISSIONS = '1099780161686';

export function buildDiscordAvatarUrl(userId: string, avatarHash: string | null): string | null {
  if (!avatarHash) return null;
  const ext = avatarHash.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${ext}?size=256`;
}

export function buildDiscordGuildIconUrl(guildId: string, iconHash: string | null): string | null {
  if (!iconHash) return null;
  const ext = iconHash.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/icons/${guildId}/${iconHash}.${ext}?size=128`;
}

export function hasAdminPermission(permissionsStr: string, isOwner: boolean): boolean {
  if (isOwner) return true;
  try {
    const perms = BigInt(permissionsStr);
    const ADMINISTRATOR = BigInt(0x8);
    return (perms & ADMINISTRATOR) === ADMINISTRATOR;
  } catch {
    return false;
  }
}

export function hasManageGuildOrAdmin(permissionsStr: string, isOwner: boolean): boolean {
  if (isOwner) return true;
  try {
    const perms = BigInt(permissionsStr);
    const ADMINISTRATOR = BigInt(0x8);
    const MANAGE_GUILD = BigInt(0x20);
    return (perms & ADMINISTRATOR) === ADMINISTRATOR || (perms & MANAGE_GUILD) === MANAGE_GUILD;
  } catch {
    return false;
  }
}

export function buildDiscordOAuthUrl(params: {
  state: string;
  codeChallenge: string;
  redirectUri: string;
}): string {
  const { discordClientId } = getServerEnv();
  const query = new URLSearchParams({
    client_id: discordClientId,
    redirect_uri: params.redirectUri,
    response_type: 'code',
    scope: 'identify guilds',
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'consent',
  });
  return `https://discord.com/oauth2/authorize?${query.toString()}`;
}

export function buildDiscordBotInviteUrl(guildId?: string): string {
  const { discordClientId, discordBotInviteUrl } = getServerEnv();
  if (!discordClientId && discordBotInviteUrl) {
    return guildId ? `${discordBotInviteUrl}&guild_id=${guildId}` : discordBotInviteUrl;
  }
  if (!discordClientId) return '';
  const query = new URLSearchParams({
    client_id: discordClientId,
    permissions: AEGIS_REQUIRED_BOT_PERMISSIONS,
    scope: 'bot applications.commands',
  });
  if (guildId) {
    query.set('guild_id', guildId);
    query.set('disable_guild_select', 'false');
  }
  return `https://discord.com/oauth2/authorize?${query.toString()}`;
}

function parseDiscordApiError(rawText: string, status: number): string {
  try {
    const parsed = JSON.parse(rawText) as {
      error?: string;
      error_description?: string;
      message?: string;
    };
    if (parsed.error_description) {
      return `${parsed.error || 'Discord error'} (${status}): ${parsed.error_description}`;
    }
    if (parsed.message) {
      return `Discord API (${status}): ${parsed.message}`;
    }
  } catch {
    // Plain text fallback
  }
  return `Discord API error (${status}): ${rawText.slice(0, 180)}`;
}

export async function exchangeDiscordCode(params: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<DiscordOAuthTokenResponse> {
  const { discordClientId, discordClientSecret } = getServerEnv();
  const body = new URLSearchParams({
    client_id: discordClientId,
    client_secret: discordClientSecret,
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });

  const res = await fetch(`${DISCORD_API_BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(DISCORD_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(parseDiscordApiError(errText, res.status));
  }
  return (await res.json()) as DiscordOAuthTokenResponse;
}

export async function fetchDiscordUser(accessToken: string): Promise<DiscordUserProfile> {
  const res = await fetch(`${DISCORD_API_BASE}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(DISCORD_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(parseDiscordApiError(errText, res.status));
  }
  return (await res.json()) as DiscordUserProfile;
}

export async function fetchDiscordUserGuilds(accessToken: string): Promise<DiscordUserGuild[]> {
  const res = await fetch(`${DISCORD_API_BASE}/users/@me/guilds`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(DISCORD_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(parseDiscordApiError(errText, res.status));
  }
  return (await res.json()) as DiscordUserGuild[];
}

export async function fetchBotGuildIdsLive(): Promise<{
  ok: boolean;
  reason: BotCheckReason;
  guildIds: Set<string>;
}> {
  const { discordBotToken } = getServerEnv();
  if (!discordBotToken) {
    return { ok: false, reason: 'UNCONFIGURED', guildIds: new Set() };
  }
  try {
    const res = await fetch(`${DISCORD_API_BASE}/users/@me/guilds?limit=200`, {
      headers: { Authorization: `Bot ${discordBotToken}` },
      signal: AbortSignal.timeout(DISCORD_FETCH_TIMEOUT_MS),
    });
    if (res.status === 401) {
      return { ok: false, reason: 'INVALID_BOT_TOKEN', guildIds: new Set() };
    }
    if (res.status === 429) {
      return { ok: false, reason: 'RATE_LIMITED', guildIds: new Set() };
    }
    if (!res.ok) {
      return { ok: false, reason: 'NETWORK_ERROR', guildIds: new Set() };
    }
    const list = (await res.json()) as Array<{ id: string }>;
    return {
      ok: true,
      reason: 'OK',
      guildIds: new Set(list.map((g) => g.id)),
    };
  } catch {
    return { ok: false, reason: 'NETWORK_ERROR', guildIds: new Set() };
  }
}

export interface LiveBotTelemetry {
  online: boolean;
  id: string | null;
  tag: string | null;
  avatarUrl: string | null;
  pingMs: number | null;
  guildCount: number | null;
  userCount: number | null;
}

export async function verifyBotTelemetryLive(): Promise<LiveBotTelemetry> {
  const { discordBotToken } = getServerEnv();
  if (!discordBotToken) {
    return {
      online: false,
      id: null,
      tag: null,
      avatarUrl: null,
      pingMs: null,
      guildCount: null,
      userCount: null,
    };
  }
  try {
    const startedAt = Date.now();
    const res = await fetch(`${DISCORD_API_BASE}/users/@me`, {
      headers: { Authorization: `Bot ${discordBotToken}` },
      signal: AbortSignal.timeout(DISCORD_FETCH_TIMEOUT_MS),
    });
    const pingMs = Math.max(1, Date.now() - startedAt);
    if (!res.ok) {
      return {
        online: false,
        id: null,
        tag: null,
        avatarUrl: null,
        pingMs: null,
        guildCount: null,
        userCount: null,
      };
    }

    const botUser = (await res.json()) as {
      id: string;
      username: string;
      discriminator?: string;
      avatar?: string | null;
    };
    const tag =
      botUser.discriminator && botUser.discriminator !== '0'
        ? `${botUser.username}#${botUser.discriminator}`
        : botUser.username;
    const avatarUrl = buildDiscordAvatarUrl(botUser.id, botUser.avatar ?? null);

    let guildCount: number | null = null;
    let userCount: number | null = null;

    try {
      const guildsRes = await fetch(`${DISCORD_API_BASE}/users/@me/guilds?with_counts=true&limit=200`, {
        headers: { Authorization: `Bot ${discordBotToken}` },
        signal: AbortSignal.timeout(DISCORD_FETCH_TIMEOUT_MS),
      });
      if (guildsRes.ok) {
        const guilds = (await guildsRes.json()) as Array<{
          id: string;
          approximate_member_count?: number;
        }>;
        guildCount = guilds.length;

        const hasInlineCounts = guilds.some(
          (g) => typeof g.approximate_member_count === 'number'
        );
        if (hasInlineCounts) {
          userCount = guilds.reduce(
            (sum, g) => sum + (typeof g.approximate_member_count === 'number' ? g.approximate_member_count : 0),
            0
          );
        } else if (guilds.length === 0) {
          userCount = 0;
        } else if (guilds.length <= 20) {
          const detailCounts = await Promise.all(
            guilds.map(async (g) => {
              try {
                const gr = await fetch(`${DISCORD_API_BASE}/guilds/${g.id}?with_counts=true`, {
                  headers: { Authorization: `Bot ${discordBotToken}` },
                  signal: AbortSignal.timeout(3000),
                });
                if (!gr.ok) return 0;
                const gd = (await gr.json()) as { approximate_member_count?: number };
                return typeof gd.approximate_member_count === 'number'
                  ? gd.approximate_member_count
                  : 0;
              } catch {
                return 0;
              }
            })
          );
          userCount = detailCounts.reduce((sum, n) => sum + n, 0);
        }
      }
    } catch {
      // Non-fatal: keep online identity even if guild summary fetch times out
    }

    return {
      online: true,
      id: botUser.id,
      tag,
      avatarUrl,
      pingMs,
      guildCount,
      userCount,
    };
  } catch {
    return {
      online: false,
      id: null,
      tag: null,
      avatarUrl: null,
      pingMs: null,
      guildCount: null,
      userCount: null,
    };
  }
}

export async function verifyBotIdentityLive(): Promise<{
  online: boolean;
  id: string | null;
  tag: string | null;
}> {
  const telemetry = await verifyBotTelemetryLive();
  return {
    online: telemetry.online,
    id: telemetry.id,
    tag: telemetry.tag,
  };
}

export async function verifyBotGuildMembership(guildId: string): Promise<{
  installed: boolean;
  reason: BotCheckReason;
  name: string | null;
  memberCount: number | null;
  iconHash: string | null;
}> {
  const { discordBotToken } = getServerEnv();
  if (!discordBotToken) {
    return {
      installed: false,
      reason: 'UNCONFIGURED',
      name: null,
      memberCount: null,
      iconHash: null,
    };
  }
  try {
    const res = await fetch(`${DISCORD_API_BASE}/guilds/${guildId}?with_counts=true`, {
      headers: { Authorization: `Bot ${discordBotToken}` },
      signal: AbortSignal.timeout(DISCORD_FETCH_TIMEOUT_MS),
    });
    if (res.status === 401) {
      return {
        installed: false,
        reason: 'INVALID_BOT_TOKEN',
        name: null,
        memberCount: null,
        iconHash: null,
      };
    }
    if (res.status === 429) {
      return {
        installed: false,
        reason: 'RATE_LIMITED',
        name: null,
        memberCount: null,
        iconHash: null,
      };
    }
    if (!res.ok) {
      return {
        installed: false,
        reason: 'NOT_IN_GUILD',
        name: null,
        memberCount: null,
        iconHash: null,
      };
    }
    const guild = (await res.json()) as {
      id: string;
      name: string;
      icon: string | null;
      approximate_member_count?: number;
    };
    return {
      installed: true,
      reason: 'OK',
      name: guild.name,
      memberCount: guild.approximate_member_count ?? null,
      iconHash: guild.icon ?? null,
    };
  } catch {
    return {
      installed: false,
      reason: 'NETWORK_ERROR',
      name: null,
      memberCount: null,
      iconHash: null,
    };
  }
}

export interface DiscordGuildChannelSummary {
  id: string;
  name: string;
  type: number;
  permissionOverwrites: Array<{ id: string; type: number; allow: string; deny: string }>;
}

export async function fetchGuildChannelsLive(
  guildId: string
): Promise<DiscordGuildChannelSummary[]> {
  const { discordBotToken } = getServerEnv();
  if (!discordBotToken) return [];
  try {
    const res = await fetch(`${DISCORD_API_BASE}/guilds/${guildId}/channels`, {
      headers: { Authorization: `Bot ${discordBotToken}` },
      signal: AbortSignal.timeout(DISCORD_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const list = (await res.json()) as Array<{
      id: string;
      name?: string;
      type: number;
      permission_overwrites?: Array<{ id: string; type: number; allow: string; deny: string }>;
    }>;
    return list
      .filter((ch) => ch.type === 0 || ch.type === 2 || ch.type === 5)
      .map((ch) => ({
        id: ch.id,
        name: ch.name ? `#${ch.name}` : ch.id,
        type: ch.type,
        permissionOverwrites: ch.permission_overwrites ?? [],
      }));
  } catch {
    return [];
  }
}

export interface DiscordGuildRoleSummary {
  id: string;
  name: string;
  color: number;
  permissions: string;
  position: number;
}

export async function fetchGuildRolesLive(guildId: string): Promise<DiscordGuildRoleSummary[]> {
  const { discordBotToken } = getServerEnv();
  if (!discordBotToken) return [];
  try {
    const res = await fetch(`${DISCORD_API_BASE}/guilds/${guildId}/roles`, {
      headers: { Authorization: `Bot ${discordBotToken}` },
      signal: AbortSignal.timeout(DISCORD_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const list = (await res.json()) as Array<{
      id: string;
      name: string;
      color: number;
      permissions: string;
      position: number;
    }>;
    return list
      .filter((r) => r.name !== '@everyone')
      .sort((a, b) => b.position - a.position)
      .map((r) => ({
        id: r.id,
        name: r.name,
        color: r.color,
        permissions: r.permissions,
        position: r.position,
      }));
  } catch {
    return [];
  }
}

export async function sendDiscordTestLogMessage(
  channelId: string,
  guildName: string,
  actorName: string
): Promise<{ sent: boolean; reason?: string }> {
  const { discordBotToken } = getServerEnv();
  if (!discordBotToken) {
    return { sent: false, reason: 'BOT_UNCONFIGURED' };
  }
  try {
    const res = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${discordBotToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        embeds: [
          {
            title: 'AEGIS SECURITY — Test Log Verification',
            description: `Log channel synchronized for **${guildName}** by **${actorName}**.`,
            color: 0x5865f2,
            timestamp: new Date().toISOString(),
          },
        ],
      }),
      signal: AbortSignal.timeout(DISCORD_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { sent: false, reason: `HTTP_${res.status}` };
    }
    return { sent: true };
  } catch {
    return { sent: false, reason: 'NETWORK_ERROR' };
  }
}

export interface LockdownEnforcementInput {
  guildId: string;
  active: boolean;
  reason: string;
  restrictions: {
    lockSendMessages: boolean;
    lockAddReactions: boolean;
    lockCreateThreads: boolean;
    lockVoiceConnect: boolean;
    disableInvites: boolean;
  };
  previousSnapshots?: Array<{
    channelId: string;
    channelName: string;
    originalDenyFlags: string[];
    aegisAppliedDenyFlags: string[];
    modifiedExternallyAfterLockdown: boolean;
  }>;
}

export interface LockdownEnforcementResult {
  syncedToDiscord: boolean;
  affectedChannelCount: number;
  failedChannelCount: number;
  snapshots: Array<{
    channelId: string;
    channelName: string;
    originalDenyFlags: string[];
    aegisAppliedDenyFlags: string[];
    modifiedExternallyAfterLockdown: boolean;
  }>;
}

const BIT_ADD_REACTIONS = BigInt(0x40);
const BIT_SEND_MESSAGES = BigInt(0x800);
const BIT_CONNECT = BigInt(0x100000);
const BIT_CREATE_PUBLIC_THREADS = BigInt(0x800000000);
const BIT_CREATE_PRIVATE_THREADS = BigInt(0x1000000000);
const BIT_SEND_MESSAGES_IN_THREADS = BigInt(0x4000000000);

export async function enforceDiscordLockdown(
  input: LockdownEnforcementInput
): Promise<LockdownEnforcementResult> {
  const { discordBotToken } = getServerEnv();
  if (!discordBotToken) {
    return {
      syncedToDiscord: false,
      affectedChannelCount: 0,
      failedChannelCount: 0,
      snapshots: [],
    };
  }

  const appliedFlags: string[] = [];
  if (input.restrictions.lockSendMessages) appliedFlags.push('SEND_MESSAGES');
  if (input.restrictions.lockAddReactions) appliedFlags.push('ADD_REACTIONS');
  if (input.restrictions.lockCreateThreads) appliedFlags.push('CREATE_PUBLIC_THREADS');
  if (input.restrictions.lockVoiceConnect) appliedFlags.push('CONNECT');

  const channels = await fetchGuildChannelsLive(input.guildId);
  if (channels.length === 0) {
    return {
      syncedToDiscord: false,
      affectedChannelCount: 0,
      failedChannelCount: 0,
      snapshots: [],
    };
  }

  const prevSnapshotMap = new Map(
    (input.previousSnapshots ?? []).map((s) => [s.channelId, s] as const)
  );
  const snapshots: LockdownEnforcementResult['snapshots'] = [];
  let affected = 0;
  let failed = 0;

  // Bounded batches of 5 to stay fast while respecting Discord per-route rate limits
  for (let i = 0; i < channels.length; i += 5) {
    const batch = channels.slice(i, i + 5);
    await Promise.all(
      batch.map(async (ch) => {
        const isVoice = ch.type === 2;
        const isTextLike = ch.type === 0 || ch.type === 5;
        if (!isVoice && !isTextLike) return;

        const existingOverwrite = ch.permissionOverwrites.find((o) => o.id === input.guildId);
        let allowBig = BigInt(existingOverwrite?.allow || '0');
        let denyBig = BigInt(existingOverwrite?.deny || '0');

        if (input.active) {
          let mask = BigInt(0);
          if (isTextLike) {
            if (input.restrictions.lockSendMessages) {
              mask |= BIT_SEND_MESSAGES | BIT_SEND_MESSAGES_IN_THREADS;
            }
            if (input.restrictions.lockAddReactions) mask |= BIT_ADD_REACTIONS;
            if (input.restrictions.lockCreateThreads) {
              mask |= BIT_CREATE_PUBLIC_THREADS | BIT_CREATE_PRIVATE_THREADS;
            }
          } else if (isVoice && input.restrictions.lockVoiceConnect) {
            mask |= BIT_CONNECT;
          }

          if (mask === BigInt(0)) return;
          snapshots.push({
            channelId: ch.id,
            channelName: ch.name,
            originalDenyFlags: existingOverwrite?.deny ? [existingOverwrite.deny] : [],
            aegisAppliedDenyFlags: appliedFlags,
            modifiedExternallyAfterLockdown: false,
          });

          denyBig |= mask;
          allowBig &= ~mask;
        } else {
          const prev = prevSnapshotMap.get(ch.id);
          const originalDenyBig = BigInt(prev?.originalDenyFlags?.[0] || '0');
          const restoreMask =
            BIT_SEND_MESSAGES |
            BIT_SEND_MESSAGES_IN_THREADS |
            BIT_ADD_REACTIONS |
            BIT_CREATE_PUBLIC_THREADS |
            BIT_CREATE_PRIVATE_THREADS |
            BIT_CONNECT;
          denyBig = (denyBig & ~restoreMask) | (originalDenyBig & restoreMask);
        }

        try {
          const res = await fetch(
            `${DISCORD_API_BASE}/channels/${ch.id}/permissions/${input.guildId}`,
            {
              method: 'PUT',
              headers: {
                Authorization: `Bot ${discordBotToken}`,
                'Content-Type': 'application/json',
                'X-Audit-Log-Reason': encodeURIComponent(input.reason.slice(0, 120)),
              },
              body: JSON.stringify({
                type: 0,
                allow: allowBig.toString(),
                deny: denyBig.toString(),
              }),
              signal: AbortSignal.timeout(5000),
            }
          );
          if (res.ok) {
            affected += 1;
          } else {
            failed += 1;
          }
        } catch {
          failed += 1;
        }
      })
    );
  }

  return {
    syncedToDiscord: affected > 0,
    affectedChannelCount: affected,
    failedChannelCount: failed,
    snapshots: input.active ? snapshots : [],
  };
}

export async function applyDiscordMemberTimeout(params: {
  guildId: string;
  discordId: string;
  durationMs: number | null;
  reason: string;
}): Promise<{ synced: boolean; reason?: string }> {
  const { discordBotToken } = getServerEnv();
  if (!discordBotToken) {
    return { synced: false, reason: 'BOT_UNCONFIGURED' };
  }

  const untilIso =
    params.durationMs && params.durationMs > 0
      ? new Date(Date.now() + Math.min(params.durationMs, 28 * 86_400_000)).toISOString()
      : null;

  try {
    const res = await fetch(
      `${DISCORD_API_BASE}/guilds/${params.guildId}/members/${params.discordId}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bot ${discordBotToken}`,
          'Content-Type': 'application/json',
          'X-Audit-Log-Reason': encodeURIComponent(params.reason.slice(0, 120)),
        },
        body: JSON.stringify({
          communication_disabled_until: untilIso,
        }),
        signal: AbortSignal.timeout(6000),
      }
    );
    if (!res.ok) {
      return { synced: false, reason: `HTTP_${res.status}` };
    }
    return { synced: true };
  } catch {
    return { synced: false, reason: 'NETWORK_ERROR' };
  }
}

