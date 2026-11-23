import Redis from 'ioredis';
import type {
  BotClusterTelemetry,
  BotShardTelemetry,
  ServiceHealthState,
} from '../aegis/types';
import { getServerEnv } from './env';
import { aegisLogger } from './logger';

export interface RedisPubSubMessage {
  channel: string;
  event: string;
  guildId?: string;
  syncVersion?: number;
  configHash?: string;
  correlationId?: string;
  fencingToken?: number | null;
  payload: unknown;
  originProcessId?: string;
  timestamp: string;
}

export interface RedisBotHeartbeatPayload {
  updatedAt: number;
  instanceId?: string;
  pid?: number;
  leaderState?: 'INITIALIZING' | 'LEADER' | 'NO_LEADER' | 'SHUTTING_DOWN';
  fencingToken?: number | null;
  tag: string;
  id: string;
  avatarUrl: string | null;
  pingMs: number;
  guildCount: number;
  userCount: number;
  shards?: BotShardTelemetry[];
  cluster?: BotClusterTelemetry;
  lastSlashSyncAt?: string | null;
  appliedGuildSyncVersions?: Record<string, number>;
  latencyMetrics?: {
    antiRaidEval: { count: number; p50Ms: number; p95Ms: number; p99Ms: number; maxMs: number };
    sanctionExec: { count: number; p50Ms: number; p95Ms: number; p99Ms: number; maxMs: number };
  };
}

export interface RedisWorkerHeartbeatPayload {
  updatedAt: number;
  instanceId: string;
  pid: number;
  status: 'ACTIVE' | 'IDLE' | 'DEGRADED' | 'ERROR' | 'SHUTTING_DOWN';
  lastCycleAt: string | null;
  lastCycleDurationMs: number;
  expiredGlobalBans: number;
  expiredQuarantines: number;
  expiredPremium: number;
  autoBackedUp: number;
  outboxFlushed: number;
  lastError: string | null;
  cycleCount: number;
}

export type DistributedLockReason =
  | 'LOCK_ACQUIRED'
  | 'LOCK_RENEWED'
  | 'LOCK_HELD_BY_OTHER'
  | 'LOCK_EXPIRED_OR_LOST'
  | 'REDIS_UNAVAILABLE'
  | 'LOCAL_SINGLE_INSTANCE'
  | 'LOCK_ERROR';

export interface DistributedLockResult {
  acquired: boolean;
  fencingToken: number | null;
  ownerToken: string;
  reason: DistributedLockReason;
}

export interface RedisTransport {
  status: ServiceHealthState;
  ping(): Promise<string>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs?: number): Promise<'OK' | null>;
  setNxPx(key: string, value: string, ttlMs: number): Promise<boolean>;
  del(key: string): Promise<number>;
  publish(channel: string, rawPayload: string): Promise<number>;
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
  quit(): Promise<void>;
}

const ACQUIRE_LOCK_WITH_FENCING_LUA = `
  local current = redis.call('get', KEYS[1])
  if not current then
    redis.call('set', KEYS[1], ARGV[1], 'PX', ARGV[2])
    local fence = redis.call('incr', KEYS[2])
    return {1, fence, 'LOCK_ACQUIRED'}
  elseif current == ARGV[1] then
    redis.call('pexpire', KEYS[1], ARGV[2])
    local fence = tonumber(redis.call('get', KEYS[2]) or '1')
    return {1, fence, 'LOCK_RENEWED'}
  else
    local fence = tonumber(redis.call('get', KEYS[2]) or '0')
    return {0, fence, 'LOCK_HELD_BY_OTHER'}
  end
`;

const VERIFY_AND_RENEW_LOCK_LUA = `
  local current = redis.call('get', KEYS[1])
  if current == ARGV[1] then
    redis.call('pexpire', KEYS[1], ARGV[2])
    local fence = tonumber(redis.call('get', KEYS[2]) or '1')
    return {1, fence, 'LOCK_RENEWED'}
  elseif not current then
    return {0, 0, 'LOCK_EXPIRED_OR_LOST'}
  else
    local fence = tonumber(redis.call('get', KEYS[2]) or '0')
    return {0, fence, 'LOCK_HELD_BY_OTHER'}
  end
`;

const RELEASE_LOCK_LUA = `
  if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
  else
    return 0
  end
`;

const CONSUME_KEY_ATOMIC_LUA = `
  local val = redis.call('get', KEYS[1])
  if val then
    redis.call('del', KEYS[1])
    return val
  end
  return nil
`;

type SyncListener = (msg: RedisPubSubMessage) => void;
type ReconnectListener = () => void;

export class RedisCoordinator {
  private client: Redis | null = null;
  private subscriber: Redis | null = null;
  private customTransport: RedisTransport | null = null;
  private status: ServiceHealthState = 'UNCONFIGURED';
  private initialized = false;
  private hasConnectedOnce = false;
  private readonly listeners = new Set<SyncListener>();
  private readonly reconnectListeners = new Set<ReconnectListener>();
  private readonly localLocks = new Map<
    string,
    { owner: string; fencingToken: number; expiresAt: number }
  >();
  private localFenceSeq = 0;

  /**
   * Injects a custom atomic Redis transport (primarily for multi-instance integration tests)
   * or pass null to restore real ioredis management.
   */
  _setTestTransport(transport: RedisTransport | null): void {
    this.customTransport = transport;
    this.initialized = Boolean(transport);
    this.status = transport ? transport.status : 'UNCONFIGURED';
    this.localLocks.clear();
  }

  _emitTestReconnect(): void {
    for (const cb of this.reconnectListeners) {
      try {
        cb();
      } catch (err) {
        aegisLogger.error('REDIS', 'Reconnect hook failed', { meta: { err } });
      }
    }
  }

  _emitTestMessage(msg: RedisPubSubMessage): void {
    for (const listener of this.listeners) {
      listener(msg);
    }
  }

  async ensureConnected(): Promise<ServiceHealthState> {
    if (this.customTransport) {
      this.status = this.customTransport.status;
      return this.status;
    }

    const { redisUrl } = getServerEnv();
    if (!redisUrl) {
      this.status = 'UNCONFIGURED';
      return this.status;
    }

    if (this.initialized && this.client) {
      try {
        const pong = await Promise.race([
          this.client.ping(),
          new Promise<string>((_, rej) => setTimeout(() => rej(new Error('timeout')), 1200)),
        ]);
        this.status = pong === 'PONG' ? 'CONNECTED' : 'DEGRADED';
      } catch {
        this.status = 'DEGRADED';
      }
      return this.status;
    }

    this.initialized = true;
    try {
      this.client = new Redis(redisUrl, {
        maxRetriesPerRequest: 2,
        enableOfflineQueue: false,
        connectTimeout: 2500,
        retryStrategy: (times) => Math.min(times * 400, 5000),
        lazyConnect: true,
      });

      this.client.on('error', (err) => {
        this.status = 'DEGRADED';
        aegisLogger.warn('REDIS', 'Redis client connection degraded', { meta: { err } });
      });

      this.client.on('close', () => {
        if (this.status === 'CONNECTED') {
          this.status = 'DEGRADED';
        }
      });

      this.client.on('ready', () => {
        this.status = 'CONNECTED';
        if (this.hasConnectedOnce) {
          aegisLogger.info('REDIS', 'Redis client reconnected; triggering recovery hooks');
          for (const cb of this.reconnectListeners) {
            try {
              cb();
            } catch (err) {
              aegisLogger.error('REDIS', 'Reconnect hook failed', { meta: { err } });
            }
          }
        }
        this.hasConnectedOnce = true;
      });

      await this.client.connect();
      await this.client.ping();
      this.status = 'CONNECTED';
      this.hasConnectedOnce = true;

      this.subscriber = new Redis(redisUrl, {
        maxRetriesPerRequest: null,
        enableOfflineQueue: true,
        connectTimeout: 2500,
        retryStrategy: (times) => Math.min(times * 400, 5000),
        lazyConnect: true,
      });

      this.subscriber.on('error', (err) => {
        aegisLogger.warn('REDIS', 'Redis subscriber error', { meta: { err } });
      });

      this.subscriber.on('ready', async () => {
        try {
          await this.subscriber?.subscribe('aegis:sync', 'aegis:events', 'aegis:bot:control');
          aegisLogger.info('REDIS', 'Redis Pub/Sub channels subscribed');
        } catch (err) {
          aegisLogger.error('REDIS', 'Failed to subscribe Redis channels', { meta: { err } });
        }
      });

      await this.subscriber.connect();
      await this.subscriber.subscribe('aegis:sync', 'aegis:events', 'aegis:bot:control');
      this.subscriber.on('message', (channel, raw) => {
        try {
          const parsed = JSON.parse(raw) as RedisPubSubMessage;
          if (!parsed || typeof parsed.event !== 'string') return;
          for (const listener of this.listeners) {
            listener({ ...parsed, channel });
          }
        } catch (err) {
          aegisLogger.warn('REDIS', 'Ignored malformed Redis Pub/Sub payload', {
            meta: { channel, err },
          });
        }
      });
    } catch (err) {
      this.status = 'DEGRADED';
      aegisLogger.error('REDIS', 'Redis initialization failed; distributed features fail-closed', {
        meta: { err },
      });
    }

    return this.status;
  }

  getStatus(): ServiceHealthState {
    if (this.customTransport) {
      return this.customTransport.status;
    }
    return this.status;
  }

  private getActiveTransport(): RedisTransport | Redis | null {
    if (this.customTransport) {
      return this.customTransport.status === 'CONNECTED' ? this.customTransport : null;
    }
    if (!this.client || this.status !== 'CONNECTED') return null;
    return this.client;
  }

  async publish(
    channel: 'aegis:sync' | 'aegis:events' | 'aegis:bot:control',
    event: string,
    payload: unknown,
    guildId?: string,
    originProcessId?: string,
    extras?: { syncVersion?: number; configHash?: string; correlationId?: string; fencingToken?: number | null }
  ): Promise<boolean> {
    const msg: RedisPubSubMessage = {
      channel,
      event,
      guildId,
      syncVersion: extras?.syncVersion,
      configHash: extras?.configHash,
      correlationId: extras?.correlationId,
      fencingToken: extras?.fencingToken ?? null,
      payload,
      originProcessId,
      timestamp: new Date().toISOString(),
    };
    const transport = this.getActiveTransport();
    if (!transport) {
      return false;
    }
    try {
      await transport.publish(channel, JSON.stringify(msg));
      return true;
    } catch (err) {
      this.status = 'DEGRADED';
      aegisLogger.warn('REDIS', `Publish failed on ${channel}`, {
        guildId,
        correlationId: extras?.correlationId,
        meta: { event, err },
      });
      return false;
    }
  }

  async publishControl(
    action: string,
    payload: Record<string, unknown>,
    originProcessId?: string
  ): Promise<boolean> {
    return this.publish('aegis:bot:control', action, payload, undefined, originProcessId);
  }

  async incrementSlidingWindow(key: string, windowSeconds: number): Promise<number | null> {
    const transport = this.getActiveTransport();
    if (!transport) return null;
    const now = Date.now();
    const minScore = now - windowSeconds * 1000;
    const member = `${now}-${Math.random().toString(36).slice(2, 8)}`;
    const lua = `
      redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[1])
      redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
      redis.call('EXPIRE', KEYS[1], tonumber(ARGV[4]) + 5)
      return redis.call('ZCARD', KEYS[1])
    `;
    try {
      const count = await transport.eval(
        lua,
        1,
        key,
        String(minScore),
        String(now),
        member,
        String(windowSeconds)
      );
      return Number(count);
    } catch {
      this.status = 'DEGRADED';
      return null;
    }
  }

  /**
   * Acquires (or renews if already held by the same owner) a distributed lock with a monotonic
   * fencing token via an atomic Redis Lua script.
   *
   * FAIL-CLOSED GUARANTEE:
   * - If Redis is configured OR `requireDistributedLock` is true and Redis is NOT CONNECTED,
   *   this ALWAYS returns `{ acquired: false, reason: 'REDIS_UNAVAILABLE' }`.
   * - Process-local lock fallback is ONLY allowed when `!redisConfigured && localSingleInstance && !requireDistributedLock`.
   */
  async acquireDistributedLockWithFencing(
    lockKey: string,
    ownerToken: string,
    ttlMs: number
  ): Promise<DistributedLockResult> {
    const env = getServerEnv();
    const fenceKey = `${lockKey}:fencing`;
    const transport = this.getActiveTransport();

    if (transport) {
      try {
        const raw = (await transport.eval(
          ACQUIRE_LOCK_WITH_FENCING_LUA,
          2,
          lockKey,
          fenceKey,
          ownerToken,
          String(ttlMs)
        )) as [number, number, string];
        const acquired = Number(raw?.[0]) === 1;
        const fencingToken = Number.isFinite(Number(raw?.[1])) ? Number(raw[1]) : null;
        const reason = (raw?.[2] as DistributedLockReason) ||
          (acquired ? 'LOCK_ACQUIRED' : 'LOCK_HELD_BY_OTHER');
        return { acquired, fencingToken, ownerToken, reason };
      } catch (err) {
        this.status = 'DEGRADED';
        aegisLogger.error('REDIS', 'Atomic lock acquisition failed', {
          meta: { lockKey, ownerToken, err },
        });
        return {
          acquired: false,
          fencingToken: null,
          ownerToken,
          reason: 'LOCK_ERROR',
        };
      }
    }

    // Fail-closed whenever Redis or distributed locking is required
    if (env.redisConfigured || env.requireDistributedLock || !env.localSingleInstance) {
      return {
        acquired: false,
        fencingToken: null,
        ownerToken,
        reason: 'REDIS_UNAVAILABLE',
      };
    }

    // Explicit local single-instance mode (dev / sandbox without Redis)
    const now = Date.now();
    const existing = this.localLocks.get(lockKey);
    if (existing && existing.expiresAt > now && existing.owner !== ownerToken) {
      return {
        acquired: false,
        fencingToken: existing.fencingToken,
        ownerToken,
        reason: 'LOCK_HELD_BY_OTHER',
      };
    }
    if (existing && existing.owner === ownerToken) {
      existing.expiresAt = now + ttlMs;
      return {
        acquired: true,
        fencingToken: existing.fencingToken,
        ownerToken,
        reason: 'LOCK_RENEWED',
      };
    }
    this.localFenceSeq += 1;
    this.localLocks.set(lockKey, {
      owner: ownerToken,
      fencingToken: this.localFenceSeq,
      expiresAt: now + ttlMs,
    });
    return {
      acquired: true,
      fencingToken: this.localFenceSeq,
      ownerToken,
      reason: 'LOCAL_SINGLE_INSTANCE',
    };
  }

  /**
   * Strictly verifies existing lock ownership and extends TTL atomically.
   * Unlike acquire, this FAILS with `LOCK_EXPIRED_OR_LOST` if the lock vanished or changed owner.
   */
  async verifyAndRenewDistributedLock(
    lockKey: string,
    ownerToken: string,
    ttlMs: number
  ): Promise<DistributedLockResult> {
    const env = getServerEnv();
    const fenceKey = `${lockKey}:fencing`;
    const transport = this.getActiveTransport();

    if (transport) {
      try {
        const raw = (await transport.eval(
          VERIFY_AND_RENEW_LOCK_LUA,
          2,
          lockKey,
          fenceKey,
          ownerToken,
          String(ttlMs)
        )) as [number, number, string];
        const acquired = Number(raw?.[0]) === 1;
        const fencingToken = Number.isFinite(Number(raw?.[1])) && Number(raw[1]) > 0 ? Number(raw[1]) : null;
        const reason = (raw?.[2] as DistributedLockReason) ||
          (acquired ? 'LOCK_RENEWED' : 'LOCK_EXPIRED_OR_LOST');
        return { acquired, fencingToken, ownerToken, reason };
      } catch (err) {
        this.status = 'DEGRADED';
        aegisLogger.warn('REDIS', 'Atomic lock verification/renewal failed', {
          meta: { lockKey, ownerToken, err },
        });
        return {
          acquired: false,
          fencingToken: null,
          ownerToken,
          reason: 'LOCK_ERROR',
        };
      }
    }

    if (env.redisConfigured || env.requireDistributedLock || !env.localSingleInstance) {
      return {
        acquired: false,
        fencingToken: null,
        ownerToken,
        reason: 'REDIS_UNAVAILABLE',
      };
    }

    const now = Date.now();
    const existing = this.localLocks.get(lockKey);
    if (!existing || existing.expiresAt <= now) {
      this.localLocks.delete(lockKey);
      return {
        acquired: false,
        fencingToken: null,
        ownerToken,
        reason: 'LOCK_EXPIRED_OR_LOST',
      };
    }
    if (existing.owner !== ownerToken) {
      return {
        acquired: false,
        fencingToken: existing.fencingToken,
        ownerToken,
        reason: 'LOCK_HELD_BY_OTHER',
      };
    }
    existing.expiresAt = now + ttlMs;
    return {
      acquired: true,
      fencingToken: existing.fencingToken,
      ownerToken,
      reason: 'LOCK_RENEWED',
    };
  }

  async acquireDistributedLock(
    lockKey: string,
    ownerToken: string,
    ttlMs: number
  ): Promise<boolean> {
    const res = await this.acquireDistributedLockWithFencing(lockKey, ownerToken, ttlMs);
    return res.acquired;
  }

  async releaseDistributedLock(lockKey: string, ownerToken: string): Promise<boolean> {
    const transport = this.getActiveTransport();
    if (transport) {
      try {
        const released = await transport.eval(RELEASE_LOCK_LUA, 1, lockKey, ownerToken);
        return Number(released) === 1;
      } catch (err) {
        aegisLogger.warn('REDIS', 'Lock release failed', { meta: { lockKey, ownerToken, err } });
        return false;
      }
    }
    const existing = this.localLocks.get(lockKey);
    if (existing && existing.owner === ownerToken) {
      this.localLocks.delete(lockKey);
      return true;
    }
    return false;
  }

  async setSharedKey(key: string, value: string, ttlMs: number): Promise<boolean> {
    const transport = this.getActiveTransport();
    if (!transport) return false;
    try {
      if (this.customTransport) {
        await this.customTransport.set(key, value, ttlMs);
      } else if (this.client) {
        await this.client.set(key, value, 'PX', ttlMs);
      }
      return true;
    } catch {
      return false;
    }
  }

  async getSharedKey(key: string): Promise<string | null> {
    const transport = this.getActiveTransport();
    if (!transport) return null;
    try {
      return await transport.get(key);
    } catch {
      return null;
    }
  }

  async consumeSharedKeyAtomically(key: string): Promise<string | null> {
    const transport = this.getActiveTransport();
    if (!transport) return null;
    try {
      const val = await transport.eval(CONSUME_KEY_ATOMIC_LUA, 1, key);
      return typeof val === 'string' ? val : null;
    } catch {
      return null;
    }
  }

  async deleteSharedKey(key: string): Promise<boolean> {
    const transport = this.getActiveTransport();
    if (!transport) return false;
    try {
      await transport.del(key);
      return true;
    } catch {
      return false;
    }
  }

  async setBotHeartbeat(payload: RedisBotHeartbeatPayload): Promise<boolean> {
    const transport = this.getActiveTransport();
    if (!transport) return false;
    try {
      const serialized = JSON.stringify(payload);
      if (this.customTransport) {
        await this.customTransport.set('aegis:bot:heartbeat', serialized, 45_000);
      } else if (this.client) {
        await this.client.set('aegis:bot:heartbeat', serialized, 'EX', 45);
      }
      return true;
    } catch {
      return false;
    }
  }

  async getBotHeartbeat(): Promise<
    (RedisBotHeartbeatPayload & { online: boolean }) | null
  > {
    const transport = this.getActiveTransport();
    if (!transport) return null;
    try {
      const raw = await transport.get('aegis:bot:heartbeat');
      if (!raw) return null;
      const parsed = JSON.parse(raw) as RedisBotHeartbeatPayload;
      if (Date.now() - parsed.updatedAt > 45_000) {
        return null;
      }
      return {
        ...parsed,
        online: true,
      };
    } catch {
      return null;
    }
  }

  async setWorkerHeartbeat(payload: RedisWorkerHeartbeatPayload): Promise<boolean> {
    const transport = this.getActiveTransport();
    if (!transport) return false;
    try {
      const serialized = JSON.stringify(payload);
      if (this.customTransport) {
        await this.customTransport.set('aegis:worker:heartbeat', serialized, 120_000);
      } else if (this.client) {
        await this.client.set('aegis:worker:heartbeat', serialized, 'EX', 120);
      }
      return true;
    } catch {
      return false;
    }
  }

  async getWorkerHeartbeat(): Promise<RedisWorkerHeartbeatPayload | null> {
    const transport = this.getActiveTransport();
    if (!transport) return null;
    try {
      const raw = await transport.get('aegis:worker:heartbeat');
      if (!raw) return null;
      const parsed = JSON.parse(raw) as RedisWorkerHeartbeatPayload;
      if (Date.now() - parsed.updatedAt > 120_000) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  subscribe(listener: SyncListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onReconnect(listener: ReconnectListener): () => void {
    this.reconnectListeners.add(listener);
    return () => {
      this.reconnectListeners.delete(listener);
    };
  }

  async disconnect(): Promise<void> {
    if (this.customTransport) {
      await this.customTransport.quit().catch(() => undefined);
      this.status = 'OFFLINE';
      return;
    }
    await Promise.allSettled([
      this.subscriber?.quit(),
      this.client?.quit(),
    ]);
    this.subscriber = null;
    this.client = null;
    this.status = getServerEnv().redisConfigured ? 'OFFLINE' : 'UNCONFIGURED';
  }
}

export const redisCoordinator = new RedisCoordinator();
