import { NextRequest, NextResponse } from 'next/server';
import { isSubscriptionActive, PLAN_CATALOG } from '@/lib/aegis/premium';
import { premiumActionSchema } from '@/lib/aegis/validators';
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

  const { state, user } = auth.ctx;
  const plan = state.guildPlans[guildId];
  const canManagePlan =
    guard.guild.userIsOwner ||
    guard.guild.ownerDiscordId === user.discordId ||
    state.secondaryOwners[guildId]?.discordId === user.discordId;

  const sub = state.userSubscriptions[user.discordId];
  const userSubscription =
    sub && isSubscriptionActive(sub)
      ? sub
      : null;

  return NextResponse.json({
    plan,
    canManagePlan,
    catalog: PLAN_CATALOG,
    userSubscription,
    usage: {
      whitelistUsers: state.whitelists.filter(
        (w) => w.guildId === guildId && w.status === 'ACTIVE'
      ).length,
      whitelistChannels: (state.channelWhitelists[guildId] ?? []).length,
      botPermUsers: (state.botPermissions[guildId] ?? []).filter((g) => g.targetType === 'USER')
        .length,
      botPermRoles: (state.botPermissions[guildId] ?? []).filter((g) => g.targetType === 'ROLE')
        .length,
      backups: (state.guildBackups[guildId] ?? []).length,
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
  const parsed = premiumActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { state, user } = auth.ctx;
  const d = parsed.data;

  if (d.action === 'ASSIGN_SLOT') {
    const res = aegisStore.assignGuildPremiumSlot(state, {
      discordId: user.discordId,
      guildId,
      username: user.username,
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: 'PREMIUM_SLOT_ERROR', message: res.message },
        { status: res.status }
      );
    }
    await aegisStore.commitMutation('premium:updated', guildId, { plan: res.plan });
    return NextResponse.json({
      plan: res.plan,
      subscription: res.subscription,
    });
  }

  const res = aegisStore.releaseGuildPremiumSlot(state, {
    discordId: user.discordId,
    guildId,
    username: user.username,
  });
  await aegisStore.commitMutation('premium:updated', guildId, { plan: res.plan });
  return NextResponse.json({
    plan: res.plan,
    subscription: state.userSubscriptions[user.discordId] ?? null,
  });
}
