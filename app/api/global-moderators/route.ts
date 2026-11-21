import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { globalModeratorCreateSchema } from '@/lib/aegis/validators';
import { requireSuperOwner } from '@/lib/server/auth-guard';
import { getServerEnv } from '@/lib/server/env';
import { aegisStore } from '@/lib/server/store';

export async function GET() {
  const auth = await requireSuperOwner();
  if (!auth.ok) return auth.response;

  return NextResponse.json({ moderators: auth.ctx.state.globalModerators });
}

export async function POST(req: NextRequest) {
  const auth = await requireSuperOwner();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = globalModeratorCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const d = parsed.data;
  const { state, user } = auth.ctx;
  const env = getServerEnv();

  if (d.discordId === user.discordId) {
    return NextResponse.json(
      { error: 'FORBIDDEN', message: 'You cannot modify your own global moderator privileges.' },
      { status: 403 }
    );
  }

  if (env.ownerIds.includes(d.discordId) || env.globalAdminIds.includes(d.discordId)) {
    return NextResponse.json(
      {
        error: 'FORBIDDEN',
        message: 'Platform-configured Owners and Global Administrators cannot be overridden.',
      },
      { status: 403 }
    );
  }

  const existing = state.globalModerators.find((m) => m.discordId === d.discordId);
  if (existing && existing.status === 'ACTIVE') {
    return NextResponse.json(
      { error: 'DUPLICATE_MODERATOR', message: 'Moderator is already active.' },
      { status: 409 }
    );
  }

  let mod;
  if (existing) {
    existing.username = d.username;
    existing.role = d.role;
    existing.status = 'ACTIVE';
    existing.allowedActions = d.allowedActions;
    existing.addedBy = user.username;
    existing.joinedAt = new Date().toISOString();
    mod = existing;
  } else {
    mod = {
      id: `GMOD-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
      discordId: d.discordId,
      username: d.username,
      avatarUrl: null,
      role: d.role,
      status: 'ACTIVE' as const,
      allowedActions: d.allowedActions,
      addedBy: user.username,
      joinedAt: new Date().toISOString(),
    };
    state.globalModerators.unshift(mod);
  }

  if (Object.hasOwn(state.users, d.discordId)) {
    state.users[d.discordId].globalRole = d.role;
  }

  aegisStore.appendAuditLog(state, {
    guildId: null,
    actorId: user.discordId,
    actorName: user.username,
    action: 'GLOBAL_MODERATOR_ADDED',
    entityType: 'GlobalModerator',
    entityId: mod.id,
    result: 'SUCCESS',
    metadata: { targetDiscordId: d.discordId, role: d.role },
  });

  await aegisStore.commitMutation('moderators:updated', undefined, { mod });
  return NextResponse.json({ moderator: mod }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireSuperOwner();
  if (!auth.ok) return auth.response;

  const id = req.nextUrl.searchParams.get('id')?.trim();
  if (!id) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', message: 'Missing moderator id.' },
      { status: 400 }
    );
  }

  const { state, user } = auth.ctx;
  const env = getServerEnv();
  const mod = state.globalModerators.find((m) => m.id === id);
  if (!mod) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  if (mod.discordId === user.discordId) {
    return NextResponse.json(
      { error: 'FORBIDDEN', message: 'You cannot revoke your own global moderator privileges.' },
      { status: 403 }
    );
  }
  if (mod.role === 'OWNER' || env.ownerIds.includes(mod.discordId) || env.globalAdminIds.includes(mod.discordId)) {
    return NextResponse.json(
      { error: 'FORBIDDEN', message: 'Platform Owners/Administrators cannot be revoked from dashboard.' },
      { status: 403 }
    );
  }

  mod.status = 'REVOKED';
  if (Object.hasOwn(state.users, mod.discordId)) {
    state.users[mod.discordId].globalRole = 'SERVER_ADMINISTRATOR';
  }

  aegisStore.appendAuditLog(state, {
    guildId: null,
    actorId: user.discordId,
    actorName: user.username,
    action: 'GLOBAL_MODERATOR_REVOKED',
    entityType: 'GlobalModerator',
    entityId: mod.id,
    result: 'SUCCESS',
    metadata: { targetDiscordId: mod.discordId },
  });

  await aegisStore.commitMutation('moderators:updated', undefined, { id });
  return NextResponse.json({ revoked: true, moderator: mod });
}
