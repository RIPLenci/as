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
  payload: unknown;
  originProcessId?: string;
  timestamp: string;
}

export interface RedisBotHeartbeatPayload {
  updatedAt: number;
  instanceId?: string;
  pid?: number;
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

type SyncListener = (msg: RedisPubSubMessage) => void;
type ReconnectListener = () => void;

class RedisCoordinator {
  private client: Redis | null = null;
  private subscriber: Redis | null = null;
  private status: ServiceHealthState = 'UNCONFIGURED';
  private initialized = false;
  private hasConnectedOnce = false;
  private readonly listeners = new Set<SyncListener>();
  private readonly reconnectListeners = new Set<ReconnectListener>();

  async ensureConnected(): Promise<ServiceHealthState> {
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
      aegisLogger.error('REDIS', 'Redis initialization failed; running in Mongo/L1 fallback mode', {
        meta: { err },
      });
    }

    return this.status;
  }

  getStatus(): ServiceHealthState {
    return this.status;
  }

  async publish(
    channel: 'aegis:sync' | 'aegis:events' | 'aegis:bot:control',
    event: string,
    payload: unknown,
    guildId?: string,
    originProcessId?: string,
    extras?: { syncVersion?: number; configHash?: string; correlationId?: string }
  ): Promise<boolean> {
    const msg: RedisPubSubMessage = {
      channel,
      event,
      guildId,
      syncVersion: extras?.syncVersion,
      configHash: extras?.configHash,
      correlationId: extras?.correlationId,
      payload,
      originProcessId,
      timestamp: new Date().toISOString(),
    };
    if (!this.client || this.status !== 'CONNECTED') {
      return false;
    }
    try {
      await this.client.publish(channel, JSON.stringify(msg));
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
    if (!this.client || this.status !== 'CONNECTED') return null;
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
      const count = await this.client.eval(
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

  async acquireDistributedLock(
    lockKey: string,
    ownerToken: string,
    ttlMs: number
  ): Promise<boolean> {
    if (!this.client || this.status !== 'CONNECTED') return true;
    try {
      const res = await this.client.set(lockKey, ownerToken, 'PX', ttlMs, 'NX');
      if (res === 'OK') return true;
      const currentOwner = await this.client.get(lockKey);
      if (currentOwner === ownerToken) {
        await this.client.pexpire(lockKey, ttlMs);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  async releaseDistributedLock(lockKey: string, ownerToken: string): Promise<void> {
    if (!this.client || this.status !== 'CONNECTED') return;
    const lua = `
      if redis.call('get', KEYS[1]) == ARGV[1] then
        return redis.call('del', KEYS[1])
      else
        return 0
      end
    `;
    try {
      await this.client.eval(lua, 1, lockKey, ownerToken);
    } catch {
      // Ignore lock release failures on shutdown
    }
  }

  async setBotHeartbeat(payload: RedisBotHeartbeatPayload): Promise<boolean> {
    if (!this.client || this.status !== 'CONNECTED') return false;
    try {
      await this.client.set('aegis:bot:heartbeat', JSON.stringify(payload), 'EX', 45);
      return true;
    } catch {
      return false;
    }
  }

  async getBotHeartbeat(): Promise<
    (RedisBotHeartbeatPayload & { online: boolean }) | null
  > {
    if (!this.client || this.status !== 'CONNECTED') return null;
    try {
      const raw = await this.client.get('aegis:bot:heartbeat');
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
    await Promise.allSettled([
      this.subscriber?.quit(),
      this.client?.quit(),
    ]);
    this.subscriber = null;
    this.client = null;
  }
}

export const redisCoordinator = new RedisCoordinator();
