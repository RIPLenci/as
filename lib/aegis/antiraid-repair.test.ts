import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateFastJoinMitigation, RaidBurstShield } from './fast-antiraid';
import { DEFAULT_RISK_WEIGHTS, evaluateJoinRisk } from './risk-engine';
import {
  clearSanctionIdempotencyCache,
  executeVerifiedSanction,
  type DiscordTargetCapability,
} from './sanction-executor';
import { KeyedAsyncMutex, SlidingWindowTracker } from './sliding-window';
import type { AntiRaidConfigRecord } from './types';
import { aegisStore } from '../server/store';
import { verifyMutationOrigin } from '../server/auth-guard';
import { NextRequest } from 'next/server';

function makeConfig(overrides: Partial<AntiRaidConfigRecord> = {}): AntiRaidConfigRecord {
  return {
    guildId: '910000000000000001',
    enabled: true,
    activatedAt: '2026-11-20T00:00:00.000Z',
    mode: 'NORMAL',
    sensitivity: 'BALANCED',
    maxJoins: 6,
    timeWindowSeconds: 10,
    minAccountAgeDays: 7,
    suspiciousAccountDetection: true,
    botJoinDetection: true,
    joinPatternDetection: true,
    burstDetection: true,
    riskThreshold: 65,
    defaultAction: 'QUARANTINE',
    riskRules: [
      { level: 'LOW', action: 'LOG_ONLY', notifyAlertChannel: false },
      { level: 'MODERATE', action: 'ALERT', notifyAlertChannel: true },
      { level: 'HIGH', action: 'QUARANTINE', notifyAlertChannel: true },
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
    lastSyncedAt: '2026-11-20T00:00:00.000Z',
    ...overrides,
  };
}

function makeCapability(overrides: Partial<DiscordTargetCapability> = {}): DiscordTargetCapability {
  return {
    targetId: '222222222222222222',
    targetUsername: 'probe_user',
    isGuildOwner: false,
    isBotSelf: false,
    bannable: true,
    kickable: true,
    moderatable: true,
    manageable: true,
    botPermissions: {
      banMembers: true,
      kickMembers: true,
      moderateMembers: true,
      manageRoles: true,
      manageGuild: true,
    },
    botHighestRoleAboveTarget: true,
    ...overrides,
  };
}

test('Master Anti-Raid disabled switch completely disables detections & scoring', () => {
  const decision = evaluateFastJoinMitigation({
    guildId: '910000000000000001',
    targetUserId: '333333333333333333',
    accountAgeDays: 0,
    isBot: true,
    hasAvatar: false,
    joinsInWindow: 25,
    thresholdExceeded: true,
    similarUsernameCount: 15,
    repetitiveJoinCount: 5,
    underActiveRaidShield: true,
    config: makeConfig({ enabled: false }),
  });

  assert.equal(decision.shouldMitigate, false);
  assert.equal(decision.action, 'LOG_ONLY');
  assert.equal(decision.evaluation.score, 0);
  assert.equal(decision.escalatedByRaidShield, false);
});

test('Individual detector switches strictly control risk signal contributions', () => {
  const baseCfg = makeConfig();

  // Disable burstDetection -> high joinsInWindow contributes 0 pts & thresholdExceeded is suppressed
  const noBurst = evaluateFastJoinMitigation({
    guildId: baseCfg.guildId,
    accountAgeDays: 60,
    isBot: false,
    joinsInWindow: 30,
    thresholdExceeded: true,
    similarUsernameCount: 0,
    repetitiveJoinCount: 0,
    underActiveRaidShield: true,
    config: makeConfig({
      burstDetection: false,
      suspiciousAccountDetection: false,
      joinPatternDetection: false,
      botJoinDetection: false,
    }),
  });
  assert.equal(noBurst.evaluation.score, 0);
  assert.equal(noBurst.shouldMitigate, false);

  // Enable only suspiciousAccountDetection -> account age fires, burst & pattern stay 0
  const onlyAge = evaluateJoinRisk({
    guildId: baseCfg.guildId,
    accountAgeDays: 0,
    isBot: true,
    joinsInWindow: 20,
    maxJoinsThreshold: 5,
    similarUsernameCount: 5,
    repetitiveJoinCount: 3,
    hasActiveGlobalBan: false,
    mode: 'NORMAL',
    weights: baseCfg.riskWeights,
    enabledDetectors: {
      suspiciousAccountDetection: true,
      botJoinDetection: false,
      joinPatternDetection: false,
      burstDetection: false,
    },
  });
  assert.ok((onlyAge.signals.find((s) => s.signal === 'accountAge')?.weightedPoints ?? 0) > 0);
  assert.equal(onlyAge.signals.find((s) => s.signal === 'eventVolume')?.weightedPoints, 0);
  assert.equal(onlyAge.signals.find((s) => s.signal === 'repetitiveBehavior')?.weightedPoints, 0);
  assert.equal(onlyAge.signals.find((s) => s.signal === 'joinPattern')?.weightedPoints, 0);

  // Enable only botJoinDetection -> unverified bot signal contributes without joinPattern handles
  const onlyBot = evaluateJoinRisk({
    guildId: baseCfg.guildId,
    accountAgeDays: 100,
    isBot: true,
    joinsInWindow: 1,
    maxJoinsThreshold: 5,
    similarUsernameCount: 4,
    repetitiveJoinCount: 0,
    hasActiveGlobalBan: false,
    mode: 'NORMAL',
    weights: baseCfg.riskWeights,
    enabledDetectors: {
      suspiciousAccountDetection: false,
      botJoinDetection: true,
      joinPatternDetection: false,
      burstDetection: false,
    },
  });
  assert.ok((onlyBot.signals.find((s) => s.signal === 'joinPattern')?.weightedPoints ?? 0) > 0);
});

test('Missing or default Discord avatar NEVER adds risk penalties', () => {
  const cfg = makeConfig();
  const withAvatar = evaluateJoinRisk({
    guildId: cfg.guildId,
    accountAgeDays: 3,
    isBot: false,
    hasAvatar: true,
    joinsInWindow: 1,
    maxJoinsThreshold: 6,
    similarUsernameCount: 0,
    repetitiveJoinCount: 0,
    hasActiveGlobalBan: false,
    mode: 'NORMAL',
    weights: cfg.riskWeights,
  });
  const withoutAvatar = evaluateJoinRisk({
    guildId: cfg.guildId,
    accountAgeDays: 3,
    isBot: false,
    hasAvatar: false,
    joinsInWindow: 1,
    maxJoinsThreshold: 6,
    similarUsernameCount: 0,
    repetitiveJoinCount: 0,
    hasActiveGlobalBan: false,
    mode: 'NORMAL',
    weights: cfg.riskWeights,
  });

  assert.equal(withAvatar.score, withoutAvatar.score);
  assert.equal(withAvatar.recommendedAction, withoutAvatar.recommendedAction);
});

test('MONITORING and ALERT_ONLY modes never execute punitive sanctions under raid waves', () => {
  const waveInput = {
    guildId: '910000000000000001',
    accountAgeDays: 0,
    isBot: false,
    joinsInWindow: 30,
    thresholdExceeded: true,
    similarUsernameCount: 10,
    repetitiveJoinCount: 4,
    underActiveRaidShield: true,
  };

  const monitoring = evaluateFastJoinMitigation({
    ...waveInput,
    config: makeConfig({ mode: 'MONITORING' }),
  });
  assert.equal(monitoring.shouldMitigate, false);
  assert.equal(monitoring.action, 'LOG_ONLY');

  const alertOnly = evaluateFastJoinMitigation({
    ...waveInput,
    config: makeConfig({ mode: 'ALERT_ONLY' }),
  });
  assert.equal(alertOnly.shouldMitigate, true);
  assert.equal(alertOnly.action, 'ALERT');
});

test('SanctionExecutor verifies permissions, retries transient errors, blocks permanent errors, and updates honest store counters', async () => {
  clearSanctionIdempotencyCache();
  const state = await aegisStore.getState();
  const gid = '910000000000000099';
  aegisStore.ensureGuildStructures(state, gid, 'Sanction Test Guild');
  const cfg = state.antiRaidConfigs[gid];
  cfg.attacksPrevented = 0;
  cfg.actionsAttempted = 0;
  cfg.actionsSucceeded = 0;
  cfg.actionsFailed = 0;
  cfg.actionsCancelled = 0;

  // 1. Missing BanMembers permission -> CANCELLED, attacksPrevented must NOT increment
  let banCalled = false;
  const missingPermRes = await executeVerifiedSanction({
    correlationId: 'cor_test_1',
    guildId: gid,
    requestedAction: 'BAN',
    reason: 'Raid burst',
    capability: makeCapability({
      botPermissions: {
        banMembers: false,
        kickMembers: true,
        moderateMembers: true,
        manageRoles: true,
        manageGuild: true,
      },
    }),
    hooks: {
      ban: async () => {
        banCalled = true;
      },
      kick: async () => {},
      timeout: async () => {},
    },
  });
  assert.equal(banCalled, false);
  assert.equal(missingPermRes.status, 'CANCELLED');
  assert.ok(missingPermRes.missingPermissions.includes('BanMembers'));
  aegisStore.recordSanctionOutcome(state, gid, missingPermRes);
  assert.equal(cfg.attacksPrevented, 0);
  assert.equal(cfg.actionsCancelled, 1);

  // 2. Permanent Discord 50013 error -> FAILED immediately without retry, attacksPrevented stays 0
  let permErrorAttempts = 0;
  const permanentErrRes = await executeVerifiedSanction({
    correlationId: 'cor_test_2',
    guildId: gid,
    requestedAction: 'KICK',
    reason: 'Coordinated wave',
    capability: makeCapability(),
    hooks: {
      ban: async () => {},
      kick: async () => {
        permErrorAttempts += 1;
        const err = new Error('Missing Permissions') as Error & { code?: number };
        err.code = 50013;
        throw err;
      },
      timeout: async () => {},
    },
  });
  assert.equal(permErrorAttempts, 1);
  assert.equal(permanentErrRes.status, 'FAILED');
  assert.equal(permanentErrRes.errorCode, 50013);
  aegisStore.recordSanctionOutcome(state, gid, permanentErrRes);
  assert.equal(cfg.attacksPrevented, 0);
  assert.equal(cfg.actionsFailed, 1);

  // 3. Transient Discord 429 rate limit -> retries cleanly and succeeds + increments attacksPrevented once; idempotency deduplicates repeat
  let transientAttempts = 0;
  const transientThenSuccess = await executeVerifiedSanction({
    correlationId: 'cor_test_3',
    idempotencyKey: 'dedup:gid:user1:BAN',
    guildId: gid,
    requestedAction: 'BAN',
    reason: 'Raid leader',
    retryDelayMs: 10,
    capability: makeCapability(),
    hooks: {
      ban: async () => {
        transientAttempts += 1;
        if (transientAttempts === 1) {
          const err = new Error('Rate limit hit') as Error & { status?: number; retryAfter?: number };
          err.status = 429;
          err.retryAfter = 0.01;
          throw err;
        }
      },
      kick: async () => {},
      timeout: async () => {},
    },
  });
  assert.equal(transientAttempts, 2);
  assert.equal(transientThenSuccess.status, 'SUCCESS');
  aegisStore.recordSanctionOutcome(state, gid, transientThenSuccess);
  assert.equal(cfg.attacksPrevented, 1);
  assert.equal(cfg.actionsSucceeded, 1);

  // Repeat with same idempotencyKey -> returns cached result without calling hook again
  const deduped = await executeVerifiedSanction({
    correlationId: 'cor_test_4',
    idempotencyKey: 'dedup:gid:user1:BAN',
    guildId: gid,
    requestedAction: 'BAN',
    reason: 'Raid leader',
    capability: makeCapability(),
    hooks: {
      ban: async () => {
        transientAttempts += 100;
      },
      kick: async () => {},
      timeout: async () => {},
    },
  });
  assert.equal(transientAttempts, 2);
  assert.equal(deduped.id, transientThenSuccess.id);
});

test('applyVersionedGuildConfig rejects stale versions and preserves multi-container sync integrity', async () => {
  const gid = '910000000000000077';
  const freshCfg = makeConfig({ guildId: gid, syncVersion: 5, enabled: true, mode: 'STRICT' });
  const appliedFresh = aegisStore.applyVersionedGuildConfig({
    guildId: gid,
    syncVersion: 5,
    configHash: 'hash_v5',
    antiRaidConfig: freshCfg,
    guildSettings: null,
    antiNukeConfig: null,
    securitySuite: null,
    updatedAt: '2026-11-22T12:00:00.000Z',
  });
  assert.equal(appliedFresh, true);

  const staleCfg = makeConfig({ guildId: gid, syncVersion: 3, enabled: false, mode: 'NORMAL' });
  const rejectedStale = aegisStore.applyVersionedGuildConfig({
    guildId: gid,
    syncVersion: 3,
    configHash: 'hash_v3',
    antiRaidConfig: staleCfg,
    guildSettings: null,
    antiNukeConfig: null,
    securitySuite: null,
    updatedAt: '2026-11-22T11:00:00.000Z',
  });
  assert.equal(rejectedStale, false);

  const hot = aegisStore.getHotStateSync();
  assert.equal(hot.antiRaidConfigs[gid].syncVersion, 5);
  assert.equal(hot.antiRaidConfigs[gid].enabled, true);
  assert.equal(hot.antiRaidConfigs[gid].mode, 'STRICT');
});

test('KeyedAsyncMutex + SlidingWindowTracker handles 150 concurrent joins with zero lost events or state corruption', async () => {
  const mutex = new KeyedAsyncMutex();
  const tracker = new SlidingWindowTracker();
  const shield = new RaidBurstShield();
  const gid = '910000000000000088';
  let processed = 0;
  let mitigated = 0;

  await Promise.all(
    Array.from({ length: 150 }, (_, idx) =>
      mutex.runExclusive(gid, async () => {
        const res = tracker.recordAndAnalyze(
          `guild:${gid}:joins`,
          `user_${idx}`,
          15,
          8,
          `raider_wave_${idx}`,
          1_700_000_100_000 + idx * 5
        );
        if (res.thresholdExceeded) {
          shield.markBurstDetected(gid, 15, 1_700_000_100_000 + idx * 5);
          mitigated += 1;
        }
        processed += 1;
      })
    )
  );

  assert.equal(processed, 150);
  assert.equal(mitigated, 150 - 7); // entries 8..150 trigger threshold=8
  assert.equal(tracker.getCount(`guild:${gid}:joins`, 15, 1_700_000_100_750), 150);
});

test('verifyMutationOrigin blocks cross-site requests without Bearer token and allows matching origin', () => {
  const evilReq = new NextRequest('http://localhost:3000/api/guilds/1/antiraid', {
    method: 'PATCH',
    headers: {
      host: 'localhost:3000',
      origin: 'https://evil-attacker.example',
      'sec-fetch-site': 'cross-site',
    },
  });
  const blocked = verifyMutationOrigin(evilReq);
  assert.ok(blocked !== null);
  assert.equal(blocked.status, 403);

  const validSameOriginReq = new NextRequest('http://localhost:3000/api/guilds/1/antiraid', {
    method: 'PATCH',
    headers: {
      host: 'localhost:3000',
      origin: 'http://localhost:3000',
      'sec-fetch-site': 'same-origin',
    },
  });
  assert.equal(verifyMutationOrigin(validSameOriginReq), null);
});

test('Empirical TypeScript Anti-Raid Engine Benchmark (10,000 sequential evaluations)', () => {
  const tracker = new SlidingWindowTracker();
  const cfg = makeConfig({ maxJoins: 10, timeWindowSeconds: 15 });
  const baseMs = 1_700_000_500_000;
  const latenciesMs: number[] = [];
  const heapBefore = process.memoryUsage().heapUsed;
  const tStartTotal = performance.now();

  for (let i = 0; i < 10_000; i++) {
    const t0 = performance.now();
    const burst = tracker.recordAndAnalyze(
      'bench:guild:1',
      `bench_u_${i % 2000}`,
      cfg.timeWindowSeconds,
      cfg.maxJoins,
      `wave_${i % 100}`,
      baseMs + i
    );
    evaluateFastJoinMitigation({
      guildId: cfg.guildId,
      targetUserId: `bench_u_${i % 2000}`,
      accountAgeDays: i % 10,
      isBot: false,
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

  const totalMs = performance.now() - tStartTotal;
  const heapAfter = process.memoryUsage().heapUsed;
  const sorted = latenciesMs.slice().sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
  const opsPerSec = Math.round((10_000 / totalMs) * 1000);
  const heapDeltaMb = Number(((heapAfter - heapBefore) / 1024 / 1024).toFixed(2));

  console.info(
    `[BENCHMARK_TS] iterations=10000 totalMs=${totalMs.toFixed(2)} opsPerSec=${opsPerSec} p50Ms=${p50.toFixed(4)} p95Ms=${p95.toFixed(4)} p99Ms=${p99.toFixed(4)} heapDeltaMb=${heapDeltaMb}`
  );

  assert.ok(totalMs < 2000, `Expected 10k evaluations under 2000ms, got ${totalMs.toFixed(2)}ms`);
  assert.ok(p99 < 1.0, `Expected p99 latency < 1.0ms, got ${p99.toFixed(4)}ms`);
});
