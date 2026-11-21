import type {
  GuildBackupSettingsRecord,
  GuildPlanRecord,
  GuildPlanQuotas,
  LanguageCode,
  PlanTier,
  UserPremiumSubscription,
} from './types';

export interface PlanDefinition {
  tier: PlanTier;
  nameEs: string;
  nameEn: string;
  priceUsdLabel: string;
  taglineEs: string;
  taglineEn: string;
  quotas: GuildPlanQuotas;
  prosEs: string[];
  consEs: string[];
  prosEn: string[];
  consEn: string[];
}

export const PLAN_CATALOG: Record<PlanTier, PlanDefinition> = {
  FREE: {
    tier: 'FREE',
    nameEs: 'Plan Gratuito',
    nameEn: 'Free Plan',
    priceUsdLabel: '0 USD',
    taglineEs: 'Protección esencial para comunidades que comienzan en Discord.',
    taglineEn: 'Essential defense for emerging Discord communities.',
    quotas: buildPlanQuotas('FREE'),
    prosEs: [
      'Antiraid base, Anti-Nuke y Cuarentena sin costo',
      '1 copia de seguridad automática cada 7 días',
      'Hasta 10 usuarios y 3 canales en Whitelist',
      'Logs de seguridad y verificación por botón',
    ],
    consEs: [
      '0 servidores activables con funciones Premium',
      'Límite máximo de 1 copia de seguridad por servidor',
      'Sin Anti-Mass Mute ni reglas avanzadas de mutación',
      'Sin verificación Strict 2FA ni dominios permitidos en Anti-Links',
    ],
    prosEn: [
      'Core Anti-Raid, Anti-Nuke, and Quarantine at $0',
      '1 automatic backup every 7 days',
      'Up to 10 Whitelist users and 3 channels',
      'Security logs and button verification',
    ],
    consEn: [
      '0 servers with Premium capabilities unlocked',
      'Maximum of 1 backup snapshot per server',
      'No Anti-Mass Mute or advanced mutation limits',
      'No Strict 2FA verification or Anti-Links domain whitelist',
    ],
  },
  ORO: {
    tier: 'ORO',
    nameEs: 'Plan Oro',
    nameEn: 'Gold Plan',
    priceUsdLabel: '5,99 USD',
    taglineEs: 'Blindaje avanzado para tu servidor principal con controles automatizados.',
    taglineEn: 'Advanced defense for your primary server with automated enforcement.',
    quotas: buildPlanQuotas('ORO'),
    prosEs: [
      'Activa beneficios Premium en hasta 1 servidor',
      'Copias de seguridad automáticas cada 3 días (máx. 5 copias)',
      'Desbloquea Anti-Mass Mute, límites Anti-Flood/Scam personalizados y dominios Anti-Links (15)',
      'Verificación Strict 2FA y expulsión automática de cuentas no verificadas',
      'Hasta 50 usuarios en Whitelist y 25 usuarios en Permisos del Bot',
    ],
    consEs: [
      'Limitado a 1 servidor activo con Premium simultáneamente',
      'Capacidad máxima de 5 respaldos antes de requerir liberación',
    ],
    prosEn: [
      'Activate Premium features on up to 1 server',
      'Automatic backups every 3 days (max 5 snapshots)',
      'Unlocks Anti-Mass Mute, custom Anti-Flood/Scam timers, and Anti-Links domains (15)',
      'Strict 2FA verification and auto-kick for unverified joins',
      'Up to 50 Whitelist users and 25 Bot Permission grants',
    ],
    consEn: [
      'Limited to 1 active Premium server simultaneously',
      'Maximum capacity of 5 backups per server',
    ],
  },
  DIAMANTE: {
    tier: 'DIAMANTE',
    nameEs: 'Plan Diamante',
    nameEn: 'Diamond Plan',
    priceUsdLabel: '9,99 USD',
    taglineEs: 'Potencia total multi-servidor con respaldos diarios y cuotas máximas.',
    taglineEn: 'Full multi-server protection with daily auto-backups and top-tier quotas.',
    quotas: buildPlanQuotas('DIAMANTE'),
    prosEs: [
      'Activa beneficios Premium en hasta 5 servidores simultáneamente',
      'Copias de seguridad automáticas diarias cada 1 día (máx. 10 copias)',
      'Todos los módulos Anti-Raid avanzados, Anti-Mass Mute y Strict 2FA desbloqueados',
      'Cuota máxima: 250 usuarios y 100 canales en Whitelist, 100 usuarios y 50 roles en Permisos',
      'Hasta 50 dominios autorizados en Anti-Links y prioridad máxima del Motor de Riesgo',
    ],
    consEs: [
      'Requiere renovación o canje de código al vencer el tiempo acumulado',
    ],
    prosEn: [
      'Activate Premium features on up to 5 servers simultaneously',
      'Daily automatic backups every 1 day (max 10 snapshots)',
      'All advanced Anti-Raid rules, Anti-Mass Mute, and Strict 2FA unlocked',
      'Maximum quotas: 250 Whitelist users, 100 channels, 100 Bot Perm users, 50 roles',
      'Up to 50 Anti-Links allowed domains and priority Risk Engine telemetry',
    ],
    consEn: [
      'Requires renewal or code redemption once accumulated time expires',
    ],
  },
};

export function normalizePlanTier(raw: string | null | undefined): PlanTier {
  if (raw === 'DIAMANTE') return 'DIAMANTE';
  if (raw === 'ORO' || raw === 'PREMIUM') return 'ORO';
  return 'FREE';
}

export function isPaidTier(tier: PlanTier): boolean {
  return tier === 'ORO' || tier === 'DIAMANTE';
}

export function buildPlanQuotas(tier: PlanTier | 'PREMIUM'): GuildPlanQuotas {
  const normalized = normalizePlanTier(tier);
  if (normalized === 'DIAMANTE') {
    return {
      maxWhitelistUsers: 250,
      maxWhitelistChannels: 100,
      maxBotPermUsers: 100,
      maxBotPermRoles: 50,
      maxBackups: 10,
      autoBackupDays: 1,
      maxPremiumServers: 5,
      maxAllowedDomains: 50,
    };
  }
  if (normalized === 'ORO') {
    return {
      maxWhitelistUsers: 50,
      maxWhitelistChannels: 20,
      maxBotPermUsers: 25,
      maxBotPermRoles: 12,
      maxBackups: 5,
      autoBackupDays: 3,
      maxPremiumServers: 1,
      maxAllowedDomains: 15,
    };
  }
  return {
    maxWhitelistUsers: 10,
    maxWhitelistChannels: 3,
    maxBotPermUsers: 5,
    maxBotPermRoles: 3,
    maxBackups: 1,
    autoBackupDays: 7,
    maxPremiumServers: 0,
    maxAllowedDomains: 0,
  };
}

export function getPlanDisplayName(tier: PlanTier, lang: LanguageCode = 'es'): string {
  const def = PLAN_CATALOG[normalizePlanTier(tier)];
  return lang === 'es' ? def.nameEs : def.nameEn;
}

const UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  y: 365 * 86_400_000,
};

const MAX_DURATION_MS = 10 * 365 * 86_400_000;

/**
 * Parses duration tokens such as:
 * - "1s" = 1 second
 * - "1m" = 1 minute
 * - "1h" = 1 hour
 * - "1d" = 1 day
 * - "1y" = 1 year (365d)
 * Supports single or compound tokens like "30d", "1y", "1d12h", "2h30m15s".
 */
export function parseDurationString(rawInput: string):
  | { ok: true; durationMs: number; normalizedLabel: string }
  | { ok: false; error: string } {
  const cleaned = rawInput.trim().toLowerCase().replace(/\s+/g, '');
  if (!cleaned) {
    return {
      ok: false,
      error: 'Debes indicar un tiempo válido (ej: 30s, 15m, 12h, 30d, 1y).',
    };
  }

  const fullMatch = /^(\d+[smhdy])+$/i.test(cleaned);
  if (!fullMatch) {
    return {
      ok: false,
      error:
        'Formato inválido. Usa unidades s, m, h, d o y (1s = 1 segundo, 1m = 1 minuto, 1h = 1 hora, 1d = 1 día, 1y = 1 año).',
    };
  }

  let totalMs = 0;
  const parts: string[] = [];
  const tokenRegex = /(\d+)([smhdy])/gi;
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(cleaned)) !== null) {
    const qty = Number.parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    if (!Number.isFinite(qty) || qty <= 0) {
      return {
        ok: false,
        error: 'La cantidad de tiempo debe ser mayor a 0.',
      };
    }
    totalMs += qty * UNIT_MS[unit];
    parts.push(`${qty}${unit}`);
  }

  if (totalMs < 1_000 || totalMs > MAX_DURATION_MS) {
    return {
      ok: false,
      error: 'El tiempo debe estar entre 1 segundo (1s) y 10 años (10y).',
    };
  }

  return {
    ok: true,
    durationMs: totalMs,
    normalizedLabel: parts.join(' '),
  };
}

export function formatDurationHuman(ms: number, lang: LanguageCode = 'es'): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return lang === 'es' ? 'Expirado' : 'Expired';
  }
  const totalSec = Math.max(1, Math.floor(ms / 1000));
  const days = Math.floor(totalSec / 86_400);
  const hours = Math.floor((totalSec % 86_400) / 3_600);
  const mins = Math.floor((totalSec % 3_600) / 60);
  const secs = totalSec % 60;

  const chunks: string[] = [];
  if (days > 0) chunks.push(`${days}d`);
  if (hours > 0) chunks.push(`${hours}h`);
  if (mins > 0) chunks.push(`${mins}m`);
  if (secs > 0 && days === 0) chunks.push(`${secs}s`);
  return chunks.join(' ') || '1s';
}

export function formatDurationPrecise(ms: number, lang: LanguageCode = 'es'): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return lang === 'es' ? '0 días, 0 horas, 0 minutos, 0 segundos (Expirado)' : '0 days, 0 hours, 0 minutes, 0 seconds (Expired)';
  }
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86_400);
  const hours = Math.floor((totalSec % 86_400) / 3_600);
  const mins = Math.floor((totalSec % 3_600) / 60);
  const secs = totalSec % 60;

  if (lang === 'es') {
    return `${days} ${days === 1 ? 'día' : 'días'}, ${hours} ${hours === 1 ? 'hora' : 'horas'}, ${mins} ${mins === 1 ? 'minuto' : 'minutos'}, ${secs} ${secs === 1 ? 'segundo' : 'segundos'}`;
  }
  return `${days} ${days === 1 ? 'day' : 'days'}, ${hours} ${hours === 1 ? 'hour' : 'hours'}, ${mins} ${mins === 1 ? 'minute' : 'minutes'}, ${secs} ${secs === 1 ? 'second' : 'seconds'}`;
}

export function formatExactDateTime(iso: string | null | undefined, lang: LanguageCode = 'es'): string {
  if (!iso) return lang === 'es' ? 'No disponible' : 'N/A';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return lang === 'es' ? 'Fecha inválida' : 'Invalid date';
  return d.toLocaleString(lang === 'es' ? 'es-ES' : 'en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function isSubscriptionActive(
  sub: Pick<UserPremiumSubscription, 'tier' | 'expiresAt'> | null | undefined,
  nowMs = Date.now()
): boolean {
  if (!sub || !isPaidTier(normalizePlanTier(sub.tier))) return false;
  if (!sub.expiresAt) return false;
  return new Date(sub.expiresAt).getTime() > nowMs;
}

/**
 * Grants or stacks Premium time onto a user subscription.
 * If the user already has active Premium (expiresAt > now), the new duration is ACCUMULATED.
 * If upgrading from ORO to DIAMANTE, the tier becomes DIAMANTE cleanly.
 */
export function applyAccumulatedPremium(
  existing: UserPremiumSubscription | undefined | null,
  params: {
    discordId: string;
    username: string;
    tier: 'ORO' | 'DIAMANTE';
    durationMs: number;
    reason?: string;
    source: UserPremiumSubscription['source'];
    updatedBy: string;
  },
  nowMs = Date.now()
): UserPremiumSubscription {
  const existingActive = isSubscriptionActive(existing, nowMs);
  const existingEndMs =
    existingActive && existing?.expiresAt ? new Date(existing.expiresAt).getTime() : nowMs;
  const nextEndMs = Math.max(existingEndMs, nowMs) + params.durationMs;

  const currentTier = existing && existingActive ? normalizePlanTier(existing.tier) : 'FREE';
  const resolvedTier: 'ORO' | 'DIAMANTE' =
    currentTier === 'DIAMANTE' || params.tier === 'DIAMANTE' ? 'DIAMANTE' : 'ORO';

  return {
    discordId: params.discordId,
    username: params.username || existing?.username || params.discordId,
    tier: resolvedTier,
    reason: params.reason?.trim() || existing?.reason || undefined,
    grantedAt:
      existingActive && existing?.grantedAt
        ? existing.grantedAt
        : new Date(nowMs).toISOString(),
    expiresAt: new Date(nextEndMs).toISOString(),
    activatedGuildIds: existingActive ? [...(existing?.activatedGuildIds ?? [])] : [],
    source: params.source,
    updatedBy: params.updatedBy,
    updatedAt: new Date(nowMs).toISOString(),
  };
}

export function buildFreeGuildPlan(guildId: string): GuildPlanRecord {
  return {
    guildId,
    tier: 'FREE',
    ownerUserId: null,
    activatedAt: null,
    expiresAt: null,
    activatedBy: null,
    activationSource: 'FREE_DEFAULT',
    quotas: buildPlanQuotas('FREE'),
  };
}

/**
 * Pure check for automatic backup eligibility & cadence per plan tier:
 * - FREE: max 1 backup, auto every 7 days
 * - ORO: max 5 backups, auto every 3 days
 * - DIAMANTE: max 10 backups, auto every 1 day
 * Once currentBackupCount >= maxBackups, automatic backups STOP until at least 1 backup is deleted.
 */
export function evaluateAutoBackupSchedule(params: {
  tier: PlanTier;
  currentBackupCount: number;
  settings: Pick<GuildBackupSettingsRecord, 'autoBackupSchedule' | 'lastAutoBackupAt'> | undefined;
  nowMs?: number;
}): {
  shouldCreate: boolean;
  reason: 'DUE' | 'DISABLED' | 'LIMIT_REACHED' | 'NOT_DUE_YET';
  intervalDays: number;
  maxBackups: number;
  nextScheduledAt: string | null;
} {
  const nowMs = params.nowMs ?? Date.now();
  const quotas = buildPlanQuotas(params.tier);
  const intervalDays = quotas.autoBackupDays;
  const maxBackups = quotas.maxBackups;
  const intervalMs = intervalDays * 86_400_000;

  if (params.settings?.autoBackupSchedule === 'OFF') {
    return {
      shouldCreate: false,
      reason: 'DISABLED',
      intervalDays,
      maxBackups,
      nextScheduledAt: null,
    };
  }

  if (params.currentBackupCount >= maxBackups) {
    return {
      shouldCreate: false,
      reason: 'LIMIT_REACHED',
      intervalDays,
      maxBackups,
      nextScheduledAt: null,
    };
  }

  const lastMs = params.settings?.lastAutoBackupAt
    ? new Date(params.settings.lastAutoBackupAt).getTime()
    : 0;
  if (!lastMs || nowMs - lastMs >= intervalMs) {
    return {
      shouldCreate: true,
      reason: 'DUE',
      intervalDays,
      maxBackups,
      nextScheduledAt: new Date(nowMs).toISOString(),
    };
  }

  return {
    shouldCreate: false,
    reason: 'NOT_DUE_YET',
    intervalDays,
    maxBackups,
    nextScheduledAt: new Date(lastMs + intervalMs).toISOString(),
  };
}
