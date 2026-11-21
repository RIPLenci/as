import { NextRequest, NextResponse } from 'next/server';
import { quarantinePatchSchema } from '@/lib/aegis/validators';
import { requireAuthenticatedUser, requireGuildAuthorization } from '@/lib/server/auth-guard';
import { applyDiscordMemberTimeout } from '@/lib/server/discord-api';
import { aegisStore } from '@/lib/server/store';

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const { state, user } = auth.ctx;
  const entry = state.quarantines.find((q) => q.id === id);
  if (!entry) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const guard = requireGuildAuthorization(auth.ctx, entry.guildId, 'quarantine:manage');
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => null);
  const parsed = quarantinePatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  let timeoutSync: { synced: boolean; reason?: string } = { synced: false };

  if (parsed.data.action === 'RELEASE') {
    entry.status = 'RELEASED';
    entry.releasedAt = new Date().toISOString();
    entry.releasedBy = user.username;
    timeoutSync = await applyDiscordMemberTimeout({
      guildId: entry.guildId,
      discordId: entry.discordId,
      durationMs: null,
      reason: `AEGIS Cuarentena Liberada (${user.username})`,
    });
  } else if (parsed.data.action === 'EXTEND' && parsed.data.durationHours) {
    entry.expiresAt = new Date(
      Date.now() + parsed.data.durationHours * 3600_000
    ).toISOString();
    timeoutSync = await applyDiscordMemberTimeout({
      guildId: entry.guildId,
      discordId: entry.discordId,
      durationMs: parsed.data.durationHours * 3600_000,
      reason: `AEGIS Cuarentena Extendida (${user.username})`,
    });
  }

  aegisStore.appendAuditLog(state, {
    guildId: entry.guildId,
    actorId: user.discordId,
    actorName: user.username,
    action: `QUARANTINE_${parsed.data.action}`,
    entityType: 'QuarantineEntry',
    entityId: entry.id,
    result: 'SUCCESS',
    metadata: { discordId: entry.discordId, discordTimeoutSynced: timeoutSync.synced },
  });

  await aegisStore.commitMutation('quarantine:updated', entry.guildId, { entry });
  return NextResponse.json({ entry, discordSync: timeoutSync });
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const { state, user } = auth.ctx;
  const entry = state.quarantines.find((q) => q.id === id);
  if (!entry) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const guard = requireGuildAuthorization(auth.ctx, entry.guildId, 'quarantine:manage');
  if (!guard.ok) return guard.response;

  entry.status = 'RELEASED';
  entry.releasedAt = new Date().toISOString();
  entry.releasedBy = user.username;

  const timeoutSync = await applyDiscordMemberTimeout({
    guildId: entry.guildId,
    discordId: entry.discordId,
    durationMs: null,
    reason: `AEGIS Cuarentena Liberada (${user.username})`,
  });

  aegisStore.appendAuditLog(state, {
    guildId: entry.guildId,
    actorId: user.discordId,
    actorName: user.username,
    action: 'QUARANTINE_RELEASED',
    entityType: 'QuarantineEntry',
    entityId: entry.id,
    result: 'SUCCESS',
    metadata: { discordId: entry.discordId, discordTimeoutSynced: timeoutSync.synced },
  });

  await aegisStore.commitMutation('quarantine:released', entry.guildId, { entry });
  return NextResponse.json({ released: true, entry, discordSync: timeoutSync });
}
