import crypto from 'node:crypto';
import { getServerEnv } from '../../lib/server/env';
import { aegisLogger } from '../../lib/server/logger';
import { ensureMongoConnected } from '../../lib/server/mongodb';
import { redisCoordinator } from '../../lib/server/redis';
import { aegisStore } from '../../lib/server/store';
import { flushPendingSyncOutbox } from '../../lib/server/sync-coordinator';

const EXPIRATION_CHECK_INTERVAL_MS = 60_000;
const WORKER_CYCLE_LOCK_KEY = 'aegis:worker:cycle_lock';
const workerInstanceId = `worker-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;

async function runWorkerCycle() {
  const correlationId = aegisLogger.createCorrelationId('wrk');
  const env = getServerEnv();

  if (env.redisConfigured && redisCoordinator.getStatus() === 'CONNECTED') {
    const acquired = await redisCoordinator.acquireDistributedLock(
      WORKER_CYCLE_LOCK_KEY,
      workerInstanceId,
      50_000
    );
    if (!acquired) {
      aegisLogger.debug('WORKER', 'Skipping worker cycle; another worker instance holds distributed lock', {
        correlationId,
        meta: { workerInstanceId },
      });
      return;
    }
  }

  const state = await aegisStore.getState();
  const now = Date.now();
  let expiredGlobalBans = 0;

  for (const ban of state.globalBans) {
    if (
      (ban.status === 'ACTIVE' || ban.status === 'PENDING_APPEAL') &&
      ban.sanctionType === 'TEMPORARY' &&
      ban.expiresAt &&
      new Date(ban.expiresAt).getTime() <= now
    ) {
      ban.status = 'EXPIRED';
      ban.history.push({
        id: `GBH-${now}`,
        action: 'EXPIRED',
        actorId: 'AEGIS_WORKER',
        actorName: 'AEGIS Expiration Worker',
        note: 'Temporary Global Ban expired; L1/L2 caches invalidated.',
        timestamp: new Date(now).toISOString(),
      });
      aegisStore.appendAuditLog(state, {
        guildId: null,
        actorId: 'AEGIS_WORKER',
        actorName: 'AEGIS Expiration Worker',
        action: 'GLOBAL_BAN_EXPIRED',
        entityType: 'GlobalBan',
        entityId: ban.id,
        result: 'SUCCESS',
        metadata: { discordId: ban.discordId, correlationId },
      });
      expiredGlobalBans += 1;
    }
  }

  let expiredQuarantines = 0;
  for (const q of state.quarantines) {
    if (q.status === 'ACTIVE' && q.expiresAt && new Date(q.expiresAt).getTime() <= now) {
      q.status = 'EXPIRED';
      q.releasedAt = new Date(now).toISOString();
      q.releasedBy = 'AEGIS_WORKER';
      expiredQuarantines += 1;
    }
  }

  const expiredPremium = aegisStore.expireDuePremiumSubscriptions(state);
  const autoBackedUp = aegisStore.runDueAutoBackups(state);

  if (expiredGlobalBans > 0 || expiredQuarantines > 0 || expiredPremium > 0 || autoBackedUp > 0) {
    await aegisStore.commitMutation(
      'worker:expiration_sync',
      undefined,
      {
        expiredGlobalBans,
        expiredQuarantines,
        expiredPremium,
        autoBackedUp,
      },
      { correlationId }
    );
    aegisLogger.info('WORKER', 'Worker expiration and backup cycle applied changes', {
      correlationId,
      meta: { expiredGlobalBans, expiredQuarantines, expiredPremium, autoBackedUp },
    });
  }

  await flushPendingSyncOutbox(aegisStore.instanceId);
}

async function startWorker() {
  aegisLogger.info('WORKER', 'Initializing background security worker...', {
    meta: { workerInstanceId },
  });
  await ensureMongoConnected();
  await redisCoordinator.ensureConnected();

  await runWorkerCycle();
  const timer = setInterval(() => {
    runWorkerCycle().catch((err) => {
      aegisLogger.error('WORKER', 'Worker cycle error', {
        meta: { error: err instanceof Error ? err.message : String(err) },
      });
    });
  }, EXPIRATION_CHECK_INTERVAL_MS);

  const shutdown = async (signal: string) => {
    aegisLogger.info('WORKER', `Shutting down worker (${signal})`, {
      meta: { workerInstanceId },
    });
    clearInterval(timer);
    await redisCoordinator.disconnect();
    process.exit(0);
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

startWorker().catch((err) => {
  aegisLogger.fatal('WORKER', 'Worker fatal startup error', {
    meta: { error: err instanceof Error ? err.message : String(err) },
  });
  process.exit(1);
});
