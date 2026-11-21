import { NextRequest, NextResponse } from 'next/server';
import { requireAuthenticatedUser, requireGuildAuthorization } from '@/lib/server/auth-guard';

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
  return NextResponse.json({
    guild: guard.guild,
    settings: state.guildSettings[guildId] ?? null,
    antiRaid: state.antiRaidConfigs[guildId] ?? null,
    antiNuke: state.antiNukeConfigs[guildId] ?? null,
    lockdown: state.lockdowns[guildId] ?? null,
  });
}
