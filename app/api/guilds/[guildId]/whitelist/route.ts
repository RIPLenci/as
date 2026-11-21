import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getPlanDisplayName, normalizePlanTier } from '@/lib/aegis/premium';
import { channelWhitelistCreateSchema, whitelistCreateSchema } from '@/lib/aegis/validators';
import { requireAuthenticatedUser, requireGuildAuthorization } from '@/lib/server/auth-guard';
import { aegisStore } from '@/lib/server/store';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ guildId: string }> }
) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  const { guildId } = await context.params;
  const guard = requireGuildAuthorization(auth.ctx, guildId, 'antiraid:read');
  if (!guard.ok) return guard.response;

  const { state } = auth.ctx;
  const entries = state.whitelists.filter((w) => w.guildId === guildId);
  const channels = state.channelWhitelists[guildId] ?? [];
  const plan = state.guildPlans[guildId];

  return NextResponse.json({
    entries,
    channels,
    plan,
    quotas: {
      usersUsed: entries.filter((e) => e.status === 'ACTIVE').length,
      usersLimit: plan.quotas.maxWhitelistUsers,
      channelsUsed: channels.length,
      channelsLimit: plan.quotas.maxWhitelistChannels,
    },
  });
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ guildId: string }> }
) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  const { guildId } = await context.params;
  const guard = requireGuildAuthorization(auth.ctx, guildId, 'antiraid:write');
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => null);
  const { state, user } = auth.ctx;
  const plan = state.guildPlans[guildId];

  if (body && body.kind === 'CHANNEL') {
    const parsedCh = channelWhitelistCreateSchema.safeParse(body);
    if (!parsedCh.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', issues: parsedCh.error.issues },
        { status: 400 }
      );
    }

    const currentChannels = state.channelWhitelists[guildId] ?? [];
    const duplicate = currentChannels.find((c) => c.channelId === parsedCh.data.channelId);
    if (duplicate) {
      return NextResponse.json({ channel: duplicate });
    }

    if (currentChannels.length >= plan.quotas.maxWhitelistChannels) {
      return NextResponse.json(
        {
          error: 'QUOTA_EXCEEDED',
          message: `Límite de canales en whitelist (${plan.quotas.maxWhitelistChannels}) alcanzado en el ${getPlanDisplayName(normalizePlanTier(plan.tier), 'es')}.`,
        },
        { status: 402 }
      );
    }

    const channelEntry = {
      id: `WLC-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
      guildId,
      channelId: parsedCh.data.channelId,
      channelName: parsedCh.data.channelName,
      reason: parsedCh.data.reason,
      addedBy: user.username,
      createdAt: new Date().toISOString(),
    };
    currentChannels.unshift(channelEntry);
    state.channelWhitelists[guildId] = currentChannels;

    aegisStore.appendAuditLog(state, {
      guildId,
      actorId: user.discordId,
      actorName: user.username,
      action: 'CHANNEL_WHITELIST_ADDED',
      entityType: 'ChannelWhitelist',
      entityId: channelEntry.id,
      result: 'SUCCESS',
      metadata: { channelId: channelEntry.channelId },
    });

    await aegisStore.commitMutation('whitelist:updated', guildId, { channel: channelEntry });
    return NextResponse.json({ channel: channelEntry }, { status: 201 });
  }

  const parsed = whitelistCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const d = parsed.data;
  const activeUserEntries = state.whitelists.filter(
    (w) => w.guildId === guildId && w.status === 'ACTIVE'
  );
  const alreadyActiveForTarget = activeUserEntries.some((w) => w.targetId === d.targetId);
  if (!alreadyActiveForTarget && activeUserEntries.length >= plan.quotas.maxWhitelistUsers) {
    return NextResponse.json(
      {
        error: 'QUOTA_EXCEEDED',
        message: `Límite de usuarios en whitelist (${plan.quotas.maxWhitelistUsers}) alcanzado en el ${getPlanDisplayName(normalizePlanTier(plan.tier), 'es')}.`,
      },
      { status: 402 }
    );
  }

  const candidateEntry = {
    id: `WL-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
    guildId,
    targetId: d.targetId,
    targetName: d.targetName,
    targetType: d.targetType,
    reason: d.reason,
    excludedRules: d.excludedRules,
    authorId: user.discordId,
    authorName: user.username,
    status: 'ACTIVE' as const,
    createdAt: new Date().toISOString(),
    expiresAt: d.expiresAt ?? null,
  };

  const { entry, updatedExisting } = aegisStore.upsertWhitelistEntry(state, candidateEntry);
  aegisStore.appendAuditLog(state, {
    guildId,
    actorId: user.discordId,
    actorName: user.username,
    action: updatedExisting ? 'WHITELIST_ENTRY_UPDATED' : 'WHITELIST_ENTRY_ADDED',
    entityType: 'WhitelistEntry',
    entityId: entry.id,
    result: 'SUCCESS',
    metadata: { targetId: entry.targetId, targetType: entry.targetType },
  });

  await aegisStore.commitMutation('whitelist:updated', guildId, { entry });
  return NextResponse.json({ entry, updatedExisting }, { status: updatedExisting ? 200 : 201 });
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ guildId: string }> }
) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  const { guildId } = await context.params;
  const guard = requireGuildAuthorization(auth.ctx, guildId, 'antiraid:write');
  if (!guard.ok) return guard.response;

  const id = req.nextUrl.searchParams.get('id');
  const kind = req.nextUrl.searchParams.get('kind');
  if (!id) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', message: 'Falta el ID de la entrada en whitelist.' },
      { status: 400 }
    );
  }

  const { state, user } = auth.ctx;

  if (kind === 'CHANNEL') {
    const channels = state.channelWhitelists[guildId] ?? [];
    const idx = channels.findIndex((c) => c.id === id);
    if (idx === -1) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    const [removed] = channels.splice(idx, 1);
    state.channelWhitelists[guildId] = channels;
    aegisStore.appendAuditLog(state, {
      guildId,
      actorId: user.discordId,
      actorName: user.username,
      action: 'CHANNEL_WHITELIST_REMOVED',
      entityType: 'ChannelWhitelist',
      entityId: removed.id,
      result: 'SUCCESS',
      metadata: { channelId: removed.channelId },
    });
    await aegisStore.commitMutation('whitelist:updated', guildId, { channelId: id });
    return NextResponse.json({ revoked: true, id });
  }

  const entry = state.whitelists.find((w) => w.id === id && w.guildId === guildId);
  if (!entry) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  entry.status = 'REVOKED';
  aegisStore.appendAuditLog(state, {
    guildId,
    actorId: user.discordId,
    actorName: user.username,
    action: 'WHITELIST_ENTRY_REVOKED',
    entityType: 'WhitelistEntry',
    entityId: entry.id,
    result: 'SUCCESS',
    metadata: { targetId: entry.targetId },
  });

  await aegisStore.commitMutation('whitelist:updated', guildId, { id });
  return NextResponse.json({ revoked: true, entry });
}
