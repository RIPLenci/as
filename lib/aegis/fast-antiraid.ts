import { DEFAULT_RISK_WEIGHTS, evaluateJoinRisk, type RiskEvaluationResult } from './risk-engine';
import type { AntiRaidConfigRecord, AutoAction } from './types';

export interface ActiveRaidShieldState {
  guildId: string;
  active: boolean;
  activatedAt: number;
  expiresAt: number;
  mitigatedInWave: number;
}

/**
 * Ultra-fast L1 in-memory Raid Shield Circuit Breaker.
 * Zero database or disk I/O: tracks active raid waves per guild so incoming raiders
 * during an active raid burst are mitigated immediately in O(1).
 */
export class RaidBurstShield {
  private readonly activeRaids = new Map<string, ActiveRaidShieldState>();

  markBurstDetected(
    guildId: string,
    windowSeconds: number,
    nowMs = Date.now()
  ): ActiveRaidShieldState {
    if (this.activeRaids.size > 2000) {
      for (const [gid, st] of this.activeRaids.entries()) {
        if (st.expiresAt <= nowMs) this.activeRaids.delete(gid);
      }
    }

    const cooldownMs = Math.max(15, Math.min(windowSeconds * 2, 120)) * 1000;
    const existing = this.activeRaids.get(guildId);
    if (existing && existing.expiresAt > nowMs) {
      existing.expiresAt = nowMs + cooldownMs;
      existing.mitigatedInWave += 1;
      return existing;
    }

    const next: ActiveRaidShieldState = {
      guildId,
      active: true,
      activatedAt: nowMs,
      expiresAt: nowMs + cooldownMs,
      mitigatedInWave: 1,
    };
    this.activeRaids.set(guildId, next);
    return next;
  }

  isUnderActiveRaid(guildId: string, nowMs = Date.now()): boolean {
    const entry = this.activeRaids.get(guildId);
    if (!entry) return false;
    if (entry.expiresAt <= nowMs) {
      this.activeRaids.delete(guildId);
      return false;
    }
    return true;
  }

  getState(guildId: string, nowMs = Date.now()): ActiveRaidShieldState | null {
    if (!this.isUnderActiveRaid(guildId, nowMs)) return null;
    return this.activeRaids.get(guildId) ?? null;
  }

  clear(guildId: string): void {
    this.activeRaids.delete(guildId);
  }
}

export interface FastJoinInput {
  guildId: string;
  targetUserId?: string;
  accountAgeDays: number;
  isBot: boolean;
  hasAvatar?: boolean | null;
  joinsInWindow: number;
  thresholdExceeded: boolean;
  similarUsernameCount: number;
  repetitiveJoinCount: number;
  underActiveRaidShield: boolean;
  concentrationScore?: number;
  growthRateRatio?: number;
  config: AntiRaidConfigRecord;
}

export interface FastJoinDecision {
  shouldMitigate: boolean;
  action: AutoAction;
  evaluation: RiskEvaluationResult;
  escalatedByRaidShield: boolean;
}

/**
 * Evaluates an incoming guild member in sub-millisecond pure memory.
 * - Immediately exits if master Anti-Raid is disabled (`config.enabled === false`).
 * - Honors individual detector switches (`burstDetection`, `joinPatternDetection`,
 *   `suspiciousAccountDetection`, `botJoinDetection`).
 * - Never penalizes missing/default avatars.
 * - Preserves non-punitive behavior in MONITORING and ALERT_ONLY modes.
 */
export function evaluateFastJoinMitigation(input: FastJoinInput): FastJoinDecision {
  const { config } = input;

  if (!config.enabled) {
    const disabledEval = evaluateJoinRisk({
      guildId: input.guildId,
      targetUserId: input.targetUserId,
      accountAgeDays: input.accountAgeDays,
      isBot: input.isBot,
      hasAvatar: input.hasAvatar,
      joinsInWindow: 0,
      maxJoinsThreshold: config.maxJoins,
      similarUsernameCount: 0,
      repetitiveJoinCount: 0,
      hasActiveGlobalBan: false,
      mode: config.mode,
      weights: config.riskWeights ?? DEFAULT_RISK_WEIGHTS,
      rules: config.riskRules,
      enabledDetectors: {
        suspiciousAccountDetection: false,
        botJoinDetection: false,
        joinPatternDetection: false,
        burstDetection: false,
      },
    });
    return {
      shouldMitigate: false,
      action: 'LOG_ONLY',
      evaluation: disabledEval,
      escalatedByRaidShield: false,
    };
  }

  const effectiveBurstActive = Boolean(config.burstDetection);
  const effectiveThresholdExceeded = effectiveBurstActive && input.thresholdExceeded;
  const effectiveShield = effectiveBurstActive && input.underActiveRaidShield;
  const effectiveJoins = effectiveShield
    ? Math.max(input.joinsInWindow, config.maxJoins)
    : input.joinsInWindow;

  const evaluation = evaluateJoinRisk({
    guildId: input.guildId,
    targetUserId: input.targetUserId,
    accountAgeDays: input.accountAgeDays,
    isBot: input.isBot,
    hasAvatar: input.hasAvatar,
    joinsInWindow: effectiveJoins,
    maxJoinsThreshold: config.maxJoins,
    similarUsernameCount: input.similarUsernameCount,
    repetitiveJoinCount: input.repetitiveJoinCount,
    hasActiveGlobalBan: false,
    mode: config.mode,
    weights: config.riskWeights ?? DEFAULT_RISK_WEIGHTS,
    rules: config.riskRules,
    concentrationScore: input.concentrationScore,
    growthRateRatio: input.growthRateRatio,
    enabledDetectors: {
      suspiciousAccountDetection: config.suspiciousAccountDetection,
      botJoinDetection: config.botJoinDetection,
      joinPatternDetection: config.joinPatternDetection,
      burstDetection: config.burstDetection,
    },
  });

  if (config.mode === 'MONITORING') {
    return {
      shouldMitigate: false,
      action: 'LOG_ONLY',
      evaluation,
      escalatedByRaidShield: false,
    };
  }

  if (config.mode === 'ALERT_ONLY') {
    const alertTriggered = effectiveThresholdExceeded || evaluation.score >= config.riskThreshold;
    return {
      shouldMitigate: alertTriggered,
      action: alertTriggered ? 'ALERT' : 'LOG_ONLY',
      evaluation,
      escalatedByRaidShield: false,
    };
  }

  const patternSignals =
    config.joinPatternDetection &&
    (input.similarUsernameCount >= 2 || input.repetitiveJoinCount >= 1);
  const botSignal = config.botJoinDetection && input.isBot;

  const corroboratingSignals =
    effectiveThresholdExceeded || effectiveShield || patternSignals || botSignal;

  const riskMet = evaluation.score >= config.riskThreshold;
  const ageBelowMinDuringBurst =
    config.suspiciousAccountDetection &&
    corroboratingSignals &&
    config.minAccountAgeDays > 0 &&
    input.accountAgeDays < config.minAccountAgeDays;

  const shouldMitigate =
    effectiveThresholdExceeded || riskMet || ageBelowMinDuringBurst;

  let action: AutoAction = evaluation.recommendedAction;
  const escalatedByRaidShield =
    effectiveShield &&
    ((config.suspiciousAccountDetection &&
      input.accountAgeDays < Math.max(7, config.minAccountAgeDays)) ||
      (config.joinPatternDetection && input.similarUsernameCount >= 2) ||
      (config.botJoinDetection && input.isBot) ||
      effectiveThresholdExceeded);

  if (shouldMitigate && escalatedByRaidShield && (action === 'LOG_ONLY' || action === 'ALERT')) {
    action = config.mode === 'EMERGENCY' ? 'BAN' : 'QUARANTINE';
  }

  return {
    shouldMitigate,
    action,
    evaluation,
    escalatedByRaidShield,
  };
}
