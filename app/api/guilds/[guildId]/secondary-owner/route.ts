import { NextRequest, NextResponse } from 'next/server';
import { secondaryOwnerPutSchema } from '@/lib/aegis/validators';
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

  const { state, user } = auth.ctx;
  const canAssign =
    guard.guild.userIsOwner ||
    guard.guild.ownerDiscordId === user.discordId;

  return NextResponse.json({
    secondaryOwner: state.secondaryOwners[guildId] ?? null,
    canAssign,
    primaryOwnerDiscordId: guard.guild.ownerDiscordId || (guard.guild.userIsOwner ? user.discordId : ''),
  });
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ guildId: string }> }
) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  const { guildId } = await context.params;
  const guard = requireGuildAuthorization(auth.ctx, guildId, 'antiraid:write');
  if (!guard.ok) return guard.response;

  const { state, user } = auth.ctx;
  const isPrimaryOwner =
    guard.guild.userIsOwner ||
    guard.guild.ownerDiscordId === user.discordId;
  if (!isPrimaryOwner) {
    return NextResponse.json(
      {
        error: 'FORBIDDEN',
        message: 'Solo el Propietario Principal de Discord puede asignar o cambiar el Segundo Dueño.',
      },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = secondaryOwnerPutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  if (parsed.data.discordId === user.discordId) {
    return NextResponse.json(
      {
        error: 'VALIDATION_ERROR',
        message: 'El Segundo Owner debe ser una cuenta de Discord distinta a tu cuenta principal.',
      },
      { status: 400 }
    );
  }

  const record = {
    guildId,
    discordId: parsed.data.discordId,
    username: parsed.data.username,
    note: parsed.data.note,
    assignedBy: user.username,
    assignedAt: new Date().toISOString(),
  };

  state.secondaryOwners[guildId] = record;

  aegisStore.appendAuditLog(state, {
    guildId,
    actorId: user.discordId,
    actorName: user.username,
    action: 'SECONDARY_OWNER_ASSIGNED',
    entityType: 'SecondaryOwner',
    entityId: record.discordId,
    result: 'SUCCESS',
    metadata: { username: record.username },
  });

  await aegisStore.commitMutation('secondary_owner:updated', guildId, { secondaryOwner: record });
  return NextResponse.json({ secondaryOwner: record });
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ guildId: string }> }
) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  const { guildId } = await context.params;
  const guard = requireGuildAuthorization(auth.ctx, guildId, 'antiraid:write');
  if (!guard.ok) return guard.response;

  const { state, user } = auth.ctx;
  const isPrimaryOwner =
    guard.guild.userIsOwner ||
    guard.guild.ownerDiscordId === user.discordId;
  if (!isPrimaryOwner) {
    return NextResponse.json(
      {
        error: 'FORBIDDEN',
        message: 'Solo el Propietario Principal de Discord puede revocar al Segundo Dueño.',
      },
      { status: 403 }
    );
  }

  const existing = state.secondaryOwners[guildId];
  if (!existing) {
    return NextResponse.json({ removed: true });
  }

  delete state.secondaryOwners[guildId];

  aegisStore.appendAuditLog(state, {
    guildId,
    actorId: user.discordId,
    actorName: user.username,
    action: 'SECONDARY_OWNER_REVOKED',
    entityType: 'SecondaryOwner',
    entityId: existing.discordId,
    result: 'SUCCESS',
    metadata: { username: existing.username },
  });

  await aegisStore.commitMutation('secondary_owner:updated', guildId, { secondaryOwner: null });
  return NextResponse.json({ removed: true });
}
