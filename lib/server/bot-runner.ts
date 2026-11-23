import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
  Options,
  REST,
  Routes,
} from 'discord.js';
import { planGuildCommandSyncBatches } from '../aegis/bot-slash-plan';
import { aegisTelemetry } from '../aegis/telemetry';
import type { BotClusterTelemetry, BotShardTelemetry } from '../aegis/types';
import { buildAegisSlashCommands } from '../../services/bot/commands/registry';
import { attachAegisBotHandlers } from '../../services/bot/handlers';
import { getServerEnv } from './env';
import { aegisLogger } from './logger';
import { redisCoordinator } from './redis';

interface BotRunnerState {
  client: Client | null;
  connectingPromise: Promise<void> | null;
  ready: boolean;
  startedAt: number | null;
  lastError: string | null;
  lastSlashSyncAt: string | null;
  lastSlashError: string | null;
  globalSynced: boolean;
  syncedGuildCount: number;
  heartbeatTimer: NodeJS.Timeout | null;
  maintenanceTimer: NodeJS.Timeout | null;
  applicationId: string | null;
  gatewayLeaseToken: string | null;
}

const globalForRunner = globalThis as unknown as { __aegisBotRunner?: BotRunnerState };
const GATEWAY_OWNER_LOCK_KEY = 'aegis:bot:gateway_owner';

function getRunnerState(): BotRunnerState {
  if (!globalForRunner.__aegisBotRunner) {
    globalForRunner.__aegisBotRunner = {
      client: null,
      connectingPromise: null,
      ready: false,
      startedAt: null,
      lastError: null,
      lastSlashSyncAt: null,
      lastSlashError: null,
      globalSynced: false,
      syncedGuildCount: 0,
      heartbeatTimer: null,
      maintenanceTimer: null,
      applicationId: null,
      gatewayLeaseToken: null,
    };
  }
  return globalForRunner.__aegisBotRunner;
}

export function isEmbeddedBotEnabled(): boolean {
  return (
    process.env.AEGIS_EMBEDDED_BOT === 'true' &&
    process.env.AEGIS_STANDALONE_BOT !== 'true'
  );
}

export async function resolveBotApplicationId(
  token: string,
  client?: Client | null
): Promise<string | null> {
  const env = getServerEnv();
  if (env.discordClientId) return env.discordClientId;
  if (client?.application?.id) return client.application.id;
  if (client?.user?.id) return client.user.id;
  try {
    const res = await fetch('https://discord.com/api/v10/oauth2/applications/@me', {
      headers: { Authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const app = (await res.json()) as { id?: string };
    return app.id ?? null;
  } catch (err) {
    aegisLogger.warn('DISCORD', 'Failed resolving bot application ID from Discord REST', {
      errorCode: 'REST_APP_ID',
      meta: { error: err instanceof Error ? err.message : String(err) },
    });
    return null;
  }
}

export async function deploySlashCommandsForGuild(
  token: string,
  applicationId: string,
  guildId: string
): Promise<boolean> {
  try {
    const rest = new REST({ version: '10', timeout: 10_000 }).setToken(token);
    const commands = buildAegisSlashCommands();
    await rest.put(Routes.applicationGuildCommands(applicationId, guildId), {
      body: commands,
    });
    return true;
  } catch (err) {
    aegisLogger.warn('DISCORD', 'Failed deploying slash commands for guild', {
      guildId,
      meta: { error: err instanceof Error ? err.message : String(err) },
    });
    return false;
  }
}

export async function deploySlashCommandsEverywhere(): Promise<{
  ok: boolean;
  error?: string;
  applicationId: string | null;
  commandCount: number;
  globalSynced: boolean;
  guildsSynced: number;
  failedGuilds: string[];
}> {
  const env = getServerEnv();
  const runner = getRunnerState();
  const commands = buildAegisSlashCommands();

  if (!env.discordBotToken) {
    return {
      ok: false,
      error: 'DISCORD_BOT_TOKEN no está configurado en las variables de entorno del servidor.',
      applicationId: null,
      commandCount: commands.length,
      globalSynced: false,
      guildsSynced: 0,
      failedGuilds: [],
    };
  }

  const appId = await resolveBotApplicationId(env.discordBotToken, runner.client);
  if (!appId) {
    return {
      ok: false,
      error:
        'No se pudo verificar el Application ID del bot con Discord REST (verifica DISCORD_BOT_TOKEN / DISCORD_CLIENT_ID).',
      applicationId: null,
      commandCount: commands.length,
      globalSynced: false,
      guildsSynced: 0,
      failedGuilds: [],
    };
  }

  runner.applicationId = appId;
  const rest = new REST({ version: '10', timeout: 15_000 }).setToken(env.discordBotToken);

  let globalError: string | undefined;
  try {
    await rest.put(Routes.applicationCommands(appId), { body: [] });
  } catch (err) {
    globalError = err instanceof Error ? err.message : 'Discord REST error';
  }

  const guildIds = new Set<string>();
  if (runner.client?.isReady()) {
    for (const gId of runner.client.guilds.cache.keys()) {
      guildIds.add(gId);
    }
  }
  try {
    const res = await fetch('https://discord.com/api/v10/users/@me/guilds?limit=200', {
      headers: { Authorization: `Bot ${env.discordBotToken}` },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const list = (await res.json()) as Array<{ id: string }>;
      for (const g of list) guildIds.add(g.id);
    }
  } catch (err) {
    aegisLogger.warn('DISCORD', 'REST guild discovery failed during slash deployment', {
      meta: { error: err instanceof Error ? err.message : String(err) },
    });
  }

  let guildsSynced = 0;
  const failedGuilds: string[] = [];
  const batches = planGuildCommandSyncBatches(Array.from(guildIds), 4);
  for (const batch of batches) {
    const results = await Promise.allSettled(
      batch.map(async (gId) => {
        await rest.put(Routes.applicationGuildCommands(appId, gId), { body: commands });
        return gId;
      })
    );
    results.forEach((res, idx) => {
      if (res.status === 'fulfilled') {
        guildsSynced += 1;
      } else {
        failedGuilds.push(batch[idx]);
      }
    });
  }

  runner.globalSynced = false;
  runner.syncedGuildCount = guildsSynced;
  runner.lastSlashSyncAt = new Date().toISOString();
  runner.lastSlashError = globalError ?? null;

  return {
    ok: guildsSynced > 0 || (guildIds.size === 0 && !globalError),
    error: guildsSynced === 0 && globalError ? globalError : undefined,
    applicationId: appId,
    commandCount: commands.length,
    globalSynced: false,
    guildsSynced,
    failedGuilds,
  };
}

function buildOptimizedDiscordClient(): Client {
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

  return new Client({
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
}

async function publishLiveHeartbeat(client: Client): Promise<void> {
  if (!client.isReady()) return;
  const snap = getLiveBotRunnerSnapshot();
  const telemetry = aegisTelemetry.getSnapshot();
  if (redisCoordinator.getStatus() === 'CONNECTED') {
    await redisCoordinator
      .setBotHeartbeat({
        updatedAt: Date.now(),
        instanceId: `embedded-${process.pid}`,
        pid: process.pid,
        tag: client.user.tag,
        id: client.user.id,
        avatarUrl: client.user.displayAvatarURL({ size: 256 }),
        pingMs: snap.pingMs ?? client.ws.ping,
        guildCount: snap.guildCount ?? client.guilds.cache.size,
        userCount: snap.userCount ?? 0,
        shards: snap.shards,
        cluster: snap.cluster ?? undefined,
        latencyMetrics: {
          antiRaidEval: telemetry.antiRaidEvalLatency,
          sanctionExec: telemetry.sanctionExecLatency,
        },
      })
      .catch((err) => {
        aegisLogger.warn('DISCORD', 'Failed publishing embedded bot heartbeat', {
          meta: { error: err instanceof Error ? err.message : String(err) },
        });
      });
  }
}

export async function connectOrRestartBot(forceRestart = false): Promise<{
  ok: boolean;
  ready: boolean;
  tag: string | null;
  id: string | null;
  pingMs: number | null;
  guildCount: number | null;
  error?: string;
}> {
  const env = getServerEnv();
  const runner = getRunnerState();

  if (!env.discordBotToken) {
    return {
      ok: false,
      ready: false,
      tag: null,
      id: null,
      pingMs: null,
      guildCount: null,
      error: 'DISCORD_BOT_TOKEN no configurado en el servidor.',
    };
  }

  if (!isEmbeddedBotEnabled()) {
    return {
      ok: false,
      ready: false,
      tag: null,
      id: null,
      pingMs: null,
      guildCount: null,
      error:
        'El bot Gateway está reservado al proceso standalone (services/bot/index.ts). Define AEGIS_EMBEDDED_BOT=true únicamente en entornos monolíticos de un solo contenedor.',
    };
  }

  // Prevent competing Gateway login if a standalone container holds the heartbeat or gateway lock
  if (env.redisConfigured) {
    await redisCoordinator.ensureConnected();
    const existingHeartbeat = await redisCoordinator.getBotHeartbeat();
    if (existingHeartbeat?.online && existingHeartbeat.pid !== process.pid) {
      return {
        ok: false,
        ready: false,
        tag: existingHeartbeat.tag,
        id: existingHeartbeat.id,
        pingMs: existingHeartbeat.pingMs,
        guildCount: existingHeartbeat.guildCount,
        error: `Un proceso standalone (${existingHeartbeat.instanceId || 'bot'}) ya posee la conexión al Gateway de Discord.`,
      };
    }
    const lockToken = runner.gatewayLeaseToken ?? `embedded-${process.pid}`;
    const lockRes = await redisCoordinator.acquireDistributedLockWithFencing(
      GATEWAY_OWNER_LOCK_KEY,
      lockToken,
      45_000
    );
    if (!lockRes.acquired) {
      return {
        ok: false,
        ready: false,
        tag: null,
        id: null,
        pingMs: null,
        guildCount: null,
        error: `Otro proceso o nodo posee el lock distribuido del Gateway (${lockRes.reason}).`,
      };
    }
    runner.gatewayLeaseToken = lockToken;
  }

  if (runner.client && !forceRestart) {
    if (runner.client.isReady()) {
      return {
        ok: true,
        ready: true,
        tag: runner.client.user.tag,
        id: runner.client.user.id,
        pingMs: runner.client.ws.ping >= 0 ? runner.client.ws.ping : null,
        guildCount: runner.client.guilds.cache.size,
      };
    }
    if (runner.connectingPromise) {
      await runner.connectingPromise.catch(() => undefined);
    }
  }

  if (forceRestart && runner.client) {
    if (runner.heartbeatTimer) {
      clearInterval(runner.heartbeatTimer);
      runner.heartbeatTimer = null;
    }
    if (runner.maintenanceTimer) {
      clearInterval(runner.maintenanceTimer);
      runner.maintenanceTimer = null;
    }
    try {
      await runner.client.destroy();
    } catch {
      // Ignore destroy errors
    }
    runner.client = null;
    runner.ready = false;
  }

  const client = buildOptimizedDiscordClient();
  runner.client = client;
  runner.lastError = null;

  attachAegisBotHandlers(client, {
    canProcessEvents: () => runner.ready && runner.client === client,
    onGuildJoined: async (guildId) => {
      const appId = await resolveBotApplicationId(env.discordBotToken, client);
      if (appId) {
        await deploySlashCommandsForGuild(env.discordBotToken, appId, guildId);
      }
    },
  });

  runner.connectingPromise = new Promise<void>((resolve, reject) => {
    const readyTimeout = setTimeout(() => {
      reject(new Error('Discord Gateway handshake timeout (20s)'));
    }, 20_000);

    client.once(Events.ClientReady, async (readyClient) => {
      clearTimeout(readyTimeout);
      runner.ready = true;
      runner.startedAt = Date.now();
      runner.applicationId = readyClient.application?.id ?? readyClient.user.id;
      readyClient.user.setPresence({
        status: 'online',
        activities: [
          {
            name: `${readyClient.guilds.cache.size} servidores protegidos | /aegis`,
            type: ActivityType.Watching,
          },
        ],
      });
      aegisLogger.info('DISCORD', 'Connected LIVE in embedded mode', {
        meta: {
          tag: readyClient.user.tag,
          guilds: readyClient.guilds.cache.size,
          shards: readyClient.ws.shards.size,
        },
      });
      void deploySlashCommandsEverywhere().catch((err) => {
        aegisLogger.warn('DISCORD', 'Initial slash sync warning', {
          meta: { error: err instanceof Error ? err.message : String(err) },
        });
      });
      void publishLiveHeartbeat(readyClient);
      if (runner.heartbeatTimer) clearInterval(runner.heartbeatTimer);
      runner.heartbeatTimer = setInterval(() => {
        void (async () => {
          if (env.redisConfigured && runner.gatewayLeaseToken) {
            const renew = await redisCoordinator.verifyAndRenewDistributedLock(
              GATEWAY_OWNER_LOCK_KEY,
              runner.gatewayLeaseToken,
              45_000
            );
            if (!renew.acquired) {
              aegisLogger.error('DISCORD', 'Embedded runner lost Gateway leadership; disconnecting client', {
                meta: { reason: renew.reason },
              });
              runner.ready = false;
              if (runner.heartbeatTimer) clearInterval(runner.heartbeatTimer);
              runner.heartbeatTimer = null;
              await readyClient.destroy().catch(() => undefined);
              if (runner.client === readyClient) runner.client = null;
              return;
            }
          }
          await publishLiveHeartbeat(readyClient);
        })();
      }, 15_000);
      if (runner.maintenanceTimer) clearInterval(runner.maintenanceTimer);
      runner.maintenanceTimer = setInterval(() => {
        void import('./store')
          .then(({ aegisStore }) => aegisStore.getState())
          .catch((err) => {
            aegisLogger.warn('SYSTEM', 'Maintenance tick error', {
              meta: { error: err instanceof Error ? err.message : String(err) },
            });
          });
      }, 60_000);
      resolve();
    });

    client.on(Events.Error, (err) => {
      runner.lastError = err.message;
      aegisLogger.error('DISCORD', 'Gateway client error', { meta: { error: err.message } });
    });

    client.on(Events.ShardDisconnect, () => {
      runner.ready = false;
    });

    client.on(Events.ShardResume, () => {
      runner.ready = true;
    });

    client.login(env.discordBotToken).catch((err) => {
      clearTimeout(readyTimeout);
      runner.lastError = err instanceof Error ? err.message : 'Login failed';
      runner.ready = false;
      reject(err);
    });
  });

  try {
    await runner.connectingPromise;
    return {
      ok: true,
      ready: Boolean(client.isReady()),
      tag: client.user?.tag ?? null,
      id: client.user?.id ?? null,
      pingMs: client.ws.ping >= 0 ? client.ws.ping : null,
      guildCount: client.guilds.cache.size,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to connect bot';
    runner.lastError = msg;
    return {
      ok: false,
      ready: false,
      tag: null,
      id: null,
      pingMs: null,
      guildCount: null,
      error: msg,
    };
  } finally {
    runner.connectingPromise = null;
  }
}

export function ensureBotStarted(): void {
  if (!isEmbeddedBotEnabled()) return;
  const env = getServerEnv();
  if (!env.discordBotToken) return;
  const runner = getRunnerState();
  if (runner.client || runner.connectingPromise) return;
  void connectOrRestartBot(false).catch((err) => {
    aegisLogger.warn('DISCORD', 'Auto-boot warning', {
      meta: { error: err instanceof Error ? err.message : String(err) },
    });
  });
}

export function getActiveDiscordClient(): Client | null {
  const runner = getRunnerState();
  if (runner.client && runner.client.isReady()) {
    return runner.client;
  }
  return null;
}

export function getLiveBotRunnerSnapshot(): {
  connected: boolean;
  id: string | null;
  tag: string | null;
  avatarUrl: string | null;
  pingMs: number | null;
  guildCount: number | null;
  userCount: number | null;
  shards: BotShardTelemetry[];
  cluster: BotClusterTelemetry | null;
  lastError: string | null;
  lastSlashSyncAt: string | null;
} {
  const runner = getRunnerState();
  const client = runner.client;
  if (!client || !client.isReady()) {
    return {
      connected: false,
      id: null,
      tag: null,
      avatarUrl: null,
      pingMs: null,
      guildCount: null,
      userCount: null,
      shards: [],
      cluster: null,
      lastError: runner.lastError,
      lastSlashSyncAt: runner.lastSlashSyncAt,
    };
  }

  const telemetry = aegisTelemetry.getSnapshot();
  const totalMemMb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  const uptimeSeconds = runner.startedAt ? Math.floor((Date.now() - runner.startedAt) / 1000) : 0;
  const guildCount = client.guilds.cache.size;
  const userCount = client.guilds.cache.reduce((sum, g) => sum + (g.memberCount || 0), 0);
  const wsShards = Array.from(client.ws.shards.values());
  const shards: BotShardTelemetry[] =
    wsShards.length > 0
      ? wsShards.map((shard, idx) => ({
          id: shard.id ?? idx,
          clusterId: 1,
          status: shard.status === 0 ? 'READY' : shard.status === 2 ? 'RECONNECTING' : 'CONNECTING',
          pingMs: shard.ping >= 0 ? Math.round(shard.ping) : Math.max(0, Math.round(client.ws.ping)),
          guildCount:
            wsShards.length === 1
              ? guildCount
              : client.guilds.cache.filter((g) => g.shardId === shard.id).size,
          uptimeSeconds,
          memoryMb: Math.max(12, Math.round(totalMemMb / Math.max(1, wsShards.length))),
          eventThroughputPerSec: telemetry.eventThroughputPerSec,
        }))
      : [
          {
            id: 0,
            clusterId: 1,
            status: 'READY',
            pingMs: client.ws.ping >= 0 ? Math.round(client.ws.ping) : 0,
            guildCount,
            uptimeSeconds,
            memoryMb: totalMemMb,
            eventThroughputPerSec: telemetry.eventThroughputPerSec,
          },
        ];

  const avgPing =
    shards.length > 0
      ? Math.round(shards.reduce((acc, s) => acc + s.pingMs, 0) / shards.length)
      : client.ws.ping >= 0
      ? Math.round(client.ws.ping)
      : 0;

  const cluster: BotClusterTelemetry = {
    clusterId: 1,
    clusterName: wsShards.length > 1 ? 'Cluster-Alpha (Multi-Shard Gateway)' : 'Cluster-Alpha (Primary Node)',
    totalShards: shards.length,
    mode: wsShards.length > 1 ? 'CLUSTERED_MULTI_WORKER' : 'STANDALONE_OPTIMIZED',
    workerPid: process.pid,
    memoryMb: totalMemMb,
    cpuPercent: telemetry.cpuPercent,
    averagePingMs: avgPing,
    status: avgPing < 120 ? 'OPTIMAL' : 'HEALTHY',
    eventLoopLagMs: telemetry.eventLoopLagMs,
    activeSockets: wsShards.length,
    queueSize: 0,
  };

  return {
    connected: true,
    id: client.user.id,
    tag: client.user.tag,
    avatarUrl: client.user.displayAvatarURL({ size: 256 }),
    pingMs: avgPing,
    guildCount,
    userCount,
    shards,
    cluster,
    lastError: null,
    lastSlashSyncAt: runner.lastSlashSyncAt,
  };
}
