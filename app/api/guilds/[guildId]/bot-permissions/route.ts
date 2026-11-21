import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getPlanDisplayName, normalizePlanTier } from '@/lib/aegis/premium';
import { botPermissionCreateSchema } from '@/lib/aegis/validators';
import { requireAuthenticatedUser, requireGuildAuthorization } from '@/lib/server/auth-guard';
import { aegisStore } from '@/lib/server/store';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ guildId: string }> }
) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  const { guildId } = await context.params;
  const guard = requireGuildAuthorization(auth.ctx, guildId, 'antiraid:read');
  if (!guard.ok) return guard.response;

  const { state } = auth.ctx;
  const grants = state.botPermissions[guildId] ?? [];
  const plan = state.guildPlans[guildId];

  const usersUsed = grants.filter((g) => g.targetType === 'USER').length;
  const rolesUsed = grants.filter((g) => g.targetType === 'ROLE').length;

  return NextResponse.json({
    grants,
    plan,
    usage: {
      usersUsed,
      usersLimit: plan.quotas.maxBotPermUsers,
      rolesUsed,
      rolesLimit: plan.quotas.maxBotPermRoles,
    },
  });
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ guildId: string }> }
) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  const { guildId } = await context.params;
  const guard = requireGuildAuthorization(auth.ctx, guildId, 'antiraid:write');
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => null);
  const parsed = botPermissionCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { state, user } = auth.ctx;
  const grants = state.botPermissions[guildId] ?? [];
  const plan = state.guildPlans[guildId];
  const d = parsed.data;

  const existingIdx = grants.findIndex(
    (g) => g.targetType === d.targetType && g.targetId === d.targetId
  );

  if (existingIdx === -1) {
    const usersUsed = grants.filter((g) => g.targetType === 'USER').length;
    const rolesUsed = grants.filter((g) => g.targetType === 'ROLE').length;
    if (d.targetType === 'USER' && usersUsed >= plan.quotas.maxBotPermUsers) {
      return NextResponse.json(
        {
          error: 'QUOTA_EXCEEDED',
          message: `Límite de usuarios (${plan.quotas.maxBotPermUsers}) alcanzado en el ${getPlanDisplayName(normalizePlanTier(plan.tier), 'es')}.`,
        },
        { status: 402 }
      );
    }
    if (d.targetType === 'ROLE' && rolesUsed >= plan.quotas.maxBotPermRoles) {
      return NextResponse.json(
        {
          error: 'QUOTA_EXCEEDED',
          message: `Límite de roles (${plan.quotas.maxBotPermRoles}) alcanzado en el ${getPlanDisplayName(normalizePlanTier(plan.tier), 'es')}.`,
        },
        { status: 402 }
      );
    }
  }

  const grant = {
    id:
      existingIdx >= 0
        ? grants[existingIdx].id
        : `BP-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
    guildId,
    targetType: d.targetType,
    targetId: d.targetId,
    targetName: d.targetName,
    permissions: d.permissions,
    rateLimitActions: d.rateLimitActions,
    rateLimitWindowMinutes: d.rateLimitWindowMinutes,
    grantedBy: user.username,
    createdAt: existingIdx >= 0 ? grants[existingIdx].createdAt : new Date().toISOString(),
  };

  if (existingIdx >= 0) {
    grants[existingIdx] = grant;
  } else {
    grants.unshift(grant);
  }
  state.botPermissions[guildId] = grants;

  aegisStore.appendAuditLog(state, {
    guildId,
    actorId: user.discordId,
    actorName: user.username,
    action: 'BOT_PERMISSION_GRANTED',
    entityType: 'BotPermissionGrant',
    entityId: grant.id,
    result: 'SUCCESS',
    metadata: {
      targetType: grant.targetType,
      targetId: grant.targetId,
      permissionsCount: grant.permissions.length,
    },
  });

  await aegisStore.commitMutation('bot_permissions:updated', guildId, { grant });
  return NextResponse.json({ grant }, { status: 201 });
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ guildId: string }> }
) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  const { guildId } = await context.params;
  const guard = requireGuildAuthorization(auth.ctx, guildId, 'antiraid:write');
  if (!guard.ok) return guard.response;

  const id = req.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', message: 'Falta el ID del permiso.' },
      { status: 400 }
    );
  }

  const { state, user } = auth.ctx;
  const grants = state.botPermissions[guildId] ?? [];
  const idx = grants.findIndex((g) => g.id === id);
  if (idx === -1) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const [removed] = grants.splice(idx, 1);
  state.botPermissions[guildId] = grants;

  aegisStore.appendAuditLog(state, {
    guildId,
    actorId: user.discordId,
    actorName: user.username,
    action: 'BOT_PERMISSION_REVOKED',
    entityType: 'BotPermissionGrant',
    entityId: removed.id,
    result: 'SUCCESS',
    metadata: { targetId: removed.targetId, targetType: removed.targetType },
  });

  await aegisStore.commitMutation('bot_permissions:updated', guildId, { id });
  return NextResponse.json({ deleted: true, id });
}
