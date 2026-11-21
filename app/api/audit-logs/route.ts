import { NextRequest, NextResponse } from 'next/server';
import {
  isBotStaff,
  isUserAuthorizedForGuildCollection,
  requireAuthenticatedUser,
  requireGuildAuthorization,
} from '@/lib/server/auth-guard';

export async function GET(req: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  const guildId = req.nextUrl.searchParams.get('guildId');
  const action = (req.nextUrl.searchParams.get('action') || '').trim().toLowerCase();
  const q = (req.nextUrl.searchParams.get('q') || '').trim().toLowerCase();

  if (guildId) {
    const guard = requireGuildAuthorization(auth.ctx, guildId, 'logs:read');
    if (!guard.ok) return guard.response;
  }

  const { user, state } = auth.ctx;
  const staffUser = isBotStaff(user);

  const logs = state.auditLogs.filter((log) => {
    if (log.guildId && !isUserAuthorizedForGuildCollection(state, user, log.guildId)) {
      return false;
    }
    if (!log.guildId && !staffUser) {
      return false;
    }
    if (guildId && log.guildId !== guildId) return false;
    if (action && !log.action.toLowerCase().includes(action)) return false;
    if (q) {
      const hay = `${log.id} ${log.actorName} ${log.actorId} ${log.action} ${log.entityType} ${log.entityId}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return NextResponse.json({ logs: logs.slice(0, 150) });
}
