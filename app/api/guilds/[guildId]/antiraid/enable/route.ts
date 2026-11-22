import { NextRequest, NextResponse } from 'next/server';
import {
  requireAuthenticatedUser,
  requireGuildAuthorization,
  verifyMutationOrigin,
} from '@/lib/server/auth-guard';
import { aegisLogger } from '@/lib/server/logger';
import { aegisStore } from '@/lib/server/store';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ guildId: string }> }
) {
  const originErr = verifyMutationOrigin(req);
  if (originErr) return originErr;

  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  const { guildId } = await context.params;
  const guard = requireGuildAuthorization(auth.ctx, guildId, 'antiraid:write');
  if (!guard.ok) return guard.response;

  const { state, user } = auth.ctx;
  const config = state.antiRaidConfigs[guildId];
  if (!config) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  if (guard.guild.botStatus !== 'BOT_CONNECTED' || !guard.guild.botPermissionsOk) {
    return NextResponse.json(
      {
        error: 'BOT_PRECONDITION_FAILED',
        message: 'El bot debe estar conectado con los permisos de seguridad requeridos antes de activar Anti-Raid.',
      },
      { status: 409 }
    );
  }

  const correlationId = aegisLogger.createCorrelationId('en');
  config.enabled = true;
  config.activatedAt = new Date().toISOString();
  config.syncVersion += 1;
  config.lastSyncedAt = config.activatedAt;
  guard.guild.protectionEnabled = true;
  guard.guild.lastSyncAt = config.activatedAt;
  aegisStore.syncGuildRecord(state, guildId, {
    protectionEnabled: true,
    lastSyncAt: config.activatedAt,
  });

  aegisStore.pushNotification(state, {
    guildId,
    type: 'PROTECTION_ENABLED',
    severity: 'LOW',
    title: `Protección Anti-Raid Activada — ${guard.guild.name}`,
    message: `Modo ${config.mode} activo (umbral ${config.maxJoins} ingresos / ${config.timeWindowSeconds}s).`,
    groupedCount: 1,
  });

  aegisStore.appendAuditLog(state, {
    guildId,
    actorId: user.discordId,
    actorName: user.username,
    action: 'ANTIRAID_ENABLED',
    entityType: 'AntiRaidConfig',
    entityId: guildId,
    result: 'SUCCESS',
    metadata: { correlationId, mode: config.mode, syncVersion: config.syncVersion },
  });

  const syncHealth = await aegisStore.commitMutation(
    'antiraid:enabled',
    guildId,
    { config },
    { correlationId }
  );
  config.syncStatus = syncHealth.redisPublished
    ? 'SYNCHRONIZED'
    : syncHealth.mongoPersisted
    ? 'PENDING_SYNC'
    : 'SYNC_ERROR';

  aegisLogger.info('ANTIRAID', 'Anti-Raid enabled from dashboard', {
    guildId,
    userId: user.discordId,
    correlationId,
    syncVersion: config.syncVersion,
  });

  return NextResponse.json({ confirmed: true, config, guild: guard.guild, syncHealth });
}
