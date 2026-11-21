import mongoose, { Schema } from 'mongoose';
import type { ServiceHealthState } from '../aegis/types';
import { getServerEnv } from './env';

let connectionAttempted = false;
let currentState: ServiceHealthState = 'UNCONFIGURED';

const genericJsonSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    payload: { type: Schema.Types.Mixed, required: true },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const auditLogSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
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

const globalBanSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
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

export const AegisSnapshotModel =
  mongoose.models.AegisSnapshot || mongoose.model('AegisSnapshot', genericJsonSchema);
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
  } catch {
    currentState = 'OFFLINE';
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
