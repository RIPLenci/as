import { aegisStore } from '../../lib/server/store';
import { redisCoordinator } from '../../lib/server/redis';
import { ensureMongoConnected } from '../../lib/server/mongodb';

const EXPIRATION_CHECK_INTERVAL_MS = 60_000;

async function runWorkerCycle() {
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
        metadata: { discordId: ban.discordId },
      });
      expiredGlobalBans += 1;
    }
  }

  // Expire time-bounded quarantines
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
    await aegisStore.commitMutation('worker:expiration_sync', undefined, {
      expiredGlobalBans,
      expiredQuarantines,
      expiredPremium,
      autoBackedUp,
    });
    console.info(
      `[AEGIS WORKER] Processed ${expiredGlobalBans} global bans, ${expiredQuarantines} quarantines, ${expiredPremium} premium expirations, ${autoBackedUp} auto backups.`
    );
  }
}

async function startWorker() {
  console.info('[AEGIS WORKER] Initializing background security worker...');
  await ensureMongoConnected();
  await redisCoordinator.ensureConnected();

  await runWorkerCycle();
  setInterval(() => {
    runWorkerCycle().catch((err) => {
      console.error('[AEGIS WORKER] Cycle error:', err);
    });
  }, EXPIRATION_CHECK_INTERVAL_MS);
}

startWorker().catch((err) => {
  console.error('[AEGIS WORKER] Fatal startup error:', err);
  process.exit(1);
});
