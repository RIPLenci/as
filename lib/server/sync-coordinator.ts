import crypto from 'node:crypto';
import type {
  AntiNukeConfigRecord,
  AntiRaidConfigRecord,
  GuildSecuritySuiteRecord,
  GuildSettingsRecord,
  SanctionActionRecord,
} from '../aegis/types';
import { aegisLogger } from './logger';
import {
  getMongoStatus,
  GuildConfigModel,
  SanctionLedgerModel,
  SyncOutboxModel,
} from './mongodb';
import { redisCoordinator } from './redis';

export interface GuildConfigDocumentShape {
  guildId: string;
  syncVersion: number;
  configHash: string;
  antiRaidConfig: AntiRaidConfigRecord;
  guildSettings: GuildSettingsRecord | null;
  antiNukeConfig: AntiNukeConfigRecord | null;
  securitySuite: GuildSecuritySuiteRecord | null;
  updatedAt: string;
}

export function computeConfigHash(payload: unknown): string {
  const canonical = JSON.stringify(payload);
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

/**
 * Persists a per-guild versioned configuration document to MongoDB + writes an Outbox
 * record when Redis is unavailable so multi-container deployments never lose updates.
 */
export async function persistGuildConfigVersioned(params: {
  guildId: string;
  eventName: string;
  correlationId: string;
  originProcessId: string;
  antiRaidConfig: AntiRaidConfigRecord;
  guildSettings: GuildSettingsRecord | null;
  antiNukeConfig: AntiNukeConfigRecord | null;
  securitySuite: GuildSecuritySuiteRecord | null;
}): Promise<{ syncVersion: number; configHash: string; mongoPersisted: boolean; redisPublished: boolean }> {
  const { guildId, eventName, correlationId, originProcessId } = params;
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
      const existing = (await GuildConfigModel.findOne({ guildId })
        .select('syncVersion')
        .lean()) as { syncVersion?: number } | null;
      const monotonicVersion = Math.max(
        params.antiRaidConfig.syncVersion,
        (existing?.syncVersion ?? 0) + 1
      );
      effectiveVersion = monotonicVersion;
      params.antiRaidConfig.syncVersion = monotonicVersion;

      await GuildConfigModel.findOneAndUpdate(
        { guildId },
        {
          $set: {
            guildId,
            syncVersion: monotonicVersion,
            configHash,
            antiRaidConfig: params.antiRaidConfig,
            guildSettings: params.guildSettings,
            antiNukeConfig: params.antiNukeConfig,
            securitySuite: params.securitySuite,
            updatedAt: new Date(),
          },
        },
        { upsert: true }
      );
      mongoPersisted = true;
    } catch (err) {
      aegisLogger.error('SYNC', 'Failed to persist versioned GuildConfig in MongoDB', {
        guildId,
        correlationId,
        syncVersion: effectiveVersion,
        meta: { err },
      });
    }
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
    }
  );

  if (!redisPublished && getMongoStatus() === 'CONNECTED') {
    try {
      await SyncOutboxModel.create({
        eventId: `out_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
        eventName,
        guildId,
        syncVersion: effectiveVersion,
        correlationId,
        payload: { guildId, syncVersion: effectiveVersion, configHash },
        status: 'PENDING',
        attempts: 0,
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

/**
 * Flushes pending Outbox notifications when Redis becomes available again.
 */
export async function flushPendingSyncOutbox(originProcessId: string): Promise<number> {
  if (getMongoStatus() !== 'CONNECTED' || redisCoordinator.getStatus() !== 'CONNECTED') {
    return 0;
  }
  try {
    const pending = (await SyncOutboxModel.find({ status: 'PENDING' })
      .sort({ createdAt: 1 })
      .limit(50)
      .lean()) as Array<{
      eventId: string;
      eventName: string;
      guildId?: string | null;
      syncVersion?: number;
      correlationId: string;
      payload: unknown;
      attempts: number;
    }>;
    let flushed = 0;
    for (const item of pending) {
      const ok = await redisCoordinator.publish(
        'aegis:sync',
        item.eventName,
        item.payload,
        item.guildId ?? undefined,
        originProcessId,
        {
          syncVersion: item.syncVersion,
          correlationId: item.correlationId,
        }
      );
      if (ok) {
        await SyncOutboxModel.updateOne(
          { eventId: item.eventId },
          { $set: { status: 'PUBLISHED', publishedAt: new Date() }, $inc: { attempts: 1 } }
        );
        flushed += 1;
      } else {
        await SyncOutboxModel.updateOne(
          { eventId: item.eventId },
          { $inc: { attempts: 1 } }
        );
      }
    }
    return flushed;
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
