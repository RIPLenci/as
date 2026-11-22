import type {
  AntiRaidConfigRecord,
  AutoAction,
  ProtectionMode,
  RiskLevel,
  RiskSignalContribution,
  RiskWeightConfig,
} from './types';

export interface EnabledDetectorsInput {
  suspiciousAccountDetection?: boolean;
  botJoinDetection?: boolean;
  joinPatternDetection?: boolean;
  burstDetection?: boolean;
}

export interface RiskEvaluationInput {
  guildId?: string;
  targetUserId?: string;
  accountAgeDays: number;
  isBot: boolean;
  /** Optional informational flag; missing/default Discord avatars NEVER add risk penalties. */
  hasAvatar?: boolean | null;
  joinsInWindow: number;
  maxJoinsThreshold: number;
  similarUsernameCount: number;
  repetitiveJoinCount: number;
  hasActiveGlobalBan: boolean;
  mode: ProtectionMode;
  weights: RiskWeightConfig;
  rules?: AntiRaidConfigRecord['riskRules'];
  enabledDetectors?: EnabledDetectorsInput;
  concentrationScore?: number;
  growthRateRatio?: number;
}

export interface RiskEvaluationResult {
  guildId?: string;
  targetUserId?: string;
  score: number;
  level: RiskLevel;
  signals: RiskSignalContribution[];
  recommendedAction: AutoAction;
  safeguardApplied: string | null;
  explanation: string;
  evaluatedAt: string;
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
    case 'MONITORING':
    case 'ALERT_ONLY':
    case 'NORMAL':
    default:
      return 1.0;
  }
}

/**
 * Explainable Risk Engine (0 - 100).
 * - Honors every individual detector flag cleanly (disabled detectors contribute 0).
 * - Never penalizes missing/default avatars (unknown/default profile != malicious).
 * - Never triggers severe sanctions based solely on young account age.
 * - Enforces non-punitive caps in MONITORING ('LOG_ONLY') and ALERT_ONLY ('ALERT') modes.
 */
export function evaluateJoinRisk(input: RiskEvaluationInput): RiskEvaluationResult {
  const weights = input.weights;
  const det = {
    suspiciousAccount: input.enabledDetectors?.suspiciousAccountDetection ?? true,
    botJoin: input.enabledDetectors?.botJoinDetection ?? true,
    joinPattern: input.enabledDetectors?.joinPatternDetection ?? true,
    burst: input.enabledDetectors?.burstDetection ?? true,
  };

  const totalConfiguredWeight = Math.max(
    1,
    weights.accountAge +
      weights.joinPattern +
      weights.eventVolume +
      weights.repetitiveBehavior +
      weights.globalBanMatch
  );

  const norm = (weight: number, rawRatio: number) => {
    const clampedRatio = Math.max(0, Math.min(1, rawRatio));
    const maxContribution = (weight / Math.max(100, totalConfiguredWeight * 0.8)) * 100;
    return Number((clampedRatio * maxContribution).toFixed(2));
  };

  // 1. Account Age Signal (honors suspiciousAccountDetection)
  let ageRaw = 0;
  if (det.suspiciousAccount) {
    if (input.accountAgeDays < 1) ageRaw = 1.0;
    else if (input.accountAgeDays < 3) ageRaw = 0.8;
    else if (input.accountAgeDays < 7) ageRaw = 0.55;
    else if (input.accountAgeDays < 14) ageRaw = 0.3;
    else if (input.accountAgeDays < 30) ageRaw = 0.1;
  }

  // 2. Join Pattern Signal (similar usernames / unverified bot flag; NO missing-avatar penalty)
  let patternRaw = 0;
  if (det.joinPattern) {
    if (input.similarUsernameCount >= 3) patternRaw += 0.65;
    else if (input.similarUsernameCount >= 2) patternRaw += 0.35;
    if ((input.concentrationScore ?? 0) >= 0.7 && input.joinsInWindow >= 3) {
      patternRaw += 0.25;
    }
  }
  if (det.botJoin && input.isBot) {
    patternRaw += 0.4;
  }
  patternRaw = Math.min(1, patternRaw);

  // 3. Burst / Event Volume Signal (honors burstDetection)
  const volumeRatio =
    det.burst && input.maxJoinsThreshold > 0 ? input.joinsInWindow / input.maxJoinsThreshold : 0;
  let volumeRaw = 0;
  if (det.burst) {
    if (volumeRatio >= 1.5) volumeRaw = 1.0;
    else if (volumeRatio >= 1.0) volumeRaw = 0.85;
    else if (volumeRatio >= 0.75) volumeRaw = 0.55;
    else if (volumeRatio >= 0.5) volumeRaw = 0.25;
    if ((input.growthRateRatio ?? 1) >= 3 && volumeRatio >= 0.5) {
      volumeRaw = Math.min(1, volumeRaw + 0.15);
    }
  }

  // 4. Repetitive Behavior Signal (honors joinPatternDetection)
  let repetitiveRaw = 0;
  if (det.joinPattern) {
    if (input.repetitiveJoinCount >= 4) repetitiveRaw = 1.0;
    else if (input.repetitiveJoinCount >= 2) repetitiveRaw = 0.6;
    else if (input.repetitiveJoinCount >= 1) repetitiveRaw = 0.25;
  }

  // 5. Global Ban Match Signal
  const globalBanRaw = input.hasActiveGlobalBan ? 1.0 : 0;

  const avatarStateLabel =
    input.hasAvatar === true
      ? 'custom'
      : input.hasAvatar === false
      ? 'default_neutral'
      : 'unknown_neutral';

  const signals: RiskSignalContribution[] = [
    {
      signal: 'accountAge',
      label: 'Account Age',
      rawScore: Number((ageRaw * 100).toFixed(1)),
      weight: det.suspiciousAccount ? weights.accountAge : 0,
      weightedPoints: det.suspiciousAccount ? norm(weights.accountAge, ageRaw) : 0,
      evidence: det.suspiciousAccount
        ? `Account age: ${input.accountAgeDays} day(s)`
        : 'Detector disabled (0 pts)',
    },
    {
      signal: 'joinPattern',
      label: 'Join Pattern',
      rawScore: Number((patternRaw * 100).toFixed(1)),
      weight: det.joinPattern || det.botJoin ? weights.joinPattern : 0,
      weightedPoints:
        det.joinPattern || det.botJoin ? norm(weights.joinPattern, patternRaw) : 0,
      evidence:
        !det.joinPattern && !det.botJoin
          ? 'Detector disabled (0 pts)'
          : `Similar handles: ${det.joinPattern ? input.similarUsernameCount : 'off'}, Avatar: ${avatarStateLabel}, Bot: ${det.botJoin ? (input.isBot ? 'yes' : 'no') : 'off'}`,
    },
    {
      signal: 'eventVolume',
      label: 'Burst Volume',
      rawScore: Number((volumeRaw * 100).toFixed(1)),
      weight: det.burst ? weights.eventVolume : 0,
      weightedPoints: det.burst ? norm(weights.eventVolume, volumeRaw) : 0,
      evidence: det.burst
        ? `${input.joinsInWindow} joins vs ${input.maxJoinsThreshold} threshold`
        : 'Detector disabled (0 pts)',
    },
    {
      signal: 'repetitiveBehavior',
      label: 'Repetitive Behavior',
      rawScore: Number((repetitiveRaw * 100).toFixed(1)),
      weight: det.joinPattern ? weights.repetitiveBehavior : 0,
      weightedPoints: det.joinPattern ? norm(weights.repetitiveBehavior, repetitiveRaw) : 0,
      evidence: det.joinPattern
        ? `${input.repetitiveJoinCount} repeated join/leave cycles`
        : 'Detector disabled (0 pts)',
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

  let recommendedAction: AutoAction = 'LOG_ONLY';
  const matchingRule = input.rules?.find((r) => r.level === level);
  if (matchingRule) {
    recommendedAction = matchingRule.action;
  } else {
    if (level === 'MODERATE') recommendedAction = 'ALERT';
    else if (level === 'HIGH' || level === 'CRITICAL') recommendedAction = 'QUARANTINE';
  }

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

  if (input.mode === 'MONITORING' && recommendedAction !== 'LOG_ONLY') {
    recommendedAction = 'LOG_ONLY';
    safeguardApplied = 'Modo OBSERVACIÓN (Monitoring): evento registrado sin aplicar sanciones.';
  } else if (
    input.mode === 'ALERT_ONLY' &&
    recommendedAction !== 'LOG_ONLY' &&
    recommendedAction !== 'ALERT'
  ) {
    recommendedAction = 'ALERT';
    safeguardApplied = 'Modo ALERTA (Alert-Only): notificación al equipo sin expulsión automática.';
  }

  const activeDrivers = signals
    .filter((s) => s.weightedPoints > 0)
    .map((s) => `${s.label} (+${s.weightedPoints})`)
    .join(', ');

  const explanation = activeDrivers
    ? `Score ${finalScore}/100 (${level}, mode=${input.mode}): ${activeDrivers}. Action=${recommendedAction}.`
    : `Score ${finalScore}/100 (${level}, mode=${input.mode}): sin señales activas de riesgo.`;

  return {
    guildId: input.guildId,
    targetUserId: input.targetUserId,
    score: finalScore,
    level,
    signals,
    recommendedAction,
    safeguardApplied,
    explanation,
    evaluatedAt: new Date().toISOString(),
  };
}
