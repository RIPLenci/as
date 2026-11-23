import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { GuildRecord } from '@/lib/aegis/types';
import { classifyDiscordServers } from '@/lib/aegis/servers-classifier';
import { requireAuthenticatedUser, requireGuildAuthorization } from '@/lib/server/auth-guard';
import {
  buildDiscordBotInviteUrl,
  buildDiscordGuildIconUrl,
  fetchBotGuildIdsLive,
  fetchDiscordUserGuilds,
  hasAdminPermission,
  hasManageGuildOrAdmin,
  verifyBotGuildMembership,
} from '@/lib/server/discord-api';
import { getServerEnv } from '@/lib/server/env';
import { getUserDiscordAccessToken } from '@/lib/server/session';
import { aegisStore } from '@/lib/server/store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  const { user, state } = auth.ctx;
  const env = getServerEnv();
  const allowedIds = state.userGuildAccess[user.id] ?? [];
  const secondaryGuildIds = new Set(
    Object.values(state.secondaryOwners)
      .filter((so) => so.discordId === user.discordId)
      .map((so) => so.guildId)
  );

  const shouldRefreshLive = req.nextUrl.searchParams.get('refresh') === '1';
  let syncWarning: string | null = null;
  let syncedNow = false;

  if (shouldRefreshLive) {
    let changed = false;
    const nowIso = new Date().toISOString();

    const botSnapshot = env.botConfigured ? await fetchBotGuildIdsLive() : null;
    if (env.botConfigured && botSnapshot && !botSnapshot.ok) {
      syncWarning =
        botSnapshot.reason === 'RATE_LIMITED'
          ? 'Discord API aplicó límite temporal al verificar el bot. Reintenta en unos segundos.'
          : 'No se pudo verificar el estado en vivo del bot con Discord API.';
    }

    // Re-fetch user guilds using encrypted shared OAuth access token if still valid
    const oauthToken = await getUserDiscordAccessToken(user.id);
    if (oauthToken) {
      try {
        const liveDiscordGuilds = await fetchDiscordUserGuilds(oauthToken);
        const existingRosterMap = new Map(
          (state.userGuildRoster[user.id] ?? []).map((g) => [g.guildId, g])
        );
        const nextRoster: GuildRecord[] = [];
        const nextAllowedIds: string[] = [];

        for (const dg of liveDiscordGuilds) {
          const prevGuild =
            existingRosterMap.get(dg.id) ??
            (Object.hasOwn(state.guilds, dg.id) ? state.guilds[dg.id] : undefined);
          const isSecondaryOwner = secondaryGuildIds.has(dg.id);
          const canEnter = Boolean(dg.owner) || isSecondaryOwner;
          const canManageDiscord = hasManageGuildOrAdmin(dg.permissions, dg.owner);
          const isAdmin = hasAdminPermission(dg.permissions, dg.owner);
          const botPresent = botSnapshot?.ok
            ? botSnapshot.guildIds.has(dg.id)
            : prevGuild?.botStatus === 'BOT_CONNECTED';

          const memberCount =
            dg.approximate_member_count ??
            (prevGuild && prevGuild.memberCount > 0 ? prevGuild.memberCount : 0);
          const memberCountKnown =
            typeof dg.approximate_member_count === 'number' || Boolean(prevGuild?.memberCountKnown);

          const record: GuildRecord = {
            guildId: dg.id,
            name: dg.name,
            iconUrl: buildDiscordGuildIconUrl(dg.id, dg.icon),
            memberCount,
            memberCountKnown,
            ownerDiscordId: dg.owner ? user.discordId : prevGuild?.ownerDiscordId ?? '',
            userIsOwner: Boolean(dg.owner),
            userIsSecondaryOwner: isSecondaryOwner,
            userIsAdmin: isAdmin,
            userHasManageGuild: canManageDiscord,
            botStatus: botPresent ? 'BOT_CONNECTED' : 'BOT_NOT_INSTALLED',
            botPermissionsOk: botPresent,
            protectionEnabled: botPresent ? prevGuild?.protectionEnabled ?? false : false,
            lastSyncAt: nowIso,
            linkedAt: botPresent ? prevGuild?.linkedAt ?? nowIso : null,
          };

          nextRoster.push(record);
          if (canEnter) {
            nextAllowedIds.push(dg.id);
            state.guilds[dg.id] = {
              ...record,
              ownerDiscordId: dg.owner ? user.discordId : prevGuild?.ownerDiscordId ?? '',
            };
            aegisStore.ensureGuildStructures(state, dg.id, record.name);
          }
        }

        state.userGuildRoster[user.id] = nextRoster;
        state.userGuildAccess[user.id] = nextAllowedIds;
        changed = true;
        syncedNow = true;
      } catch (err) {
        if (!syncWarning) {
          syncWarning =
            err instanceof Error
              ? err.message
              : 'No se pudo refrescar la lista completa desde Discord.';
        }
      }
    }

    // Also update bot presence status on stored roster & state.guilds when botSnapshot is ok
    if (botSnapshot?.ok) {
      syncedNow = true;
      const candidateIds = new Set<string>();
      for (const entry of state.userGuildRoster[user.id] ?? []) {
        candidateIds.add(entry.guildId);
      }
      for (const guild of Object.values(state.guilds)) {
        if (allowedIds.includes(guild.guildId) || secondaryGuildIds.has(guild.guildId)) {
          candidateIds.add(guild.guildId);
        }
      }

      for (const gid of candidateIds) {
        const present = botSnapshot.guildIds.has(gid);
        const nextStatus = present ? 'BOT_CONNECTED' : 'BOT_NOT_INSTALLED';
        const existingShared = Object.hasOwn(state.guilds, gid) ? state.guilds[gid] : undefined;
        const existingRoster = (state.userGuildRoster[user.id] ?? []).find(
          (r) => r.guildId === gid
        );
        const currentStatus = existingShared?.botStatus ?? existingRoster?.botStatus;
        if (currentStatus !== nextStatus) {
          aegisStore.syncGuildRecord(state, gid, {
            botStatus: nextStatus,
            botPermissionsOk: present,
            ...(present ? {} : { protectionEnabled: false }),
            lastSyncAt: nowIso,
            linkedAt: present
              ? existingShared?.linkedAt ?? existingRoster?.linkedAt ?? nowIso
              : null,
          });
          if (!present && state.antiRaidConfigs[gid]) {
            state.antiRaidConfigs[gid].enabled = false;
            state.antiRaidConfigs[gid].syncVersion += 1;
          }
          changed = true;
        }
      }
    }

    if (changed) {
      await aegisStore.commitMutation('guild:list_synced', undefined);
    }
  }

  // Prefer full per-user Discord guild roster; fall back to strictly owned/co-owned guilds
  const userRoster = state.userGuildRoster[user.id];

  const rawBaseList: GuildRecord[] =
    userRoster && userRoster.length > 0
      ? userRoster.map((rosterItem) => {
          const shared = Object.hasOwn(state.guilds, rosterItem.guildId)
            ? state.guilds[rosterItem.guildId]
            : undefined;
          const delegated = secondaryGuildIds.has(rosterItem.guildId);
          return {
            ...rosterItem,
            userIsSecondaryOwner: delegated,
            // Preserve live protection state from shared guild record while keeping user's own role flags
            protectionEnabled: shared ? shared.protectionEnabled : rosterItem.protectionEnabled,
            memberCount:
              shared && shared.memberCount > rosterItem.memberCount
                ? shared.memberCount
                : rosterItem.memberCount,
            memberCountKnown: Boolean(
              rosterItem.memberCountKnown || shared?.memberCountKnown || rosterItem.memberCount > 0
            ),
          };
        })
      : Object.values(state.guilds)
          .filter(
            (g) =>
              g.ownerDiscordId === user.discordId ||
              secondaryGuildIds.has(g.guildId) ||
              (allowedIds.includes(g.guildId) && g.userIsOwner)
          )
          .map((g) => ({
            ...g,
            userIsOwner: g.ownerDiscordId === user.discordId || g.userIsOwner,
            userIsSecondaryOwner: secondaryGuildIds.has(g.guildId),
          }));

  const presentIds = new Set(rawBaseList.map((g) => g.guildId));
  for (const secGid of secondaryGuildIds) {
    if (!presentIds.has(secGid) && Object.hasOwn(state.guilds, secGid)) {
      const g = state.guilds[secGid];
      rawBaseList.push({
        ...g,
        userIsOwner: false,
        userIsSecondaryOwner: true,
      });
    }
  }

  const baseList = rawBaseList;
  const classified = classifyDiscordServers(
    baseList,
    (guildId) => buildDiscordBotInviteUrl(guildId),
    secondaryGuildIds
  );

  const lastSyncedAt =
    classified.orderedAll
      .map((s) => s.lastSyncAt)
      .filter((v): v is string => Boolean(v))
      .sort()
      .at(-1) ?? (syncedNow ? new Date().toISOString() : null);

  return NextResponse.json({
    servers: classified.orderedAll,
    grouped: {
      owned: classified.owned,
      admin: classified.admin,
      invite: classified.invite,
      memberConnected: classified.memberConnected,
    },
    stats: classified.stats,
    botConfigured: env.botConfigured,
    genericInviteUrl: buildDiscordBotInviteUrl(),
    lastSyncedAt,
    syncWarning,
  });
}

const verifySchema = z.object({
  guildId: z.string().regex(/^\d{17,20}$/),
});

export async function POST(req: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = verifySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const guard = requireGuildAuthorization(auth.ctx, parsed.data.guildId, 'antiraid:read');
  if (!guard.ok) return guard.response;

  const { guild } = guard;
  const { state, user } = auth.ctx;
  const env = getServerEnv();

  const updateRosterEntry = (updated: GuildRecord) => {
    aegisStore.syncGuildRecord(state, updated.guildId, {
      name: updated.name,
      iconUrl: updated.iconUrl,
      memberCount: updated.memberCount,
      memberCountKnown: Boolean(updated.memberCountKnown || updated.memberCount > 0),
      botStatus: updated.botStatus,
      botPermissionsOk: updated.botPermissionsOk,
      protectionEnabled: updated.protectionEnabled,
      lastSyncAt: updated.lastSyncAt,
      linkedAt: updated.linkedAt,
    });
  };

  if (!env.botConfigured) {
    return NextResponse.json(
      {
        verified: false,
        code: 'UNCONFIGURED',
        guild,
        message:
          'DISCORD_BOT_TOKEN no está configurado en el servidor; la verificación real del bot requiere DISCORD_BOT_TOKEN.',
      },
      { status: 503 }
    );
  }

  const verification = await verifyBotGuildMembership(guild.guildId);
  if (!verification.installed) {
    if (verification.reason === 'INVALID_BOT_TOKEN') {
      return NextResponse.json(
        {
          verified: false,
          code: 'INVALID_BOT_TOKEN',
          guild,
          message:
            'Discord rechazó DISCORD_BOT_TOKEN (401). Verifica el token del bot en las variables de entorno.',
        },
        { status: 502 }
      );
    }
    if (verification.reason === 'RATE_LIMITED' || verification.reason === 'NETWORK_ERROR') {
      return NextResponse.json(
        {
          verified: false,
          code: verification.reason,
          guild,
          message:
            verification.reason === 'RATE_LIMITED'
              ? 'La API de Discord limitó temporalmente la verificación. Reintenta en unos segundos.'
              : 'Error temporal de red al contactar con la API de Discord. Reintenta en breve.',
        },
        { status: 503 }
      );
    }

    guild.botStatus = 'BOT_NOT_INSTALLED';
    guild.botPermissionsOk = false;
    guild.protectionEnabled = false;
    guild.lastSyncAt = new Date().toISOString();
    if (state.antiRaidConfigs[guild.guildId]) {
      state.antiRaidConfigs[guild.guildId].enabled = false;
    }
    updateRosterEntry(guild);
    await aegisStore.commitMutation('guild:bot_disconnected', guild.guildId);
    return NextResponse.json(
      {
        verified: false,
        code: 'NOT_IN_GUILD',
        guild,
        message:
          'El bot todavía no está presente en este servidor. Usa "+ Invitar al Bot" primero y vuelve a verificar.',
      },
      { status: 409 }
    );
  }

  guild.name = verification.name ?? guild.name;
  guild.memberCount = verification.memberCount ?? guild.memberCount;
  if (typeof verification.memberCount === 'number') {
    guild.memberCountKnown = true;
  }
  if (verification.iconHash) {
    guild.iconUrl = buildDiscordGuildIconUrl(guild.guildId, verification.iconHash);
  }
  guild.botStatus = 'BOT_CONNECTED';
  guild.botPermissionsOk = true;
  guild.lastSyncAt = new Date().toISOString();
  guild.linkedAt = guild.linkedAt ?? guild.lastSyncAt;
  updateRosterEntry(guild);

  aegisStore.appendAuditLog(state, {
    guildId: guild.guildId,
    actorId: user.discordId,
    actorName: user.username,
    action: 'GUILD_BOT_VERIFIED',
    entityType: 'Guild',
    entityId: guild.guildId,
    result: 'SUCCESS',
    metadata: { botStatus: guild.botStatus },
  });

  await aegisStore.commitMutation('guild:verified', guild.guildId, { guild });

  return NextResponse.json({
    verified: true,
    confirmation: {
      headline: 'AEGIS conectado correctamente.',
      serverName: guild.name,
      botState: 'ACTIVO',
      securityState: 'Listo para configurar.',
    },
    guild,
  });
}
