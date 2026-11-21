import path from 'node:path';
import { ShardingManager } from 'discord.js';
import { getServerEnv } from '../../lib/server/env';

export async function launchCluster() {
  const env = getServerEnv();

  if (!env.discordBotToken) {
    console.warn(
      '[AEGIS CLUSTER] DISCORD_BOT_TOKEN not configured in environment. Sharding cluster aborted.'
    );
    return null;
  }

  const botScript = path.join(__dirname, 'index.ts');
  const manager = new ShardingManager(botScript, {
    token: env.discordBotToken,
    totalShards: 'auto',
    respawn: true,
    shardArgs: ['--cluster=1'],
  });

  manager.on('shardCreate', (shard) => {
    console.info(`[AEGIS CLUSTER] Successfully spawned Shard #${shard.id} on Cluster #1`);

    shard.on('ready', () => {
      console.info(`[AEGIS CLUSTER] Shard #${shard.id} is READY and receiving Gateway events.`);
    });

    shard.on('disconnect', () => {
      console.warn(`[AEGIS CLUSTER] Shard #${shard.id} disconnected, triggering auto-reconnect.`);
    });

    shard.on('reconnecting', () => {
      console.info(`[AEGIS CLUSTER] Shard #${shard.id} reconnecting to Discord Gateway...`);
    });

    shard.on('death', (proc) => {
      const code = proc && 'exitCode' in proc ? proc.exitCode : 'terminated';
      console.error(`[AEGIS CLUSTER] Shard #${shard.id} exited with code ${code}, respawning shard immediately.`);
    });
  });

  try {
    await manager.spawn({ amount: 'auto', delay: 5500, timeout: 60000 });
    console.info(`[AEGIS CLUSTER] All shards initialized and online.`);
    return manager;
  } catch (err) {
    console.error('[AEGIS CLUSTER] Error spawning shards:', err);
    throw err;
  }
}

if (require.main === module) {
  launchCluster().catch((err) => {
    console.error('[AEGIS CLUSTER] Fatal cluster initialization error:', err);
    process.exit(1);
  });
}
