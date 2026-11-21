import type {
  ClassifiedServerItem,
  ClassifiedServersResult,
  GuildRecord,
  ServerPriorityTier,
  ServerRoleTag,
} from './types';

function resolveRoleTag(g: GuildRecord, isSecondaryOwner: boolean): ServerRoleTag {
  if (g.userIsOwner) return 'PROPIETARIO';
  if (isSecondaryOwner) return 'SEGUNDO DUEÑO';
  if (g.userIsAdmin || g.userHasManageGuild) return 'ADMINISTRADOR';
  return 'MIEMBRO';
}

function getTierRank(item: ClassifiedServerItem): number {
  if (item.priorityTier === 'OWNED') return 1;
  if (item.priorityTier === 'ADMIN') return 2;
  if (item.priorityTier === 'INVITE') {
    if (item.roleTag === 'PROPIETARIO') return 3;
    if (item.roleTag === 'SEGUNDO DUEÑO') return 4;
    if (item.roleTag === 'ADMINISTRADOR') return 5;
    return 6;
  }
  return 7;
}

/**
 * Deduplicates guilds by guildId, preferring connected bot state and higher user permissions.
 */
export function deduplicateServers<T extends GuildRecord>(servers: T[]): T[] {
  const byId = new Map<string, T>();
  for (const srv of servers) {
    if (!srv || !srv.guildId) continue;
    const existing = byId.get(srv.guildId);
    if (!existing) {
      byId.set(srv.guildId, srv);
      continue;
    }

    const srvConnected = srv.botStatus === 'BOT_CONNECTED';
    const existingConnected = existing.botStatus === 'BOT_CONNECTED';
    const srvPrivilege = (srv.userIsOwner ? 4 : 0) + (srv.userIsAdmin ? 2 : 0) + (srv.userHasManageGuild ? 1 : 0);
    const existingPrivilege =
      (existing.userIsOwner ? 4 : 0) +
      (existing.userIsAdmin ? 2 : 0) +
      (existing.userHasManageGuild ? 1 : 0);

    const preferIncoming =
      (srvConnected && !existingConnected) ||
      (srvConnected === existingConnected && srvPrivilege > existingPrivilege) ||
      (srvConnected === existingConnected &&
        srvPrivilege === existingPrivilege &&
        srv.memberCount > existing.memberCount);

    if (preferIncoming) {
      byId.set(srv.guildId, srv);
    }
  }
  return Array.from(byId.values());
}

/**
 * Organizes Discord servers into strict priority tiers:
 * 1. OWNED (bot connected + user is Guild Owner or designated Secondary Owner -> canManage=true)
 * 2. ADMIN (bot connected + user only holds Discord Admin/ManageGuild -> canManage=false, read/status only)
 * 3. INVITE (bot not installed, ordered PROPIETARIO -> SEGUNDO DUEÑO -> ADMINISTRADOR -> MIEMBRO)
 * 4. MEMBER (bot connected where user is plain member)
 *
 * STRICT SECURITY RULE: Only the Discord Owner OR designated Secondary Owner can enter & configure a server,
 * even if they have zero Discord Administrator permissions.
 */
export function classifyDiscordServers<T extends GuildRecord & { inviteUrl?: string }>(
  rawServers: T[],
  buildInviteUrl?: (guildId: string) => string,
  secondaryOwnerGuildIds?: Set<string> | string[]
): ClassifiedServersResult {
  const deduped = deduplicateServers(rawServers);
  const secondarySet =
    secondaryOwnerGuildIds instanceof Set
      ? secondaryOwnerGuildIds
      : new Set(secondaryOwnerGuildIds ?? []);

  const owned: ClassifiedServerItem[] = [];
  const admin: ClassifiedServerItem[] = [];
  const invite: ClassifiedServerItem[] = [];
  const memberConnected: ClassifiedServerItem[] = [];

  for (const srv of deduped) {
    const isSecondaryOwner = secondarySet.has(srv.guildId);
    const roleTag = resolveRoleTag(srv, isSecondaryOwner);
    const hasAdminRight = srv.userIsOwner || Boolean(srv.userIsAdmin) || srv.userHasManageGuild;
    const isAuthorizedOwnerOrCoOwner = srv.userIsOwner || isSecondaryOwner;
    const botActive = srv.botStatus === 'BOT_CONNECTED';

    let priorityTier: ServerPriorityTier;
    if (botActive && isAuthorizedOwnerOrCoOwner) {
      priorityTier = 'OWNED';
    } else if (botActive && hasAdminRight) {
      priorityTier = 'ADMIN';
    } else if (!botActive) {
      priorityTier = 'INVITE';
    } else {
      priorityTier = 'MEMBER';
    }

    // ONLY Guild Owner or registered Secondary Owner can configure AEGIS on this guild
    const canManage = botActive && isAuthorizedOwnerOrCoOwner;
    const canInvite = !botActive && (srv.userIsOwner || srv.userHasManageGuild);
    const rawInvite = srv.inviteUrl || (buildInviteUrl ? buildInviteUrl(srv.guildId) : '');

    const classified: ClassifiedServerItem = {
      ...srv,
      userIsSecondaryOwner: isSecondaryOwner,
      userIsAdmin: Boolean(srv.userIsAdmin || srv.userIsOwner),
      memberCountKnown:
        typeof srv.memberCountKnown === 'boolean'
          ? srv.memberCountKnown
          : typeof srv.memberCount === 'number' && srv.memberCount > 0,
      priorityTier,
      roleTag,
      canManage,
      canInvite,
      inviteUrl: canInvite ? rawInvite : '',
    };

    if (priorityTier === 'OWNED') owned.push(classified);
    else if (priorityTier === 'ADMIN') admin.push(classified);
    else if (priorityTier === 'INVITE') invite.push(classified);
    else memberConnected.push(classified);
  }

  const byNameAndPrivilege = (a: ClassifiedServerItem, b: ClassifiedServerItem) => {
    const rankDiff = getTierRank(a) - getTierRank(b);
    if (rankDiff !== 0) return rankDiff;
    return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
  };

  owned.sort(byNameAndPrivilege);
  admin.sort(byNameAndPrivilege);
  invite.sort(byNameAndPrivilege);
  memberConnected.sort(byNameAndPrivilege);

  const orderedAll = [...owned, ...admin, ...invite, ...memberConnected];

  return {
    owned,
    admin,
    invite,
    memberConnected,
    orderedAll,
    stats: {
      total: orderedAll.length,
      ownedCount: owned.length,
      adminCount: admin.length,
      inviteCount: invite.length,
      invitableCount: invite.filter((s) => s.canInvite).length,
      connectedCount: owned.length + admin.length + memberConnected.length,
    },
  };
}
