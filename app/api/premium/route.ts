import { NextResponse } from 'next/server';
import {
  formatDurationHuman,
  isSubscriptionActive,
  PLAN_CATALOG,
} from '@/lib/aegis/premium';
import {
  getAuthorizedGuildIdsForUser,
  isBotStaff,
  requireAuthenticatedUser,
} from '@/lib/server/auth-guard';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  const { user, state } = auth.ctx;
  const staff = isBotStaff(user);
  const rawSub = Object.hasOwn(state.userSubscriptions, user.discordId)
    ? state.userSubscriptions[user.discordId]
    : undefined;
  const active = rawSub && isSubscriptionActive(rawSub);
  const remainingMs =
    active && rawSub?.expiresAt
      ? Math.max(0, new Date(rawSub.expiresAt).getTime() - Date.now())
      : 0;

  const authorizedIds = getAuthorizedGuildIdsForUser(state, user);
  const servers = authorizedIds
    .map((gid) => {
      const guild = Object.hasOwn(state.guilds, gid) ? state.guilds[gid] : undefined;
      if (!guild) return null;
      const plan = Object.hasOwn(state.guildPlans, gid) ? state.guildPlans[gid] : undefined;
      return {
        guildId: guild.guildId,
        name: guild.name,
        iconUrl: guild.iconUrl,
        tier: plan?.tier ?? 'FREE',
        slottedByMe: Boolean(active && rawSub?.activatedGuildIds.includes(gid)),
        slottedByOther: Boolean(
          plan && plan.tier !== 'FREE' && plan.ownerUserId && plan.ownerUserId !== user.discordId
        ),
        expiresAt: plan?.expiresAt ?? null,
      };
    })
    .filter((s): s is NonNullable<typeof s> => Boolean(s));

  return NextResponse.json({
    catalog: PLAN_CATALOG,
    isStaff: staff,
    subscription: active && rawSub
      ? {
          ...rawSub,
          remainingMs,
          remainingHuman: formatDurationHuman(remainingMs, 'es'),
          maxServers: PLAN_CATALOG[rawSub.tier].quotas.maxPremiumServers,
        }
      : {
          discordId: user.discordId,
          username: user.username,
          tier: 'FREE' as const,
          grantedAt: null,
          expiresAt: null,
          activatedGuildIds: [],
          source: 'EXPIRED' as const,
          updatedBy: '',
          updatedAt: new Date().toISOString(),
          remainingMs: 0,
          remainingHuman: 'Sin tiempo activo',
          maxServers: 0,
        },
    servers,
    staffOverview: staff
      ? {
          codes: Object.values(state.premiumCodes).sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          ),
          subscriptions: Object.values(state.userSubscriptions)
            .filter((s) => isSubscriptionActive(s))
            .map((s) => {
              const rem = s.expiresAt
                ? Math.max(0, new Date(s.expiresAt).getTime() - Date.now())
                : 0;
              return {
                ...s,
                remainingMs: rem,
                remainingHuman: formatDurationHuman(rem, 'es'),
              };
            })
            .sort((a, b) => b.remainingMs - a.remainingMs),
        }
      : null,
  });
}
