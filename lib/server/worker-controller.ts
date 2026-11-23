import crypto from 'node:crypto';
import { getServerEnv } from './env';
import { aegisLogger } from './logger';
import { ensureMongoConnected, getMongoStatus, WorkerJobStateModel } from './mongodb';
import { redisCoordinator } from './redis';
import { aegisStore } from './store';
import { flushPendingSyncOutbox } from './sync-coordinator';

export const WORKER_CYCLE_LOCK_KEY = 'aegis:worker:cycle_lock';

export interface WorkerCycleOutcome {
  runId: string;
  executed: boolean;
  skipReason?: 'OVERLAPPING_CYCLE' | 'REDIS_UNAVAILABLE' | 'LOCK_HELD_BY_OTHER' | 'SHUTTING_DOWN';
  expiredGlobalBans: number;
  expiredQuarantines: number;
  expiredPremium: number;
  autoBackedUp: number;
  outboxFlushed: number;
  durationMs: number;
  error: string | null;
}

export class AegisWorkerController {
  public readonly instanceId: string;
  private isCycleRunning = false;
  private shuttingDown = false;
  private cycleCount = 0;
  private activeCyclePromise: Promise<WorkerCycleOutcome> | null = null;
  private activeAbortController: AbortController | null = null;
  private readonly executedRunIds = new Set<string>();

  constructor(instanceId?: string) {
    this.instanceId =
      instanceId ?? `worker-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
  }

  public isRunning(): boolean {
    return this.isCycleRunning;
  }

  private async persistJobState(
    status: 'RUNNING' | 'COMPLETED' | 'FAILED',
    runId: string,
    summary: Record<string, unknown>,
    errorMessage: string | null = null
  ): Promise<void> {
    if (getMongoStatus() !== 'CONNECTED') return;
    try {
      await WorkerJobStateModel.findOneAndUpdate(
        { jobKey: 'aegis_expiration_worker' },
        {
          $set: {
            jobKey: 'aegis_expiration_worker',
            lastRunId: runId,
            status,
            instanceId: this.instanceId,
            ...(status === 'RUNNING' ? { startedAt: new Date() } : { completedAt: new Date() }),
            summary,
            errorMessage,
          },
        },
        { upsert: true }
      );
    } catch (err) {
      aegisLogger.warn('WORKER', 'Unable to persist WorkerJobState in MongoDB', {
        meta: { runId, status, err },
      });
    }
  }

  private async publishHeartbeat(
    status: 'ACTIVE' | 'IDLE' | 'DEGRADED' | 'ERROR' | 'SHUTTING_DOWN',
    outcome?: Partial<WorkerCycleOutcome>
  ): Promise<void> {
    if (redisCoordinator.getStatus() !== 'CONNECTED') return;
    await redisCoordinator.setWorkerHeartbeat({
      updatedAt: Date.now(),
      instanceId: this.instanceId,
      pid: process.pid,
      status,
      lastCycleAt: new Date().toISOString(),
      lastCycleDurationMs: outcome?.durationMs ?? 0,
      expiredGlobalBans: outcome?.expiredGlobalBans ?? 0,
      expiredQuarantines: outcome?.expiredQuarantines ?? 0,
      expiredPremium: outcome?.expiredPremium ?? 0,
      autoBackedUp: outcome?.autoBackedUp ?? 0,
      outboxFlushed: outcome?.outboxFlushed ?? 0,
      lastError: outcome?.error ?? null,
      cycleCount: this.cycleCount,
    });
  }

  public async runCycle(explicitRunId?: string): Promise<WorkerCycleOutcome> {
    const startMs = Date.now();
    const runId =
      explicitRunId || `wrk_${startMs.toString(36)}_${crypto.randomBytes(3).toString('hex')}`;

    if (this.shuttingDown) {
      return {
        runId,
        executed: false,
        skipReason: 'SHUTTING_DOWN',
        expiredGlobalBans: 0,
        expiredQuarantines: 0,
        expiredPremium: 0,
        autoBackedUp: 0,
        outboxFlushed: 0,
        durationMs: 0,
        error: null,
      };
    }

    if (this.executedRunIds.has(runId)) {
      return {
        runId,
        executed: false,
        skipReason: 'OVERLAPPING_CYCLE',
        expiredGlobalBans: 0,
        expiredQuarantines: 0,
        expiredPremium: 0,
        autoBackedUp: 0,
        outboxFlushed: 0,
        durationMs: 0,
        error: null,
      };
    }

    if (this.isCycleRunning) {
      aegisLogger.debug('WORKER', 'Skipped overlapping worker cycle on same instance', {
        meta: { instanceId: this.instanceId, runId },
      });
      return {
        runId,
        executed: false,
        skipReason: 'OVERLAPPING_CYCLE',
        expiredGlobalBans: 0,
        expiredQuarantines: 0,
        expiredPremium: 0,
        autoBackedUp: 0,
        outboxFlushed: 0,
        durationMs: 0,
        error: null,
      };
    }

    this.isCycleRunning = true;
    const cyclePromise = this.executeLockedCycle(runId, startMs);
    this.activeCyclePromise = cyclePromise;
    try {
      return await cyclePromise;
    } finally {
      this.isCycleRunning = false;
      if (this.activeCyclePromise === cyclePromise) {
        this.activeCyclePromise = null;
      }
    }
  }

  private async executeLockedCycle(runId: string, startMs: number): Promise<WorkerCycleOutcome> {
    const correlationId = aegisLogger.createCorrelationId('wrk');
    const env = getServerEnv();
    const abortCtrl = new AbortController();
    this.activeAbortController = abortCtrl;

    let lockAcquired = false;
    let renewTimer: NodeJS.Timeout | null = null;
    let outcome: WorkerCycleOutcome = {
      runId,
      executed: false,
      expiredGlobalBans: 0,
      expiredQuarantines: 0,
      expiredPremium: 0,
      autoBackedUp: 0,
      outboxFlushed: 0,
      durationMs: 0,
      error: null,
    };

    try {
      const lockRes = await redisCoordinator.acquireDistributedLockWithFencing(
        WORKER_CYCLE_LOCK_KEY,
        this.instanceId,
        50_000
      );

      if (!lockRes.acquired) {
        const skipReason =
          lockRes.reason === 'REDIS_UNAVAILABLE'
            ? 'REDIS_UNAVAILABLE'
            : 'LOCK_HELD_BY_OTHER';
        aegisLogger.warn('WORKER', 'Worker cycle skipped: distributed lock not acquired', {
          correlationId,
          meta: {
            instanceId: this.instanceId,
            reason: lockRes.reason,
            redisRequired: env.redisConfigured || env.requireDistributedLock,
          },
        });
        await this.publishHeartbeat(skipReason === 'REDIS_UNAVAILABLE' ? 'DEGRADED' : 'IDLE', {
          durationMs: Date.now() - startMs,
          error: skipReason === 'REDIS_UNAVAILABLE' ? 'REDIS_UNAVAILABLE' : null,
        });
        outcome = {
          ...outcome,
          skipReason,
          durationMs: Date.now() - startMs,
        };
        return outcome;
      }

      lockAcquired = true;
      this.executedRunIds.add(runId);
      if (this.executedRunIds.size > 500) {
        const first = this.executedRunIds.values().next().value;
        if (first) this.executedRunIds.delete(first);
      }

      await this.persistJobState('RUNNING', runId, { cycleCount: this.cycleCount });
      await this.publishHeartbeat('ACTIVE');

      // Keep lock alive if cycle runs longer than expected without blocking event loop
      renewTimer = setInterval(() => {
        void (async () => {
          const renew = await redisCoordinator.verifyAndRenewDistributedLock(
            WORKER_CYCLE_LOCK_KEY,
            this.instanceId,
            50_000
          );
          if (!renew.acquired) {
            abortCtrl.abort(`WORKER_LOCK_LOST:${renew.reason}`);
          }
        })();
      }, 15_000);

      if (abortCtrl.signal.aborted) {
        throw new Error(`Worker cycle aborted: ${String(abortCtrl.signal.reason)}`);
      }

      const state = await aegisStore.getState();

      // Re-verify ownership before performing state mutations
      const verifyBeforeWrite = await redisCoordinator.verifyAndRenewDistributedLock(
        WORKER_CYCLE_LOCK_KEY,
        this.instanceId,
        50_000
      );
      if (!verifyBeforeWrite.acquired) {
        throw new Error(`Worker lost distributed lock before write (${verifyBeforeWrite.reason})`);
      }

      const expiredGlobalBans = aegisStore.expireDueGlobalBans(state);
      const expiredQuarantines = aegisStore.expireDueQuarantines(state);
      const expiredPremium = aegisStore.expireDuePremiumSubscriptions(state);
      const autoBackedUp = aegisStore.runDueAutoBackups(state);

      if (
        expiredGlobalBans > 0 ||
        expiredQuarantines > 0 ||
        expiredPremium > 0 ||
        autoBackedUp > 0
      ) {
        aegisStore.appendAuditLog(state, {
          guildId: null,
          actorId: 'AEGIS_WORKER',
          actorName: 'AEGIS Expiration Worker',
          action: 'WORKER_CYCLE_MUTATIONS_APPLIED',
          entityType: 'Worker',
          entityId: runId,
          result: 'SUCCESS',
          metadata: {
            expiredGlobalBans,
            expiredQuarantines,
            expiredPremium,
            autoBackedUp,
            correlationId,
          },
        });

        await aegisStore.commitMutation(
          'worker:expiration_sync',
          undefined,
          {
            runId,
            expiredGlobalBans,
            expiredQuarantines,
            expiredPremium,
            autoBackedUp,
          },
          {
            correlationId,
            updatedBy: `worker:${this.instanceId}`,
            fencingToken: lockRes.fencingToken,
          }
        );

        aegisLogger.info('WORKER', 'Worker expiration and backup cycle applied changes', {
          correlationId,
          meta: {
            runId,
            expiredGlobalBans,
            expiredQuarantines,
            expiredPremium,
            autoBackedUp,
          },
        });
      }

      let outboxFlushed = 0;
      if (!abortCtrl.signal.aborted) {
        outboxFlushed = await flushPendingSyncOutbox(this.instanceId);
      }

      this.cycleCount += 1;
      const durationMs = Date.now() - startMs;
      outcome = {
        runId,
        executed: true,
        expiredGlobalBans,
        expiredQuarantines,
        expiredPremium,
        autoBackedUp,
        outboxFlushed,
        durationMs,
        error: null,
      };

      await this.persistJobState('COMPLETED', runId, {
        cycleCount: this.cycleCount,
        expiredGlobalBans,
        expiredQuarantines,
        expiredPremium,
        autoBackedUp,
        outboxFlushed,
        durationMs,
      });
      await this.publishHeartbeat('IDLE', outcome);

      return outcome;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      outcome = {
        ...outcome,
        durationMs: Date.now() - startMs,
        error: msg,
      };
      aegisLogger.error('WORKER', 'Worker cycle failed', {
        correlationId,
        meta: { runId, instanceId: this.instanceId, error: msg },
      });
      await this.persistJobState('FAILED', runId, { cycleCount: this.cycleCount }, msg);
      await this.publishHeartbeat('ERROR', outcome);
      return outcome;
    } finally {
      if (renewTimer) {
        clearInterval(renewTimer);
      }
      if (this.activeAbortController === abortCtrl) {
        this.activeAbortController = null;
      }
      if (lockAcquired) {
        await redisCoordinator.releaseDistributedLock(WORKER_CYCLE_LOCK_KEY, this.instanceId);
      }
    }
  }

  public async shutdown(signal: string): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    aegisLogger.info('WORKER', `Shutting down worker (${signal})`, {
      meta: { instanceId: this.instanceId },
    });
    if (this.activeAbortController) {
      this.activeAbortController.abort(`SHUTDOWN:${signal}`);
    }
    if (this.activeCyclePromise) {
      await Promise.race([
        this.activeCyclePromise,
        new Promise<void>((resolve) => setTimeout(resolve, 4000)),
      ]);
    }
    await this.publishHeartbeat('SHUTTING_DOWN', { durationMs: 0 });
    await redisCoordinator.releaseDistributedLock(WORKER_CYCLE_LOCK_KEY, this.instanceId);
  }
}

export async function initializeWorkerConnections(): Promise<void> {
  await ensureMongoConnected();
  await redisCoordinator.ensureConnected();
}
