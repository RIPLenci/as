import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
  Options,
  REST,
  Routes,
} from 'discord.js';
import Redis from 'ioredis';
import { planGuildCommandSyncBatches } from '../../lib/aegis/bot-slash-plan';
import { getServerEnv } from '../../lib/server/env';
import { aegisStore } from '../../lib/server/store';
import { buildAegisSlashCommands } from './commands/registry';
import { attachAegisBotHandlers } from './handlers';

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
  } catch {
    return null;
  }
}

async function syncAllGuildSlashCommands(token: string, appId: string, client: Client) {
  const rest = new REST({ version: '10', timeout: 15_000 }).setToken(token);
  const commands = buildAegisSlashCommands();

  // Clear global commands first so old commands never duplicate per-guild commands
  await rest.put(Routes.applicationCommands(appId), { body: [] }).catch(() => undefined);

  const guildIds = Array.from(client.guilds.cache.keys());
  const batches = planGuildCommandSyncBatches(guildIds, 4);
  for (const batch of batches) {
    await Promise.allSettled(
      batch.map((guildId) =>
        rest.put(Routes.applicationGuildCommands(appId, guildId), { body: commands })
      )
    );
  }
  console.info(
    `[AEGIS BOT] Synchronized ${commands.length} deduplicated slash commands across ${guildIds.length} servers.`
  );
}

async function startBot() {
  const env = getServerEnv();
  if (!env.discordBotToken) {
    console.error('[AEGIS BOT] DISCORD_BOT_TOKEN is required to start the Discord Bot service.');
    process.exit(1);
  }

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

  const client = new Client({
    intents,
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

  // Optional Redis Pub/Sub subscriber for instant config synchronization without restart
  let redisPub: Redis | null = null;
  let redisSub: Redis | null = null;
  if (env.redisUrl) {
    redisPub = new Redis(env.redisUrl, { maxRetriesPerRequest: 2 });
    redisSub = new Redis(env.redisUrl, { maxRetriesPerRequest: 2 });
    await redisSub.subscribe('aegis:sync');
    redisSub.on('message', (_channel, raw) => {
      try {
        const msg = JSON.parse(raw) as {
          guildId?: string;
          event?: string;
          originProcessId?: string;
        };
        if (msg.originProcessId && msg.originProcessId === aegisStore.instanceId) {
          return;
        }
        aegisStore.reloadFromDiskIfNewer();
        if (msg.guildId) {
          aegisStore.l1Cache.invalidateByPrefix(`guild:${msg.guildId}:`);
        } else {
          aegisStore.l1Cache.invalidateByPrefix('global:');
        }
      } catch {
        // Ignore malformed sync event
      }
    });
  }

  attachAegisBotHandlers(client, {
    onGuildJoined: async (guildId) => {
      const appId = await resolveAppId(env.discordBotToken, client);
      if (!appId) return;
      const rest = new REST({ version: '10', timeout: 10_000 }).setToken(env.discordBotToken);
      await rest
        .put(Routes.applicationGuildCommands(appId, guildId), {
          body: buildAegisSlashCommands(),
        })
        .catch(() => undefined);
    },
  });

  client.once(Events.ClientReady, async (readyClient) => {
    console.info(
      `[AEGIS BOT] Logged in as ${readyClient.user.tag} (${readyClient.guilds.cache.size} guilds)`
    );
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
        const synced = aegisStore.syncGuildRecord(state, guild.id, {
          name: guild.name,
          iconUrl: guild.iconURL({ size: 256 }),
          botStatus: 'BOT_CONNECTED',
          botPermissionsOk: true,
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
      console.warn('[AEGIS BOT] Guild state startup sync warning:', err);
    }

    const appId = await resolveAppId(env.discordBotToken, readyClient);
    if (appId) {
      await syncAllGuildSlashCommands(env.discordBotToken, appId, readyClient).catch((err) => {
        console.warn('[AEGIS BOT] Slash command sync warning:', err);
      });
    }

    const publishHeartbeat = async () => {
      if (!redisPub) return;
      const userCount = readyClient.guilds.cache.reduce(
        (sum, g) => sum + (g.memberCount || 0),
        0
      );
      await redisPub
        .set(
          'aegis:bot:heartbeat',
          JSON.stringify({
            updatedAt: Date.now(),
            tag: readyClient.user.tag,
            id: readyClient.user.id,
            avatarUrl: readyClient.user.displayAvatarURL({ size: 256 }),
            pingMs: readyClient.ws.ping,
            guildCount: readyClient.guilds.cache.size,
            userCount,
          }),
          'EX',
          45
        )
        .catch(() => undefined);
    };
    await publishHeartbeat();
    setInterval(publishHeartbeat, 15_000);
  });

  await client.login(env.discordBotToken);
}

startBot().catch((err) => {
  console.error('[AEGIS BOT] Fatal startup error:', err);
  process.exit(1);
});
