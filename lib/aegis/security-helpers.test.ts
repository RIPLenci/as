import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dedupePreserveOrder,
  detectImageFormatFromMagicBytes,
  isSafeSinglePathSegment,
  mergeWhitelistExcludedRules,
  sanitizeHtmlScriptJson,
  stripUnsafeKeys,
} from './security-helpers';
import { aegisStore, createEmptyState } from '../server/store';
import { SUPER_OWNER_DISCORD_ID } from './rbac';

test('detectImageFormatFromMagicBytes accepts valid PNG/JPEG/WEBP/GIF signatures and rejects spoofed binaries', () => {
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  assert.deepEqual(detectImageFormatFromMagicBytes(pngBytes), {
    ext: '.png',
    mime: 'image/png',
  });

  const jpgBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  assert.deepEqual(detectImageFormatFromMagicBytes(jpgBytes), {
    ext: '.jpg',
    mime: 'image/jpeg',
  });

  const gifBytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00]);
  assert.deepEqual(detectImageFormatFromMagicBytes(gifBytes), {
    ext: '.gif',
    mime: 'image/gif',
  });

  // RIFF....WEBP
  const webpBytes = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ]);
  assert.deepEqual(detectImageFormatFromMagicBytes(webpBytes), {
    ext: '.webp',
    mime: 'image/webp',
  });

  // Spoofed HTML or SVG payload must be rejected
  const spoofedSvg = new TextEncoder().encode('<svg onload=alert(1)>');
  assert.equal(detectImageFormatFromMagicBytes(spoofedSvg), null);

  // ELF / PE executable headers must be rejected
  const elfBinary = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]);
  assert.equal(detectImageFormatFromMagicBytes(elfBinary), null);
});

test('isSafeSinglePathSegment blocks traversal segments, slashes, and null bytes', () => {
  assert.equal(isSafeSinglePathSegment('evidencia-1-a1b2c3.png'), true);
  assert.equal(isSafeSinglePathSegment('GB-1A2B3C'), true);

  assert.equal(isSafeSinglePathSegment('.'), false);
  assert.equal(isSafeSinglePathSegment('..'), false);
  assert.equal(isSafeSinglePathSegment('../etc/passwd'), false);
  assert.equal(isSafeSinglePathSegment('..\\secret'), false);
  assert.equal(isSafeSinglePathSegment('sub/file.png'), false);
  assert.equal(isSafeSinglePathSegment('file\x00.png'), false);
  assert.equal(isSafeSinglePathSegment(''), false);
});

test('sanitizeHtmlScriptJson neutralizes script breakouts and HTML characters', () => {
  const encoded = sanitizeHtmlScriptJson({
    message: '</script><script>alert(1)</script>&"\'test\u2028\u2029',
  });
  assert.equal(encoded.includes('</script>'), false);
  assert.equal(encoded.includes('<'), false);
  assert.equal(encoded.includes('>'), false);
  assert.equal(encoded.includes('\u2028'), false);
  assert.equal(encoded.includes('\u2029'), false);
  const parsed = JSON.parse(encoded) as { message: string };
  assert.equal(parsed.message, '</script><script>alert(1)</script>&"\'test\u2028\u2029');
});

test('stripUnsafeKeys removes __proto__, constructor, and prototype recursively', () => {
  const raw = JSON.parse(
    '{"safe": 1, "__proto__": {"polluted": true}, "nested": {"constructor": {"bad": 1}, "ok": "yes"}}'
  ) as Record<string, unknown>;
  const cleaned = stripUnsafeKeys(raw);
  assert.equal(cleaned.safe, 1);
  assert.equal(Object.hasOwn(cleaned, '__proto__'), false);
  assert.equal(Object.hasOwn(cleaned, 'constructor'), false);
  assert.equal((cleaned.nested as Record<string, unknown>).ok, 'yes');
  assert.equal(Object.hasOwn(cleaned.nested as object, 'constructor'), false);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('dedupePreserveOrder and mergeWhitelistExcludedRules prevent duplicates cleanly', () => {
  assert.deepEqual(dedupePreserveOrder(['a', 'b', 'a', 'c', 'b']), ['a', 'b', 'c']);
  assert.deepEqual(
    mergeWhitelistExcludedRules(['JOIN_BURST', 'ANTI_NUKE'], ['ANTI_NUKE', 'BOT_DETECTION']),
    ['JOIN_BURST', 'ANTI_NUKE', 'BOT_DETECTION']
  );
});

test('aegisStore syncGuildRecord, upsertWhitelistEntry, upsertQuarantineEntry, and pushIncident stay deduplicated and synchronized', () => {
  const state = createEmptyState();
  const guildId = '888777666555444333';
  const baseGuild = {
    guildId,
    name: 'Guild Initial',
    iconUrl: null,
    memberCount: 100,
    ownerDiscordId: SUPER_OWNER_DISCORD_ID,
    userIsOwner: true,
    userHasManageGuild: true,
    botStatus: 'BOT_CONNECTED' as const,
    botPermissionsOk: true,
    protectionEnabled: false,
    lastSyncAt: null,
    linkedAt: null,
  };
  state.guilds[guildId] = { ...baseGuild };
  state.userGuildRoster['usr_1'] = [{ ...baseGuild }];
  state.userGuildRoster['usr_2'] = [{ ...baseGuild, userIsOwner: false }];

  // Syncing guild protection updates shared guild record + every roster copy
  aegisStore.syncGuildRecord(state, guildId, {
    protectionEnabled: true,
    name: 'Guild Renamed',
  });
  assert.equal(state.guilds[guildId].protectionEnabled, true);
  assert.equal(state.guilds[guildId].name, 'Guild Renamed');
  assert.equal(state.userGuildRoster['usr_1'][0].protectionEnabled, true);
  assert.equal(state.userGuildRoster['usr_2'][0].name, 'Guild Renamed');

  // Whitelist upsert merges excludedRules for the same active target instead of duplicating
  const nowIso = new Date().toISOString();
  const firstWl = aegisStore.upsertWhitelistEntry(state, {
    id: 'WL-1',
    guildId,
    targetId: '123456789012345678',
    targetName: 'TrustedMod',
    targetType: 'USER',
    reason: 'Moderator',
    excludedRules: ['JOIN_BURST'],
    authorId: SUPER_OWNER_DISCORD_ID,
    authorName: 'Owner',
    status: 'ACTIVE',
    createdAt: nowIso,
    expiresAt: null,
  });
  assert.equal(firstWl.updatedExisting, false);

  const secondWl = aegisStore.upsertWhitelistEntry(state, {
    id: 'WL-2',
    guildId,
    targetId: '123456789012345678',
    targetName: 'TrustedMod',
    targetType: 'USER',
    reason: 'Moderator + Bot',
    excludedRules: ['ANTI_NUKE'],
    authorId: SUPER_OWNER_DISCORD_ID,
    authorName: 'Owner',
    status: 'ACTIVE',
    createdAt: nowIso,
    expiresAt: null,
  });
  assert.equal(secondWl.updatedExisting, true);
  assert.equal(state.whitelists.length, 1);
  assert.deepEqual(state.whitelists[0].excludedRules, ['JOIN_BURST', 'ANTI_NUKE']);

  // Quarantine upsert merges active user quarantine instead of duplicating
  const q1 = aegisStore.upsertQuarantineEntry(state, {
    id: 'QRT-1',
    guildId,
    guildName: 'Guild Renamed',
    discordId: '999888777666555444',
    username: 'suspect',
    avatarUrl: null,
    reason: 'First offense',
    riskScore: 60,
    riskLevel: 'HIGH',
    incidentId: null,
    responsibleActor: 'Owner',
    previousRoleIds: [],
    status: 'ACTIVE',
    createdAt: nowIso,
    expiresAt: null,
    releasedAt: null,
    releasedBy: null,
  });
  assert.equal(q1.updatedExisting, false);

  const q2 = aegisStore.upsertQuarantineEntry(state, {
    id: 'QRT-2',
    guildId,
    guildName: 'Guild Renamed',
    discordId: '999888777666555444',
    username: 'suspect',
    avatarUrl: null,
    reason: 'Escalated offense',
    riskScore: 85,
    riskLevel: 'CRITICAL',
    incidentId: null,
    responsibleActor: 'Owner',
    previousRoleIds: [],
    status: 'ACTIVE',
    createdAt: nowIso,
    expiresAt: null,
    releasedAt: null,
    releasedBy: null,
  });
  assert.equal(q2.updatedExisting, true);
  assert.equal(state.quarantines.length, 1);
  assert.equal(state.quarantines[0].riskScore, 85);

  // Incident push caps at 500 records to avoid unbounded store growth
  for (let i = 0; i < 515; i += 1) {
    aegisStore.pushIncident(state, {
      id: `INC-${i}`,
      guildId,
      guildName: 'Guild Renamed',
      threatType: 'JOIN_RAID',
      riskScore: 50,
      riskLevel: 'HIGH',
      affectedUserId: String(100000000000000000 + i),
      affectedUsername: `user_${i}`,
      responsibleUserId: String(100000000000000000 + i),
      responsibleUsername: `user_${i}`,
      appliedAction: 'ALERT',
      status: 'MITIGATED',
      assignedTo: null,
      evidenceSummary: 'cap check',
      signals: [],
      comments: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  }
  assert.equal(state.incidents.length, 500);
});

test('aegisStore.assignGuildPremiumSlot reconstructs missing guildPlans when guildId already holds an active slot', () => {
  const state = createEmptyState();
  const discordId = SUPER_OWNER_DISCORD_ID;
  const guildId = '777666555444333222';
  const futureIso = new Date(Date.now() + 86_400_000).toISOString();

  state.userSubscriptions[discordId] = {
    discordId,
    username: 'Owner',
    tier: 'DIAMANTE',
    grantedAt: new Date(Date.now() - 3600_000).toISOString(),
    expiresAt: futureIso,
    updatedBy: 'SYSTEM',
    source: 'STAFF_PANEL',
    reason: 'Regression test',
    activatedGuildIds: [guildId],
    updatedAt: new Date(Date.now() - 3600_000).toISOString(),
  };

  // Simulate stale state where activatedGuildIds contains guildId, but guildPlans[guildId] was missing
  delete state.guildPlans[guildId];

  const result = aegisStore.assignGuildPremiumSlot(state, {
    discordId,
    guildId,
    username: 'Owner',
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.plan.guildId, guildId);
    assert.equal(result.plan.tier, 'DIAMANTE');
    assert.equal(result.plan.expiresAt, futureIso);
    assert.equal(state.guildPlans[guildId]?.tier, 'DIAMANTE');
    assert.ok(state.antiRaidConfigs[guildId]);
  }
});

test('aegisStore.buildOverviewAnalytics counts incidents at exact nowMs in final bucket and enforces guild isolation', async () => {
  const state = createEmptyState();
  const targetGuildId = '111222333444555666';
  const otherGuildId = '999888777666555444';
  const exactNowIso = new Date().toISOString();

  aegisStore.pushIncident(state, {
    id: 'INC-BOUNDARY',
    guildId: targetGuildId,
    guildName: 'Target Server',
    threatType: 'JOIN_RAID',
    riskScore: 95,
    riskLevel: 'CRITICAL',
    affectedUserId: '555444333222111000',
    affectedUsername: 'raider',
    responsibleUserId: '555444333222111000',
    responsibleUsername: 'raider',
    appliedAction: 'BAN',
    status: 'MITIGATED',
    assignedTo: null,
    evidenceSummary: 'Exact boundary timestamp check',
    signals: [],
    comments: [],
    createdAt: exactNowIso,
    updatedAt: exactNowIso,
  });

  aegisStore.pushIncident(state, {
    id: 'INC-OTHER-GUILD',
    guildId: otherGuildId,
    guildName: 'Other Server',
    threatType: 'JOIN_RAID',
    riskScore: 90,
    riskLevel: 'CRITICAL',
    affectedUserId: '444333222111000999',
    affectedUsername: 'other_raider',
    responsibleUserId: '444333222111000999',
    responsibleUsername: 'other_raider',
    appliedAction: 'BAN',
    status: 'MITIGATED',
    assignedTo: null,
    evidenceSummary: 'Must not leak across guilds',
    signals: [],
    comments: [],
    createdAt: exactNowIso,
    updatedAt: exactNowIso,
  });

  const origGetState = aegisStore.getState.bind(aegisStore);
  const origGetHealth = aegisStore.getSystemHealth.bind(aegisStore);
  try {
    aegisStore.getState = async () => state;
    aegisStore.getSystemHealth = async () => ({
      api: 'ONLINE',
      mongodb: 'ONLINE',
      redis: 'ONLINE',
      bot: 'ONLINE',
      degradedMode: false,
      lastSynchronization: exactNowIso,
      l1CacheStats: {
        entries: 0,
        maxEntries: 5000,
        hits: 0,
        misses: 0,
        hitRatePercent: 100,
      },
      botIdentity: {
        configured: true,
        tag: 'AEGIS#0001',
        id: '100000000000000000',
        avatarUrl: null,
        pingMs: 12,
        guildCount: 1,
        userCount: 10,
      },
      shards: [],
      cluster: {
        clusterId: 1,
        clusterName: 'Test Cluster',
        totalShards: 1,
        mode: 'STANDALONE_OPTIMIZED',
        workerPid: 1,
        memoryMb: 64,
        cpuPercent: 1,
        averagePingMs: 12,
        status: 'OPTIMAL',
        eventLoopLagMs: 0.2,
        activeSockets: 1,
        queueSize: 0,
      },
      slashCommands: [],
      oauthConfigured: true,
    });

    const analytics = await aegisStore.buildOverviewAnalytics('24h', targetGuildId, [targetGuildId]);
    assert.equal(analytics.metrics.totalRaidsDetected.value, 1);
    const totalBucketRaids = analytics.securityActivity.reduce((sum, b) => sum + b.detectedRaids, 0);
    assert.equal(totalBucketRaids, 1);
    assert.equal(analytics.securityActivity[analytics.securityActivity.length - 1].detectedRaids, 1);
    assert.equal(analytics.recentIncidents.length, 1);
    assert.equal(analytics.recentIncidents[0].guildId, targetGuildId);
  } finally {
    aegisStore.getState = origGetState;
    aegisStore.getSystemHealth = origGetHealth;
  }
});
