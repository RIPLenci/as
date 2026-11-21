import { NextRequest, NextResponse } from 'next/server';
import {
  isUserAuthorizedForGuildCollection,
  requireAuthenticatedUser,
  requireGuildAuthorization,
} from '@/lib/server/auth-guard';

export async function GET(req: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  const guildId = req.nextUrl.searchParams.get('guildId');
  const risk = req.nextUrl.searchParams.get('risk') || 'ALL';

  if (guildId) {
    const guard = requireGuildAuthorization(auth.ctx, guildId, 'antiraid:read');
    if (!guard.ok) return guard.response;
  }

  const { user, state } = auth.ctx;

  const events = state.events.filter((e) => {
    if (!isUserAuthorizedForGuildCollection(state, user, e.guildId)) return false;
    if (guildId && e.guildId !== guildId) return false;
    if (risk !== 'ALL' && e.riskLevel !== risk) return false;
    return true;
  });

  return NextResponse.json({ events });
}
