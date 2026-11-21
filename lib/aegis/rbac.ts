import type { GuildRecord, PermissionKey, RbacRole, UserRecord } from './types';

export const SUPER_OWNER_DISCORD_ID = '1052422681569525792' as const;

export function isSuperOwner(
  userOrDiscordId: Pick<UserRecord, 'discordId'> | string | null | undefined
): boolean {
  if (!userOrDiscordId) return false;
  const id = typeof userOrDiscordId === 'string' ? userOrDiscordId : userOrDiscordId.discordId;
  return id === SUPER_OWNER_DISCORD_ID;
}

export const ROLE_PERMISSION_MATRIX: Record<RbacRole, PermissionKey[]> = {
  OWNER: [
    'overview:read',
    'antiraid:read',
    'antiraid:write',
    'lockdown:manage',
    'quarantine:manage',
    'globalban:read',
    'globalban:create',
    'globalban:revoke',
    'appeals:manage',
    'logs:read',
    'moderators:manage',
  ],
  GLOBAL_ADMINISTRATOR: [
    'overview:read',
    'antiraid:read',
    'antiraid:write',
    'lockdown:manage',
    'quarantine:manage',
    'globalban:read',
    'globalban:create',
    'globalban:revoke',
    'appeals:manage',
    'logs:read',
    'moderators:manage',
  ],
  GLOBAL_MODERATOR: [
    'overview:read',
    'antiraid:read',
    'globalban:read',
    'globalban:create',
    'appeals:manage',
    'logs:read',
  ],
  SERVER_ADMINISTRATOR: [
    'overview:read',
    'antiraid:read',
    'antiraid:write',
    'lockdown:manage',
    'quarantine:manage',
    'globalban:read',
    'logs:read',
  ],
  SERVER_MODERATOR: [
    'overview:read',
    'antiraid:read',
    'quarantine:manage',
    'globalban:read',
    'logs:read',
  ],
  VIEWER: ['overview:read', 'antiraid:read', 'globalban:read'],
};

export const ALL_PERMISSIONS: PermissionKey[] = [
  'overview:read',
  'antiraid:read',
  'antiraid:write',
  'lockdown:manage',
  'quarantine:manage',
  'globalban:read',
  'globalban:create',
  'globalban:revoke',
  'appeals:manage',
  'logs:read',
  'moderators:manage',
];

export const ALL_ROLES: RbacRole[] = [
  'OWNER',
  'GLOBAL_ADMINISTRATOR',
  'GLOBAL_MODERATOR',
  'SERVER_ADMINISTRATOR',
  'SERVER_MODERATOR',
  'VIEWER',
];

/**
 * Resolves the effective RBAC role for a user within a guild context.
 * STRICT RULE: Only the Discord Guild Owner OR the AEGIS-registered Secondary Owner
 * can configure a server (even without Discord Administrator permissions).
 * Users who only possess Discord Administrator/ManageGuild permissions are treated as VIEWER.
 */
export function resolveEffectiveRole(
  user: Pick<UserRecord, 'discordId' | 'globalRole'>,
  guild?: Pick<GuildRecord, 'userIsOwner' | 'ownerDiscordId' | 'userHasManageGuild'> | null,
  secondaryOwnerDiscordId?: string | null
): RbacRole {
  if (guild) {
    const isPrimaryOwner =
      guild.userIsOwner ||
      (Boolean(guild.ownerDiscordId) && guild.ownerDiscordId === user.discordId);
    const isSecondaryOwner =
      Boolean(secondaryOwnerDiscordId) && secondaryOwnerDiscordId === user.discordId;
    if (isPrimaryOwner || isSecondaryOwner) {
      return 'SERVER_ADMINISTRATOR';
    }
    return 'VIEWER';
  }

  return user.globalRole;
}

export function hasPermission(
  role: RbacRole,
  permission: PermissionKey,
  customGrants?: PermissionKey[]
): boolean {
  const roleAllowed = ROLE_PERMISSION_MATRIX[role]?.includes(permission) ?? false;
  if (!roleAllowed) {
    return false;
  }
  if (role === 'OWNER') {
    return true;
  }
  if (Array.isArray(customGrants)) {
    return customGrants.includes(permission);
  }
  return true;
}

/**
 * Anti-IDOR Guild Access Verification.
 * Strictly requires the user to be EITHER the Discord Guild Owner OR the designated Secondary Owner
 * in AEGIS (independent of Discord Administrator permission bitmasks).
 */
export function canAccessGuild(
  user: Pick<UserRecord, 'discordId' | 'globalRole'>,
  guild: Pick<GuildRecord, 'guildId' | 'userIsOwner' | 'ownerDiscordId' | 'userHasManageGuild'> | undefined | null,
  secondaryOwnerDiscordId?: string | null
): boolean {
  if (!guild) return false;
  const isPrimaryOwner =
    guild.userIsOwner ||
    (Boolean(guild.ownerDiscordId) && guild.ownerDiscordId === user.discordId);
  const isSecondaryOwner =
    Boolean(secondaryOwnerDiscordId) && secondaryOwnerDiscordId === user.discordId;
  return isPrimaryOwner || isSecondaryOwner;
}
