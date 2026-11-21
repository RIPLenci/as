import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { appealPatchSchema } from '@/lib/aegis/validators';
import { requireSuperOwner } from '@/lib/server/auth-guard';
import { aegisStore } from '@/lib/server/store';

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperOwner();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const body = await req.json().catch(() => null);
  const parsed = appealPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { state, user } = auth.ctx;
  const appeal = state.appeals.find((a) => a.id === id);
  if (!appeal) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  if (appeal.status === 'APPROVED' || appeal.status === 'REJECTED') {
    return NextResponse.json(
      {
        error: 'APPEAL_FINALIZED',
        message: `Appeal ${appeal.id} has already been finalized (${appeal.status}).`,
      },
      { status: 409 }
    );
  }

  const nowIso = new Date().toISOString();
  appeal.status = parsed.data.status;
  appeal.reviewNotes = parsed.data.reviewNotes;
  appeal.reviewerId = user.discordId;
  appeal.reviewerName = user.username;
  appeal.updatedAt = nowIso;

  const ban = state.globalBans.find((b) => b.id === appeal.banId);
  if (ban) {
    if (parsed.data.status === 'APPROVED') {
      // Automatically revoke sanction without deleting historical record
      ban.status = 'REVOKED';
      ban.revokedAt = nowIso;
      ban.revokedBy = user.username;
      ban.revokeReason = `Appeal ${appeal.id} approved: ${parsed.data.reviewNotes}`;
      ban.history.push({
        id: `GBH-${Date.now()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
        action: 'REVOKED',
        actorId: user.discordId,
        actorName: user.username,
        note: `Sanction automatically revoked upon approval of appeal ${appeal.id}.`,
        timestamp: nowIso,
      });
    } else if (parsed.data.status === 'REJECTED' && ban.status === 'PENDING_APPEAL') {
      ban.status = 'ACTIVE';
      ban.history.push({
        id: `GBH-${Date.now()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
        action: 'UPDATED',
        actorId: user.discordId,
        actorName: user.username,
        note: `Appeal ${appeal.id} rejected: ${parsed.data.reviewNotes}`,
        timestamp: nowIso,
      });
    }
  }

  aegisStore.appendAuditLog(state, {
    guildId: null,
    actorId: user.discordId,
    actorName: user.username,
    action: `APPEAL_${parsed.data.status}`,
    entityType: 'GlobalBanAppeal',
    entityId: appeal.id,
    result: 'SUCCESS',
    metadata: { banId: appeal.banId },
  });

  await aegisStore.commitMutation('appeal:reviewed', undefined, { appeal, ban });
  return NextResponse.json({ appeal, ban });
}
