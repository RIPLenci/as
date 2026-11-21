import { NextRequest, NextResponse } from 'next/server';
import { antiRaidPatchSchema } from '@/lib/aegis/validators';
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
  return NextResponse.json({
    config: state.antiRaidConfigs[guildId] ?? null,
    settings: state.guildSettings[guildId] ?? null,
    guild: guard.guild,
  });
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ guildId: string }> }
) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  const { guildId } = await context.params;
  const guard = requireGuildAuthorization(auth.ctx, guildId, 'antiraid:write');
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => null);
  const parsed = antiRaidPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { state, user } = auth.ctx;
  const config = state.antiRaidConfigs[guildId];
  const settings = state.guildSettings[guildId];
  if (!config) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: 'Configuración del servidor no encontrada.' },
      { status: 404 }
    );
  }

  const d = parsed.data;
  const nowIso = new Date().toISOString();
  if (d.enabled !== undefined) {
    if (d.enabled && guard.guild.botStatus !== 'BOT_CONNECTED') {
      return NextResponse.json(
        {
          error: 'BOT_NOT_CONNECTED',
          message: 'No se puede activar la protección mientras el bot de AEGIS no esté conectado en este servidor.',
        },
        { status: 409 }
      );
    }
    config.enabled = d.enabled;
    config.activatedAt = d.enabled ? config.activatedAt ?? nowIso : null;
    guard.guild.protectionEnabled = d.enabled;
  }

  if (d.mode !== undefined) config.mode = d.mode;
  if (d.sensitivity !== undefined) config.sensitivity = d.sensitivity;
  if (d.maxJoins !== undefined) config.maxJoins = d.maxJoins;
  if (d.timeWindowSeconds !== undefined) config.timeWindowSeconds = d.timeWindowSeconds;
  if (d.minAccountAgeDays !== undefined) config.minAccountAgeDays = d.minAccountAgeDays;
  if (d.suspiciousAccountDetection !== undefined)
    config.suspiciousAccountDetection = d.suspiciousAccountDetection;
  if (d.botJoinDetection !== undefined) config.botJoinDetection = d.botJoinDetection;
  if (d.joinPatternDetection !== undefined) config.joinPatternDetection = d.joinPatternDetection;
  if (d.burstDetection !== undefined) config.burstDetection = d.burstDetection;
  if (d.riskThreshold !== undefined) config.riskThreshold = d.riskThreshold;
  if (d.defaultAction !== undefined) config.defaultAction = d.defaultAction;
  if (d.riskRules !== undefined) config.riskRules = d.riskRules;
  if (d.riskWeights !== undefined) config.riskWeights = d.riskWeights;

  if (settings) {
    if (d.alertChannelId !== undefined) settings.alertChannelId = d.alertChannelId;
    if (d.alertChannelName !== undefined) settings.alertChannelName = d.alertChannelName;
    if (d.quarantineRoleId !== undefined) settings.quarantineRoleId = d.quarantineRoleId;
    if (d.quarantineRoleName !== undefined) settings.quarantineRoleName = d.quarantineRoleName;
    if (d.alertBatchIntervalSeconds !== undefined)
      settings.alertBatchIntervalSeconds = d.alertBatchIntervalSeconds;
    if (d.deduplicateAlerts !== undefined) settings.deduplicateAlerts = d.deduplicateAlerts;
    if (d.minAlertSeverity !== undefined) settings.minAlertSeverity = d.minAlertSeverity;
    settings.updatedAt = nowIso;
  }

  if (state.guildLogConfigs[guildId]) {
    if (d.alertChannelId !== undefined) {
      state.guildLogConfigs[guildId].channelId = d.alertChannelId;
      state.guildLogConfigs[guildId].updatedAt = nowIso;
    }
    if (d.alertChannelName !== undefined) {
      state.guildLogConfigs[guildId].channelName = d.alertChannelName;
      state.guildLogConfigs[guildId].updatedAt = nowIso;
    }
  }

  config.syncVersion += 1;
  config.lastSyncedAt = nowIso;
  guard.guild.lastSyncAt = config.lastSyncedAt;

  aegisStore.syncGuildRecord(state, guildId, {
    protectionEnabled: config.enabled,
    lastSyncAt: config.lastSyncedAt,
  });

  aegisStore.appendAuditLog(state, {
    guildId,
    actorId: user.discordId,
    actorName: user.username,
    action: 'ANTIRAID_CONFIG_UPDATED',
    entityType: 'AntiRaidConfig',
    entityId: guildId,
    result: 'SUCCESS',
    metadata: {
      syncVersion: config.syncVersion,
      mode: config.mode,
      maxJoins: config.maxJoins,
      timeWindowSeconds: config.timeWindowSeconds,
    },
  });

  await aegisStore.commitMutation('antiraid:config_updated', guildId, {
    syncVersion: config.syncVersion,
    config,
  });

  return NextResponse.json({
    confirmed: true,
    syncVersion: config.syncVersion,
    config,
    settings: settings ?? null,
  });
}
