import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { globalBanCreateSchema } from '@/lib/aegis/validators';
import { requireAuthenticatedUser, requireGlobalPermission } from '@/lib/server/auth-guard';
import { aegisStore } from '@/lib/server/store';

export async function GET(req: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  const perm = requireGlobalPermission(auth.ctx, 'globalban:read');
  if (!perm.ok) return perm.response;

  const status = req.nextUrl.searchParams.get('status') || 'ALL';
  const type = req.nextUrl.searchParams.get('type') || 'ALL';
  const q = (req.nextUrl.searchParams.get('q') || '').trim().toLowerCase();

  const { state } = auth.ctx;
  const analytics = await aegisStore.buildGlobalBanAnalytics();

  const bans = state.globalBans.filter((b) => {
    if (status !== 'ALL' && b.status !== status) return false;
    if (type !== 'ALL' && b.sanctionType !== type) return false;
    if (q) {
      const hay =
        `${b.id} ${b.discordId} ${b.username} ${b.reason} ${b.moderatorName} ${b.createdAt}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return NextResponse.json({ bans, analytics });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  const perm = requireGlobalPermission(auth.ctx, 'globalban:create');
  if (!perm.ok) return perm.response;

  const body = await req.json().catch(() => null);
  const parsed = globalBanCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const d = parsed.data;
  const { state, user } = auth.ctx;

  // Reinforced authorization check for PERMANENT Global Bans
  if (
    d.sanctionType === 'PERMANENT' &&
    state.systemSettings.requireDualApprovalForPermanentBan &&
    perm.role !== 'OWNER' &&
    perm.role !== 'GLOBAL_ADMINISTRATOR'
  ) {
    return NextResponse.json(
      {
        error: 'REINFORCED_AUTHORIZATION_REQUIRED',
        message: 'Permanent Global Bans require OWNER or GLOBAL_ADMINISTRATOR authorization.',
      },
      { status: 403 }
    );
  }

  const existingActive = state.globalBans.find(
    (b) =>
      b.discordId === d.discordId &&
      (b.status === 'ACTIVE' || b.status === 'PENDING_APPEAL')
  );
  if (existingActive) {
    return NextResponse.json(
      {
        error: 'DUPLICATE_SANCTION',
        message: `User ${d.discordId} already has active sanction ${existingActive.id}.`,
      },
      { status: 409 }
    );
  }

  const nowIso = new Date().toISOString();
  const expiresAt =
    d.sanctionType === 'TEMPORARY' && d.durationDays
      ? new Date(Date.now() + d.durationDays * 86_400_000).toISOString()
      : null;

  const banId = `GB-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const ban = {
    id: banId,
    discordId: d.discordId,
    username: d.username,
    reason: d.reason,
    description: d.description,
    category: d.category,
    severity: d.severity,
    sanctionType: d.sanctionType,
    evidence: d.evidence,
    moderatorId: user.discordId,
    moderatorName: user.username,
    status: 'ACTIVE' as const,
    createdAt: nowIso,
    expiresAt,
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
    history: [
      {
        id: `GBH-${Date.now()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
        action: 'CREATED' as const,
        actorId: user.discordId,
        actorName: user.username,
        note: `${d.sanctionType} Global Ban issued (${d.category}).`,
        timestamp: nowIso,
      },
    ],
  };

  state.globalBans.unshift(ban);
  aegisStore.appendAuditLog(state, {
    guildId: null,
    actorId: user.discordId,
    actorName: user.username,
    action: 'GLOBAL_BAN_CREATED',
    entityType: 'GlobalBan',
    entityId: ban.id,
    result: 'SUCCESS',
    metadata: {
      discordId: ban.discordId,
      sanctionType: ban.sanctionType,
      category: ban.category,
    },
  });

  await aegisStore.commitMutation('globalban:created', undefined, { ban });
  return NextResponse.json({ ban }, { status: 201 });
}
