import mongoose, { Schema } from 'mongoose';
import type { ServiceHealthState } from '../aegis/types';
import { getServerEnv } from './env';
import { aegisLogger } from './logger';

let connectionAttempted = false;
let currentState: ServiceHealthState = 'UNCONFIGURED';
let listenersBound = false;

const genericJsonSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    payload: { type: Schema.Types.Mixed, required: true },
    snapshotVersion: { type: Number, default: 1 },
    updatedBy: { type: String, default: 'system' },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const guildConfigSchema = new Schema(
  {
    guildId: { type: String, required: true, unique: true },
    syncVersion: { type: Number, required: true, default: 1 },
    configHash: { type: String, required: true },
    updatedBy: { type: String, default: 'system' },
    antiRaidConfig: { type: Schema.Types.Mixed, required: true },
    guildSettings: { type: Schema.Types.Mixed, default: null },
    antiNukeConfig: { type: Schema.Types.Mixed, default: null },
    securitySuite: { type: Schema.Types.Mixed, default: null },
    updatedAt: { type: Date, default: Date.now, index: true },
  },
  { versionKey: false }
);
guildConfigSchema.index({ guildId: 1, syncVersion: -1 });

const syncOutboxSchema = new Schema(
  {
    eventId: { type: String, required: true, unique: true },
    eventName: { type: String, required: true },
    guildId: { type: String, default: null, index: true },
    syncVersion: { type: Number, default: 0 },
    correlationId: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ['PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED'],
      default: 'PENDING',
      index: true,
    },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 8 },
    nextAttemptAt: { type: Date, default: Date.now, index: true },
    leaseOwner: { type: String, default: null },
    leaseExpiresAt: { type: Date, default: null, index: true },
    deliveryId: { type: String, default: null },
    lastError: { type: String, default: null },
    createdAt: { type: Date, default: Date.now, expires: 604800 },
    processedAt: { type: Date, default: null },
    publishedAt: { type: Date, default: null },
  },
  { versionKey: false }
);
syncOutboxSchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });
syncOutboxSchema.index({ status: 1, leaseExpiresAt: 1 });

const workerJobStateSchema = new Schema(
  {
    jobKey: { type: String, required: true, unique: true },
    lastRunId: { type: String, required: true },
    status: {
      type: String,
      enum: ['RUNNING', 'COMPLETED', 'FAILED'],
      required: true,
    },
    instanceId: { type: String, required: true },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    summary: { type: Schema.Types.Mixed, default: {} },
    errorMessage: { type: String, default: null },
  },
  { versionKey: false }
);

const sanctionLedgerSchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
    correlationId: { type: String, required: true, index: true },
    guildId: { type: String, required: true, index: true },
    targetUserId: { type: String, required: true, index: true },
    targetUsername: { type: String, required: true },
    requestedAction: { type: String, required: true },
    executedAction: { type: String, required: true },
    reason: { type: String, required: true },
    status: {
      type: String,
      enum: ['PENDING', 'EXECUTING', 'SUCCESS', 'FAILED', 'CANCELLED'],
      required: true,
      index: true,
    },
    missingPermissions: { type: [String], default: [] },
    errorCode: { type: Schema.Types.Mixed, default: null },
    errorMessage: { type: String, default: null },
    attempts: { type: Number, default: 1 },
    durationMs: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now, expires: 7776000 },
    completedAt: { type: Date, default: null },
  },
  { versionKey: false }
);
sanctionLedgerSchema.index({ guildId: 1, createdAt: -1 });
sanctionLedgerSchema.index({ status: 1, createdAt: -1 });

const auditLogSchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
    guildId: { type: String, default: null, index: true },
    actorId: { type: String, required: true, index: true },
    actorName: { type: String, required: true },
    action: { type: String, required: true, index: true },
    entityType: { type: String, required: true },
    entityId: { type: String, required: true },
    result: { type: String, enum: ['SUCCESS', 'DENIED', 'ERROR'], required: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { versionKey: false }
);
auditLogSchema.index({ guildId: 1, createdAt: -1 });

const globalBanSchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
    discordId: { type: String, required: true, index: true },
    username: { type: String, required: true },
    reason: { type: String, required: true },
    description: { type: String, required: true },
    category: { type: String, required: true, index: true },
    severity: { type: String, required: true },
    sanctionType: { type: String, enum: ['PERMANENT', 'TEMPORARY'], required: true },
    evidence: { type: String, required: true },
    moderatorId: { type: String, required: true },
    moderatorName: { type: String, required: true },
    status: {
      type: String,
      enum: ['ACTIVE', 'EXPIRED', 'REVOKED', 'PENDING_APPEAL'],
      required: true,
      index: true,
    },
    createdAt: { type: Date, default: Date.now, index: true },
    expiresAt: { type: Date, default: null, index: true },
    revokedAt: { type: Date, default: null },
    revokedBy: { type: String, default: null },
    revokeReason: { type: String, default: null },
    history: { type: [Schema.Types.Mixed], default: [] },
  },
  { versionKey: false }
);
globalBanSchema.index({ status: 1, discordId: 1 });
globalBanSchema.index({ status: 1, sanctionType: 1, expiresAt: 1 });

export const AegisSnapshotModel =
  mongoose.models.AegisSnapshot || mongoose.model('AegisSnapshot', genericJsonSchema);
export const GuildConfigModel =
  mongoose.models.GuildConfig || mongoose.model('GuildConfig', guildConfigSchema);
export const SyncOutboxModel =
  mongoose.models.SyncOutbox || mongoose.model('SyncOutbox', syncOutboxSchema);
export const WorkerJobStateModel =
  mongoose.models.WorkerJobState || mongoose.model('WorkerJobState', workerJobStateSchema);
export const SanctionLedgerModel =
  mongoose.models.SanctionLedger || mongoose.model('SanctionLedger', sanctionLedgerSchema);
export const AuditLogModel =
  mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);
export const GlobalBanModel =
  mongoose.models.GlobalBan || mongoose.model('GlobalBan', globalBanSchema);

export async function ensureMongoConnected(): Promise<ServiceHealthState> {
  const { mongodbUri } = getServerEnv();
  if (!mongodbUri) {
    currentState = 'UNCONFIGURED';
    return currentState;
  }

  if (!listenersBound) {
    listenersBound = true;
    mongoose.connection.on('connected', () => {
      currentState = 'CONNECTED';
      aegisLogger.info('MONGODB', 'MongoDB connection established');
    });
    mongoose.connection.on('disconnected', () => {
      currentState = 'OFFLINE';
      aegisLogger.warn('MONGODB', 'MongoDB connection lost');
    });
    mongoose.connection.on('error', (err) => {
      currentState = 'DEGRADED';
      aegisLogger.error('MONGODB', 'MongoDB connection error', { meta: { err } });
    });
  }

  if (mongoose.connection.readyState === 1) {
    currentState = 'CONNECTED';
    return currentState;
  }

  if (connectionAttempted && mongoose.connection.readyState === 2) {
    return currentState;
  }

  connectionAttempted = true;
  try {
    const conn = await mongoose.connect(mongodbUri, {
      serverSelectionTimeoutMS: 2500,
      maxPoolSize: 10,
    });
    currentState =
      Number(conn.connection.readyState) === mongoose.ConnectionStates.connected
        ? 'CONNECTED'
        : 'DEGRADED';
  } catch (err) {
    currentState = 'OFFLINE';
    aegisLogger.error('MONGODB', 'Failed to connect to MongoDB', { meta: { err } });
  }
  return currentState;
}

export function getMongoStatus(): ServiceHealthState {
  const { mongodbUri } = getServerEnv();
  if (!mongodbUri) return 'UNCONFIGURED';
  if (mongoose.connection.readyState === 1) return 'CONNECTED';
  if (mongoose.connection.readyState === 2) return 'DEGRADED';
  return currentState;
}
