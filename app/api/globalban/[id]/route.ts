import { NextRequest, NextResponse } from 'next/server';
import { requireSuperOwner } from '@/lib/server/auth-guard';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperOwner();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const { state } = auth.ctx;
  const ban = state.globalBans.find((b) => b.id === id || b.discordId === id);
  if (!ban) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const userHistory = state.globalBans.filter((b) => b.discordId === ban.discordId);
  const appeals = state.appeals.filter(
    (a) => a.banId === ban.id || a.appellantDiscordId === ban.discordId
  );

  return NextResponse.json({ ban, userHistory, appeals });
}
