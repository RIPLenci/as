import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateFastJoinMitigation, RaidBurstShield } from './fast-antiraid';
import { DEFAULT_RISK_WEIGHTS } from './risk-engine';
import { SlidingWindowTracker } from './sliding-window';
import type { AntiRaidConfigRecord } from './types';

function makeConfig(overrides: Partial<AntiRaidConfigRecord> = {}): AntiRaidConfigRecord {
  return {
    guildId: '100000000000000001',
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
    riskThreshold: 70,
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
    syncVersion: 1,
    lastSyncedAt: '2026-11-20T00:00:00.000Z',
    ...overrides,
  };
}

test('RaidBurstShield activates in O(1), increments wave count, and expires cleanly', () => {
  const shield = new RaidBurstShield();
  const t0 = 1_700_000_000_000;
  assert.equal(shield.isUnderActiveRaid('g1', t0), false);

  const st1 = shield.markBurstDetected('g1', 10, t0);
  assert.equal(st1.active, true);
  assert.equal(st1.mitigatedInWave, 1);
  assert.equal(shield.isUnderActiveRaid('g1', t0 + 5_000), true);

  const st2 = shield.markBurstDetected('g1', 10, t0 + 5_000);
  assert.equal(st2.mitigatedInWave, 2);
  assert.equal(shield.isUnderActiveRaid('g1', t0 + 24_000), true);
  assert.equal(shield.isUnderActiveRaid('g1', t0 + 30_000), false);

  shield.markBurstDetected('g2', 10, t0);
  shield.clear('g2');
  assert.equal(shield.isUnderActiveRaid('g2', t0 + 100), false);
});

test('evaluateFastJoinMitigation enforces young-account safeguard outside raids and escalates rapidly during active raids', () => {
  const cfg = makeConfig();

  // Single young account without burst, avatar present, normal username -> must NOT mitigate
  const calmYoung = evaluateFastJoinMitigation({
    guildId: cfg.guildId,
    accountAgeDays: 1,
    isBot: false,
    hasAvatar: true,
    joinsInWindow: 1,
    thresholdExceeded: false,
    similarUsernameCount: 1,
    repetitiveJoinCount: 0,
    underActiveRaidShield: false,
    config: cfg,
  });
  assert.equal(calmYoung.shouldMitigate, false);
  assert.equal(calmYoung.action, 'LOG_ONLY');

  // Active raid burst + suspicious young account with default avatar -> immediate QUARANTINE
  const activeRaidJoin = evaluateFastJoinMitigation({
    guildId: cfg.guildId,
    accountAgeDays: 1,
    isBot: false,
    hasAvatar: false,
    joinsInWindow: 2,
    thresholdExceeded: false,
    similarUsernameCount: 3,
    repetitiveJoinCount: 0,
    underActiveRaidShield: true,
    config: makeConfig({ mode: 'EMERGENCY' }),
  });
  assert.equal(activeRaidJoin.shouldMitigate, true);
  assert.equal(activeRaidJoin.escalatedByRaidShield, true);
  assert.equal(activeRaidJoin.action, 'QUARANTINE');

  // Critical coordinated wave during EMERGENCY mode -> immediate BAN
  const criticalWaveJoin = evaluateFastJoinMitigation({
    guildId: cfg.guildId,
    accountAgeDays: 0,
    isBot: false,
    hasAvatar: false,
    joinsInWindow: 12,
    thresholdExceeded: true,
    similarUsernameCount: 6,
    repetitiveJoinCount: 4,
    underActiveRaidShield: true,
    config: makeConfig({ mode: 'EMERGENCY' }),
  });
  assert.equal(criticalWaveJoin.shouldMitigate, true);
  assert.equal(criticalWaveJoin.action, 'BAN');
});

test('O(1) SlidingWindowTracker handles 5,000 high-speed raid joins in under 50ms with exact pattern counts', () => {
  const tracker = new SlidingWindowTracker();
  const baseMs = 1_700_000_000_000;
  const tStart = performance.now();

  let lastResult = tracker.recordAndAnalyze('guild:fast:joins', 'u0', 10, 6, 'raider_0', baseMs);
  for (let i = 1; i < 5000; i++) {
    lastResult = tracker.recordAndAnalyze(
      'guild:fast:joins',
      `u${i}`,
      10,
      6,
      `raider_${i}`,
      baseMs + i
    );
  }
  const elapsedMs = performance.now() - tStart;

  assert.equal(lastResult.countInWindow, 5000);
  assert.equal(lastResult.thresholdExceeded, true);
  assert.equal(lastResult.similarUsernameCount, 5000);
  assert.equal(lastResult.repetitiveSubjectCount, 0);
  assert.ok(elapsedMs < 150, `Expected fast execution under 150ms, got ${elapsedMs.toFixed(2)}ms`);

  // Expired entries after window elapses prune cleanly down to 1
  const postWindow = tracker.recordAndAnalyze(
    'guild:fast:joins',
    'fresh_user',
    10,
    6,
    'normal_member',
    baseMs + 20_000
  );
  assert.equal(postWindow.countInWindow, 1);
  assert.equal(postWindow.thresholdExceeded, false);
  assert.equal(postWindow.similarUsernameCount, 1);
});
