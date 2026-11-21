import { NextRequest, NextResponse } from 'next/server';
import { isPaidTier, normalizePlanTier } from '@/lib/aegis/premium';
import { verificationPatchSchema } from '@/lib/aegis/validators';
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
  return NextResponse.json({
    verification: state.guildVerifications[guildId],
    plan: state.guildPlans[guildId],
  });
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ guildId: string }> }
) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  const { guildId } = await context.params;
  const guard = requireGuildAuthorization(auth.ctx, guildId, 'antiraid:write');
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => null);
  const parsed = verificationPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { state, user } = auth.ctx;
  const plan = state.guildPlans[guildId];
  const current = state.guildVerifications[guildId];
  const d = parsed.data;

  const isPremium = isPaidTier(normalizePlanTier(plan.tier));

  if (
    !isPremium &&
    d.kickUnverifiedAfterMinutes !== undefined &&
    d.kickUnverifiedAfterMinutes !== null
  ) {
    return NextResponse.json(
      {
        error: 'PREMIUM_REQUIRED',
        message: 'La expulsión automática de cuentas sin verificar requiere AEGIS Premium (Plan Oro o Diamante).',
      },
      { status: 402 }
    );
  }

  if (!isPremium && d.mode === 'STRICT_2FA') {
    return NextResponse.json(
      {
        error: 'PREMIUM_REQUIRED',
        message: 'El modo de verificación Estricto (2FA) requiere AEGIS Premium (Plan Oro o Diamante).',
      },
      { status: 402 }
    );
  }

  const updated = {
    ...current,
    ...d,
    updatedAt: new Date().toISOString(),
  };
  state.guildVerifications[guildId] = updated;

  aegisStore.appendAuditLog(state, {
    guildId,
    actorId: user.discordId,
    actorName: user.username,
    action: 'VERIFICATION_CONFIG_UPDATED',
    entityType: 'GuildVerification',
    entityId: guildId,
    result: 'SUCCESS',
    metadata: { enabled: updated.enabled, mode: updated.mode },
  });

  await aegisStore.commitMutation('verification:updated', guildId, { verification: updated });
  return NextResponse.json({ verification: updated });
}
