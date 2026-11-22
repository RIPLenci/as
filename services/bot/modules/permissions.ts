import { PermissionFlagsBits, type Guild, type GuildMember } from 'discord.js';
import type {
  DiscordTargetCapability,
  SanctionExecutionHooks,
} from '../../../lib/aegis/sanction-executor';
import { isSuperOwner } from '../../../lib/aegis/rbac';
import { getServerEnv } from '../../../lib/server/env';
import type { PersistedDatabaseState } from '../../../lib/server/store';

const IN_FLIGHT_MITIGATIONS = new Map<string, number>();

export function tryClaimMitigation(key: string, ttlMs = 2_500): boolean {
  const now = Date.now();
  const exp = IN_FLIGHT_MITIGATIONS.get(key);
  if (exp && exp > now) return false;
  IN_FLIGHT_MITIGATIONS.set(key, now + ttlMs);
  if (IN_FLIGHT_MITIGATIONS.size > 2000) {
    for (const [k, v] of IN_FLIGHT_MITIGATIONS.entries()) {
      if (v <= now) IN_FLIGHT_MITIGATIONS.delete(k);
    }
  }
  return true;
}

export function isBotStaffMember(state: PersistedDatabaseState, discordId: string): boolean {
  if (isSuperOwner(discordId)) return true;
  const env = getServerEnv();
  if (env.ownerIds.includes(discordId) || env.globalAdminIds.includes(discordId)) {
    return true;
  }
  const activeMod = state.globalModerators.find(
    (m) =>
      m.discordId === discordId &&
      m.status === 'ACTIVE' &&
      (m.role === 'OWNER' || m.role === 'GLOBAL_ADMINISTRATOR')
  );
  return Boolean(activeMod);
}

export function isAuthorizedGuildOperator(
  state: PersistedDatabaseState,
  guild: Guild,
  discordId: string
): boolean {
  if (guild.ownerId === discordId) return true;
  const secondary = Object.hasOwn(state.secondaryOwners, guild.id)
    ? state.secondaryOwners[guild.id]
    : undefined;
  return Boolean(secondary && secondary.discordId === discordId);
}

export function auditGuildBotPermissions(guild: Guild): {
  ok: boolean;
  missingPermissions: string[];
} {
  const me = guild.members.me;
  if (!me) {
    return {
      ok: false,
      missingPermissions: ['BotMemberUnavailable'],
    };
  }

  const requiredChecks: Array<[bigint, string]> = [
    [PermissionFlagsBits.ManageGuild, 'ManageGuild'],
    [PermissionFlagsBits.ManageRoles, 'ManageRoles'],
    [PermissionFlagsBits.ManageChannels, 'ManageChannels'],
    [PermissionFlagsBits.KickMembers, 'KickMembers'],
    [PermissionFlagsBits.BanMembers, 'BanMembers'],
    [PermissionFlagsBits.ModerateMembers, 'ModerateMembers'],
  ];

  const missingPermissions: string[] = [];
  for (const [bit, label] of requiredChecks) {
    if (!me.permissions.has(bit)) {
      missingPermissions.push(label);
    }
  }

  return {
    ok: missingPermissions.length === 0,
    missingPermissions,
  };
}

export function inspectMemberCapability(
  member: GuildMember,
  botUserId?: string
): DiscordTargetCapability {
  const me = member.guild.members.me;
  const targetHighestPos = member.roles?.highest?.position ?? 0;
  const botHighestPos = me?.roles?.highest?.position ?? 0;

  return {
    targetId: member.id,
    targetUsername: member.user.username,
    isGuildOwner: member.id === member.guild.ownerId,
    isBotSelf: Boolean(botUserId && member.id === botUserId),
    bannable: Boolean(member.bannable),
    kickable: Boolean(member.kickable),
    moderatable: Boolean(member.moderatable),
    manageable: Boolean(member.manageable),
    botPermissions: {
      banMembers: Boolean(me?.permissions.has(PermissionFlagsBits.BanMembers)),
      kickMembers: Boolean(me?.permissions.has(PermissionFlagsBits.KickMembers)),
      moderateMembers: Boolean(me?.permissions.has(PermissionFlagsBits.ModerateMembers)),
      manageRoles: Boolean(me?.permissions.has(PermissionFlagsBits.ManageRoles)),
      manageGuild: Boolean(me?.permissions.has(PermissionFlagsBits.ManageGuild)),
    },
    botHighestRoleAboveTarget:
      member.id !== member.guild.ownerId && botHighestPos > targetHighestPos,
  };
}

export function buildSanctionHooks(member: GuildMember): SanctionExecutionHooks {
  return {
    ban: async (reason: string) => {
      await member.ban({ reason: reason.slice(0, 500) });
    },
    kick: async (reason: string) => {
      await member.kick(reason.slice(0, 500));
    },
    timeout: async (durationMs: number, reason: string) => {
      await member.timeout(durationMs, reason.slice(0, 500));
    },
    stripDangerousRoles: async (reason: string) => {
      const rolesToRemove = member.roles.cache.filter(
        (r) => r.editable && r.id !== member.guild.id
      );
      if (rolesToRemove.size > 0) {
        await member.roles.remove(rolesToRemove, reason.slice(0, 500));
      }
    },
  };
}
