import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { evaluateAutoBackupSchedule, normalizePlanTier } from '@/lib/aegis/premium';
import { backupActionSchema } from '@/lib/aegis/validators';
import { requireAuthenticatedUser, requireGuildAuthorization } from '@/lib/server/auth-guard';
import { fetchGuildChannelsLive, fetchGuildRolesLive } from '@/lib/server/discord-api';
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
  const backups = state.guildBackups[guildId] ?? [];
  const settings = state.guildBackupSettings[guildId];
  const plan = state.guildPlans[guildId];
  const scheduleInfo = evaluateAutoBackupSchedule({
    tier: normalizePlanTier(plan.tier),
    currentBackupCount: backups.length,
    settings,
  });

  return NextResponse.json({
    backups,
    settings,
    plan,
    scheduleInfo,
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
  const parsed = backupActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { state, user } = auth.ctx;
  const plan = state.guildPlans[guildId];
  const currentBackups = state.guildBackups[guildId] ?? [];
  const d = parsed.data;

  if (d.action === 'SET_SCHEDULE') {
    const normalizedSchedule = d.schedule === 'OFF' ? 'OFF' : 'AUTO';
    state.guildBackupSettings[guildId] = {
      ...state.guildBackupSettings[guildId],
      autoBackupSchedule: normalizedSchedule,
    };
    aegisStore.appendAuditLog(state, {
      guildId,
      actorId: user.discordId,
      actorName: user.username,
      action: 'BACKUP_SCHEDULE_UPDATED',
      entityType: 'GuildBackupSettings',
      entityId: guildId,
      result: 'SUCCESS',
      metadata: { schedule: normalizedSchedule, intervalDays: plan.quotas.autoBackupDays },
    });
    await aegisStore.commitMutation('backups:updated', guildId, { schedule: normalizedSchedule });
    const scheduleInfo = evaluateAutoBackupSchedule({
      tier: normalizePlanTier(plan.tier),
      currentBackupCount: currentBackups.length,
      settings: state.guildBackupSettings[guildId],
    });
    return NextResponse.json({ settings: state.guildBackupSettings[guildId], scheduleInfo });
  }

  if (d.action === 'RESTORE') {
    const backup = currentBackups.find((b) => b.id === d.backupId);
    if (!backup) {
      return NextResponse.json({ error: 'NOT_FOUND', message: 'Backup not found' }, { status: 404 });
    }
    if (backup.snapshot.antiRaidConfig) {
      state.antiRaidConfigs[guildId] = {
        ...backup.snapshot.antiRaidConfig,
        syncVersion: (state.antiRaidConfigs[guildId]?.syncVersion ?? 0) + 1,
        lastSyncedAt: new Date().toISOString(),
      };
    }
    if (backup.snapshot.antiNukeConfig) {
      state.antiNukeConfigs[guildId] = {
        ...backup.snapshot.antiNukeConfig,
        updatedAt: new Date().toISOString(),
      };
    }
    if (backup.snapshot.securitySuite) {
      state.guildSecuritySuites[guildId] = {
        ...backup.snapshot.securitySuite,
        updatedAt: new Date().toISOString(),
      };
    }
    if (backup.snapshot.verification) {
      state.guildVerifications[guildId] = {
        ...backup.snapshot.verification,
        updatedAt: new Date().toISOString(),
      };
    }
    if (backup.snapshot.logConfig) {
      state.guildLogConfigs[guildId] = {
        ...backup.snapshot.logConfig,
        updatedAt: new Date().toISOString(),
      };
    }

    aegisStore.appendAuditLog(state, {
      guildId,
      actorId: user.discordId,
      actorName: user.username,
      action: 'BACKUP_RESTORED',
      entityType: 'GuildBackup',
      entityId: backup.id,
      result: 'SUCCESS',
      metadata: { backupName: backup.name },
    });
    await aegisStore.commitMutation('backups:restored', guildId, { backupId: backup.id });
    return NextResponse.json({ restored: true, backup });
  }

  // CREATE backup
  if (currentBackups.length >= plan.quotas.maxBackups) {
    return NextResponse.json(
      {
        error: 'QUOTA_EXCEEDED',
        message: `Has alcanzado el máximo de ${plan.quotas.maxBackups} backups en el plan ${plan.tier}.`,
      },
      { status: 402 }
    );
  }

  const [liveRoles, liveChannels] = await Promise.all([
    guard.guild.botStatus === 'BOT_CONNECTED' ? fetchGuildRolesLive(guildId) : Promise.resolve([]),
    guard.guild.botStatus === 'BOT_CONNECTED' ? fetchGuildChannelsLive(guildId) : Promise.resolve([]),
  ]);

  const backup = {
    id: `BKP-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
    guildId,
    guildName: guard.guild.name,
    name: d.name,
    createdBy: user.discordId,
    creatorName: user.username,
    createdAt: new Date().toISOString(),
    automatic: false,
    stats: {
      rolesCount: liveRoles.length,
      channelsCount: liveChannels.length,
      whitelistCount:
        state.whitelists.filter((w) => w.guildId === guildId && w.status === 'ACTIVE').length +
        (state.channelWhitelists[guildId]?.length ?? 0),
      botPermissionsCount: state.botPermissions[guildId]?.length ?? 0,
    },
    snapshot: {
      antiRaidConfig: structuredClone(state.antiRaidConfigs[guildId] ?? null),
      antiNukeConfig: structuredClone(state.antiNukeConfigs[guildId] ?? null),
      securitySuite: structuredClone(state.guildSecuritySuites[guildId] ?? null),
      verification: structuredClone(state.guildVerifications[guildId] ?? null),
      logConfig: structuredClone(state.guildLogConfigs[guildId] ?? null),
      roles: liveRoles.map((r) => ({
        id: r.id,
        name: r.name,
        color: r.color,
        permissions: r.permissions,
      })),
      channels: liveChannels.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
      })),
    },
  };

  currentBackups.unshift(backup);
  state.guildBackups[guildId] = currentBackups;

  aegisStore.appendAuditLog(state, {
    guildId,
    actorId: user.discordId,
    actorName: user.username,
    action: 'BACKUP_CREATED',
    entityType: 'GuildBackup',
    entityId: backup.id,
    result: 'SUCCESS',
    metadata: {
      name: backup.name,
      rolesCount: backup.stats.rolesCount,
      channelsCount: backup.stats.channelsCount,
    },
  });

  await aegisStore.commitMutation('backups:updated', guildId, { backupId: backup.id });
  return NextResponse.json({ backup }, { status: 201 });
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
    return NextResponse.json({ error: 'VALIDATION_ERROR', message: 'Missing backup id' }, { status: 400 });
  }

  const { state, user } = auth.ctx;
  const currentBackups = state.guildBackups[guildId] ?? [];
  const idx = currentBackups.findIndex((b) => b.id === id);
  if (idx === -1) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const [removed] = currentBackups.splice(idx, 1);
  state.guildBackups[guildId] = currentBackups;

  aegisStore.appendAuditLog(state, {
    guildId,
    actorId: user.discordId,
    actorName: user.username,
    action: 'BACKUP_DELETED',
    entityType: 'GuildBackup',
    entityId: removed.id,
    result: 'SUCCESS',
    metadata: { name: removed.name },
  });

  await aegisStore.commitMutation('backups:updated', guildId, { id });
  return NextResponse.json({ deleted: true, id });
}
