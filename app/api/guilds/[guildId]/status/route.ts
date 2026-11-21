import { NextRequest, NextResponse } from 'next/server';
import { requireAuthenticatedUser, requireGuildAuthorization } from '@/lib/server/auth-guard';
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
  const systemHealth = await aegisStore.getSystemHealth();

  return NextResponse.json({
    guild: guard.guild,
    effectiveRole: guard.role,
    antiRaid: state.antiRaidConfigs[guildId] ?? null,
    antiNuke: state.antiNukeConfigs[guildId] ?? null,
    lockdown: state.lockdowns[guildId] ?? null,
    settings: state.guildSettings[guildId] ?? null,
    participating: state.participatingServers[guildId] ?? null,
    systemHealth,
  });
}
