import assert from 'node:assert/strict';
import test from 'node:test';
import { AuditLogEvent, PermissionFlagsBits, type Guild, type GuildAuditLogsEntry, type GuildMember } from 'discord.js';
import { NextRequest } from 'next/server';
import { evaluateMutationCsrf } from './csrf';
import { evaluateFastJoinMitigation } from './fast-antiraid';
import { isSuperOwner } from './rbac';
import { evaluateJoinRisk, DEFAULT_RISK_WEIGHTS } from './risk-engine';
import { clearSanctionIdempotencyCache } from './sanction-executor';
import { BoundedGuildTaskQueue, KeyedAsyncMutex, SlidingWindowTracker } from './sliding-window';
import type { AntiRaidConfigRecord, GlobalBanRecord, QuarantineEntryRecord } from './types';
import { globalBanCreateSchema } from './validators';
import { requireGuildAuthorization, verifyMutationOrigin } from '../server/auth-guard';
import { GATEWAY_OWNER_LOCK_KEY, GatewayLeadershipController } from '../server/gateway-leadership';
import { checkRateLimit } from '../server/rate-limit';
import { redisCoordinator, type RedisTransport } from '../server/redis';
import {
  consumeOAuthExchangeCode,
  consumePendingOAuthState,
  createOAuthExchangeCode,
  generateRandomState,
  getUserDiscordAccessToken,
  isSessionRevoked,
  revokeSessionId,
  savePendingOAuthState,
  setUserDiscordAccessToken,
} from '../server/session';
import { aegisStore } from '../server/store';
import {
  type ClaimedOutboxRecord,
  computeRetryBackoffMs,
  flushPendingSyncOutboxWithAdapter,
  type SyncOutboxStoreAdapter,
} from '../server/sync-coordinator';
import { AegisWorkerController, WORKER_CYCLE_LOCK_KEY } from '../server/worker-controller';
import { handleGuildAuditLogEntryCreate } from '../../services/bot/modules/audit-guard';
import { handleGuildMemberAdd } from '../../services/bot/modules/member-join';

// ==============================================================================
// Atomic In-Memory Lua-Faithful RedisTransport (Multi-Container Integration Test)
// ==============================================================================
class InMemoryAtomicRedisTransport implements RedisTransport {
  public status: RedisTransport['status'] = 'CONNECTED';
  public readonly kv = new Map<string, { value: string; expiresAt: number | null }>();
  public readonly zsets = new Map<string, Array<{ score: number; member: string }>>();
  public readonly publishedMessages: Array<{ channel: string; payload: string }> = [];

  private getValid(key: string): string | null {
    const entry = this.kv.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && Date.now() >= entry.expiresAt) {
      this.kv.delete(key);
      return null;
    }
    return entry.value;
  }

  public forceExpireKey(key: string): void {
    this.kv.delete(key);
  }

  public forceStealKey(key: string, otherOwner: string, ttlMs = 30_000): void {
    this.kv.set(key, { value: otherOwner, expiresAt: Date.now() + ttlMs });
  }

  async ping(): Promise<string> {
    if (this.status !== 'CONNECTED') throw new Error('Redis disconnected');
    return 'PONG';
  }

  async get(key: string): Promise<string | null> {
    if (this.status !== 'CONNECTED') throw new Error('Redis disconnected');
    return this.getValid(key);
  }

  async set(key: string, value: string, ttlMs?: number): Promise<'OK' | null> {
    if (this.status !== 'CONNECTED') throw new Error('Redis disconnected');
    this.kv.set(key, {
      value,
      expiresAt: typeof ttlMs === 'number' && ttlMs > 0 ? Date.now() + ttlMs : null,
    });
    return 'OK';
  }

  async setNxPx(key: string, value: string, ttlMs: number): Promise<boolean> {
    if (this.status !== 'CONNECTED') throw new Error('Redis disconnected');
    if (this.getValid(key) !== null) return false;
    this.kv.set(key, { value, expiresAt: Date.now() + ttlMs });
    return true;
  }

  async del(key: string): Promise<number> {
    if (this.status !== 'CONNECTED') throw new Error('Redis disconnected');
    const existed = this.kv.delete(key);
    return existed ? 1 : 0;
  }

  async publish(channel: string, rawPayload: string): Promise<number> {
    if (this.status !== 'CONNECTED') throw new Error('Redis disconnected');
    this.publishedMessages.push({ channel, payload: rawPayload });
    return 1;
  }

  async eval(script: string, numKeys: number, ...args: string[]): Promise<unknown> {
    if (this.status !== 'CONNECTED') throw new Error('Redis disconnected');
    const keys = args.slice(0, numKeys);
    const argv = args.slice(numKeys);

    // 1. Acquire Lock With Fencing
    if (script.includes("redis.call('incr', KEYS[2])") && script.includes("LOCK_HELD_BY_OTHER")) {
      const [lockKey, fenceKey] = keys;
      const [ownerToken, ttlStr] = argv;
      const ttlMs = Number(ttlStr) || 30_000;
      const current = this.getValid(lockKey);
      if (!current) {
        this.kv.set(lockKey, { value: ownerToken, expiresAt: Date.now() + ttlMs });
        const nextFence = Number(this.getValid(fenceKey) ?? '0') + 1;
        this.kv.set(fenceKey, { value: String(nextFence), expiresAt: null });
        return [1, nextFence, 'LOCK_ACQUIRED'];
      }
      if (current === ownerToken) {
        this.kv.set(lockKey, { value: ownerToken, expiresAt: Date.now() + ttlMs });
        const fence = Number(this.getValid(fenceKey) ?? '1');
        return [1, fence, 'LOCK_RENEWED'];
      }
      const fence = Number(this.getValid(fenceKey) ?? '0');
      return [0, fence, 'LOCK_HELD_BY_OTHER'];
    }

    // 2. Verify and Renew Lock
    if (script.includes('LOCK_EXPIRED_OR_LOST')) {
      const [lockKey, fenceKey] = keys;
      const [ownerToken, ttlStr] = argv;
      const ttlMs = Number(ttlStr) || 30_000;
      const current = this.getValid(lockKey);
      if (current === ownerToken) {
        this.kv.set(lockKey, { value: ownerToken, expiresAt: Date.now() + ttlMs });
        const fence = Number(this.getValid(fenceKey) ?? '1');
        return [1, fence, 'LOCK_RENEWED'];
      }
      if (!current) {
        return [0, 0, 'LOCK_EXPIRED_OR_LOST'];
      }
      const fence = Number(this.getValid(fenceKey) ?? '0');
      return [0, fence, 'LOCK_HELD_BY_OTHER'];
    }

    // 3. Release Lock If Owner Matches
    if (script.includes("redis.call('get', KEYS[1]) == ARGV[1]")) {
      const [lockKey] = keys;
      const [ownerToken] = argv;
      if (this.getValid(lockKey) === ownerToken) {
        this.kv.delete(lockKey);
        return 1;
      }
      return 0;
    }

    // 4. Consume Key Atomically (Single-Use OAuth State / Exchange Code)
    if (script.includes("redis.call('del', KEYS[1])") && script.includes('return val')) {
      const [key] = keys;
      const val = this.getValid(key);
      if (val !== null) {
        this.kv.delete(key);
        return val;
      }
      return null;
    }

    // 5. Sliding Window ZSET Rate Limiter
    if (script.includes('ZREMRANGEBYSCORE')) {
      const [key] = keys;
      const minScore = Number(argv[0]);
      const nowScore = Number(argv[1]);
      const member = argv[2];
      const existing = this.zsets.get(key) ?? [];
      const filtered = existing.filter((e) => e.score > minScore);
      filtered.push({ score: nowScore, member });
      this.zsets.set(key, filtered);
      return filtered.length;
    }

    throw new Error(`Unsupported Lua script in InMemoryAtomicRedisTransport`);
  }

  async quit(): Promise<void> {
    this.status = 'OFFLINE';
  }
}

function makeAntiRaidConfig(overrides: Partial<AntiRaidConfigRecord> = {}): AntiRaidConfigRecord {
  return {
    guildId: '991000000000000001',
    enabled: true,
    activatedAt: new Date().toISOString(),
    mode: 'EMERGENCY',
    sensitivity: 'HIGH',
    maxJoins: 5,
    timeWindowSeconds: 15,
    minAccountAgeDays: 7,
    suspiciousAccountDetection: true,
    botJoinDetection: true,
    joinPatternDetection: true,
    burstDetection: true,
    riskThreshold: 60,
    defaultAction: 'BAN',
    riskRules: [
      { level: 'LOW', action: 'LOG_ONLY', notifyAlertChannel: false },
      { level: 'MODERATE', action: 'ALERT', notifyAlertChannel: true },
      { level: 'HIGH', action: 'KICK', notifyAlertChannel: true },
      { level: 'CRITICAL', action: 'BAN', notifyAlertChannel: true },
    ],
    riskWeights: { ...DEFAULT_RISK_WEIGHTS },
    eventsProcessed: 0,
    attacksDetected: 0,
    attacksPrevented: 0,
    threatsInvestigated: 0,
    actionsAttempted: 0,
    actionsSucceeded: 0,
    actionsFailed: 0,
    actionsCancelled: 0,
    syncVersion: 1,
    lastSyncedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeMockMember(opts: {
  guildId: string;
  userId: string;
  username: string;
  accountAgeDays: number;
  isBot?: boolean;
  hasAvatar?: boolean;
  guildOwnerId?: string;
  botPermissions?: bigint[];
  banDelayMs?: number;
  banError?: Error & { code?: number; status?: number };
  onBan?: (reason: string) => void;
  onKick?: (reason: string) => void;
  onUserDm?: (payload: unknown) => void;
  onOwnerDm?: (payload: unknown) => void;
}): GuildMember {
  const createdAtMs = Date.now() - opts.accountAgeDays * 86_400_000;
  const botBitSet = new Set(
    opts.botPermissions ?? [
      PermissionFlagsBits.Administrator,
      PermissionFlagsBits.BanMembers,
      PermissionFlagsBits.KickMembers,
      PermissionFlagsBits.ModerateMembers,
      PermissionFlagsBits.ManageRoles,
      PermissionFlagsBits.ManageGuild,
    ]
  );

  const botMember = {
    permissions: {
      has: (perm: bigint) => botBitSet.has(PermissionFlagsBits.Administrator) || botBitSet.has(perm),
    },
    roles: { highest: { position: 50 } },
  };

  const mockGuild = {
    id: opts.guildId,
    name: 'AEGIS Mock Guild',
    ownerId: opts.guildOwnerId ?? '999000000000000001',
    client: { user: { id: '888000000000000001' } },
    members: {
      me: botMember,
    },
    roles: {
      everyone: {
        id: opts.guildId,
        position: 0,
      },
    },
    channels: {
      fetch: async () => null,
    },
    fetchOwner: async () => ({
      user: {
        send: async (payload: unknown) => {
          opts.onOwnerDm?.(payload);
        },
      },
    }),
  };

  const member = {
    id: opts.userId,
    guild: mockGuild,
    client: { user: { id: '888000000000000001' } },
    bannable: true,
    kickable: true,
    moderatable: true,
    manageable: true,
    roles: { highest: { position: 5 }, add: async () => undefined },
    user: {
      id: opts.userId,
      username: opts.username,
      avatar: opts.hasAvatar === false ? null : 'abc123avatar',
      bot: Boolean(opts.isBot),
      createdTimestamp: createdAtMs,
      flags: { bitfield: 0 },
      send: async (payload: unknown) => {
        opts.onUserDm?.(payload);
      },
    },
    ban: async ({ reason }: { reason: string }) => {
      if (opts.banDelayMs) {
        await new Promise((r) => setTimeout(r, opts.banDelayMs));
      }
      if (opts.banError) {
        throw opts.banError;
      }
      opts.onBan?.(reason);
    },
    kick: async (reason: string) => {
      if (opts.banDelayMs) {
        await new Promise((r) => setTimeout(r, opts.banDelayMs));
      }
      opts.onKick?.(reason);
    },
    timeout: async () => undefined,
  };

  return member as unknown as GuildMember;
}

// ==============================================================================
// 19.1 END-TO-END ANTI-RAID, GLOBALBAN CONCURRENT DM & AUDIT GUARD TESTS
// ==============================================================================
test('19.1 E2E handleGuildMemberAdd handles normal join, GlobalBan DM+Owner DM, and 50-member concurrent burst without head-of-line stalling', async () => {
  clearSanctionIdempotencyCache();
  const state = await aegisStore.getState();
  const gid = '991000000000000101';
  aegisStore.ensureGuildStructures(state, gid, 'Concurrent Raid Guild');
  state.guildSecuritySuites[gid].additionalSecurity.antiAlts.enabled = false;
  state.guildSecuritySuites[gid].additionalSecurity.banMaliciousUsers = false;
  state.antiRaidConfigs[gid] = makeAntiRaidConfig({ guildId: gid, maxJoins: 5, timeWindowSeconds: 15 });
  aegisStore.joinWindow.clearBucket(`guild:${gid}:joins`);

  // 1. Normal aged user joining alone -> NOT sanctioned
  let normalBanned = false;
  await handleGuildMemberAdd(
    makeMockMember({
      guildId: gid,
      userId: '700000000000000001',
      username: 'friendly_veteran',
      accountAgeDays: 180,
      hasAvatar: false,
      onBan: () => {
        normalBanned = true;
      },
    })
  );
  assert.equal(normalBanned, false);
  assert.equal(state.antiRaidConfigs[gid].attacksPrevented, 0);

  // 2. GlobalBan user joining -> sends user DM, executes BAN, notifies guild owner
  const gbUserId = '700000000000000002';
  const gbRecord: GlobalBanRecord = {
    id: 'GB-OVERHAUL-01',
    discordId: gbUserId,
    username: 'known_raider',
    reason: 'Automated raid network leader',
    description: 'Verified coordinated raid wave across multiple guilds',
    category: 'COORDINATED_RAID',
    evidence: 'Verified raid wave evidence',
    severity: 'CRITICAL',
    severityLabel: 'Peligro',
    sanctionType: 'PERMANENT',
    durationKind: 'PERMANENT',
    appealable: false,
    moderatorId: '1052422681569525792',
    moderatorName: 'Owner',
    status: 'ACTIVE',
    createdAt: new Date().toISOString(),
    expiresAt: null,
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
    history: [],
  };
  state.globalBans = state.globalBans.filter((b) => b.discordId !== gbUserId);
  state.globalBans.push(gbRecord);
  aegisStore.rebuildHotIndexes(state);

  let gbUserDmSent = false;
  let gbOwnerDmSent = false;
  let gbMemberBanned = false;
  await handleGuildMemberAdd(
    makeMockMember({
      guildId: gid,
      userId: gbUserId,
      username: 'known_raider',
      accountAgeDays: 90,
      onUserDm: () => {
        gbUserDmSent = true;
      },
      onOwnerDm: () => {
        gbOwnerDmSent = true;
      },
      onBan: () => {
        gbMemberBanned = true;
      },
    })
  );
  assert.equal(gbUserDmSent, true, 'GlobalBan must DM sanctioned user');
  assert.equal(gbMemberBanned, true, 'GlobalBan must ban sanctioned user');
  assert.equal(gbOwnerDmSent, true, 'GlobalBan must notify guild owner');

  // 3. Whitelist JOIN_BURST bypass -> exempt from burst sanction
  const wlUserId = '700000000000000003';
  aegisStore.upsertWhitelistEntry(state, {
    id: 'WL-OVERHAUL-01',
    guildId: gid,
    targetId: wlUserId,
    targetName: 'vip_partner',
    targetType: 'USER',
    reason: 'Verified raid drill responder',
    excludedRules: ['JOIN_BURST', 'ACCOUNT_AGE'],
    authorId: '1052422681569525792',
    authorName: 'Owner',
    status: 'ACTIVE',
    createdAt: new Date().toISOString(),
    expiresAt: null,
  });
  aegisStore.rebuildHotIndexes(state);

  // 4. 30-member concurrent burst with simulated 100ms Discord REST sanction latency.
  // BoundedGuildTaskQueue runs 6 concurrent per guild -> 30 sanctions take ~550ms, NOT serial 3000ms!
  let burstSanctionsExecuted = 0;
  let wlSanctioned = false;
  const t0 = performance.now();
  await Promise.all([
    handleGuildMemberAdd(
      makeMockMember({
        guildId: gid,
        userId: wlUserId,
        username: 'vip_partner',
        accountAgeDays: 30,
        banDelayMs: 100,
        onBan: () => {
          wlSanctioned = true;
        },
        onKick: () => {
          wlSanctioned = true;
        },
      })
    ),
    ...Array.from({ length: 30 }, (_, idx) =>
      handleGuildMemberAdd(
        makeMockMember({
          guildId: gid,
          userId: `700000000000010${String(idx).padStart(3, '0')}`,
          username: `raid_clone_${idx}`,
          accountAgeDays: 0,
          banDelayMs: 100,
          onBan: () => {
            burstSanctionsExecuted += 1;
          },
          onKick: () => {
            burstSanctionsExecuted += 1;
          },
        })
      )
    ),
  ]);
  const burstElapsedMs = performance.now() - t0;

  assert.equal(wlSanctioned, false, 'Whitelisted JOIN_BURST user must never be sanctioned');
  assert.ok(burstSanctionsExecuted >= 20, `Expected high burst sanctions >= 20, got ${burstSanctionsExecuted}`);
  assert.ok(
    burstElapsedMs < 2000,
    `Bounded concurrent executor must complete 30 x 100ms sanctions well under serial 3000ms (actual=${burstElapsedMs.toFixed(1)}ms)`
  );
  console.info(
    `[INTEGRATION_BURST] members=31 delayedRestMs=100 totalElapsedMs=${burstElapsedMs.toFixed(1)} sanctionsExecuted=${burstSanctionsExecuted}`
  );

  // Clean up test globalBan from shared state
  state.globalBans = state.globalBans.filter((b) => b.discordId !== gbUserId);
  aegisStore.rebuildHotIndexes(state);
});

test('19.1 Explainable RiskEngine includes correlationId, detectors, weights, and appliedConfig', () => {
  const cfg = makeAntiRaidConfig({ riskThreshold: 55 });
  const evalRes = evaluateJoinRisk({
    guildId: cfg.guildId,
    correlationId: 'join_explain_1',
    accountAgeDays: 0,
    isBot: true,
    joinsInWindow: 12,
    maxJoinsThreshold: cfg.maxJoins,
    riskThreshold: cfg.riskThreshold,
    similarUsernameCount: 6,
    repetitiveJoinCount: 2,
    hasActiveGlobalBan: false,
    mode: 'STRICT',
    weights: cfg.riskWeights,
    enabledDetectors: {
      suspiciousAccountDetection: true,
      botJoinDetection: false,
      joinPatternDetection: true,
      burstDetection: true,
    },
  });

  assert.equal(evalRes.correlationId, 'join_explain_1');
  assert.ok(evalRes.activatedDetectors.includes('suspiciousAccountDetection'));
  assert.ok(evalRes.discardedDetectors.includes('botJoinDetection'));
  assert.equal(evalRes.appliedConfig.riskThreshold, 55);
  assert.equal(evalRes.appliedConfig.mode, 'STRICT');
});

test('19.1 Audit Guard enforces 30s recency filter and real @everyone bitfield diff without false positives', async () => {
  const state = await aegisStore.getState();
  const gid = '991000000000000102';
  aegisStore.ensureGuildStructures(state, gid, 'Audit Guard Guild');
  state.guildSecuritySuites[gid].additionalSecurity.antiEveryonePerms = true;
  state.antiNukeConfigs[gid].enabled = true;

  let revertedEveryone = false;
  let timeoutCalled = false;
  const mockGuild = {
    id: gid,
    name: 'Audit Guard Guild',
    ownerId: '999000000000000001',
    client: { user: { id: '888000000000000001' } },
    members: {
      me: {
        permissions: { has: () => true },
        roles: { highest: { position: 50 } },
      },
      cache: {
        get: () => undefined,
      },
      fetch: async () => ({
        id: '555000000000000001',
        guild: mockGuild,
        bannable: true,
        kickable: true,
        moderatable: true,
        manageable: true,
        roles: { highest: { position: 10 } },
        user: { username: 'suspect_mod' },
        ban: async () => {},
        kick: async () => {},
        timeout: async () => {
          timeoutCalled = true;
        },
      }),
    },
    roles: {
      everyone: {
        id: gid,
        permissions: {
          any: () => true,
          remove: () => BigInt(0),
        },
        setPermissions: async () => {
          revertedEveryone = true;
        },
      },
    },
    fetchOwner: async () => ({ user: { send: async () => {} } }),
  } as unknown as Guild;

  // 1. Delayed historical AuditLog entry (> 30s) -> ignored completely
  await handleGuildAuditLogEntryCreate(
    {
      action: AuditLogEvent.ChannelDelete,
      executorId: '555000000000000001',
      targetId: '333',
      createdTimestamp: Date.now() - 45_000,
    } as unknown as GuildAuditLogsEntry,
    mockGuild
  );
  assert.equal(revertedEveryone, false, 'Historical >30s audit log entry must not trigger action');
  assert.equal(timeoutCalled, false, 'Historical >30s audit log entry must not sanction executor');

  // 2. Harmless @everyone RoleUpdate (only color/name changed, zero dangerous perms added) -> zero false positive
  await handleGuildAuditLogEntryCreate(
    {
      action: AuditLogEvent.RoleUpdate,
      executorId: '555000000000000001',
      targetId: gid,
      createdTimestamp: Date.now() - 200,
      changes: [{ key: 'name', old: '@everyone', new: '@everyone' }],
    } as unknown as GuildAuditLogsEntry,
    mockGuild
  );
  assert.equal(revertedEveryone, false, 'Harmless RoleUpdate on @everyone must not revert');
  assert.equal(timeoutCalled, false, 'Harmless RoleUpdate on @everyone must not trigger sanction');

  // 3. Dangerous @everyone RoleUpdate adding Administrator bit -> reverts @everyone & triggers verified timeout
  await handleGuildAuditLogEntryCreate(
    {
      action: AuditLogEvent.RoleUpdate,
      executorId: '555000000000000001',
      targetId: gid,
      createdTimestamp: Date.now() - 100,
      changes: [
        {
          key: 'permissions',
          old: '0',
          new: String(PermissionFlagsBits.Administrator),
        },
      ],
    } as unknown as GuildAuditLogsEntry,
    mockGuild
  );
  assert.equal(revertedEveryone, true, 'Adding Administrator to @everyone must revert dangerous perms');
  assert.equal(timeoutCalled, true, 'Adding Administrator to @everyone must sanction executor');
});

// ==============================================================================
// 19.2 GATEWAY LEADERSHIP & FAIL-CLOSED SPLIT-BRAIN TESTS
// ==============================================================================
test('19.2 GatewayLeadershipController enforces fail-closed lock, single owner, monotonic fencing tokens, loss detection, and safe release', async () => {
  const prevRedisUrl = process.env.REDIS_URL;
  const prevRequireLock = process.env.AEGIS_REQUIRE_DISTRIBUTED_LOCK;
  const transport = new InMemoryAtomicRedisTransport();

  try {
    process.env.REDIS_URL = 'redis://127.0.0.1:6379';
    process.env.AEGIS_REQUIRE_DISTRIBUTED_LOCK = 'true';
    redisCoordinator._setTestTransport(transport);

    // 1. Redis disconnected during startup -> fail-closed
    transport.status = 'DEGRADED';
    const failClosedCtrl = new GatewayLeadershipController({ instanceId: 'bot-a' });
    const downRes = await failClosedCtrl.acquireLeadership();
    assert.equal(downRes.acquired, false);
    assert.equal(downRes.reason, 'REDIS_UNAVAILABLE');
    assert.equal(failClosedCtrl.getState(), 'NO_LEADER');
    assert.equal(failClosedCtrl.canProcessEvents(), false);

    // 2. Redis connected -> race two instances simultaneously
    transport.status = 'CONNECTED';
    let aDisconnected = false;
    let bDisconnected = false;
    const ctrlA = new GatewayLeadershipController({
      instanceId: 'bot-a',
      ttlMs: 10_000,
      onDisconnectGateway: () => {
        aDisconnected = true;
      },
    });
    const ctrlB = new GatewayLeadershipController({
      instanceId: 'bot-b',
      ttlMs: 10_000,
      onDisconnectGateway: () => {
        bDisconnected = true;
      },
    });

    const [resA, resB] = await Promise.all([ctrlA.acquireLeadership(), ctrlB.acquireLeadership()]);
    assert.equal(Number(resA.acquired) + Number(resB.acquired), 1, 'Strictly 1 Gateway leader allowed');
    const firstLeader = resA.acquired ? ctrlA : ctrlB;
    const standby = resA.acquired ? ctrlB : ctrlA;
    assert.equal(firstLeader.canProcessEvents(), true);
    assert.equal(standby.canProcessEvents(), false);
    const token1 = firstLeader.getFencingToken();
    assert.equal(token1, 1);

    // 3. Successful renewal keeps token1
    const renewOk = await firstLeader.verifyAndRenewLeadership();
    assert.equal(renewOk.acquired, true);
    assert.equal(firstLeader.getFencingToken(), token1);

    // 4. Simulate lock expiration/theft -> heartbeat fails, aborts signal, disconnects gateway, standby takes over with higher token
    transport.forceExpireKey(GATEWAY_OWNER_LOCK_KEY);
    const renewLost = await firstLeader.verifyAndRenewLeadership();
    assert.equal(renewLost.acquired, false);
    assert.equal(firstLeader.getState(), 'NO_LEADER');
    assert.equal(firstLeader.canProcessEvents(), false);
    assert.equal(firstLeader.getAbortSignal().aborted, true);
    assert.equal(firstLeader === ctrlA ? aDisconnected : bDisconnected, true);

    const standbyTakeover = await standby.acquireLeadership();
    assert.equal(standbyTakeover.acquired, true);
    assert.equal(standby.canProcessEvents(), true);
    assert.ok((standby.getFencingToken() ?? 0) > (token1 ?? 0), 'Fencing token must increase monotonically');

    // 5. Previous owner shutdown MUST NOT release standby's lock
    const prevShutdown = await firstLeader.shutdown('SIGTERM');
    assert.equal(prevShutdown.releasedLock, false);
    assert.equal(transport.kv.get(GATEWAY_OWNER_LOCK_KEY)?.value, standby.instanceId);

    // 6. Active leader safe shutdown releases lock so fresh bot-c recovers cleanly
    const activeShutdown = await standby.shutdown('SIGTERM');
    assert.equal(activeShutdown.releasedLock, true);

    const ctrlC = new GatewayLeadershipController({ instanceId: 'bot-c' });
    const recovered = await ctrlC.acquireLeadership();
    assert.equal(recovered.acquired, true);
    assert.ok((ctrlC.getFencingToken() ?? 0) >= 3);
    await ctrlC.shutdown('SIGINT');
  } finally {
    redisCoordinator._setTestTransport(null);
    if (prevRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prevRedisUrl;
    if (prevRequireLock === undefined) delete process.env.AEGIS_REQUIRE_DISTRIBUTED_LOCK;
    else process.env.AEGIS_REQUIRE_DISTRIBUTED_LOCK = prevRequireLock;
  }
});

// ==============================================================================
// 19.3 OUTBOX CONCURRENCY, SLIDING WINDOW LRU CAPS, FENCING & IDEMPOTENCY
// ==============================================================================
test('19.3 SlidingWindowTracker enforces hard MAX_BUCKETS LRU bound and pruneExpiredBuckets', () => {
  const tracker = new SlidingWindowTracker(10);
  const now = 1_700_000_000_000;
  for (let i = 0; i < 30; i++) {
    tracker.recordAndAnalyze(`bucket:${i}`, `user:${i}`, 10, 5, `u_${i}`, now + i * 10);
  }
  assert.ok(
    tracker.getBucketCount() <= 10,
    `Expected <= 10 active buckets, got ${tracker.getBucketCount()}`
  );
  const pruned = tracker.pruneExpiredBuckets(now + 400_000, 300_000);
  assert.equal(pruned, 10);
  assert.equal(tracker.getBucketCount(), 0);
});

test('19.3 Concurrent Outbox leasing prevents duplicate delivery, applies backoff+jitter, and rejects stale fencing/versions', async () => {
  const rows: Array<{
    eventId: string;
    eventName: string;
    guildId: string;
    syncVersion: number;
    correlationId: string;
    payload: unknown;
    status: 'PENDING' | 'PROCESSING' | 'PUBLISHED' | 'FAILED';
    attempts: number;
    maxAttempts: number;
    leaseOwner: string | null;
    leaseExpiresAt: number | null;
    nextAttemptAt: number;
    deliveryId: string | null;
  }> = Array.from({ length: 6 }, (_, i) => ({
    eventId: `evt_${i}`,
    eventName: 'antiraid:updated',
    guildId: '991000000000000201',
    syncVersion: i + 1,
    correlationId: `cor_${i}`,
    payload: { idx: i },
    status: 'PENDING',
    attempts: 0,
    maxAttempts: 3,
    leaseOwner: null,
    leaseExpiresAt: null,
    nextAttemptAt: 0,
    deliveryId: null,
  }));

  const memoryAdapter: SyncOutboxStoreAdapter = {
    async claimNext(ownerId, leaseMs, now): Promise<ClaimedOutboxRecord | null> {
      const nowMs = now.getTime();
      const target = rows.find(
        (r) =>
          (r.status === 'PENDING' && r.nextAttemptAt <= nowMs) ||
          (r.status === 'PROCESSING' && (r.leaseExpiresAt ?? Infinity) <= nowMs)
      );
      if (!target) return null;
      const deliveryId = `dlv_${target.eventId}_${target.attempts + 1}_${ownerId}`;
      target.status = 'PROCESSING';
      target.leaseOwner = ownerId;
      target.leaseExpiresAt = nowMs + leaseMs;
      target.deliveryId = deliveryId;
      target.attempts += 1;
      return {
        eventId: target.eventId,
        eventName: target.eventName,
        guildId: target.guildId,
        syncVersion: target.syncVersion,
        correlationId: target.correlationId,
        payload: target.payload,
        attempts: target.attempts,
        maxAttempts: target.maxAttempts,
        deliveryId,
        leaseOwner: ownerId,
      };
    },
    async markPublished(eventId, ownerId, deliveryId): Promise<boolean> {
      const row = rows.find(
        (r) =>
          r.eventId === eventId &&
          r.status === 'PROCESSING' &&
          r.leaseOwner === ownerId &&
          r.deliveryId === deliveryId
      );
      if (!row) return false;
      row.status = 'PUBLISHED';
      row.leaseExpiresAt = null;
      return true;
    },
    async markRetryOrFailed(item, nextAttemptAt): Promise<'PENDING' | 'FAILED'> {
      const row = rows.find((r) => r.eventId === item.eventId && r.deliveryId === item.deliveryId);
      if (!row) return 'FAILED';
      const finalStatus = row.attempts >= row.maxAttempts ? 'FAILED' : 'PENDING';
      row.status = finalStatus;
      row.nextAttemptAt = nextAttemptAt.getTime();
      row.leaseOwner = null;
      return finalStatus;
    },
  };

  const publishedEvents: string[] = [];
  await Promise.all([
    flushPendingSyncOutboxWithAdapter('bot-1', memoryAdapter, async (_ev, payload) => {
      await new Promise((r) => setTimeout(r, 5));
      publishedEvents.push((payload as { eventId: string }).eventId);
      return true;
    }),
    flushPendingSyncOutboxWithAdapter('worker-1', memoryAdapter, async (_ev, payload) => {
      await new Promise((r) => setTimeout(r, 5));
      publishedEvents.push((payload as { eventId: string }).eventId);
      return true;
    }),
  ]);

  assert.equal(publishedEvents.length, 6);
  assert.equal(new Set(publishedEvents).size, 6, 'Concurrent flushers must not publish duplicate events');
  assert.ok(rows.every((r) => r.status === 'PUBLISHED'));

  // Retry backoff with jitter bounds
  const b1 = computeRetryBackoffMs(1, 1000, 10_000);
  const b3 = computeRetryBackoffMs(3, 1000, 10_000);
  assert.ok(b1 >= 500 && b1 <= 1000);
  assert.ok(b3 >= 2000 && b3 <= 4000);

  // Delivery idempotency & stale fencing token rejection
  assert.equal(aegisStore.claimDeliveryId('dlv_unique_check_1'), true);
  assert.equal(aegisStore.claimDeliveryId('dlv_unique_check_1'), false);
  assert.equal(aegisStore.acceptGatewayFencingToken(5), true);
  assert.equal(aegisStore.acceptGatewayFencingToken(4), false);
});

// ==============================================================================
// 19.4 WORKER CONCURRENCY, FAIL-CLOSED LOCK & IDEMPOTENT EXPIRATION
// ==============================================================================
test('19.4 AegisWorkerController prevents overlapping cycles, fails closed without Redis, and performs idempotent expirations', async () => {
  const prevRedisUrl = process.env.REDIS_URL;
  const prevRequireLock = process.env.AEGIS_REQUIRE_DISTRIBUTED_LOCK;
  const transport = new InMemoryAtomicRedisTransport();

  try {
    process.env.REDIS_URL = 'redis://127.0.0.1:6379';
    process.env.AEGIS_REQUIRE_DISTRIBUTED_LOCK = 'true';
    redisCoordinator._setTestTransport(transport);

    // 1. Fail-closed when Redis unavailable
    transport.status = 'DEGRADED';
    const wDown = new AegisWorkerController('wrk-down');
    const skippedDown = await wDown.runCycle('run_down_1');
    assert.equal(skippedDown.executed, false);
    assert.equal(skippedDown.skipReason, 'REDIS_UNAVAILABLE');

    // 2. Seed an expired GlobalBan & Quarantine for idempotency check
    transport.status = 'CONNECTED';
    const state = await aegisStore.getState();
    const expiredBanId = 'GB-EXP-OVERHAUL-1';
    const expiredQuarantineId = 'Q-EXP-OVERHAUL-1';
    state.globalBans = state.globalBans.filter((b) => b.id !== expiredBanId);
    state.quarantines = state.quarantines.filter((q) => q.id !== expiredQuarantineId);

    const pastIso = new Date(Date.now() - 60_000).toISOString();
    state.globalBans.push({
      id: expiredBanId,
      discordId: '666000000000000001',
      username: 'temp_raider',
      reason: 'Temp ban test',
      description: 'Temporary overdue sanction test',
      category: 'COORDINATED_RAID',
      evidence: 'test',
      severity: 'MODERATE',
      sanctionType: 'TEMPORARY',
      appealable: true,
      moderatorId: '1052422681569525792',
      moderatorName: 'Owner',
      status: 'ACTIVE',
      createdAt: new Date(Date.now() - 120_000).toISOString(),
      expiresAt: pastIso,
      revokedAt: null,
      revokedBy: null,
      revokeReason: null,
      history: [],
    });
    const qEntry: QuarantineEntryRecord = {
      id: expiredQuarantineId,
      guildId: '991000000000000301',
      guildName: 'Expiration Guild',
      discordId: '666000000000000002',
      username: 'temp_quarantine',
      avatarUrl: null,
      reason: 'Burst suspicion',
      riskScore: 70,
      riskLevel: 'HIGH',
      incidentId: null,
      responsibleActor: 'AEGIS_BOT',
      previousRoleIds: [],
      status: 'ACTIVE',
      createdAt: new Date(Date.now() - 120_000).toISOString(),
      expiresAt: pastIso,
      releasedAt: null,
      releasedBy: null,
    };
    state.quarantines.push(qEntry);

    const w1 = new AegisWorkerController('wrk-1');
    const w2 = new AegisWorkerController('wrk-2');

    // Pre-hold lock by another worker -> w2 skips with LOCK_HELD_BY_OTHER
    await transport.set(WORKER_CYCLE_LOCK_KEY, 'wrk-other', 30_000);
    const heldByOther = await w2.runCycle('run_other_held');
    assert.equal(heldByOther.executed, false);
    assert.equal(heldByOther.skipReason, 'LOCK_HELD_BY_OTHER');
    transport.forceExpireKey(WORKER_CYCLE_LOCK_KEY);

    // Cycle 1 expires the overdue entries cleanly
    const c1 = await w1.runCycle('run_cycle_1');
    assert.equal(c1.executed, true);
    assert.equal(c1.expiredGlobalBans, 1);
    assert.equal(c1.expiredQuarantines, 1);

    // Repeating same runId is rejected as duplicate
    const dupRun = await w1.runCycle('run_cycle_1');
    assert.equal(dupRun.executed, false);
    assert.equal(dupRun.skipReason, 'OVERLAPPING_CYCLE');

    // Cycle 2 runs idempotently with 0 additional expirations
    const c2 = await w1.runCycle('run_cycle_2');
    assert.equal(c2.executed, true);
    assert.equal(c2.expiredGlobalBans, 0);
    assert.equal(c2.expiredQuarantines, 0);

    // Safe shutdown blocks subsequent cycles
    await w1.shutdown('SIGTERM');
    const afterShutdown = await w1.runCycle('run_after_stop');
    assert.equal(afterShutdown.executed, false);
    assert.equal(afterShutdown.skipReason, 'SHUTTING_DOWN');

    // Clean test entities
    state.globalBans = state.globalBans.filter((b) => b.id !== expiredBanId);
    state.quarantines = state.quarantines.filter((q) => q.id !== expiredQuarantineId);
  } finally {
    redisCoordinator._setTestTransport(null);
    if (prevRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prevRedisUrl;
    if (prevRequireLock === undefined) delete process.env.AEGIS_REQUIRE_DISTRIBUTED_LOCK;
    else process.env.AEGIS_REQUIRE_DISTRIBUTED_LOCK = prevRequireLock;
  }
});

// ==============================================================================
// 19.5 SECURITY: DISTRIBUTED SESSIONS, CSRF, IDOR, SUPER-OWNER RBAC, RATE LIMIT
// ==============================================================================
test('19.5 Cross-container Redis OAuth state, exchange codes, encrypted token storage, session revocation, CSRF, RBAC & Rate Limit', async () => {
  const prevRedisUrl = process.env.REDIS_URL;
  const transport = new InMemoryAtomicRedisTransport();

  try {
    process.env.REDIS_URL = 'redis://127.0.0.1:6379';
    redisCoordinator._setTestTransport(transport);

    // 1. Pending OAuth state stored by container A -> consumed atomically ONCE by container B; tampered rejected
    const tamperedConsumed = await consumePendingOAuthState('tampered_nonce.bad_sig');
    assert.equal(tamperedConsumed, null, 'Unsigned/tampered OAuth state must be rejected');

    const validState = generateRandomState();
    const statePayload = {
      state: validState,
      codeVerifier: 'verifier_secret_value',
      redirectUri: 'https://panel.aegis.example/api/auth/callback',
      issuedAt: Date.now(),
    };
    await savePendingOAuthState(statePayload);
    const consumedOnce = await consumePendingOAuthState(validState);
    assert.deepEqual(consumedOnce, statePayload);
    const replay = await consumePendingOAuthState(validState);
    assert.equal(replay, null, 'OAuth state must be strictly single-use across containers');

    // 2. Single-use OAuth exchange code across containers
    const code = await createOAuthExchangeCode({
      userId: 'u_1',
      discordId: '1052422681569525792',
      sessionId: 'ses_test_cross',
      maxAgeSeconds: 3600,
    });
    const ex1 = await consumeOAuthExchangeCode(code);
    assert.equal(ex1?.discordId, '1052422681569525792');
    const ex2 = await consumeOAuthExchangeCode(code);
    assert.equal(ex2, null, 'Exchange code replay must return null');

    // 3. Access token encrypted in Redis (never plaintext) and decryptable by another container
    const secretToken = 'discord_oauth_access_token_very_secret_987';
    await setUserDiscordAccessToken('ses_test_cross', secretToken, 600);
    const redisValues = Array.from(transport.kv.values()).map((e) => e.value);
    assert.ok(
      !redisValues.some((v) => v.includes(secretToken)),
      'Access token must never be stored in plaintext inside Redis'
    );
    const decrypted = await getUserDiscordAccessToken('ses_test_cross');
    assert.equal(decrypted, secretToken);

    // 4. Distributed session revocation immediately invalidates across containers
    assert.equal(await isSessionRevoked('ses_test_cross'), false);
    await revokeSessionId('ses_test_cross');
    assert.equal(await isSessionRevoked('ses_test_cross'), true);

    // 5. CSRF validator (Edge + Route Guard) blocks foreign origin and cross-site Sec-Fetch-Site
    const csrfBlocked = evaluateMutationCsrf({
      method: 'POST',
      host: 'panel.aegis.example',
      origin: 'https://attacker.evil',
      secFetchSite: 'cross-site',
    });
    assert.equal(csrfBlocked.allowed, false);

    const csrfAllowed = verifyMutationOrigin(
      new NextRequest('https://panel.aegis.example/api/guilds/1/antiraid', {
        method: 'PATCH',
        headers: {
          host: 'panel.aegis.example',
          origin: 'https://panel.aegis.example',
          'sec-fetch-site': 'same-origin',
        },
      })
    );
    assert.equal(csrfAllowed, null);

    // 6. SuperOwner exclusivity & Cross-guild IDOR denial
    assert.equal(isSuperOwner('1052422681569525792'), true);
    assert.equal(isSuperOwner('2052422681569525799'), false);

    const idorDeny = requireGuildAuthorization(
      {
        state: await aegisStore.getState(),
        session: {
          sessionId: 'ses_idor',
          userId: 'u_idor',
          discordId: '2052422681569525799',
          authMode: 'DISCORD_OAUTH',
          issuedAt: Date.now(),
          expiresAt: Date.now() + 60_000,
        },
        user: {
          id: 'u_idor',
          discordId: '2052422681569525799',
          username: 'non_admin',
          globalName: null,
          globalRole: 'VIEWER',
          avatarUrl: null,
          language: 'es',
          theme: 'dark',
          authMode: 'DISCORD_OAUTH',
          createdAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString(),
        },
      },
      '999999999999999999',
      'antiraid:write'
    );
    assert.equal(idorDeny.ok, false);
    if (!idorDeny.ok) {
      assert.equal(idorDeny.response.status, 403);
    }

    // 7. Redis-backed sliding-window rate limiter enforces limit and denies on overflow
    for (let i = 1; i <= 3; i++) {
      const rl = await checkRateLimit({
        bucket: 'test_security',
        identifier: 'u:probe',
        limit: 3,
        windowSeconds: 60,
      });
      assert.equal(rl.allowed, true);
    }
    const overflow = await checkRateLimit({
      bucket: 'test_security',
      identifier: 'u:probe',
      limit: 3,
      windowSeconds: 60,
    });
    assert.equal(overflow.allowed, false);

    // 8. Zod validation rejects malformed Snowflakes
    const badSchema = globalBanCreateSchema.safeParse({
      discordId: 'not_a_snowflake',
      reason: 'ok',
    });
    assert.equal(badSchema.success, false);
  } finally {
    redisCoordinator._setTestTransport(null);
    if (prevRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prevRedisUrl;
  }
});

// ==============================================================================
// 19.6 EMPIRICAL CONTROLLED LOAD & CONCURRENCY BENCHMARK (TS ANTI-RAID + QUEUES)
// ==============================================================================
test('19.6 Controlled Load Benchmark: Anti-Raid TS Engine & BoundedGuildTaskQueue vs Serial KeyedAsyncMutex', async () => {
  const tracker = new SlidingWindowTracker(2000);
  const cfg = makeAntiRaidConfig({ maxJoins: 8, timeWindowSeconds: 15 });
  const baseMs = 1_700_002_000_000;
  const latenciesMs: number[] = [];

  const memBefore = process.memoryUsage();
  const cpuBefore = process.cpuUsage();
  const wallStart = performance.now();

  for (let i = 0; i < 5_000; i++) {
    const t0 = performance.now();
    const guildKey = `guild:bench_${i % 25}:joins`;
    const burst = tracker.recordAndAnalyze(
      guildKey,
      `u_${i % 1500}`,
      cfg.timeWindowSeconds,
      cfg.maxJoins,
      `raidwave_${i % 40}`,
      baseMs + i * 2
    );
    evaluateFastJoinMitigation({
      guildId: `bench_${i % 25}`,
      correlationId: `bench_${i}`,
      targetUserId: `u_${i % 1500}`,
      accountAgeDays: i % 14,
      isBot: i % 20 === 0,
      joinsInWindow: burst.countInWindow,
      thresholdExceeded: burst.thresholdExceeded,
      similarUsernameCount: burst.similarUsernameCount,
      repetitiveJoinCount: burst.repetitiveSubjectCount,
      underActiveRaidShield: burst.thresholdExceeded,
      concentrationScore: burst.concentrationScore,
      growthRateRatio: burst.growthRateRatio,
      config: cfg,
    });
    latenciesMs.push(performance.now() - t0);
  }

  const wallTotalMs = performance.now() - wallStart;
  const cpuDelta = process.cpuUsage(cpuBefore);
  const memAfter = process.memoryUsage();

  const sorted = latenciesMs.slice().sort((a, b) => a - b);
  const p50Ms = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
  const p95Ms = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const p99Ms = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
  const opsPerSec = Math.round((5_000 / wallTotalMs) * 1000);
  const heapDeltaMb = Number(((memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024).toFixed(2));
  const rssMb = Number((memAfter.rss / 1024 / 1024).toFixed(2));
  const cpuMs = Number(((cpuDelta.user + cpuDelta.system) / 1000).toFixed(2));

  // Compare 18 concurrent guild REST ops: serial KeyedAsyncMutex vs BoundedGuildTaskQueue(6)
  const mutex = new KeyedAsyncMutex();
  const serialT0 = performance.now();
  await Promise.all(
    Array.from({ length: 18 }, () =>
      mutex.runExclusive('g_bench', async () => {
        await new Promise((r) => setTimeout(r, 20));
      })
    )
  );
  const serialMs = performance.now() - serialT0;

  const queue = new BoundedGuildTaskQueue(6, 128, 64);
  const concurrentT0 = performance.now();
  await Promise.all(
    Array.from({ length: 18 }, () =>
      queue.enqueue('g_bench', async () => {
        await new Promise((r) => setTimeout(r, 20));
      })
    )
  );
  const concurrentMs = performance.now() - concurrentT0;

  console.info(
    `[OVERHAUL_BENCHMARK] events=5000 wallMs=${wallTotalMs.toFixed(2)} opsPerSec=${opsPerSec} p50Ms=${p50Ms.toFixed(4)} p95Ms=${p95Ms.toFixed(4)} p99Ms=${p99Ms.toFixed(4)} cpuMs=${cpuMs} heapDeltaMb=${heapDeltaMb} rssMb=${rssMb} serial18x20ms=${serialMs.toFixed(1)}ms boundedConcurrent18x20ms=${concurrentMs.toFixed(1)}ms`
  );

  assert.ok(p99Ms < 1.0, `p99 latency must stay < 1ms in TS engine (got ${p99Ms.toFixed(4)}ms)`);
  assert.ok(
    concurrentMs * 2 < serialMs,
    `Bounded concurrent executor (${concurrentMs.toFixed(1)}ms) must outperform serial mutex (${serialMs.toFixed(1)}ms) by >2x`
  );
});
