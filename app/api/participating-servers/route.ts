import { NextRequest, NextResponse } from 'next/server';
import { participatingServerPatchSchema } from '@/lib/aegis/validators';
import {
  isUserAuthorizedForGuildCollection,
  requireGuildAuthorization,
  requireSuperOwner,
} from '@/lib/server/auth-guard';
import { aegisStore } from '@/lib/server/store';

export async function GET() {
  const auth = await requireSuperOwner();
  if (!auth.ok) return auth.response;

  const { user, state } = auth.ctx;

  const servers = Object.values(state.guilds)
    .filter((g) => isUserAuthorizedForGuildCollection(state, user, g.guildId))
    .map((g) => {
      return (
        state.participatingServers[g.guildId] ?? {
          guildId: g.guildId,
          guildName: g.name,
          globalBanEnabled: false,
          enforcementMode: 'ALERT_ONLY' as const,
          actionPolicy: 'NOTIFY_STAFF' as const,
          notificationChannelId: state.guildSettings[g.guildId]?.alertChannelId ?? null,
          syncStatus: 'DISABLED' as const,
          lastSyncedAt: new Date().toISOString(),
        }
      );
    });

  return NextResponse.json({ participatingServers: servers });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireSuperOwner();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = participatingServerPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const d = parsed.data;
  const guard = requireGuildAuthorization(auth.ctx, d.guildId, 'antiraid:write');
  if (!guard.ok) return guard.response;

  const { state, user } = auth.ctx;
  const nowIso = new Date().toISOString();
  const record = {
    guildId: d.guildId,
    guildName: guard.guild.name,
    globalBanEnabled: d.globalBanEnabled,
    enforcementMode: d.enforcementMode,
    actionPolicy: d.actionPolicy,
    notificationChannelId: d.notificationChannelId ?? null,
    syncStatus: d.globalBanEnabled ? ('SYNCHRONIZED' as const) : ('DISABLED' as const),
    lastSyncedAt: nowIso,
  };

  state.participatingServers[d.guildId] = record;

  aegisStore.appendAuditLog(state, {
    guildId: d.guildId,
    actorId: user.discordId,
    actorName: user.username,
    action: 'PARTICIPATING_SERVER_UPDATED',
    entityType: 'GuildParticipation',
    entityId: d.guildId,
    result: 'SUCCESS',
    metadata: {
      globalBanEnabled: d.globalBanEnabled,
      enforcementMode: d.enforcementMode,
    },
  });

  await aegisStore.commitMutation('participating:updated', d.guildId, { record });
  return NextResponse.json({ participatingServer: record });
}
