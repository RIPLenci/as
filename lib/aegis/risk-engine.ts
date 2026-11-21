import type {
  AntiRaidConfigRecord,
  AutoAction,
  ProtectionMode,
  RiskLevel,
  RiskSignalContribution,
  RiskWeightConfig,
} from './types';

export interface RiskEvaluationInput {
  accountAgeDays: number;
  isBot: boolean;
  hasAvatar: boolean;
  joinsInWindow: number;
  maxJoinsThreshold: number;
  similarUsernameCount: number;
  repetitiveJoinCount: number;
  hasActiveGlobalBan: boolean;
  mode: ProtectionMode;
  weights: RiskWeightConfig;
  rules?: AntiRaidConfigRecord['riskRules'];
}

export interface RiskEvaluationResult {
  score: number;
  level: RiskLevel;
  signals: RiskSignalContribution[];
  recommendedAction: AutoAction;
  safeguardApplied: string | null;
}

export const DEFAULT_RISK_WEIGHTS: RiskWeightConfig = {
  accountAge: 20,
  joinPattern: 20,
  eventVolume: 25,
  repetitiveBehavior: 15,
  globalBanMatch: 45,
};

export function scoreToRiskLevel(score: number): RiskLevel {
  if (score >= 75) return 'CRITICAL';
  if (score >= 50) return 'HIGH';
  if (score >= 25) return 'MODERATE';
  return 'LOW';
}

function getModeMultiplier(mode: ProtectionMode): number {
  switch (mode) {
    case 'EMERGENCY':
      return 1.25;
    case 'STRICT':
      return 1.12;
    case 'NORMAL':
    default:
      return 1.0;
  }
}

/**
 * Explainable Risk Engine (0 - 100).
 * Combines weighted telemetry signals and enforces safety invariants:
 * - Never triggers severe sanctions (KICK/BAN/QUARANTINE) based solely on young account age.
 * - Documents exact signal contributions for every evaluation.
 */
export function evaluateJoinRisk(input: RiskEvaluationInput): RiskEvaluationResult {
  const weights = input.weights;
  const totalConfiguredWeight = Math.max(
    1,
    weights.accountAge +
      weights.joinPattern +
      weights.eventVolume +
      weights.repetitiveBehavior +
      weights.globalBanMatch
  );

  // Normalize weights relative to standard 125-point baseline so custom weights stay bounded 0-100
  const norm = (weight: number, rawRatio: number) => {
    const clampedRatio = Math.max(0, Math.min(1, rawRatio));
    const maxContribution = (weight / Math.max(100, totalConfiguredWeight * 0.8)) * 100;
    return Number((clampedRatio * maxContribution).toFixed(2));
  };

  // 1. Account Age Signal (0..1)
  let ageRaw = 0;
  if (input.accountAgeDays < 1) ageRaw = 1.0;
  else if (input.accountAgeDays < 3) ageRaw = 0.8;
  else if (input.accountAgeDays < 7) ageRaw = 0.55;
  else if (input.accountAgeDays < 14) ageRaw = 0.3;
  else if (input.accountAgeDays < 30) ageRaw = 0.1;

  // 2. Join Pattern Signal (similar usernames / missing avatar / bot flag)
  let patternRaw = 0;
  if (input.similarUsernameCount >= 3) patternRaw += 0.65;
  else if (input.similarUsernameCount >= 2) patternRaw += 0.35;
  if (!input.hasAvatar) patternRaw += 0.2;
  if (input.isBot) patternRaw += 0.35;
  patternRaw = Math.min(1, patternRaw);

  // 3. Burst / Event Volume Signal
  const volumeRatio =
    input.maxJoinsThreshold > 0 ? input.joinsInWindow / input.maxJoinsThreshold : 0;
  let volumeRaw = 0;
  if (volumeRatio >= 1.5) volumeRaw = 1.0;
  else if (volumeRatio >= 1.0) volumeRaw = 0.85;
  else if (volumeRatio >= 0.75) volumeRaw = 0.55;
  else if (volumeRatio >= 0.5) volumeRaw = 0.25;

  // 4. Repetitive Behavior Signal
  let repetitiveRaw = 0;
  if (input.repetitiveJoinCount >= 4) repetitiveRaw = 1.0;
  else if (input.repetitiveJoinCount >= 2) repetitiveRaw = 0.6;
  else if (input.repetitiveJoinCount >= 1) repetitiveRaw = 0.25;

  // 5. Global Ban Match Signal
  const globalBanRaw = input.hasActiveGlobalBan ? 1.0 : 0;

  const signals: RiskSignalContribution[] = [
    {
      signal: 'accountAge',
      label: 'Account Age',
      rawScore: Number((ageRaw * 100).toFixed(1)),
      weight: weights.accountAge,
      weightedPoints: norm(weights.accountAge, ageRaw),
      evidence: `Account age: ${input.accountAgeDays} day(s)`,
    },
    {
      signal: 'joinPattern',
      label: 'Join Pattern',
      rawScore: Number((patternRaw * 100).toFixed(1)),
      weight: weights.joinPattern,
      weightedPoints: norm(weights.joinPattern, patternRaw),
      evidence: `Similar handles: ${input.similarUsernameCount}, Avatar: ${
        input.hasAvatar ? 'present' : 'default'
      }, Bot: ${input.isBot ? 'yes' : 'no'}`,
    },
    {
      signal: 'eventVolume',
      label: 'Burst Volume',
      rawScore: Number((volumeRaw * 100).toFixed(1)),
      weight: weights.eventVolume,
      weightedPoints: norm(weights.eventVolume, volumeRaw),
      evidence: `${input.joinsInWindow} joins vs ${input.maxJoinsThreshold} threshold`,
    },
    {
      signal: 'repetitiveBehavior',
      label: 'Repetitive Behavior',
      rawScore: Number((repetitiveRaw * 100).toFixed(1)),
      weight: weights.repetitiveBehavior,
      weightedPoints: norm(weights.repetitiveBehavior, repetitiveRaw),
      evidence: `${input.repetitiveJoinCount} repeated join/leave cycles`,
    },
    {
      signal: 'globalBanMatch',
      label: 'Global Ban Network',
      rawScore: Number((globalBanRaw * 100).toFixed(1)),
      weight: weights.globalBanMatch,
      weightedPoints: norm(weights.globalBanMatch, globalBanRaw),
      evidence: input.hasActiveGlobalBan
        ? 'Active sanction matched in Global Ban Network'
        : 'No active global sanctions',
    },
  ];

  const baseSum = signals.reduce((acc, s) => acc + s.weightedPoints, 0);
  const multiplied = baseSum * getModeMultiplier(input.mode);
  const finalScore = Math.max(0, Math.min(100, Math.round(multiplied)));
  const level = scoreToRiskLevel(finalScore);

  // Determine recommended action from configured rules or defaults
  let recommendedAction: AutoAction = 'LOG_ONLY';
  const matchingRule = input.rules?.find((r) => r.level === level);
  if (matchingRule) {
    recommendedAction = matchingRule.action;
  } else {
    if (level === 'MODERATE') recommendedAction = 'ALERT';
    else if (level === 'HIGH') recommendedAction = 'QUARANTINE';
    else if (level === 'CRITICAL') recommendedAction = 'QUARANTINE';
  }

  // Safeguard invariant: Never apply severe sanctions (KICK, BAN, QUARANTINE)
  // if account age is the ONLY non-zero contributing signal.
  let safeguardApplied: string | null = null;
  const nonAgeSignalsActive =
    patternRaw > 0 || volumeRaw > 0 || repetitiveRaw > 0 || globalBanRaw > 0;

  if (
    !nonAgeSignalsActive &&
    (recommendedAction === 'BAN' ||
      recommendedAction === 'KICK' ||
      recommendedAction === 'QUARANTINE')
  ) {
    recommendedAction = 'ALERT';
    safeguardApplied =
      'Safeguard enforced: Severe sanction downgraded to ALERT because account age was the sole risk signal.';
  }

  // Additional safeguard: KICK/BAN require corroborating high-confidence signals (burst or global ban)
  if (
    (recommendedAction === 'BAN' || recommendedAction === 'KICK') &&
    !input.hasActiveGlobalBan &&
    volumeRaw < 0.85 &&
    repetitiveRaw < 0.6
  ) {
    recommendedAction = 'QUARANTINE';
    safeguardApplied =
      'Safeguard enforced: Expulsion/ban downgraded to QUARANTINE pending corroborating burst or global sanction evidence.';
  }

  return {
    score: finalScore,
    level,
    signals,
    recommendedAction,
    safeguardApplied,
  };
}
