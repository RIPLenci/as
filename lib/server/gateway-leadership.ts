import crypto from 'node:crypto';
import { getServerEnv } from './env';
import { aegisLogger } from './logger';
import { redisCoordinator, type DistributedLockResult } from './redis';

export type GatewayLeaderState =
  | 'INITIALIZING'
  | 'LEADER'
  | 'NO_LEADER'
  | 'SHUTTING_DOWN';

export interface GatewayLeadershipOptions {
  lockKey?: string;
  instanceId?: string;
  ttlMs?: number;
  onLeadershipLost?: (reason: string) => Promise<void> | void;
  onDisconnectGateway?: () => Promise<void> | void;
}

export const GATEWAY_OWNER_LOCK_KEY = 'aegis:bot:gateway_owner';

/**
 * Coordinates single-owner distributed leadership for the Discord Gateway.
 * Guarantees:
 * - Fail-closed when Redis is configured or required and unreachable.
 * - Monotonic fencing tokens from Redis Lua atomic acquire.
 * - Strict lock verification during heartbeats (verifyAndRenewDistributedLock).
 * - Immediate transition to `NO_LEADER` + event gate closure + Gateway disconnect on lock loss.
 * - Atomic lock release ONLY if this instance still owns the lock during shutdown.
 */
export class GatewayLeadershipController {
  public readonly lockKey: string;
  public readonly instanceId: string;
  public readonly ttlMs: number;
  private state: GatewayLeaderState = 'INITIALIZING';
  private fencingToken: number | null = null;
  private abortController = new AbortController();
  private readonly inFlightTasks = new Set<Promise<unknown>>();
  private shutdownPromise: Promise<void> | null = null;
  private readonly onLeadershipLost?: (reason: string) => Promise<void> | void;
  private readonly onDisconnectGateway?: () => Promise<void> | void;

  constructor(options: GatewayLeadershipOptions = {}) {
    this.lockKey = options.lockKey ?? GATEWAY_OWNER_LOCK_KEY;
    this.instanceId =
      options.instanceId ?? `bot-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
    this.ttlMs = options.ttlMs ?? 45_000;
    this.onLeadershipLost = options.onLeadershipLost;
    this.onDisconnectGateway = options.onDisconnectGateway;
  }

  getState(): GatewayLeaderState {
    return this.state;
  }

  getFencingToken(): number | null {
    return this.fencingToken;
  }

  getAbortSignal(): AbortSignal {
    return this.abortController.signal;
  }

  canProcessEvents(): boolean {
    return this.state === 'LEADER' && !this.abortController.signal.aborted;
  }

  trackCriticalOperation<T>(promise: Promise<T>): Promise<T> {
    this.inFlightTasks.add(promise);
    void promise.finally(() => {
      this.inFlightTasks.delete(promise);
    });
    return promise;
  }

  async acquireLeadership(): Promise<DistributedLockResult> {
    if (this.state === 'SHUTTING_DOWN') {
      return {
        acquired: false,
        fencingToken: this.fencingToken,
        ownerToken: this.instanceId,
        reason: 'LOCK_ERROR',
      };
    }

    const res = await redisCoordinator.acquireDistributedLockWithFencing(
      this.lockKey,
      this.instanceId,
      this.ttlMs
    );

    if (res.acquired) {
      this.state = 'LEADER';
      this.fencingToken = res.fencingToken;
      if (this.abortController.signal.aborted) {
        this.abortController = new AbortController();
      }
      aegisLogger.info('DISCORD', 'Gateway leadership acquired', {
        meta: {
          lockKey: this.lockKey,
          instanceId: this.instanceId,
          fencingToken: this.fencingToken,
          reason: res.reason,
        },
      });
    } else {
      this.state = 'NO_LEADER';
      aegisLogger.warn('DISCORD', 'Gateway leadership acquisition rejected', {
        meta: {
          lockKey: this.lockKey,
          instanceId: this.instanceId,
          reason: res.reason,
        },
      });
    }

    return res;
  }

  async verifyAndRenewLeadership(): Promise<DistributedLockResult> {
    if (this.state !== 'LEADER') {
      return {
        acquired: false,
        fencingToken: this.fencingToken,
        ownerToken: this.instanceId,
        reason: 'LOCK_EXPIRED_OR_LOST',
      };
    }

    const env = getServerEnv();
    if (
      (env.redisConfigured || env.requireDistributedLock) &&
      redisCoordinator.getStatus() !== 'CONNECTED'
    ) {
      await this.handleLostLeadership('REDIS_DISCONNECTED_DURING_HEARTBEAT');
      return {
        acquired: false,
        fencingToken: null,
        ownerToken: this.instanceId,
        reason: 'REDIS_UNAVAILABLE',
      };
    }

    const res = await redisCoordinator.verifyAndRenewDistributedLock(
      this.lockKey,
      this.instanceId,
      this.ttlMs
    );

    if (!res.acquired) {
      await this.handleLostLeadership(res.reason);
      return res;
    }

    if (res.fencingToken !== null) {
      this.fencingToken = res.fencingToken;
    }
    return res;
  }

  async handleLostLeadership(reason: string): Promise<void> {
    if (this.state === 'NO_LEADER' || this.state === 'SHUTTING_DOWN') return;
    this.state = 'NO_LEADER';
    this.abortController.abort(reason);

    aegisLogger.error('DISCORD', 'LOST_LEADERSHIP: Halting Gateway processing immediately', {
      meta: {
        lockKey: this.lockKey,
        instanceId: this.instanceId,
        previousFencingToken: this.fencingToken,
        reason,
      },
    });

    await this.waitForInFlightOperations(2500);

    if (this.onDisconnectGateway) {
      await Promise.resolve(this.onDisconnectGateway()).catch((err) => {
        aegisLogger.warn('DISCORD', 'Gateway disconnect after leadership loss warning', {
          meta: { error: err instanceof Error ? err.message : String(err) },
        });
      });
    }

    if (this.onLeadershipLost) {
      await Promise.resolve(this.onLeadershipLost(reason)).catch((err) => {
        aegisLogger.warn('DISCORD', 'Leadership lost callback error', {
          meta: { error: err instanceof Error ? err.message : String(err) },
        });
      });
    }
  }

  private async waitForInFlightOperations(timeoutMs: number): Promise<void> {
    if (this.inFlightTasks.size === 0) return;
    await Promise.race([
      Promise.allSettled(Array.from(this.inFlightTasks)),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }

  async shutdown(signal: string): Promise<{ releasedLock: boolean }> {
    if (this.shutdownPromise) {
      await this.shutdownPromise;
      return { releasedLock: false };
    }

    let releasedLock = false;
    this.shutdownPromise = (async () => {
      const wasLeader = this.state === 'LEADER';
      this.state = 'SHUTTING_DOWN';
      this.abortController.abort(`SHUTDOWN:${signal}`);

      aegisLogger.info('SYSTEM', `Gateway leadership shutdown initiated (${signal})`, {
        meta: {
          instanceId: this.instanceId,
          wasLeader,
          fencingToken: this.fencingToken,
          inFlightTasks: this.inFlightTasks.size,
        },
      });

      await this.waitForInFlightOperations(3500);

      if (this.onDisconnectGateway) {
        await Promise.resolve(this.onDisconnectGateway()).catch((err) => {
          aegisLogger.warn('DISCORD', 'Gateway destroy warning during shutdown', {
            meta: { error: err instanceof Error ? err.message : String(err) },
          });
        });
      }

      if (wasLeader) {
        releasedLock = await redisCoordinator.releaseDistributedLock(
          this.lockKey,
          this.instanceId
        );
        aegisLogger.info('DISCORD', 'Gateway distributed lock release completed', {
          meta: {
            lockKey: this.lockKey,
            instanceId: this.instanceId,
            releasedLock,
          },
        });
      }
    })();

    await this.shutdownPromise;
    return { releasedLock };
  }
}
