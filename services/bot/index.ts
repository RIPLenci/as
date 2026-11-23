import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
  Options,
  REST,
  Routes,
} from 'discord.js';
import { planGuildCommandSyncBatches } from '../../lib/aegis/bot-slash-plan';
import { aegisTelemetry } from '../../lib/aegis/telemetry';
import { getServerEnv } from '../../lib/server/env';
import {
  GATEWAY_OWNER_LOCK_KEY,
  GatewayLeadershipController,
} from '../../lib/server/gateway-leadership';
import { aegisLogger } from '../../lib/server/logger';
import { ensureMongoConnected } from '../../lib/server/mongodb';
import { redisCoordinator } from '../../lib/server/redis';
import { aegisStore } from '../../lib/server/store';
import { flushPendingSyncOutbox } from '../../lib/server/sync-coordinator';
import { buildAegisSlashCommands } from './commands/registry';
import { attachAegisBotHandlers } from './handlers';
import { auditGuildBotPermissions } from './modules/permissions';

process.env.AEGIS_STANDALONE_BOT = 'true';

async function resolveAppId(token: string, client: Client): Promise<string | null> {
  const env = getServerEnv();
  if (env.discordClientId) return env.discordClientId;
  if (client.application?.id) return client.application.id;
  if (client.user?.id) return client.user.id;
  try {
    const res = await fetch('https://discord.com/api/v10/oauth2/applications/@me', {
      headers: { Authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { id?: string };
    return data.id ?? null;
  } catch (err) {
    aegisLogger.warn('DISCORD', 'Unable to resolve Discord application ID via REST', {
      meta: { error: err instanceof Error ? err.message : String(err) },
    });
    return null;
  }
}

async function syncAllGuildSlashCommands(token: string, appId: string, client: Client) {
  const rest = new REST({ version: '10', timeout: 15_000 }).setToken(token);
  const commands = buildAegisSlashCommands();

  await rest.put(Routes.applicationCommands(appId), { body: [] }).catch((err) => {
    aegisLogger.warn('DISCORD', 'Global command clear warning', {
      meta: { error: err instanceof Error ? err.message : String(err) },
    });
  });

  const guildIds = Array.from(client.guilds.cache.keys());
  const batches = planGuildCommandSyncBatches(guildIds, 4);
  let synced = 0;
  for (const batch of batches) {
    const results = await Promise.allSettled(
      batch.map((guildId) =>
        rest.put(Routes.applicationGuildCommands(appId, guildId), { body: commands })
      )
    );
    for (const r of results) {
      if (r.status === 'fulfilled') synced += 1;
    }
  }
  aegisLogger.info('DISCORD', 'Synchronized deduplicated guild slash commands', {
    meta: { commandCount: commands.length, guildsTotal: guildIds.length, guildsSynced: synced },
  });
}

async function startBot() {
  const env = getServerEnv();
  if (!env.discordBotToken) {
    aegisLogger.fatal('DISCORD', 'DISCORD_BOT_TOKEN is required to start the standalone bot service');
    process.exit(1);
  }

  let client: Client | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let reconcileTimer: NodeJS.Timeout | null = null;
  let unsubscribeRedis: (() => void) | null = null;
  let shuttingDown = false;

  const stopTimers = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (reconcileTimer) {
      clearInterval(reconcileTimer);
      reconcileTimer = null;
    }
  };

  const leadership = new GatewayLeadershipController({
    lockKey: GATEWAY_OWNER_LOCK_KEY,
    ttlMs: 45_000,
    onDisconnectGateway: async () => {
      stopTimers();
      if (client) {
        await client.destroy().catch((err) => {
          aegisLogger.warn('DISCORD', 'Error destroying Discord Gateway client', {
            meta: { error: err instanceof Error ? err.message : String(err) },
          });
        });
      }
    },
    onLeadershipLost: async (reason) => {
      aegisLogger.fatal('DISCORD', 'Exiting standalone bot cleanly after leadership loss', {
        meta: { reason, instanceId: leadership.instanceId },
      });
      if (unsubscribeRedis) unsubscribeRedis();
      await redisCoordinator.disconnect().catch(() => undefined);
      process.exit(1);
    },
  });

  const shutdown = async (signal: string, exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    stopTimers();
    if (unsubscribeRedis) unsubscribeRedis();
    await leadership.shutdown(signal);
    await redisCoordinator.disconnect().catch(() => undefined);
    process.exit(exitCode);
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT', 0);
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM', 0);
  });
  process.once('uncaughtException', (err) => {
    aegisLogger.fatal('DISCORD', 'Uncaught exception in standalone bot process', {
      meta: { error: err.message, stack: err.stack },
    });
    void shutdown('UNCAUGHT_EXCEPTION', 1);
  });
  process.once('unhandledRejection', (reason) => {
    aegisLogger.fatal('DISCORD', 'Unhandled rejection in standalone bot process', {
      meta: { error: reason instanceof Error ? reason.message : String(reason) },
    });
    void shutdown('UNHANDLED_REJECTION', 1);
  });

  await ensureMongoConnected();
  if (env.redisConfigured) {
    const redisState = await redisCoordinator.ensureConnected();
    if (redisState !== 'CONNECTED') {
      aegisLogger.fatal(
        'REDIS',
        'Fail-closed shutdown: REDIS_URL is configured but Redis is unavailable; refusing uncoordinated Gateway boot',
        { meta: { instanceId: leadership.instanceId, redisState } }
      );
      await shutdown('REDIS_UNAVAILABLE_ON_BOOT', 1);
      return;
    }
  }

  const initialLock = await leadership.acquireLeadership();
  if (!initialLock.acquired) {
    aegisLogger.error('DISCORD', 'Failed acquiring exclusive Gateway distributed lock', {
      meta: {
        instanceId: leadership.instanceId,
        reason: initialLock.reason,
        fencingToken: initialLock.fencingToken,
      },
    });
    await shutdown(`LOCK_NOT_ACQUIRED:${initialLock.reason}`, 1);
    return;
  }

  // Pull authoritative MongoDB state and flush pending sync outbox before accepting Gateway traffic
  await aegisStore.getState();
  await aegisStore.reconcileGuildConfigsFromMongo();
  await flushPendingSyncOutbox(aegisStore.instanceId);

  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildWebhooks,
    GatewayIntentBits.GuildMessages,
  ];
  if (process.env.DISCORD_ENABLE_MESSAGE_CONTENT === 'true') {
    intents.push(GatewayIntentBits.MessageContent);
  }

  const configuredShards = Number.parseInt(process.env.DISCORD_SHARD_COUNT || '', 10);

  client = new Client({
    intents,
    shards: Number.isFinite(configuredShards) && configuredShards > 0 ? configuredShards : 'auto',
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 32,
      ThreadManager: 32,
      GuildEmojiManager: 0,
      GuildStickerManager: 0,
      PresenceManager: 0,
      VoiceStateManager: 0,
      StageInstanceManager: 0,
    }),
    sweepers: {
      ...Options.DefaultSweeperSettings,
      messages: {
        interval: 300,
        lifetime: 600,
      },
    },
    rest: {
      timeout: 10_000,
      retries: 2,
    },
  });

  let lastSlashSyncAt: string | null = null;

  // Authoritative cross-container Redis sync & remote control subscription
  unsubscribeRedis = redisCoordinator.subscribe(async (msg) => {
    if (!leadership.canProcessEvents()) return;
    if (msg.originProcessId && msg.originProcessId === aegisStore.instanceId) {
      return;
    }

    const payloadObj =
      typeof msg.payload === 'object' && msg.payload !== null
        ? (msg.payload as Record<string, unknown>)
        : null;
    const deliveryId = typeof payloadObj?.deliveryId === 'string' ? payloadObj.deliveryId : null;
    if (!aegisStore.claimDeliveryId(deliveryId)) {
      return;
    }
    if (!aegisStore.acceptGatewayFencingToken(msg.fencingToken)) {
      return;
    }

    if (msg.channel === 'aegis:bot:control') {
      if (msg.event === 'DEPLOY_SLASH_COMMANDS' && client?.isReady()) {
        const appId = await resolveAppId(env.discordBotToken, client);
        if (appId) {
          await syncAllGuildSlashCommands(env.discordBotToken, appId, client);
          lastSlashSyncAt = new Date().toISOString();
        }
      } else if (msg.event === 'RECONCILE_ALL' || msg.event === 'RESTART_CLUSTER') {
        await aegisStore.reconcileGuildConfigsFromMongo();
        await aegisStore.reconcileGlobalBansFromMongo();
      }
      return;
    }

    if (msg.guildId) {
      await aegisStore.reconcileGuildConfigsFromMongo(msg.guildId);
      aegisStore.l1Cache.invalidateByPrefix(`guild:${msg.guildId}:`);
    } else {
      await aegisStore.reconcileGlobalBansFromMongo();
      aegisStore.reloadFromDiskIfNewer();
      aegisStore.l1Cache.invalidateByPrefix('global:');
    }
  });

  redisCoordinator.onReconnect(() => {
    if (!leadership.canProcessEvents()) return;
    void (async () => {
      const renewal = await leadership.verifyAndRenewLeadership();
      if (!renewal.acquired) return;
      await flushPendingSyncOutbox(aegisStore.instanceId);
      await aegisStore.reconcileGuildConfigsFromMongo();
      await aegisStore.reconcileGlobalBansFromMongo();
    })();
  });

  attachAegisBotHandlers(client, {
    canProcessEvents: () => leadership.canProcessEvents(),
    trackOperation: (p) => leadership.trackCriticalOperation(p),
    onGuildJoined: async (guildId) => {
      if (!client || !leadership.canProcessEvents()) return;
      const appId = await resolveAppId(env.discordBotToken, client);
      if (!appId) return;
      const rest = new REST({ version: '10', timeout: 10_000 }).setToken(env.discordBotToken);
      await rest
        .put(Routes.applicationGuildCommands(appId, guildId), {
          body: buildAegisSlashCommands(),
        })
        .catch((err) => {
          aegisLogger.warn('DISCORD', 'Slash command registration on join failed', {
            guildId,
            meta: { error: err instanceof Error ? err.message : String(err) },
          });
        });
    },
  });

  client.on(Events.Error, (err) => {
    aegisTelemetry.recordError(undefined, err.message);
    aegisLogger.error('DISCORD', 'Discord Gateway client error', {
      meta: { error: err.message, fencingToken: leadership.getFencingToken() },
    });
  });

  client.on(Events.Invalidated, () => {
    aegisLogger.fatal('DISCORD', 'Discord Gateway session invalidated; terminating controlled shutdown');
    void shutdown('DISCORD_SESSION_INVALIDATED', 1);
  });

  client.once(Events.ClientReady, async (readyClient) => {
    if (!leadership.canProcessEvents()) {
      await readyClient.destroy().catch(() => undefined);
      return;
    }

    aegisLogger.info('DISCORD', 'Standalone Gateway bot ready', {
      meta: {
        instanceId: leadership.instanceId,
        fencingToken: leadership.getFencingToken(),
        tag: readyClient.user.tag,
        guilds: readyClient.guilds.cache.size,
      },
    });

    readyClient.user.setPresence({
      status: 'online',
      activities: [
        {
          name: `${readyClient.guilds.cache.size} servidores protegidos | /aegis`,
          type: ActivityType.Watching,
        },
      ],
    });

    try {
      const state = await aegisStore.getState();
      const nowIso = new Date().toISOString();
      let updatedAny = false;

      for (const guild of readyClient.guilds.cache.values()) {
        aegisStore.ensureGuildStructures(state, guild.id, guild.name);
        const permAudit = auditGuildBotPermissions(guild);
        if (state.antiRaidConfigs[guild.id]) {
          state.antiRaidConfigs[guild.id].botPermissionsMissing = permAudit.missingPermissions;
        }
        const synced = aegisStore.syncGuildRecord(state, guild.id, {
          name: guild.name,
          iconUrl: guild.iconURL({ size: 256 }),
          ownerDiscordId: guild.ownerId,
          botStatus: permAudit.ok ? 'BOT_CONNECTED' : 'INSUFFICIENT_PERMISSIONS',
          botPermissionsOk: permAudit.ok,
          memberCount: guild.memberCount,
          memberCountKnown: typeof guild.memberCount === 'number' && guild.memberCount > 0,
          lastSyncAt: nowIso,
        });
        if (synced) updatedAny = true;
      }

      for (const knownGuild of Object.values(state.guilds)) {
        if (
          knownGuild.botStatus === 'BOT_CONNECTED' &&
          !readyClient.guilds.cache.has(knownGuild.guildId)
        ) {
          const synced = aegisStore.syncGuildRecord(state, knownGuild.guildId, {
            botStatus: 'BOT_NOT_INSTALLED',
            botPermissionsOk: false,
            protectionEnabled: false,
            lastSyncAt: nowIso,
          });
          if (state.antiRaidConfigs[knownGuild.guildId]) {
            state.antiRaidConfigs[knownGuild.guildId].enabled = false;
          }
          if (synced) updatedAny = true;
        }
      }

      if (updatedAny) {
        await aegisStore.commitMutation('guild:list_synced', undefined, undefined, {
          updatedBy: `bot:${leadership.instanceId}`,
          fencingToken: leadership.getFencingToken(),
        });
      }
    } catch (err) {
      aegisLogger.warn('DISCORD', 'Guild startup state reconciliation warning', {
        meta: { error: err instanceof Error ? err.message : String(err) },
      });
    }

    const appId = await resolveAppId(env.discordBotToken, readyClient);
    if (appId) {
      await syncAllGuildSlashCommands(env.discordBotToken, appId, readyClient).catch((err) => {
        aegisLogger.warn('DISCORD', 'Slash command startup sync warning', {
          meta: { error: err instanceof Error ? err.message : String(err) },
        });
      });
      lastSlashSyncAt = new Date().toISOString();
    }

    const publishHeartbeat = async () => {
      if (!leadership.canProcessEvents()) return;

      const renewal = await leadership.verifyAndRenewLeadership();
      if (!renewal.acquired) {
        return; // LeadershipController already handles NO_LEADER + disconnect + abort
      }

      if (redisCoordinator.getStatus() !== 'CONNECTED') return;

      const telemetry = aegisTelemetry.getSnapshot();
      const userCount = readyClient.guilds.cache.reduce(
        (sum, g) => sum + (g.memberCount || 0),
        0
      );
      const memMb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      const uptimeSeconds = Math.floor(process.uptime());
      const wsShards = Array.from(readyClient.ws.shards.values());
      const shards =
        wsShards.length > 0
          ? wsShards.map((shard, idx) => ({
              id: shard.id ?? idx,
              clusterId: 1,
              status: (shard.status === 0
                ? 'READY'
                : shard.status === 2
                ? 'RECONNECTING'
                : 'CONNECTING') as 'READY' | 'CONNECTING' | 'RECONNECTING',
              pingMs:
                shard.ping >= 0
                  ? Math.round(shard.ping)
                  : Math.max(0, Math.round(readyClient.ws.ping)),
              guildCount:
                wsShards.length === 1
                  ? readyClient.guilds.cache.size
                  : readyClient.guilds.cache.filter((g) => g.shardId === shard.id).size,
              uptimeSeconds,
              memoryMb: Math.max(12, Math.round(memMb / Math.max(1, wsShards.length))),
              eventThroughputPerSec: telemetry.eventThroughputPerSec,
            }))
          : [
              {
                id: 0,
                clusterId: 1,
                status: 'READY' as const,
                pingMs: Math.max(0, Math.round(readyClient.ws.ping)),
                guildCount: readyClient.guilds.cache.size,
                uptimeSeconds,
                memoryMb: memMb,
                eventThroughputPerSec: telemetry.eventThroughputPerSec,
              },
            ];

      const avgPing =
        shards.length > 0
          ? Math.round(shards.reduce((acc, s) => acc + s.pingMs, 0) / shards.length)
          : Math.max(0, Math.round(readyClient.ws.ping));

      const hot = aegisStore.getHotStateSync();
      const appliedGuildSyncVersions: Record<string, number> = {};
      for (const [gid, cfg] of Object.entries(hot.antiRaidConfigs)) {
        appliedGuildSyncVersions[gid] = cfg.syncVersion;
      }

      await redisCoordinator.setBotHeartbeat({
        updatedAt: Date.now(),
        instanceId: leadership.instanceId,
        pid: process.pid,
        leaderState: leadership.getState(),
        fencingToken: leadership.getFencingToken(),
        tag: readyClient.user.tag,
        id: readyClient.user.id,
        avatarUrl: readyClient.user.displayAvatarURL({ size: 256 }),
        pingMs: avgPing,
        guildCount: readyClient.guilds.cache.size,
        userCount,
        shards,
        cluster: {
          clusterId: 1,
          clusterName:
            wsShards.length > 1
              ? 'Cluster-Alpha (Standalone Multi-Shard)'
              : 'Cluster-Alpha (Standalone Gateway)',
          totalShards: shards.length,
          mode: wsShards.length > 1 ? 'CLUSTERED_MULTI_WORKER' : 'STANDALONE_OPTIMIZED',
          workerPid: process.pid,
          memoryMb: memMb,
          cpuPercent: telemetry.cpuPercent,
          averagePingMs: avgPing,
          status: avgPing < 120 ? 'OPTIMAL' : 'HEALTHY',
          eventLoopLagMs: telemetry.eventLoopLagMs,
          activeSockets: shards.length,
          queueSize: 0,
        },
        lastSlashSyncAt,
        appliedGuildSyncVersions,
        latencyMetrics: {
          antiRaidEval: telemetry.antiRaidEvalLatency,
          sanctionExec: telemetry.sanctionExecLatency,
        },
      });
    };

    await publishHeartbeat();
    heartbeatTimer = setInterval(() => {
      void publishHeartbeat();
    }, 15_000);

    reconcileTimer = setInterval(() => {
      if (!leadership.canProcessEvents()) return;
      aegisStore.joinWindow.pruneExpiredBuckets();
      void aegisStore.reconcileGuildConfigsFromMongo();
      void aegisStore.reconcileGlobalBansFromMongo();
      void flushPendingSyncOutbox(aegisStore.instanceId);
    }, 60_000);
  });

  await client.login(env.discordBotToken);
}

startBot().catch((err) => {
  aegisLogger.fatal('DISCORD', 'Standalone bot fatal startup error', {
    meta: { error: err instanceof Error ? err.message : String(err) },
  });
  process.exit(1);
});
