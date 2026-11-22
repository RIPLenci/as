import { NextRequest, NextResponse } from 'next/server';
import { summarizeSlashCommands } from '@/lib/aegis/bot-slash-plan';
import { hasAnyManageableGuild, requireAuthenticatedUser } from '@/lib/server/auth-guard';
import {
  connectOrRestartBot,
  deploySlashCommandsEverywhere,
  isEmbeddedBotEnabled,
} from '@/lib/server/bot-runner';
import { getServerEnv } from '@/lib/server/env';
import { aegisLogger } from '@/lib/server/logger';
import { redisCoordinator } from '@/lib/server/redis';
import { aegisStore } from '@/lib/server/store';

export async function GET() {
  try {
    const auth = await requireAuthenticatedUser();
    if (!auth.ok) return auth.response;

    const health = await aegisStore.getSystemHealth();
    const commands = health.slashCommands || [];
    const summary = summarizeSlashCommands(commands);

    return NextResponse.json({
      ok: true,
      bot: health.bot,
      botIdentity: health.botIdentity,
      shards: health.shards || [],
      cluster: health.cluster || null,
      slashCommands: commands,
      commandCount: summary.commandCount,
      totalSubcommands: summary.totalSubcommands,
      lastSync: health.lastSynchronization,
      syncHealth: health.syncHealth ?? null,
      latencyMetrics: health.latencyMetrics ?? null,
    });
  } catch (err) {
    aegisLogger.error('DISCORD', 'Bot control GET error', {
      meta: { error: err instanceof Error ? err.message : String(err) },
    });
    return NextResponse.json(
      { ok: false, error: 'INTERNAL_ERROR', message: 'Error interno al consultar el estado del bot.' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuthenticatedUser();
    if (!auth.ok) return auth.response;

    const currentUser = auth.ctx.user;
    const state = auth.ctx.state;

    if (!hasAnyManageableGuild(state, currentUser)) {
      return NextResponse.json(
        {
          ok: false,
          error: 'FORBIDDEN',
          message: 'Se requiere administrar al menos un servidor o rol global para operar el bot.',
        },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action as string | undefined;
    const env = getServerEnv();

    if (action === 'DEPLOY_SLASH_COMMANDS') {
      if (!env.botConfigured) {
        return NextResponse.json(
          {
            ok: false,
            error: 'BOT_UNCONFIGURED',
            message:
              'DISCORD_BOT_TOKEN no está configurado en el servidor. Configura las variables de entorno del servidor para registrar los comandos slash reales en Discord.',
          },
          { status: 400 }
        );
      }

      const deployRes = await deploySlashCommandsEverywhere();
      if (!deployRes.ok) {
        aegisStore.appendAuditLog(state, {
          guildId: null,
          actorId: currentUser.discordId,
          actorName: currentUser.username,
          action: 'DISCORD_SLASH_COMMANDS_DEPLOY_FAILED',
          entityType: 'DISCORD_BOT',
          entityId: deployRes.applicationId || 'UNRESOLVED',
          result: 'ERROR',
          metadata: { error: deployRes.error || 'Unknown error' },
        });
        await aegisStore.commitMutation('bot:slash_deploy_failed');
        return NextResponse.json(
          {
            ok: false,
            error: 'DISCORD_REST_FAILED',
            message: deployRes.error || 'No se pudieron sincronizar los comandos slash con Discord.',
          },
          { status: 503 }
        );
      }

      if (redisCoordinator.getStatus() === 'CONNECTED') {
        await redisCoordinator.publishControl(
          'DEPLOY_SLASH_COMMANDS',
          { requestedBy: currentUser.discordId },
          aegisStore.instanceId
        );
      }

      const audit = aegisStore.appendAuditLog(state, {
        guildId: null,
        actorId: currentUser.discordId,
        actorName: currentUser.username,
        action: 'DISCORD_SLASH_COMMANDS_DEPLOYED',
        entityType: 'DISCORD_BOT',
        entityId: deployRes.applicationId || env.discordClientId || 'DISCORD_APP',
        result: 'SUCCESS',
        metadata: {
          commandCount: deployRes.commandCount,
          globalSynced: deployRes.globalSynced,
          guildsSynced: deployRes.guildsSynced,
          failedGuildsCount: deployRes.failedGuilds.length,
        },
      });

      aegisStore.pushNotification(state, {
        guildId: null,
        type: 'PROTECTION_ENABLED',
        severity: 'LOW',
        title: 'Comandos Slash Desplegados',
        message: `Se sincronizaron ${deployRes.commandCount} comandos slash principales (/antiraid, /antinuke, /seguridad, /cuarentena, /bloqueo, /whitelist, /premium, /aegis) por servidor en ${deployRes.guildsSynced} servidores (duplicados globales eliminados).`,
        groupedCount: 1,
      });

      await aegisStore.commitMutation('bot:slash_deployed');

      return NextResponse.json({
        ok: true,
        success: true,
        message: `Comandos slash sincronizados en Discord (${deployRes.commandCount} comandos, ${deployRes.guildsSynced} servidores actualizados al instante).`,
        commandCount: deployRes.commandCount,
        globalSynced: deployRes.globalSynced,
        guildsSynced: deployRes.guildsSynced,
        failedGuilds: deployRes.failedGuilds,
        syncedAt: new Date().toISOString(),
        auditId: audit.id,
      });
    }

    if (action === 'RESTART_CLUSTER' || action === 'CONNECT_BOT') {
      if (!env.botConfigured) {
        return NextResponse.json(
          {
            ok: false,
            error: 'BOT_UNCONFIGURED',
            message:
              'DISCORD_BOT_TOKEN no está configurado en el servidor. Añade DISCORD_BOT_TOKEN al entorno del servidor para conectar el bot a Discord.',
          },
          { status: 400 }
        );
      }

      // If standalone bot container owns Gateway via Redis heartbeat, route control cleanly over Pub/Sub
      const remoteHeartbeat = env.redisConfigured
        ? await redisCoordinator.getBotHeartbeat()
        : null;

      if (remoteHeartbeat?.online) {
        await redisCoordinator.publishControl(
          action === 'RESTART_CLUSTER' ? 'RECONCILE_ALL' : 'PING',
          { requestedBy: currentUser.discordId, reason: action },
          aegisStore.instanceId
        );
        const slashRes = await deploySlashCommandsEverywhere();
        const audit = aegisStore.appendAuditLog(state, {
          guildId: null,
          actorId: currentUser.discordId,
          actorName: currentUser.username,
          action: 'DISCORD_REMOTE_CONTROL_SIGNALED',
          entityType: 'DISCORD_CLUSTER',
          entityId: remoteHeartbeat.id || 'Standalone-Bot',
          result: 'SUCCESS',
          metadata: {
            signal: action,
            remoteInstanceId: remoteHeartbeat.instanceId ?? null,
            slashSyncedGuilds: slashRes.guildsSynced,
          },
        });
        await aegisStore.commitMutation('bot:remote_control_signaled');

        return NextResponse.json({
          ok: true,
          success: true,
          message: `Bot standalone conectado (${remoteHeartbeat.tag}, ${remoteHeartbeat.guildCount ?? 0} servidores, latencia ${remoteHeartbeat.pingMs ?? '-'} ms). Señal de resincronización enviada y ${slashRes.guildsSynced} servidores actualizados.`,
          tag: remoteHeartbeat.tag,
          pingMs: remoteHeartbeat.pingMs,
          guildCount: remoteHeartbeat.guildCount,
          slashGuildsSynced: slashRes.guildsSynced,
          restartedAt: new Date().toISOString(),
          auditId: audit.id,
        });
      }

      if (!isEmbeddedBotEnabled()) {
        return NextResponse.json(
          {
            ok: false,
            error: 'STANDALONE_BOT_OFFLINE',
            message:
              'El servicio standalone del Bot de Discord (services/bot/index.ts) no reporta heartbeat activo en Redis. Inicia el contenedor del bot (`npm run start:bot`) para evitar duplicar sesiones Gateway desde la Web.',
          },
          { status: 503 }
        );
      }

      const connectRes = await connectOrRestartBot(action === 'RESTART_CLUSTER');
      if (!connectRes.ok) {
        aegisStore.appendAuditLog(state, {
          guildId: null,
          actorId: currentUser.discordId,
          actorName: currentUser.username,
          action: 'DISCORD_CLUSTER_CONNECT_FAILED',
          entityType: 'DISCORD_CLUSTER',
          entityId: 'Cluster-Alpha',
          result: 'ERROR',
          metadata: { error: connectRes.error || 'Gateway error' },
        });
        await aegisStore.commitMutation('bot:connect_failed');
        return NextResponse.json(
          {
            ok: false,
            error: 'GATEWAY_CONNECTION_FAILED',
            message: connectRes.error || 'No se pudo conectar el bot al Gateway de Discord.',
          },
          { status: 503 }
        );
      }

      const slashRes = await deploySlashCommandsEverywhere();

      const audit = aegisStore.appendAuditLog(state, {
        guildId: null,
        actorId: currentUser.discordId,
        actorName: currentUser.username,
        action: action === 'RESTART_CLUSTER' ? 'DISCORD_CLUSTER_RESTARTED' : 'DISCORD_BOT_CONNECTED',
        entityType: 'DISCORD_CLUSTER',
        entityId: connectRes.id || 'Cluster-Alpha',
        result: 'SUCCESS',
        metadata: {
          tag: connectRes.tag,
          pingMs: connectRes.pingMs,
          guildCount: connectRes.guildCount,
          slashSyncedGuilds: slashRes.guildsSynced,
        },
      });

      await aegisStore.commitMutation('bot:connected');

      return NextResponse.json({
        ok: true,
        success: true,
        message: `Bot conectado como ${connectRes.tag} (${connectRes.guildCount ?? 0} servidores, latencia ${connectRes.pingMs ?? '-'} ms). Comandos slash cargados en ${slashRes.guildsSynced} servidores.`,
        tag: connectRes.tag,
        pingMs: connectRes.pingMs,
        guildCount: connectRes.guildCount,
        slashGuildsSynced: slashRes.guildsSynced,
        restartedAt: new Date().toISOString(),
        auditId: audit.id,
      });
    }

    return NextResponse.json(
      { ok: false, error: `Acción '${action || 'none'}' desconocida.` },
      { status: 400 }
    );
  } catch (err) {
    aegisLogger.error('DISCORD', 'Bot control POST error', {
      meta: { error: err instanceof Error ? err.message : String(err) },
    });
    return NextResponse.json(
      { ok: false, error: 'INTERNAL_ERROR', message: 'Error interno al operar el servicio del bot.' },
      { status: 500 }
    );
  }
}
