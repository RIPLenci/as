import crypto from 'node:crypto';
import type {
  AntiNukeConfigRecord,
  AntiRaidConfigRecord,
  AuditLogRecord,
  GlobalBanRecord,
  GuildSecuritySuiteRecord,
  GuildSettingsRecord,
  SanctionActionRecord,
} from '../aegis/types';
import { aegisLogger } from './logger';
import {
  AuditLogModel,
  getMongoStatus,
  GlobalBanModel,
  GuildConfigModel,
  SanctionLedgerModel,
  SyncOutboxModel,
} from './mongodb';
import { redisCoordinator } from './redis';

export interface GuildConfigDocumentShape {
  guildId: string;
  syncVersion: number;
  configHash: string;
  updatedBy?: string;
  antiRaidConfig: AntiRaidConfigRecord;
  guildSettings: GuildSettingsRecord | null;
  antiNukeConfig: AntiNukeConfigRecord | null;
  securitySuite: GuildSecuritySuiteRecord | null;
  updatedAt: string;
}

export interface ClaimedOutboxRecord {
  eventId: string;
  eventName: string;
  guildId?: string | null;
  syncVersion?: number;
  correlationId: string;
  payload: unknown;
  attempts: number;
  maxAttempts?: number;
  deliveryId: string;
  leaseOwner: string;
}

export interface SyncOutboxStoreAdapter {
  claimNext(
    ownerId: string,
    leaseMs: number,
    now: Date
  ): Promise<ClaimedOutboxRecord | null>;
  markPublished(eventId: string, ownerId: string, deliveryId: string, now: Date): Promise<boolean>;
  markRetryOrFailed(
    item: ClaimedOutboxRecord,
    nextAttemptAt: Date,
    errorMessage: string
  ): Promise<'PENDING' | 'FAILED'>;
}

export function computeConfigHash(payload: unknown): string {
  const canonical = JSON.stringify(payload);
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

export function computeRetryBackoffMs(attempts: number, baseMs = 1500, maxMs = 60_000): number {
  const safeAttempt = Math.max(1, attempts);
  const exp = Math.min(maxMs, baseMs * Math.pow(2, safeAttempt - 1));
  // Equal jitter [0.5 * exp, 1.0 * exp] avoids thundering herds cleanly
  const jitter = 0.5 + Math.random() * 0.5;
  return Math.round(exp * jitter);
}

export function shouldApplyVersionedConfig(
  currentVersion: number | undefined | null,
  incomingVersion: number
): boolean {
  if (typeof currentVersion !== 'number' || !Number.isFinite(currentVersion)) return true;
  return incomingVersion >= currentVersion;
}

/**
 * Persists a per-guild versioned configuration document to MongoDB using an ATOMIC `$inc`
 * on `syncVersion` (never read-then-write) + writes an Outbox record when Redis is unavailable
 * so multi-container deployments never lose updates.
 */
export async function persistGuildConfigVersioned(params: {
  guildId: string;
  eventName: string;
  correlationId: string;
  originProcessId: string;
  updatedBy?: string;
  fencingToken?: number | null;
  antiRaidConfig: AntiRaidConfigRecord;
  guildSettings: GuildSettingsRecord | null;
  antiNukeConfig: AntiNukeConfigRecord | null;
  securitySuite: GuildSecuritySuiteRecord | null;
}): Promise<{ syncVersion: number; configHash: string; mongoPersisted: boolean; redisPublished: boolean }> {
  const { guildId, eventName, correlationId, originProcessId } = params;
  const updatedBy = params.updatedBy || originProcessId;
  const configHash = computeConfigHash({
    antiRaidConfig: params.antiRaidConfig,
    guildSettings: params.guildSettings,
    antiNukeConfig: params.antiNukeConfig,
    securitySuite: params.securitySuite,
  });

  let effectiveVersion = params.antiRaidConfig.syncVersion;
  let mongoPersisted = false;

  if (getMongoStatus() === 'CONNECTED') {
    try {
      const updatedDoc = (await GuildConfigModel.findOneAndUpdate(
        { guildId },
        {
          $inc: { syncVersion: 1 },
          $set: {
            guildId,
            configHash,
            updatedBy,
            antiRaidConfig: {
              ...params.antiRaidConfig,
              configHash,
            },
            guildSettings: params.guildSettings,
            antiNukeConfig: params.antiNukeConfig,
            securitySuite: params.securitySuite,
            updatedAt: new Date(),
          },
        },
        { upsert: true, returnDocument: 'after' }
      ).lean()) as { syncVersion?: number } | null;

      if (typeof updatedDoc?.syncVersion === 'number' && updatedDoc.syncVersion > 0) {
        effectiveVersion = updatedDoc.syncVersion;
        params.antiRaidConfig.syncVersion = effectiveVersion;
        params.antiRaidConfig.configHash = configHash;
        // Align embedded antiRaidConfig.syncVersion asynchronously without risking regression
        await GuildConfigModel.updateOne(
          { guildId, syncVersion: effectiveVersion },
          { $set: { 'antiRaidConfig.syncVersion': effectiveVersion } }
        ).catch(() => undefined);
      }
      mongoPersisted = true;
    } catch (err) {
      aegisLogger.error('SYNC', 'Failed to atomically persist versioned GuildConfig in MongoDB', {
        guildId,
        correlationId,
        syncVersion: effectiveVersion,
        meta: { err },
      });
    }
  } else {
    // Non-Mongo single-host fallback still increments deterministically in memory
    effectiveVersion = Math.max(1, params.antiRaidConfig.syncVersion);
    params.antiRaidConfig.configHash = configHash;
  }

  const redisPublished = await redisCoordinator.publish(
    'aegis:sync',
    eventName,
    {
      guildId,
      syncVersion: effectiveVersion,
      configHash,
      antiRaidEnabled: params.antiRaidConfig.enabled,
    },
    guildId,
    originProcessId,
    {
      syncVersion: effectiveVersion,
      configHash,
      correlationId,
      fencingToken: params.fencingToken ?? null,
    }
  );

  if (!redisPublished && getMongoStatus() === 'CONNECTED') {
    try {
      await SyncOutboxModel.create({
        eventId: `out_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`,
        eventName,
        guildId,
        syncVersion: effectiveVersion,
        correlationId,
        payload: { guildId, syncVersion: effectiveVersion, configHash },
        status: 'PENDING',
        attempts: 0,
        maxAttempts: 8,
        nextAttemptAt: new Date(),
      });
    } catch (err) {
      aegisLogger.warn('SYNC', 'Failed to enqueue SyncOutbox record', {
        guildId,
        correlationId,
        meta: { err },
      });
    }
  }

  return { syncVersion: effectiveVersion, configHash, mongoPersisted, redisPublished };
}

/**
 * Pulls authoritative guild configs from MongoDB. Used on bot startup, on Redis reconnect,
 * on targeted sync notifications, and during periodic reconciliation.
 */
export async function pullGuildConfigsFromMongo(
  targetGuildId?: string
): Promise<GuildConfigDocumentShape[]> {
  if (getMongoStatus() !== 'CONNECTED') return [];
  try {
    const query = targetGuildId ? { guildId: targetGuildId } : {};
    const docs = (await GuildConfigModel.find(query).lean()) as Array<{
      guildId: string;
      syncVersion: number;
      configHash: string;
      updatedBy?: string;
      antiRaidConfig: AntiRaidConfigRecord;
      guildSettings: GuildSettingsRecord | null;
      antiNukeConfig: AntiNukeConfigRecord | null;
      securitySuite: GuildSecuritySuiteRecord | null;
      updatedAt?: Date | string;
    }>;
    return docs.map((d) => ({
      guildId: d.guildId,
      syncVersion: d.syncVersion,
      configHash: d.configHash,
      updatedBy: d.updatedBy,
      antiRaidConfig: d.antiRaidConfig,
      guildSettings: d.guildSettings ?? null,
      antiNukeConfig: d.antiNukeConfig ?? null,
      securitySuite: d.securitySuite ?? null,
      updatedAt:
        d.updatedAt instanceof Date
          ? d.updatedAt.toISOString()
          : String(d.updatedAt || new Date().toISOString()),
    }));
  } catch (err) {
    aegisLogger.error('SYNC', 'Failed to pull GuildConfig documents from MongoDB', {
      guildId: targetGuildId,
      meta: { err },
    });
    return [];
  }
}

const mongooseOutboxAdapter: SyncOutboxStoreAdapter = {
  async claimNext(ownerId: string, leaseMs: number, now: Date): Promise<ClaimedOutboxRecord | null> {
    const deliveryId = `dlv_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
    const leaseExpiresAt = new Date(now.getTime() + leaseMs);
    const claimed = (await SyncOutboxModel.findOneAndUpdate(
      {
        $or: [
          { status: 'PENDING', nextAttemptAt: { $lte: now } },
          { status: 'PROCESSING', leaseExpiresAt: { $lte: now } },
        ],
      },
      {
        $set: {
          status: 'PROCESSING',
          leaseOwner: ownerId,
          leaseExpiresAt,
          deliveryId,
          processedAt: now,
        },
        $inc: { attempts: 1 },
      },
      {
        sort: { createdAt: 1 },
        returnDocument: 'after',
      }
    ).lean()) as
      | {
          eventId: string;
          eventName: string;
          guildId?: string | null;
          syncVersion?: number;
          correlationId: string;
          payload: unknown;
          attempts: number;
          maxAttempts?: number;
          deliveryId: string;
          leaseOwner: string;
        }
      | null;
    return claimed;
  },
  async markPublished(
    eventId: string,
    ownerId: string,
    deliveryId: string,
    now: Date
  ): Promise<boolean> {
    const res = await SyncOutboxModel.updateOne(
      { eventId, status: 'PROCESSING', leaseOwner: ownerId, deliveryId },
      {
        $set: {
          status: 'PUBLISHED',
          publishedAt: now,
          leaseExpiresAt: null,
          lastError: null,
        },
      }
    );
    return (res.modifiedCount ?? 0) > 0;
  },
  async markRetryOrFailed(
    item: ClaimedOutboxRecord,
    nextAttemptAt: Date,
    errorMessage: string
  ): Promise<'PENDING' | 'FAILED'> {
    const maxAttempts = item.maxAttempts ?? 8;
    const finalStatus: 'PENDING' | 'FAILED' = item.attempts >= maxAttempts ? 'FAILED' : 'PENDING';
    await SyncOutboxModel.updateOne(
      {
        eventId: item.eventId,
        status: 'PROCESSING',
        leaseOwner: item.leaseOwner,
        deliveryId: item.deliveryId,
      },
      {
        $set: {
          status: finalStatus,
          leaseOwner: null,
          leaseExpiresAt: null,
          nextAttemptAt,
          lastError: errorMessage.slice(0, 300),
        },
      }
    );
    return finalStatus;
  },
};

/**
 * Flushes pending Outbox notifications via atomic lease claims + backoff/jitter + idempotent delivery metadata.
 * Prevents duplicate simultaneous claiming across Bot & Worker containers.
 */
export async function flushPendingSyncOutboxWithAdapter(
  originProcessId: string,
  adapter: SyncOutboxStoreAdapter,
  publishFn: (
    eventName: string,
    payload: unknown,
    guildId: string | undefined,
    originProcessId: string,
    meta: { syncVersion?: number; correlationId: string; deliveryId: string }
  ) => Promise<boolean>,
  maxBatch = 50,
  leaseMs = 20_000
): Promise<{ flushed: number; failed: number; retried: number }> {
  let flushed = 0;
  let failed = 0;
  let retried = 0;

  for (let i = 0; i < maxBatch; i++) {
    const now = new Date();
    const claimed = await adapter.claimNext(originProcessId, leaseMs, now);
    if (!claimed) break;

    try {
      const ok = await publishFn(
        claimed.eventName,
        {
          ...(typeof claimed.payload === 'object' && claimed.payload !== null
            ? (claimed.payload as Record<string, unknown>)
            : { raw: claimed.payload }),
          deliveryId: claimed.deliveryId,
          eventId: claimed.eventId,
        },
        claimed.guildId ?? undefined,
        originProcessId,
        {
          syncVersion: claimed.syncVersion,
          correlationId: claimed.correlationId,
          deliveryId: claimed.deliveryId,
        }
      );

      if (ok) {
        await adapter.markPublished(claimed.eventId, originProcessId, claimed.deliveryId, new Date());
        flushed += 1;
      } else {
        const delayMs = computeRetryBackoffMs(claimed.attempts);
        const status = await adapter.markRetryOrFailed(
          claimed,
          new Date(Date.now() + delayMs),
          'REDIS_PUBLISH_RETURNED_FALSE'
        );
        if (status === 'FAILED') failed += 1;
        else retried += 1;
        break;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const delayMs = computeRetryBackoffMs(claimed.attempts);
      const status = await adapter.markRetryOrFailed(
        claimed,
        new Date(Date.now() + delayMs),
        msg
      );
      if (status === 'FAILED') failed += 1;
      else retried += 1;
    }
  }

  return { flushed, failed, retried };
}

export async function flushPendingSyncOutbox(originProcessId: string): Promise<number> {
  if (getMongoStatus() !== 'CONNECTED' || redisCoordinator.getStatus() !== 'CONNECTED') {
    return 0;
  }
  try {
    const result = await flushPendingSyncOutboxWithAdapter(
      originProcessId,
      mongooseOutboxAdapter,
      async (eventName, payload, guildId, procId, meta) =>
        redisCoordinator.publish('aegis:sync', eventName, payload, guildId, procId, {
          syncVersion: meta.syncVersion,
          correlationId: meta.correlationId,
        })
    );
    return result.flushed;
  } catch (err) {
    aegisLogger.warn('SYNC', 'Outbox flush encountered error', { meta: { err } });
    return 0;
  }
}

export async function recordSanctionActionToMongo(record: SanctionActionRecord): Promise<void> {
  if (getMongoStatus() !== 'CONNECTED') return;
  try {
    await SanctionLedgerModel.findOneAndUpdate(
      { id: record.id },
      {
        $set: {
          ...record,
          createdAt: new Date(record.createdAt),
          completedAt: record.completedAt ? new Date(record.completedAt) : null,
        },
      },
      { upsert: true }
    );
  } catch (err) {
    aegisLogger.error('SANCTION', 'Failed to persist sanction ledger entry in MongoDB', {
      guildId: record.guildId,
      correlationId: record.correlationId,
      actionId: record.id,
      meta: { err },
    });
  }
}

export async function upsertGlobalBanInMongo(ban: GlobalBanRecord): Promise<boolean> {
  if (getMongoStatus() !== 'CONNECTED') return false;
  try {
    await GlobalBanModel.findOneAndUpdate(
      { id: ban.id },
      {
        $set: {
          ...ban,
          createdAt: new Date(ban.createdAt),
          expiresAt: ban.expiresAt ? new Date(ban.expiresAt) : null,
          revokedAt: ban.revokedAt ? new Date(ban.revokedAt) : null,
        },
      },
      { upsert: true }
    );
    return true;
  } catch (err) {
    aegisLogger.error('GLOBALBAN', 'Failed to upsert GlobalBan in MongoDB', {
      userId: ban.discordId,
      meta: { banId: ban.id, err },
    });
    return false;
  }
}

export async function pullGlobalBansFromMongo(limit = 500): Promise<GlobalBanRecord[]> {
  if (getMongoStatus() !== 'CONNECTED') return [];
  try {
    const docs = (await GlobalBanModel.find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()) as Array<Record<string, unknown>>;
    return docs.map((d) => ({
      ...(d as unknown as GlobalBanRecord),
      createdAt:
        d.createdAt instanceof Date
          ? d.createdAt.toISOString()
          : String(d.createdAt || new Date().toISOString()),
      expiresAt:
        d.expiresAt instanceof Date
          ? d.expiresAt.toISOString()
          : typeof d.expiresAt === 'string'
          ? d.expiresAt
          : null,
      revokedAt:
        d.revokedAt instanceof Date
          ? d.revokedAt.toISOString()
          : typeof d.revokedAt === 'string'
          ? d.revokedAt
          : null,
    }));
  } catch (err) {
    aegisLogger.warn('GLOBALBAN', 'Failed pulling GlobalBans from MongoDB', { meta: { err } });
    return [];
  }
}

export async function recordAuditLogToMongo(record: AuditLogRecord): Promise<void> {
  if (getMongoStatus() !== 'CONNECTED') return;
  try {
    await AuditLogModel.findOneAndUpdate(
      { id: record.id },
      {
        $setOnInsert: {
          ...record,
          createdAt: new Date(record.createdAt),
        },
      },
      { upsert: true }
    );
  } catch (err) {
    aegisLogger.warn('AUDIT', 'Failed persisting audit log in MongoDB', {
      guildId: record.guildId ?? undefined,
      meta: { action: record.action, err },
    });
  }
}

