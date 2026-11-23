import { getServerEnv } from '../../lib/server/env';
import { aegisLogger } from '../../lib/server/logger';
import { redisCoordinator } from '../../lib/server/redis';
import {
  AegisWorkerController,
  initializeWorkerConnections,
} from '../../lib/server/worker-controller';

async function startWorker() {
  const env = getServerEnv();
  const controller = new AegisWorkerController();
  let timer: NodeJS.Timeout | null = null;
  let shuttingDown = false;

  aegisLogger.info('WORKER', 'Initializing background security worker...', {
    meta: {
      workerInstanceId: controller.instanceId,
      intervalMs: env.workerIntervalMs,
      maxConcurrency: env.workerMaxConcurrency,
    },
  });

  await initializeWorkerConnections();

  await controller.runCycle();
  timer = setInterval(() => {
    void controller.runCycle();
  }, env.workerIntervalMs);

  const shutdown = async (signal: string, exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    await controller.shutdown(signal);
    await redisCoordinator.disconnect().catch(() => undefined);
    process.exit(exitCode);
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT', 0);
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM', 0);
  });
  process.once('uncaughtException', (err) => {
    aegisLogger.fatal('WORKER', 'Uncaught exception in worker process', {
      meta: { error: err.message, stack: err.stack },
    });
    void shutdown('UNCAUGHT_EXCEPTION', 1);
  });
  process.once('unhandledRejection', (reason) => {
    aegisLogger.fatal('WORKER', 'Unhandled rejection in worker process', {
      meta: { error: reason instanceof Error ? reason.message : String(reason) },
    });
    void shutdown('UNHANDLED_REJECTION', 1);
  });
}

startWorker().catch((err) => {
  aegisLogger.fatal('WORKER', 'Worker fatal startup error', {
    meta: { error: err instanceof Error ? err.message : String(err) },
  });
  process.exit(1);
});
