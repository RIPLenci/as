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

  const correlationId = aegisLogger.createCorrelationId('dis');
  config.enabled = false;
  config.syncVersion += 1;
  config.lastSyncedAt = new Date().toISOString();
  aegisStore.raidShield.clear(guildId);
  guard.guild.protectionEnabled = false;
  guard.guild.lastSyncAt = config.lastSyncedAt;
  aegisStore.syncGuildRecord(state, guildId, {
    protectionEnabled: false,
    lastSyncAt: config.lastSyncedAt,
  });

  aegisStore.pushNotification(state, {
    guildId,
    type: 'PROTECTION_DISABLED',
    severity: 'MODERATE',
    title: `Protección Anti-Raid Desactivada — ${guard.guild.name}`,
    message: `Protección automática de ingresos pausada por ${user.username}.`,
    groupedCount: 1,
  });

  aegisStore.appendAuditLog(state, {
    guildId,
    actorId: user.discordId,
    actorName: user.username,
    action: 'ANTIRAID_DISABLED',
    entityType: 'AntiRaidConfig',
    entityId: guildId,
    result: 'SUCCESS',
    metadata: { correlationId, syncVersion: config.syncVersion },
  });

  const syncHealth = await aegisStore.commitMutation(
    'antiraid:disabled',
    guildId,
    { config },
    { correlationId }
  );
  config.syncStatus = syncHealth.redisPublished
    ? 'SYNCHRONIZED'
    : syncHealth.mongoPersisted
    ? 'PENDING_SYNC'
    : 'SYNC_ERROR';

  aegisLogger.info('ANTIRAID', 'Anti-Raid disabled from dashboard', {
    guildId,
    userId: user.discordId,
    correlationId,
    syncVersion: config.syncVersion,
  });

  return NextResponse.json({ confirmed: true, config, guild: guard.guild, syncHealth });
}
