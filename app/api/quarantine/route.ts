import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { scoreToRiskLevel } from '@/lib/aegis/risk-engine';
import { quarantineCreateSchema } from '@/lib/aegis/validators';
import {
  isUserAuthorizedForGuildCollection,
  requireAuthenticatedUser,
  requireGuildAuthorization,
} from '@/lib/server/auth-guard';
import { applyDiscordMemberTimeout } from '@/lib/server/discord-api';
import { aegisStore } from '@/lib/server/store';

export async function GET(req: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  const guildId = req.nextUrl.searchParams.get('guildId');
  const status = req.nextUrl.searchParams.get('status');

  if (guildId) {
    const guard = requireGuildAuthorization(auth.ctx, guildId, 'antiraid:read');
    if (!guard.ok) return guard.response;
  }

  const { user, state } = auth.ctx;

  const entries = state.quarantines.filter((q) => {
    if (!isUserAuthorizedForGuildCollection(state, user, q.guildId)) return false;
    if (guildId && q.guildId !== guildId) return false;
    if (status && status !== 'ALL' && q.status !== status) return false;
    return true;
  });

  return NextResponse.json({ entries });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = quarantineCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const d = parsed.data;
  const guard = requireGuildAuthorization(auth.ctx, d.guildId, 'quarantine:manage');
  if (!guard.ok) return guard.response;

  const { state, user } = auth.ctx;
  const nowIso = new Date().toISOString();
  const durationHours = d.durationHours ?? 24;
  const expiresAtIso = d.durationHours
    ? new Date(Date.now() + d.durationHours * 3600_000).toISOString()
    : null;

  const candidateEntry = {
    id: `QRT-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
    guildId: d.guildId,
    guildName: guard.guild.name,
    discordId: d.discordId,
    username: d.username,
    avatarUrl: null,
    reason: d.reason,
    riskScore: d.riskScore,
    riskLevel: scoreToRiskLevel(d.riskScore),
    incidentId: null,
    responsibleActor: user.username,
    previousRoleIds: [],
    status: 'ACTIVE' as const,
    createdAt: nowIso,
    expiresAt: expiresAtIso,
    releasedAt: null,
    releasedBy: null,
  };

  const { entry, updatedExisting } = aegisStore.upsertQuarantineEntry(state, candidateEntry);
  const timeoutSync = await applyDiscordMemberTimeout({
    guildId: d.guildId,
    discordId: d.discordId,
    durationMs: durationHours * 3600_000,
    reason: `AEGIS Cuarentena (${user.username}): ${d.reason}`,
  });

  aegisStore.pushNotification(state, {
    guildId: d.guildId,
    type: 'USER_QUARANTINED',
    severity: entry.riskLevel,
    title: `User Quarantined — ${entry.username}`,
    message: `${entry.username} (${entry.discordId}) isolated in ${guard.guild.name}.`,
    groupedCount: 1,
  });

  aegisStore.appendAuditLog(state, {
    guildId: d.guildId,
    actorId: user.discordId,
    actorName: user.username,
    action: updatedExisting ? 'QUARANTINE_UPDATED' : 'QUARANTINE_CREATED',
    entityType: 'QuarantineEntry',
    entityId: entry.id,
    result: 'SUCCESS',
    metadata: {
      discordId: entry.discordId,
      durationHours: d.durationHours ?? null,
      discordTimeoutSynced: timeoutSync.synced,
    },
  });

  await aegisStore.commitMutation('quarantine:created', d.guildId, { entry });
  return NextResponse.json(
    { entry, updatedExisting, discordSync: timeoutSync },
    { status: updatedExisting ? 200 : 201 }
  );
}
