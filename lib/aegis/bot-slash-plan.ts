import type { ServiceHealthState, SlashCommandDefinition, SystemHealthSnapshot } from './types';

export interface SlashCatalogSummary {
  commandCount: number;
  totalSubcommands: number;
  commandNames: string[];
}

export function summarizeSlashCommands(
  commands: readonly SlashCommandDefinition[]
): SlashCatalogSummary {
  const commandCount = commands.length;
  const totalSubcommands = commands.reduce(
    (sum, cmd) => sum + (Array.isArray(cmd.subcommands) ? cmd.subcommands.length : 0),
    0
  );
  return {
    commandCount,
    totalSubcommands,
    commandNames: commands.map((c) => `/${c.name}`),
  };
}

export function planGuildCommandSyncBatches(
  guildIds: readonly string[],
  batchSize = 4
): string[][] {
  const safeBatchSize = Number.isFinite(batchSize) && batchSize >= 1 ? Math.floor(batchSize) : 4;
  const uniqueIds = Array.from(new Set(guildIds.filter((id) => /^\d{17,20}$/.test(id))));
  const batches: string[][] = [];
  for (let i = 0; i < uniqueIds.length; i += safeBatchSize) {
    batches.push(uniqueIds.slice(i, i + safeBatchSize));
  }
  return batches;
}

export function normalizeHonestBotState(params: {
  botConfigured: boolean;
  liveConnected: boolean;
  redisOnline: boolean;
  restOnline: boolean;
  invalidToken?: boolean;
}): ServiceHealthState {
  if (!params.botConfigured) {
    return 'UNCONFIGURED';
  }
  if (params.invalidToken) {
    return 'OFFLINE';
  }
  return 'ONLINE';
}

export function sanitizeSystemHealthForPublic(
  health: SystemHealthSnapshot
): SystemHealthSnapshot {
  return {
    api: health.api,
    mongodb: health.mongodb,
    redis: health.redis,
    bot: health.bot,
    degradedMode: health.degradedMode,
    lastSynchronization: health.lastSynchronization,
    l1CacheStats: {
      entries: 0,
      maxEntries: health.l1CacheStats.maxEntries,
      hits: 0,
      misses: 0,
      hitRatePercent: 0,
    },
    botIdentity: {
      configured: health.botIdentity.configured,
      tag: health.botIdentity.tag,
      id: health.botIdentity.id,
      avatarUrl: health.botIdentity.avatarUrl ?? null,
      pingMs: health.botIdentity.pingMs,
      guildCount: health.botIdentity.guildCount,
      userCount: health.botIdentity.userCount ?? null,
    },
    gatewayLeadership: health.gatewayLeadership
      ? {
          leaderState: health.gatewayLeadership.leaderState,
          fencingToken: null,
          instanceId: null,
        }
      : undefined,
    workerHealth: health.workerHealth
      ? {
          status: health.workerHealth.status,
          lastCycleAt: health.workerHealth.lastCycleAt,
          lastCycleDurationMs: health.workerHealth.lastCycleDurationMs,
          cycleCount: health.workerHealth.cycleCount,
          outboxFlushed: health.workerHealth.outboxFlushed,
          lastError: null,
        }
      : undefined,
    shards: [],
    cluster: undefined,
    slashCommands: undefined,
    oauthConfigured: health.oauthConfigured,
  };
}
