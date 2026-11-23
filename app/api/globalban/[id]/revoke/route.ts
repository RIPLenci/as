import { NextRequest, NextResponse } from 'next/server';
import { globalBanRevokeSchema } from '@/lib/aegis/validators';
import { requireSuperOwner } from '@/lib/server/auth-guard';
import { aegisStore } from '@/lib/server/store';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperOwner();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const body = await req.json().catch(() => null);
  const parsed = globalBanRevokeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { state, user } = auth.ctx;
  const ban = state.globalBans.find((b) => b.id === id);
  if (!ban) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const nowIso = new Date().toISOString();
  // Never delete historical records; mark REVOKED and append immutable history entry
  ban.status = 'REVOKED';
  ban.revokedAt = nowIso;
  ban.revokedBy = user.username;
  ban.revokeReason = parsed.data.reason;
  ban.history.push({
    id: `GBH-${Date.now()}`,
    action: 'REVOKED',
    actorId: user.discordId,
    actorName: user.username,
    note: `Sanction revoked: ${parsed.data.reason}`,
    timestamp: nowIso,
  });

  aegisStore.appendAuditLog(state, {
    guildId: null,
    actorId: user.discordId,
    actorName: user.username,
    action: 'GLOBAL_BAN_REVOKED',
    entityType: 'GlobalBan',
    entityId: ban.id,
    result: 'SUCCESS',
    metadata: { discordId: ban.discordId, reason: parsed.data.reason },
  });

  await aegisStore.commitMutation('globalban:revoked', undefined, { ban }, { globalBanRecord: ban });
  return NextResponse.json({ ban });
}
