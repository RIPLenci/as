import Redis from 'ioredis';
import type { ServiceHealthState } from '../aegis/types';
import { getServerEnv } from './env';

export interface RedisPubSubMessage {
  channel: string;
  event: string;
  guildId?: string;
  payload: unknown;
  originProcessId?: string;
  timestamp: string;
}

type SyncListener = (msg: RedisPubSubMessage) => void;

class RedisCoordinator {
  private client: Redis | null = null;
  private subscriber: Redis | null = null;
  private status: ServiceHealthState = 'UNCONFIGURED';
  private initialized = false;
  private readonly listeners = new Set<SyncListener>();

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
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 2000,
        lazyConnect: true,
      });
      this.client.on('error', () => {
        this.status = 'DEGRADED';
      });
      this.client.on('ready', () => {
        this.status = 'CONNECTED';
      });

      await this.client.connect();
      await this.client.ping();
      this.status = 'CONNECTED';

      this.subscriber = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 2000,
        lazyConnect: true,
      });
      this.subscriber.on('error', () => {
        // Safe degradation when pub/sub drops
      });
      await this.subscriber.connect();
      await this.subscriber.subscribe('aegis:sync', 'aegis:events');
      this.subscriber.on('message', (channel, raw) => {
        try {
          const parsed = JSON.parse(raw) as RedisPubSubMessage;
          for (const listener of this.listeners) {
            listener({ ...parsed, channel });
          }
        } catch {
          // Ignore malformed pubsub message
        }
      });
    } catch {
      this.status = 'DEGRADED';
    }

    return this.status;
  }

  getStatus(): ServiceHealthState {
    return this.status;
  }

  async publish(
    channel: 'aegis:sync' | 'aegis:events',
    event: string,
    payload: unknown,
    guildId?: string,
    originProcessId?: string
  ): Promise<boolean> {
    const msg: RedisPubSubMessage = {
      channel,
      event,
      guildId,
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
    } catch {
      this.status = 'DEGRADED';
      return false;
    }
  }

  /**
   * Atomic sliding-window counter via Redis Lua script when connected.
   * Returns null if Redis is degraded/unconfigured so caller uses safe local fallback.
   */
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

  async getBotHeartbeat(): Promise<{
    online: boolean;
    tag: string | null;
    id: string | null;
    avatarUrl: string | null;
    pingMs: number | null;
    guildCount: number | null;
    userCount: number | null;
  } | null> {
    if (!this.client || this.status !== 'CONNECTED') return null;
    try {
      const raw = await this.client.get('aegis:bot:heartbeat');
      if (!raw) return null;
      const parsed = JSON.parse(raw) as {
        updatedAt: number;
        tag: string;
        id: string;
        avatarUrl?: string | null;
        pingMs: number;
        guildCount: number;
        userCount?: number | null;
      };
      if (Date.now() - parsed.updatedAt > 45_000) {
        return null;
      }
      return {
        online: true,
        tag: parsed.tag,
        id: parsed.id,
        avatarUrl: parsed.avatarUrl ?? null,
        pingMs: parsed.pingMs,
        guildCount: parsed.guildCount,
        userCount: typeof parsed.userCount === 'number' ? parsed.userCount : null,
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
}

export const redisCoordinator = new RedisCoordinator();
