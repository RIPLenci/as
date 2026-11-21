import { NextRequest, NextResponse } from 'next/server';
import { lockdownActionSchema } from '@/lib/aegis/validators';
import { requireAuthenticatedUser, requireGuildAuthorization } from '@/lib/server/auth-guard';
import { enforceDiscordLockdown } from '@/lib/server/discord-api';
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

  return NextResponse.json({
    lockdown: auth.ctx.state.lockdowns[guildId] ?? null,
  });
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ guildId: string }> }
) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  const { guildId } = await context.params;
  const guard = requireGuildAuthorization(auth.ctx, guildId, 'lockdown:manage');
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => null);
  const parsed = lockdownActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { state, user } = auth.ctx;
  const existing = state.lockdowns[guildId];
  if (!existing) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const nowIso = new Date().toISOString();
  const d = parsed.data;

  if (d.action === 'ACTIVATE') {
    const restrictions = d.restrictions ?? existing.restrictions;
    const reason = d.reason ?? 'Emergency Lockdown triggered from AEGIS Dashboard';

    const syncResult = await enforceDiscordLockdown({
      guildId,
      active: true,
      reason,
      restrictions,
      previousSnapshots: existing.snapshots,
    });

    existing.active = true;
    existing.mode = d.mode;
    existing.reason = reason;
    existing.activatedBy = user.username;
    existing.activatedAt = nowIso;
    existing.scheduledEndAt = d.durationMinutes
      ? new Date(Date.now() + d.durationMinutes * 60_000).toISOString()
      : null;
    existing.restrictions = restrictions;
    existing.affectedChannelCount = syncResult.affectedChannelCount;
    existing.snapshots = syncResult.snapshots;

    aegisStore.pushNotification(state, {
      guildId,
      type: 'LOCKDOWN_ACTIVATED',
      severity: 'CRITICAL',
      title: `Emergency Lockdown Activated — ${guard.guild.name}`,
      message: `${existing.reason}. Permission snapshot saved for safe restoration.`,
      groupedCount: 1,
    });

    aegisStore.appendAuditLog(state, {
      guildId,
      actorId: user.discordId,
      actorName: user.username,
      action: 'EMERGENCY_LOCKDOWN_ACTIVATED',
      entityType: 'LockdownState',
      entityId: guildId,
      result: 'SUCCESS',
      metadata: {
        mode: d.mode,
        snapshotChannels: existing.snapshots.length,
        affectedChannelCount: syncResult.affectedChannelCount,
        syncedToDiscord: syncResult.syncedToDiscord,
      },
    });

    await aegisStore.commitMutation('lockdown:activated', guildId, { lockdown: existing });
    return NextResponse.json({
      confirmed: true,
      lockdown: existing,
      discordSync: {
        synced: syncResult.syncedToDiscord,
        affectedChannelCount: syncResult.affectedChannelCount,
        failedChannelCount: syncResult.failedChannelCount,
      },
    });
  } else {
    const syncResult = await enforceDiscordLockdown({
      guildId,
      active: false,
      reason: 'AEGIS Lockdown Restored',
      restrictions: existing.restrictions,
      previousSnapshots: existing.snapshots,
    });

    const preservedManual = existing.snapshots.filter(
      (s) => s.modifiedExternallyAfterLockdown
    ).length;

    existing.active = false;
    existing.lastRestoredAt = nowIso;
    existing.scheduledEndAt = null;
    existing.snapshots = [];
    existing.affectedChannelCount = 0;

    aegisStore.pushNotification(state, {
      guildId,
      type: 'LOCKDOWN_FINISHED',
      severity: 'LOW',
      title: `Emergency Lockdown Restored — ${guard.guild.name}`,
      message: `Original channel permissions restored safely (${preservedManual} manual admin overrides preserved).`,
      groupedCount: 1,
    });

    aegisStore.appendAuditLog(state, {
      guildId,
      actorId: user.discordId,
      actorName: user.username,
      action: 'EMERGENCY_LOCKDOWN_DEACTIVATED',
      entityType: 'LockdownState',
      entityId: guildId,
      result: 'SUCCESS',
      metadata: {
        preservedManual,
        restoredChannels: syncResult.affectedChannelCount,
        syncedToDiscord: syncResult.syncedToDiscord,
      },
    });

    await aegisStore.commitMutation('lockdown:deactivated', guildId, { lockdown: existing });
    return NextResponse.json({
      confirmed: true,
      lockdown: existing,
      discordSync: {
        synced: syncResult.syncedToDiscord,
        affectedChannelCount: syncResult.affectedChannelCount,
        failedChannelCount: syncResult.failedChannelCount,
      },
    });
  }
}
