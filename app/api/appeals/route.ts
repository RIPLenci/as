import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { appealCreateSchema } from '@/lib/aegis/validators';
import { requireSuperOwner } from '@/lib/server/auth-guard';
import { aegisStore } from '@/lib/server/store';

export async function GET() {
  const auth = await requireSuperOwner();
  if (!auth.ok) return auth.response;

  return NextResponse.json({
    appeals: auth.ctx.state.appeals,
    bans: auth.ctx.state.globalBans,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireSuperOwner();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = appealCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const d = parsed.data;
  const { state, user } = auth.ctx;

  const ban = state.globalBans.find((b) => b.id === d.banId);
  if (!ban) {
    return NextResponse.json({ error: 'BAN_NOT_FOUND' }, { status: 404 });
  }

  if (ban.discordId !== d.appellantDiscordId) {
    return NextResponse.json(
      {
        error: 'APPEAL_MISMATCH',
        message: 'Appellant Discord ID does not match the sanctioned account.',
      },
      { status: 400 }
    );
  }

  if (ban.status !== 'ACTIVE') {
    return NextResponse.json(
      {
        error: 'BAN_NOT_APPEALABLE',
        message: `Sanction ${ban.id} is currently ${ban.status} and cannot be appealed.`,
      },
      { status: 409 }
    );
  }

  // Anti-spam cooldown guard per Discord ID / ban
  const cooldownMs = (state.systemSettings.appealCooldownHours || 72) * 3600_000;
  const recentAppeal = state.appeals.find(
    (a) =>
      a.banId === d.banId &&
      (a.status === 'PENDING' ||
        a.status === 'REVIEWING' ||
        Date.now() - new Date(a.createdAt).getTime() < cooldownMs)
  );
  if (recentAppeal) {
    return NextResponse.json(
      {
        error: 'APPEAL_COOLDOWN_ACTIVE',
        message: 'An active or recent appeal already exists for this sanction.',
      },
      { status: 429 }
    );
  }

  const nowIso = new Date().toISOString();
  const appeal = {
    id: `APL-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
    banId: d.banId,
    appellantDiscordId: d.appellantDiscordId,
    appellantUsername: d.appellantUsername,
    reason: d.reason,
    evidence: d.evidence,
    status: 'PENDING' as const,
    reviewerId: null,
    reviewerName: null,
    reviewNotes: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  state.appeals.unshift(appeal);
  ban.status = 'PENDING_APPEAL';
  ban.history.push({
    id: `GBH-${Date.now()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
    action: 'APPEALED',
    actorId: d.appellantDiscordId,
    actorName: d.appellantUsername,
    note: `Appeal ${appeal.id} submitted.`,
    timestamp: nowIso,
  });

  aegisStore.pushNotification(state, {
    guildId: null,
    type: 'APPEAL_SUBMITTED',
    severity: 'MODERATE',
    title: `Appeal Submitted — ${appeal.id}`,
    message: `${appeal.appellantUsername} appealed sanction ${appeal.banId}.`,
    groupedCount: 1,
  });

  aegisStore.appendAuditLog(state, {
    guildId: null,
    actorId: user.discordId,
    actorName: user.username,
    action: 'APPEAL_SUBMITTED',
    entityType: 'GlobalBanAppeal',
    entityId: appeal.id,
    result: 'SUCCESS',
    metadata: { banId: appeal.banId },
  });

  await aegisStore.commitMutation('appeal:submitted', undefined, { appeal });
  return NextResponse.json({ appeal }, { status: 201 });
}
