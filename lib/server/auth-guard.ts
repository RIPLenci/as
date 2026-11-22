import { NextResponse } from 'next/server';
import type { GuildRecord, PermissionKey, RbacRole, UserRecord } from '../aegis/types';
import {
  canAccessGuild,
  hasPermission,
  isSuperOwner,
  resolveEffectiveRole,
  SUPER_OWNER_DISCORD_ID,
} from '../aegis/rbac';
import { getServerEnv } from './env';
import { readSessionFromCookies, type SessionPayload } from './session';
import { aegisStore, type PersistedDatabaseState } from './store';

const SNOWFLAKE_RE = /^\d{17,20}$/;

export interface AuthContext {
  session: SessionPayload;
  user: UserRecord;
  state: PersistedDatabaseState;
}

export function resolveAuthoritativeGlobalRole(
  state: PersistedDatabaseState,
  discordId: string,
  storedRole: RbacRole
): RbacRole {
  if (discordId === SUPER_OWNER_DISCORD_ID) return 'OWNER';
  const env = getServerEnv();
  if (env.ownerIds.includes(discordId)) return 'OWNER';
  if (env.globalAdminIds.includes(discordId)) return 'GLOBAL_ADMINISTRATOR';

  const activeMod = state.globalModerators.find(
    (m) => m.discordId === discordId && m.status === 'ACTIVE'
  );
  if (activeMod) return activeMod.role;

  // Prevent stale/revoked global moderator/administrator roles from remaining active
  if (storedRole === 'GLOBAL_ADMINISTRATOR' || storedRole === 'GLOBAL_MODERATOR') {
    return 'SERVER_ADMINISTRATOR';
  }
  if (storedRole === 'OWNER') {
    return 'SERVER_ADMINISTRATOR';
  }
  return storedRole;
}

export async function requireAuthenticatedUser(
  explicitBearer?: string | null
): Promise<
  { ok: true; ctx: AuthContext } | { ok: false; response: NextResponse }
> {
  const session = await readSessionFromCookies(explicitBearer);
  if (!session || !SNOWFLAKE_RE.test(session.discordId)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      ),
    };
  }

  const state = await aegisStore.getState();
  if (!Object.hasOwn(state.users, session.discordId)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'UNAUTHORIZED', message: 'Session user not found' },
        { status: 401 }
      ),
    };
  }

  const user = state.users[session.discordId];
  if (!user || user.id !== session.userId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'UNAUTHORIZED', message: 'Session integrity mismatch' },
        { status: 401 }
      ),
    };
  }

  const authoritativeRole = resolveAuthoritativeGlobalRole(state, user.discordId, user.globalRole);
  if (authoritativeRole !== user.globalRole) {
    user.globalRole = authoritativeRole;
  }

  return { ok: true, ctx: { session, user, state } };
}

/**
 * Mitigates Cross-Site Request Forgery when cookies use SameSite=None (required by iframe preview).
 * Allows Bearer token calls, same-origin requests, and direct API clients without Origin;
 * blocks cross-site browser requests whose Origin/Sec-Fetch-Site mismatches host/appUrl.
 */
export function verifyMutationOrigin(req: Request): NextResponse | null {
  const authHeader = req.headers.get('authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    return null;
  }

  const secFetchSite = req.headers.get('sec-fetch-site');
  if (secFetchSite === 'cross-site') {
    return NextResponse.json(
      { error: 'CSRF_BLOCKED', message: 'Solicitud cross-site bloqueada por política de origen.' },
      { status: 403 }
    );
  }

  const origin = req.headers.get('origin');
  if (!origin) return null;

  try {
    const originHost = new URL(origin).host.toLowerCase();
    const expectedHosts = new Set<string>();
    const hostHeader = req.headers.get('x-forwarded-host') || req.headers.get('host');
    if (hostHeader) {
      expectedHosts.add(hostHeader.split(',')[0].trim().toLowerCase());
    }
    const env = getServerEnv();
    if (env.appUrl) {
      expectedHosts.add(new URL(env.appUrl).host.toLowerCase());
    }
    if (expectedHosts.size > 0 && !expectedHosts.has(originHost)) {
      return NextResponse.json(
        { error: 'CSRF_BLOCKED', message: 'Origen de solicitud no autorizado.' },
        { status: 403 }
      );
    }
  } catch {
    return NextResponse.json(
      { error: 'CSRF_BLOCKED', message: 'Cabecera Origin inválida.' },
      { status: 403 }
    );
  }
  return null;
}

export function isBotStaff(user: Pick<UserRecord, 'discordId' | 'globalRole'>): boolean {
  const env = getServerEnv();
  return (
    isSuperOwner(user.discordId) ||
    env.ownerIds.includes(user.discordId) ||
    env.globalAdminIds.includes(user.discordId) ||
    user.globalRole === 'OWNER' ||
    user.globalRole === 'GLOBAL_ADMINISTRATOR'
  );
}

export async function requireSuperOwner(
  explicitBearer?: string | null
): Promise<
  { ok: true; ctx: AuthContext } | { ok: false; response: NextResponse }
> {
  const auth = await requireAuthenticatedUser(explicitBearer);
  if (!auth.ok) return auth;
  if (!isSuperOwner(auth.ctx.user.discordId)) {
    aegisStore.appendAuditLog(auth.ctx.state, {
      guildId: null,
      actorId: auth.ctx.user.discordId,
      actorName: auth.ctx.user.username,
      action: 'ADMIN_PANEL_ACCESS_DENIED',
      entityType: 'AdminPanel',
      entityId: auth.ctx.user.discordId,
      result: 'DENIED',
      metadata: { reason: 'EXCLUSIVE_OWNER_ID_REQUIRED' },
    });
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'FORBIDDEN',
          message: 'Acceso denegado. El Panel Administrativo es exclusivo del Owner autorizado.',
        },
        { status: 403 }
      ),
    };
  }
  return auth;
}

function resolveGuildForUser(
  state: PersistedDatabaseState,
  user: UserRecord,
  guildId: string
): GuildRecord | undefined {
  const sharedGuild = Object.hasOwn(state.guilds, guildId) ? state.guilds[guildId] : undefined;
  const rosterEntry = (state.userGuildRoster[user.id] ?? []).find((g) => g.guildId === guildId);
  if (!sharedGuild && !rosterEntry) return undefined;

  const userIsOwner = rosterEntry
    ? rosterEntry.userIsOwner
    : Boolean(sharedGuild?.ownerDiscordId === user.discordId || sharedGuild?.userIsOwner);

  return {
    ...(sharedGuild ?? rosterEntry!),
    ownerDiscordId: sharedGuild?.ownerDiscordId || rosterEntry?.ownerDiscordId || '',
    userIsOwner,
  };
}

export function requireGuildAuthorization(
  ctx: AuthContext,
  guildId: string,
  permission: PermissionKey
):
  | { ok: true; guild: GuildRecord; role: RbacRole }
  | { ok: false; response: NextResponse } {
  if (!SNOWFLAKE_RE.test(guildId)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'ID de servidor de Discord inválido.' },
        { status: 400 }
      ),
    };
  }

  const guild = resolveGuildForUser(ctx.state, ctx.user, guildId);
  const secondaryOwner = Object.hasOwn(ctx.state.secondaryOwners, guildId)
    ? ctx.state.secondaryOwners[guildId]
    : undefined;
  const isSecondaryOwner = secondaryOwner?.discordId === ctx.user.discordId;
  const isPrimaryOwner = Boolean(
    guild && (guild.userIsOwner || guild.ownerDiscordId === ctx.user.discordId)
  );

  if (!guild || (!isPrimaryOwner && !isSecondaryOwner)) {
    aegisStore.appendAuditLog(ctx.state, {
      guildId,
      actorId: ctx.user.discordId,
      actorName: ctx.user.username,
      action: `ACCESS_DENIED_${permission.toUpperCase()}`,
      entityType: 'Guild',
      entityId: guildId,
      result: 'DENIED',
      metadata: { reason: 'OWNER_OR_SECONDARY_OWNER_REQUIRED' },
    });
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'FORBIDDEN',
          message:
            'Solo el Dueño Principal o el Segundo Dueño designado pueden acceder y configurar este servidor.',
        },
        { status: 403 }
      ),
    };
  }

  if (!canAccessGuild(ctx.user, guild, secondaryOwner?.discordId)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'FORBIDDEN',
          message:
            'Solo el Dueño Principal o el Segundo Dueño designado pueden configurar este servidor.',
        },
        { status: 403 }
      ),
    };
  }

  aegisStore.ensureGuildStructures(ctx.state, guildId, guild.name);

  const role = resolveEffectiveRole(ctx.user, guild, secondaryOwner?.discordId);
  if (!hasPermission(role, permission)) {
    aegisStore.appendAuditLog(ctx.state, {
      guildId,
      actorId: ctx.user.discordId,
      actorName: ctx.user.username,
      action: `PERMISSION_DENIED_${permission.toUpperCase()}`,
      entityType: 'Guild',
      entityId: guildId,
      result: 'DENIED',
      metadata: { role },
    });
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'FORBIDDEN', message: `Permiso requerido insuficiente: ${permission}` },
        { status: 403 }
      ),
    };
  }

  return { ok: true, guild, role };
}

export function requireGlobalPermission(
  ctx: AuthContext,
  permission: PermissionKey
): { ok: true; role: RbacRole } | { ok: false; response: NextResponse } {
  const modEntry = ctx.state.globalModerators.find(
    (m) => m.discordId === ctx.user.discordId && m.status === 'ACTIVE'
  );
  const role: RbacRole = resolveAuthoritativeGlobalRole(
    ctx.state,
    ctx.user.discordId,
    modEntry ? modEntry.role : ctx.user.globalRole
  );

  if (!hasPermission(role, permission, modEntry?.allowedActions)) {
    aegisStore.appendAuditLog(ctx.state, {
      guildId: null,
      actorId: ctx.user.discordId,
      actorName: ctx.user.username,
      action: `PERMISSION_DENIED_${permission.toUpperCase()}`,
      entityType: 'GlobalSecurity',
      entityId: 'GLOBAL',
      result: 'DENIED',
      metadata: { role },
    });
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'FORBIDDEN', message: `Permiso global requerido insuficiente: ${permission}` },
        { status: 403 }
      ),
    };
  }

  return { ok: true, role };
}

export function isUserAuthorizedForGuildCollection(
  state: PersistedDatabaseState,
  user: UserRecord,
  guildId: string
): boolean {
  const guild = resolveGuildForUser(state, user, guildId);
  const secondaryOwner = Object.hasOwn(state.secondaryOwners, guildId)
    ? state.secondaryOwners[guildId]
    : undefined;
  return Boolean(guild && canAccessGuild(user, guild, secondaryOwner?.discordId));
}

export function hasAnyManageableGuild(
  state: PersistedDatabaseState,
  user: UserRecord
): boolean {
  if (Object.values(state.secondaryOwners).some((s) => s.discordId === user.discordId)) {
    return true;
  }
  const roster = state.userGuildRoster[user.id] ?? [];
  if (roster.some((g) => g.userIsOwner && g.botStatus === 'BOT_CONNECTED')) {
    return true;
  }
  const allowedIds = state.userGuildAccess[user.id] ?? [];
  for (const gId of allowedIds) {
    const guild = resolveGuildForUser(state, user, gId);
    const secondaryOwner = Object.hasOwn(state.secondaryOwners, gId)
      ? state.secondaryOwners[gId]
      : undefined;
    if (guild && canAccessGuild(user, guild, secondaryOwner?.discordId)) {
      return true;
    }
  }
  return false;
}

export function getAuthorizedGuildIdsForUser(
  state: PersistedDatabaseState,
  user: UserRecord
): string[] {
  const authorized = new Set<string>();
  const roster = state.userGuildRoster[user.id] ?? [];
  for (const item of roster) {
    if (item.userIsOwner) authorized.add(item.guildId);
  }
  for (const sec of Object.values(state.secondaryOwners)) {
    if (sec.discordId === user.discordId) authorized.add(sec.guildId);
  }
  for (const gId of state.userGuildAccess[user.id] ?? []) {
    const guild = resolveGuildForUser(state, user, gId);
    const secondaryOwner = Object.hasOwn(state.secondaryOwners, gId)
      ? state.secondaryOwners[gId]
      : undefined;
    if (guild && canAccessGuild(user, guild, secondaryOwner?.discordId)) {
      authorized.add(gId);
    }
  }
  return Array.from(authorized);
}

