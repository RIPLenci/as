import { NextRequest, NextResponse } from 'next/server';
import { logConfigPatchSchema } from '@/lib/aegis/validators';
import { requireAuthenticatedUser, requireGuildAuthorization } from '@/lib/server/auth-guard';
import {
  fetchGuildChannelsLive,
  fetchGuildRolesLive,
  sendDiscordTestLogMessage,
} from '@/lib/server/discord-api';
import { aegisStore } from '@/lib/server/store';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ guildId: string }> }
) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  const { guildId } = await context.params;
  const guard = requireGuildAuthorization(auth.ctx, guildId, 'antiraid:read');
  if (!guard.ok) return guard.response;

  const { state } = auth.ctx;
  const [channels, roles] = await Promise.all([
    guard.guild.botStatus === 'BOT_CONNECTED' ? fetchGuildChannelsLive(guildId) : Promise.resolve([]),
    guard.guild.botStatus === 'BOT_CONNECTED' ? fetchGuildRolesLive(guildId) : Promise.resolve([]),
  ]);

  return NextResponse.json({
    guild: guard.guild,
    channels,
    roles,
    logConfig: state.guildLogConfigs[guildId],
  });
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ guildId: string }> }
) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  const { guildId } = await context.params;
  const guard = requireGuildAuthorization(auth.ctx, guildId, 'antiraid:write');
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => null);
  const parsed = logConfigPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { state, user } = auth.ctx;
  const current = state.guildLogConfigs[guildId];
  const updated = {
    ...current,
    channelId: parsed.data.channelId !== undefined ? parsed.data.channelId : current.channelId,
    channelName:
      parsed.data.channelName !== undefined ? parsed.data.channelName : current.channelName,
    events: parsed.data.events ? { ...current.events, ...parsed.data.events } : current.events,
    updatedAt: new Date().toISOString(),
  };
  state.guildLogConfigs[guildId] = updated;

  // Keep guildSettings.alertChannelId synchronized as well
  if (state.guildSettings[guildId]) {
    state.guildSettings[guildId].alertChannelId = updated.channelId;
    state.guildSettings[guildId].alertChannelName = updated.channelName;
    state.guildSettings[guildId].updatedAt = updated.updatedAt;
  }

  aegisStore.appendAuditLog(state, {
    guildId,
    actorId: user.discordId,
    actorName: user.username,
    action: 'LOG_CHANNEL_UPDATED',
    entityType: 'GuildLogConfig',
    entityId: guildId,
    result: 'SUCCESS',
    metadata: { channelId: updated.channelId },
  });

  await aegisStore.commitMutation('logs:updated', guildId, { logConfig: updated });
  return NextResponse.json({ logConfig: updated });
}

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ guildId: string }> }
) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  const { guildId } = await context.params;
  const guard = requireGuildAuthorization(auth.ctx, guildId, 'antiraid:write');
  if (!guard.ok) return guard.response;

  const { state, user } = auth.ctx;
  const logConfig = state.guildLogConfigs[guildId];
  if (!logConfig.channelId) {
    return NextResponse.json(
      { error: 'MISSING_CHANNEL', message: 'Selecciona o guarda primero un canal de logs.' },
      { status: 400 }
    );
  }

  const delivery = await sendDiscordTestLogMessage(
    logConfig.channelId,
    guard.guild.name,
    user.username
  );

  aegisStore.appendAuditLog(state, {
    guildId,
    actorId: user.discordId,
    actorName: user.username,
    action: 'LOG_CHANNEL_TEST_DISPATCHED',
    entityType: 'GuildLogConfig',
    entityId: logConfig.channelId,
    result: delivery.sent ? 'SUCCESS' : 'ERROR',
    metadata: { reason: delivery.reason ?? null },
  });
  await aegisStore.commitMutation('logs:tested', guildId, { delivery });

  if (!delivery.sent) {
    return NextResponse.json(
      {
        sent: false,
        reason: delivery.reason,
        message:
          delivery.reason === 'BOT_UNCONFIGURED'
            ? 'Configuración guardada localmente; conecta DISCORD_BOT_TOKEN para enviar embeds reales.'
            : `No se pudo enviar al canal (${delivery.reason}). Verifica los permisos del bot.`,
      },
      { status: 200 }
    );
  }

  return NextResponse.json({ sent: true });
}
