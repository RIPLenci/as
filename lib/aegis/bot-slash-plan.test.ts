import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeHonestBotState,
  planGuildCommandSyncBatches,
  sanitizeSystemHealthForPublic,
  summarizeSlashCommands,
} from './bot-slash-plan';
import type { SlashCommandDefinition, SystemHealthSnapshot } from './types';

test('summarizeSlashCommands counts top-level commands and all subcommands accurately', () => {
  const sample: SlashCommandDefinition[] = [
    {
      name: 'antiraid',
      description: 'Anti-Raid',
      category: 'Seguridad',
      defaultMemberPermissions: 'ManageGuild',
      status: 'GLOBAL_SYNCED',
      subcommands: [
        { name: 'status', description: 'Status', optionsCount: 0 },
        { name: 'enable', description: 'Enable', optionsCount: 0 },
      ],
    },
    {
      name: 'security',
      description: 'Additional security',
      category: 'Seguridad Adicional',
      defaultMemberPermissions: 'ManageGuild',
      status: 'GLOBAL_SYNCED',
      subcommands: [
        { name: 'status', description: 'Status', optionsCount: 0 },
        { name: 'antialts', description: 'Anti alts', optionsCount: 2 },
        { name: 'antibots', description: 'Anti bots', optionsCount: 1 },
      ],
    },
  ];

  const summary = summarizeSlashCommands(sample);
  assert.equal(summary.commandCount, 2);
  assert.equal(summary.totalSubcommands, 5);
  assert.deepEqual(summary.commandNames, ['/antiraid', '/security']);
});

test('planGuildCommandSyncBatches deduplicates valid snowflakes and chunks cleanly', () => {
  const ids = [
    '123456789012345678',
    '123456789012345678', // duplicate
    'not-a-snowflake',
    '223456789012345678',
    '323456789012345678',
    '423456789012345678',
    '523456789012345678',
  ];

  const batches = planGuildCommandSyncBatches(ids, 2);
  assert.deepEqual(batches, [
    ['123456789012345678', '223456789012345678'],
    ['323456789012345678', '423456789012345678'],
    ['523456789012345678'],
  ]);
});

test('normalizeHonestBotState never reports ONLINE when token is unconfigured', () => {
  assert.equal(
    normalizeHonestBotState({
      botConfigured: false,
      liveConnected: false,
      redisOnline: false,
      restOnline: false,
    }),
    'UNCONFIGURED'
  );
  assert.equal(
    normalizeHonestBotState({
      botConfigured: true,
      liveConnected: true,
      redisOnline: false,
      restOnline: true,
    }),
    'ONLINE'
  );
  assert.equal(
    normalizeHonestBotState({
      botConfigured: true,
      liveConnected: false,
      redisOnline: false,
      restOnline: true,
    }),
    'DEGRADED'
  );
  assert.equal(
    normalizeHonestBotState({
      botConfigured: true,
      liveConnected: false,
      redisOnline: false,
      restOnline: false,
      invalidToken: true,
    }),
    'OFFLINE'
  );
});

test('sanitizeSystemHealthForPublic strips internal PID/memory/cache metrics', () => {
  const snapshot: SystemHealthSnapshot = {
    api: 'ONLINE',
    mongodb: 'UNCONFIGURED',
    redis: 'UNCONFIGURED',
    bot: 'UNCONFIGURED',
    degradedMode: true,
    lastSynchronization: '2026-11-18T10:00:00.000Z',
    l1CacheStats: {
      entries: 42,
      maxEntries: 2000,
      hits: 900,
      misses: 100,
      hitRatePercent: 90,
    },
    botIdentity: {
      configured: false,
      tag: null,
      id: null,
      avatarUrl: null,
      pingMs: null,
      guildCount: null,
      userCount: null,
    },
    shards: [
      {
        id: 0,
        clusterId: 1,
        status: 'READY',
        pingMs: 18,
        guildCount: 3,
        uptimeSeconds: 120,
        memoryMb: 64,
        eventThroughputPerSec: 12,
      },
    ],
    cluster: {
      clusterId: 1,
      clusterName: 'Cluster-Alpha',
      totalShards: 1,
      mode: 'CLUSTERED_MULTI_WORKER',
      workerPid: 99999,
      memoryMb: 120,
      cpuPercent: 1.5,
      averagePingMs: 18,
      status: 'OPTIMAL',
      eventLoopLagMs: 0.4,
      activeSockets: 1,
      queueSize: 0,
    },
    slashCommands: [],
    oauthConfigured: false,
  };

  const sanitized = sanitizeSystemHealthForPublic(snapshot);
  assert.equal(sanitized.l1CacheStats.entries, 0);
  assert.equal(sanitized.l1CacheStats.hits, 0);
  assert.equal(sanitized.cluster, undefined);
  assert.deepEqual(sanitized.shards, []);
  assert.equal(sanitized.slashCommands, undefined);
});

test('Discord slash command registry and metadata use clean Spanish names and (Emoji | Descripción) format without duplicates', async () => {
  const { buildAegisSlashCommands } = await import('../../services/bot/commands/registry');
  const { AEGIS_SLASH_COMMANDS_METADATA } = await import('../server/store');

  const built = buildAegisSlashCommands();
  assert.equal(built.length, 8);
  assert.deepEqual(
    built.map((c) => c.name),
    ['antiraid', 'antinuke', 'seguridad', 'cuarentena', 'bloqueo', 'whitelist', 'premium', 'aegis']
  );

  const emojiDescPattern = /^[^\s|]+\s\|\s.+$/;
  const slugPattern = /^[a-z0-9_-]{1,32}$/;

  const seenNames = new Set<string>();
  for (const cmd of built) {
    assert.ok(slugPattern.test(cmd.name), `Invalid command slug: ${cmd.name}`);
    assert.ok(!seenNames.has(cmd.name), `Duplicate command name: ${cmd.name}`);
    seenNames.add(cmd.name);
    assert.ok(
      emojiDescPattern.test(cmd.description),
      `Command /${cmd.name} description missing Emoji | Descripción: ${cmd.description}`
    );
    assert.ok(cmd.description.length <= 100, `Command /${cmd.name} description > 100 chars`);

    const subNames = new Set<string>();
    for (const opt of cmd.options ?? []) {
      if (opt.type === 1) {
        assert.ok(slugPattern.test(opt.name), `Invalid subcommand slug: /${cmd.name} ${opt.name}`);
        assert.ok(!subNames.has(opt.name), `Duplicate subcommand /${cmd.name} ${opt.name}`);
        subNames.add(opt.name);
        assert.ok(
          emojiDescPattern.test(opt.description),
          `Subcommand /${cmd.name} ${opt.name} description missing Emoji | Descripción: ${opt.description}`
        );
        assert.ok(
          opt.description.length <= 100,
          `Subcommand /${cmd.name} ${opt.name} description > 100 chars`
        );
      }
    }
  }

  assert.equal(AEGIS_SLASH_COMMANDS_METADATA.length, built.length);
  for (let i = 0; i < built.length; i++) {
    assert.equal(AEGIS_SLASH_COMMANDS_METADATA[i].name, built[i].name);
    assert.equal(AEGIS_SLASH_COMMANDS_METADATA[i].description, built[i].description);
  }
});

