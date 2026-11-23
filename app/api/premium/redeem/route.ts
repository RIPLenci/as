import { NextRequest, NextResponse } from 'next/server';
import { formatDurationHuman, PLAN_CATALOG } from '@/lib/aegis/premium';
import { premiumRedeemSchema } from '@/lib/aegis/validators';
import { requireAuthenticatedUser } from '@/lib/server/auth-guard';
import { enforceRateLimit } from '@/lib/server/rate-limit';
import { aegisStore } from '@/lib/server/store';

export async function POST(req: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  const rlErr = await enforceRateLimit(req, {
    bucket: 'premium_redeem',
    userId: auth.ctx.user.id,
    limit: 10,
    windowSeconds: 60,
  });
  if (rlErr) return rlErr;

  const body = await req.json().catch(() => null);
  const parsed = premiumRedeemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'VALIDATION_ERROR',
        message: 'Ingresa un código Premium válido (mínimo 4 caracteres alfanuméricos).',
        issues: parsed.error.issues,
      },
      { status: 400 }
    );
  }

  const { state, user } = auth.ctx;
  const res = aegisStore.redeemPremiumCode(state, {
    code: parsed.data.code,
    discordId: user.discordId,
    username: user.username,
    source: 'CODE_REDEEM',
  });

  if (!res.ok) {
    return NextResponse.json(
      { error: 'REDEEM_FAILED', message: res.message },
      { status: 400 }
    );
  }

  await aegisStore.commitMutation('premium:code_redeemed', undefined, {
    discordId: user.discordId,
    tier: res.subscription.tier,
  });

  const remMs = res.subscription.expiresAt
    ? Math.max(0, new Date(res.subscription.expiresAt).getTime() - Date.now())
    : 0;

  return NextResponse.json({
    ok: true,
    message: `Código canjeado correctamente. Se añadió ${formatDurationHuman(res.codeRecord.durationMs, 'es')} al plan ${PLAN_CATALOG[res.subscription.tier].nameEs}.`,
    subscription: {
      ...res.subscription,
      remainingMs: remMs,
      remainingHuman: formatDurationHuman(remMs, 'es'),
      maxServers: PLAN_CATALOG[res.subscription.tier].quotas.maxPremiumServers,
    },
  });
}
