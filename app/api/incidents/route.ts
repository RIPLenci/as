import { NextRequest, NextResponse } from 'next/server';
import {
  isUserAuthorizedForGuildCollection,
  requireAuthenticatedUser,
  requireGuildAuthorization,
} from '@/lib/server/auth-guard';

export async function GET(req: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  const { user, state } = auth.ctx;
  const guildId = req.nextUrl.searchParams.get('guildId');
  const status = req.nextUrl.searchParams.get('status');
  const risk = req.nextUrl.searchParams.get('risk');
  const q = (req.nextUrl.searchParams.get('q') || '').trim().toLowerCase();

  if (guildId) {
    const guard = requireGuildAuthorization(auth.ctx, guildId, 'antiraid:read');
    if (!guard.ok) return guard.response;
  }

  let list = state.incidents.filter((inc) => {
    if (!isUserAuthorizedForGuildCollection(state, user, inc.guildId)) return false;
    if (guildId && inc.guildId !== guildId) return false;
    if (status && status !== 'ALL' && inc.status !== status) return false;
    if (risk && risk !== 'ALL' && inc.riskLevel !== risk) return false;
    if (q) {
      const hay =
        `${inc.id} ${inc.guildName} ${inc.threatType} ${inc.affectedUsername} ${inc.affectedUserId} ${inc.evidenceSummary}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const rawPage = Number.parseInt(req.nextUrl.searchParams.get('page') || '1', 10);
  const rawPageSize = Number.parseInt(req.nextUrl.searchParams.get('pageSize') || '10', 10);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;
  const pageSize =
    Number.isFinite(rawPageSize) && rawPageSize >= 1 ? Math.min(50, rawPageSize) : 10;
  const total = list.length;
  const start = (page - 1) * pageSize;
  list = list.slice(start, start + pageSize);

  return NextResponse.json({
    incidents: list,
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  });
}
