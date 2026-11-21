import { NextRequest, NextResponse } from 'next/server';
import type { OverviewPeriod } from '@/lib/aegis/types';
import {
  getAuthorizedGuildIdsForUser,
  requireAuthenticatedUser,
  requireGuildAuthorization,
} from '@/lib/server/auth-guard';
import { aegisStore } from '@/lib/server/store';

export async function GET(req: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  const periodParam = req.nextUrl.searchParams.get('period') || '7d';
  const period: OverviewPeriod =
    periodParam === '24h' ||
    periodParam === '7d' ||
    periodParam === '30d' ||
    periodParam === '90d'
      ? periodParam
      : '7d';

  const guildId = req.nextUrl.searchParams.get('guildId') || undefined;
  if (guildId) {
    const guard = requireGuildAuthorization(auth.ctx, guildId, 'overview:read');
    if (!guard.ok) return guard.response;
  }

  const authorizedIds = getAuthorizedGuildIdsForUser(auth.ctx.state, auth.ctx.user);
  const analytics = await aegisStore.buildOverviewAnalytics(period, guildId, authorizedIds);
  return NextResponse.json(analytics);
}
