import crypto from 'node:crypto';
import type { AutoAction, SanctionActionRecord } from './types';

export interface DiscordTargetCapability {
  targetId: string;
  targetUsername: string;
  isGuildOwner: boolean;
  isBotSelf: boolean;
  bannable: boolean;
  kickable: boolean;
  moderatable: boolean;
  manageable: boolean;
  botPermissions: {
    banMembers: boolean;
    kickMembers: boolean;
    moderateMembers: boolean;
    manageRoles: boolean;
    manageGuild: boolean;
  };
  botHighestRoleAboveTarget: boolean;
}

export interface SanctionExecutionHooks {
  ban: (reason: string) => Promise<void>;
  kick: (reason: string) => Promise<void>;
  timeout: (durationMs: number, reason: string) => Promise<void>;
  stripDangerousRoles?: (reason: string) => Promise<void>;
}

export interface SanctionExecutionRequest {
  correlationId: string;
  idempotencyKey?: string;
  guildId: string;
  requestedAction: AutoAction;
  reason: string;
  timeoutDurationMs?: number;
  capability: DiscordTargetCapability;
  hooks: SanctionExecutionHooks;
  maxTransientRetries?: number;
  retryDelayMs?: number;
}

const IDEMPOTENCY_DONE = new Map<string, { record: SanctionActionRecord; expiresAt: number }>();

export function clearSanctionIdempotencyCache(): void {
  IDEMPOTENCY_DONE.clear();
}

export function checkActionPrerequisites(
  requestedAction: AutoAction,
  cap: DiscordTargetCapability
): { allowed: boolean; missingPermissions: string[]; reason: string | null } {
  if (requestedAction === 'LOG_ONLY' || requestedAction === 'ALERT') {
    return { allowed: true, missingPermissions: [], reason: null };
  }
  if (cap.isBotSelf) {
    return {
      allowed: false,
      missingPermissions: ['SelfTargetForbidden'],
      reason: 'No se puede sancionar al propio bot.',
    };
  }
  if (cap.isGuildOwner) {
    return {
      allowed: false,
      missingPermissions: ['GuildOwnerImmune'],
      reason: 'El dueño del servidor no puede recibir sanciones automáticas.',
    };
  }

  const missing: string[] = [];
  if (requestedAction === 'BAN') {
    if (!cap.botPermissions.banMembers) missing.push('BanMembers');
    if (!cap.botHighestRoleAboveTarget || !cap.bannable) missing.push('RoleHierarchyTooLow');
  } else if (requestedAction === 'KICK') {
    if (!cap.botPermissions.kickMembers) missing.push('KickMembers');
    if (!cap.botHighestRoleAboveTarget || !cap.kickable) missing.push('RoleHierarchyTooLow');
  } else if (requestedAction === 'TIMEOUT' || requestedAction === 'QUARANTINE') {
    if (!cap.botPermissions.moderateMembers) missing.push('ModerateMembers');
    if (!cap.botHighestRoleAboveTarget || !cap.moderatable) missing.push('RoleHierarchyTooLow');
  }

  if (missing.length > 0) {
    return {
      allowed: false,
      missingPermissions: missing,
      reason: `Permisos o jerarquía insuficientes: ${missing.join(', ')}`,
    };
  }
  return { allowed: true, missingPermissions: [], reason: null };
}

function extractDiscordErrorDetails(err: unknown): {
  code: string | number | null;
  message: string;
  transient: boolean;
  retryAfterMs: number;
} {
  const rec = (err && typeof err === 'object' ? err : {}) as Record<string, unknown>;
  const code =
    typeof rec.code === 'number' || typeof rec.code === 'string'
      ? rec.code
      : typeof rec.status === 'number'
      ? rec.status
      : null;
  const status = typeof rec.status === 'number' ? rec.status : 0;
  const message =
    err instanceof Error
      ? err.message
      : typeof rec.message === 'string'
      ? rec.message
      : 'Unknown Discord API error';

  // Permanent Discord errors: 50013 Missing Permissions, 50001 Missing Access, 10007 Unknown Member, 10013 Unknown User
  const permanentCodes = new Set<string | number>([50013, 50001, 10007, 10013, 400, 403, 404]);
  const isTransient =
    !permanentCodes.has(code ?? '') &&
    (status === 429 ||
      status >= 500 ||
      code === 'ECONNRESET' ||
      code === 'ETIMEDOUT' ||
      code === 'UND_ERR_CONNECT_TIMEOUT' ||
      /rate limit|timeout|temporarily unavailable|502|503|504/i.test(message));

  const retryAfterSec =
    typeof rec.retryAfter === 'number'
      ? rec.retryAfter
      : typeof rec.retry_after === 'number'
      ? rec.retry_after
      : 0;
  const retryAfterMs =
    retryAfterSec > 0 ? Math.min(3000, Math.round(retryAfterSec * 1000)) : 120;

  return { code, message, transient: isTransient, retryAfterMs };
}

/**
 * Deterministic sanction execution with lifecycle tracking:
 * PENDING -> EXECUTING -> SUCCESS | FAILED | CANCELLED
 * - Validates permissions & role hierarchy BEFORE calling Discord.
 * - Deduplicates via idempotencyKey so double execution never happens.
 * - Retries ONLY transient network / 429 / 5xx failures.
 * - Never counts a sanction as successful unless Discord confirms completion.
 */
export async function executeVerifiedSanction(
  req: SanctionExecutionRequest
): Promise<SanctionActionRecord> {
  const nowMs = Date.now();
  if (req.idempotencyKey) {
    const cached = IDEMPOTENCY_DONE.get(req.idempotencyKey);
    if (cached && cached.expiresAt > nowMs) {
      return cached.record;
    }
    if (IDEMPOTENCY_DONE.size > 3000) {
      for (const [k, v] of IDEMPOTENCY_DONE.entries()) {
        if (v.expiresAt <= nowMs) IDEMPOTENCY_DONE.delete(k);
      }
    }
  }

  const startedAt = performance.now();
  const actionRecord: SanctionActionRecord = {
    id: `ACT-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
    correlationId: req.correlationId,
    guildId: req.guildId,
    targetUserId: req.capability.targetId,
    targetUsername: req.capability.targetUsername,
    requestedAction: req.requestedAction,
    executedAction: req.requestedAction,
    reason: req.reason,
    status: 'PENDING',
    missingPermissions: [],
    errorCode: null,
    errorMessage: null,
    attempts: 0,
    createdAt: new Date().toISOString(),
    completedAt: null,
    durationMs: 0,
  };

  if (req.requestedAction === 'LOG_ONLY' || req.requestedAction === 'ALERT') {
    actionRecord.status = 'CANCELLED';
    actionRecord.executedAction = req.requestedAction;
    actionRecord.errorMessage = 'Acción informativa sin sanción punitiva.';
    actionRecord.completedAt = new Date().toISOString();
    actionRecord.durationMs = Number((performance.now() - startedAt).toFixed(2));
    return actionRecord;
  }

  const prereq = checkActionPrerequisites(req.requestedAction, req.capability);
  if (!prereq.allowed) {
    actionRecord.status = 'CANCELLED';
    actionRecord.executedAction = 'CANCELLED_MISSING_PERMISSIONS';
    actionRecord.missingPermissions = prereq.missingPermissions;
    actionRecord.errorCode = 'MISSING_PERMISSIONS';
    actionRecord.errorMessage = prereq.reason;
    actionRecord.completedAt = new Date().toISOString();
    actionRecord.durationMs = Number((performance.now() - startedAt).toFixed(2));
    if (req.idempotencyKey) {
      IDEMPOTENCY_DONE.set(req.idempotencyKey, {
        record: actionRecord,
        expiresAt: Date.now() + 30_000,
      });
    }
    return actionRecord;
  }

  actionRecord.status = 'EXECUTING';
  const maxAttempts = Math.max(1, Math.min(3, (req.maxTransientRetries ?? 2) + 1));
  const baseDelayMs = Math.max(10, req.retryDelayMs ?? 120);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    actionRecord.attempts = attempt;
    try {
      if (req.requestedAction === 'BAN') {
        await req.hooks.ban(req.reason);
      } else if (req.requestedAction === 'KICK') {
        await req.hooks.kick(req.reason);
      } else {
        await req.hooks.timeout(req.timeoutDurationMs ?? 3600_000, req.reason);
      }

      actionRecord.status = 'SUCCESS';
      actionRecord.executedAction = req.requestedAction;
      actionRecord.completedAt = new Date().toISOString();
      actionRecord.durationMs = Number((performance.now() - startedAt).toFixed(2));
      if (req.idempotencyKey) {
        IDEMPOTENCY_DONE.set(req.idempotencyKey, {
          record: actionRecord,
          expiresAt: Date.now() + 30_000,
        });
      }
      return actionRecord;
    } catch (err) {
      const info = extractDiscordErrorDetails(err);
      actionRecord.errorCode = info.code;
      actionRecord.errorMessage = info.message;

      if (info.code === 50013) {
        actionRecord.missingPermissions = ['DiscordApi50013MissingPermissions'];
      }

      if (!info.transient || attempt >= maxAttempts) {
        actionRecord.status = 'FAILED';
        actionRecord.executedAction = 'FAILED';
        actionRecord.completedAt = new Date().toISOString();
        actionRecord.durationMs = Number((performance.now() - startedAt).toFixed(2));
        return actionRecord;
      }

      const waitMs = Math.max(baseDelayMs * attempt, info.retryAfterMs);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  actionRecord.status = 'FAILED';
  actionRecord.executedAction = 'FAILED';
  actionRecord.completedAt = new Date().toISOString();
  actionRecord.durationMs = Number((performance.now() - startedAt).toFixed(2));
  return actionRecord;
}
