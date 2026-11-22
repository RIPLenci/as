import crypto from 'node:crypto';
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
import { aegisLogger } from '../../lib/server/logger';
import { ensureMongoConnected } from '../../lib/server/mongodb';
import { redisCoordinator } from '../../lib/server/redis';
import { aegisStore } from '../../lib/server/store';
import { flushPendingSyncOutbox } from '../../lib/server/sync-coordinator';
import { buildAegisSlashCommands } from './commands/registry';
import { attachAegisBotHandlers } from './handlers';
import { auditGuildBotPermissions } from './modules/permissions';

process.env.AEGIS_STANDALONE_BOT = 'true';

const GATEWAY_OWNER_LOCK_KEY = 'aegis:bot:gateway_owner';
const instanceId = `bot-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;

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

  await ensureMongoConnected();
  if (env.redisConfigured) {
    await redisCoordinator.ensureConnected();
    const acquired = await redisCoordinator.acquireDistributedLock(
      GATEWAY_OWNER_LOCK_KEY,
      instanceId,
      45_000
    );
    if (!acquired) {
      aegisLogger.error('DISCORD', 'Another standalone bot instance already owns the Gateway lock', {
        meta: { instanceId },
      });
      process.exit(1);
    }
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

  const client = new Client({
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
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let reconcileTimer: NodeJS.Timeout | null = null;

  // Authoritative cross-container Redis sync & remote control subscription
  const unsubscribeRedis = redisCoordinator.subscribe(async (msg) => {
    if (msg.originProcessId && msg.originProcessId === aegisStore.instanceId) {
      return;
    }

    if (msg.channel === 'aegis:bot:control') {
      if (msg.event === 'DEPLOY_SLASH_COMMANDS' && client.isReady()) {
        const appId = await resolveAppId(env.discordBotToken, client);
        if (appId) {
          await syncAllGuildSlashCommands(env.discordBotToken, appId, client);
          lastSlashSyncAt = new Date().toISOString();
        }
      } else if (msg.event === 'RECONCILE_ALL' || msg.event === 'RESTART_CLUSTER') {
        await aegisStore.reconcileGuildConfigsFromMongo();
      }
      return;
    }

    if (msg.guildId) {
      await aegisStore.reconcileGuildConfigsFromMongo(msg.guildId);
      aegisStore.l1Cache.invalidateByPrefix(`guild:${msg.guildId}:`);
    } else {
      aegisStore.reloadFromDiskIfNewer();
      aegisStore.l1Cache.invalidateByPrefix('global:');
    }
  });

  redisCoordinator.onReconnect(() => {
    void (async () => {
      await flushPendingSyncOutbox(aegisStore.instanceId);
      await aegisStore.reconcileGuildConfigsFromMongo();
    })();
  });

  attachAegisBotHandlers(client, {
    onGuildJoined: async (guildId) => {
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
      meta: { error: err.message },
    });
  });

  client.once(Events.ClientReady, async (readyClient) => {
    aegisLogger.info('DISCORD', 'Standalone Gateway bot ready', {
      meta: {
        instanceId,
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
        await aegisStore.commitMutation('guild:list_synced');
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
      if (redisCoordinator.getStatus() !== 'CONNECTED') return;
      await redisCoordinator.acquireDistributedLock(GATEWAY_OWNER_LOCK_KEY, instanceId, 45_000);
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
        instanceId,
        pid: process.pid,
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
      void aegisStore.reconcileGuildConfigsFromMongo();
      void flushPendingSyncOutbox(aegisStore.instanceId);
    }, 60_000);
  });

  const shutdown = async (signal: string) => {
    aegisLogger.info('SYSTEM', `Shutting down standalone bot (${signal})`, { meta: { instanceId } });
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (reconcileTimer) clearInterval(reconcileTimer);
    unsubscribeRedis();
    await client.destroy().catch(() => undefined);
    await redisCoordinator.disconnect();
    process.exit(0);
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  await client.login(env.discordBotToken);
}

startBot().catch((err) => {
  aegisLogger.fatal('DISCORD', 'Standalone bot fatal startup error', {
    meta: { error: err instanceof Error ? err.message : String(err) },
  });
  process.exit(1);
});
