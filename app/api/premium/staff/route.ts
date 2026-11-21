import { NextRequest, NextResponse } from 'next/server';
import {
  formatDurationHuman,
  parseDurationString,
  PLAN_CATALOG,
} from '@/lib/aegis/premium';
import { premiumStaffGrantSchema } from '@/lib/aegis/validators';
import { isBotStaff, requireAuthenticatedUser } from '@/lib/server/auth-guard';
import { aegisStore } from '@/lib/server/store';

export async function POST(req: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  const { state, user } = auth.ctx;
  if (!isBotStaff(user)) {
    return NextResponse.json(
      {
        error: 'FORBIDDEN',
        message: 'Solo el Staff autorizado del bot puede gestionar suscripciones o códigos Premium.',
      },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = premiumStaffGrantSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'VALIDATION_ERROR',
        message: 'Revisa los parámetros enviados en la solicitud.',
        issues: parsed.error.issues,
      },
      { status: 400 }
    );
  }

  const d = parsed.data;

  if (d.action === 'GRANT') {
    const dur = parseDurationString(d.duration);
    if (!dur.ok) {
      return NextResponse.json({ error: 'VALIDATION_ERROR', message: dur.error }, { status: 400 });
    }
    const targetUser = Object.hasOwn(state.users, d.discordId)
      ? state.users[d.discordId]
      : undefined;

    const sub = aegisStore.grantUserPremium(state, {
      discordId: d.discordId,
      username: d.username?.trim() || targetUser?.username || `Usuario ${d.discordId.slice(-4)}`,
      tier: d.tier,
      durationMs: dur.durationMs,
      source: 'STAFF_PANEL',
      updatedBy: user.username,
    });

    aegisStore.appendAuditLog(state, {
      guildId: null,
      actorId: user.discordId,
      actorName: user.username,
      action: 'STAFF_PREMIUM_GRANTED',
      entityType: 'UserPremiumSubscription',
      entityId: d.discordId,
      result: 'SUCCESS',
      metadata: { tier: sub.tier, added: dur.normalizedLabel },
    });

    await aegisStore.commitMutation('premium:staff_granted', undefined, { discordId: d.discordId });
    const remMs = sub.expiresAt ? Math.max(0, new Date(sub.expiresAt).getTime() - Date.now()) : 0;

    return NextResponse.json({
      ok: true,
      message: `${PLAN_CATALOG[sub.tier].nameEs} asignado (${dur.normalizedLabel}). Tiempo acumulado restante: ${formatDurationHuman(remMs, 'es')}.`,
      subscription: sub,
    });
  }

  if (d.action === 'REVOKE') {
    const revoked = aegisStore.revokeUserPremium(state, {
      discordId: d.discordId,
      revokedBy: user.username,
    });
    if (!revoked) {
      return NextResponse.json(
        { error: 'NOT_FOUND', message: 'El usuario indicado no tiene historial de suscripción Premium.' },
        { status: 404 }
      );
    }

    aegisStore.appendAuditLog(state, {
      guildId: null,
      actorId: user.discordId,
      actorName: user.username,
      action: 'STAFF_PREMIUM_REVOKED',
      entityType: 'UserPremiumSubscription',
      entityId: d.discordId,
      result: 'SUCCESS',
      metadata: {},
    });

    await aegisStore.commitMutation('premium:staff_revoked', undefined, { discordId: d.discordId });
    return NextResponse.json({
      ok: true,
      message: `Premium revocado para ${d.discordId}. Todos sus servidores volvieron al Plan Gratuito automáticamente.`,
    });
  }

  if (d.action === 'CREATE_CODE') {
    const dur = parseDurationString(d.duration);
    if (!dur.ok) {
      return NextResponse.json({ error: 'VALIDATION_ERROR', message: dur.error }, { status: 400 });
    }
    const created = aegisStore.createPremiumCode(state, {
      tier: d.tier,
      durationMs: dur.durationMs,
      durationLabel: dur.normalizedLabel,
      maxUses: d.maxUses,
      createdBy: user.username,
      customCode: d.customCode,
    });
    if (!created.ok) {
      return NextResponse.json({ error: 'VALIDATION_ERROR', message: created.message }, { status: 400 });
    }

    aegisStore.appendAuditLog(state, {
      guildId: null,
      actorId: user.discordId,
      actorName: user.username,
      action: 'PREMIUM_CODE_CREATED',
      entityType: 'PremiumCode',
      entityId: created.record.code,
      result: 'SUCCESS',
      metadata: {
        tier: created.record.tier,
        durationLabel: created.record.durationLabel,
        maxUses: created.record.maxUses,
      },
    });

    await aegisStore.commitMutation('premium:code_created', undefined, {
      code: created.record.code,
    });
    return NextResponse.json(
      {
        ok: true,
        message: `Código ${created.record.code} generado (${PLAN_CATALOG[created.record.tier].nameEs}, ${dur.normalizedLabel}, ${created.record.maxUses} uso/s).`,
        codeRecord: created.record,
      },
      { status: 201 }
    );
  }

  // REVOKE_CODE
  const cleanCode = d.code.trim().toUpperCase();
  if (!Object.hasOwn(state.premiumCodes, cleanCode)) {
    return NextResponse.json({ error: 'NOT_FOUND', message: 'Código no encontrado.' }, { status: 404 });
  }
  state.premiumCodes[cleanCode].revoked = true;
  aegisStore.appendAuditLog(state, {
    guildId: null,
    actorId: user.discordId,
    actorName: user.username,
    action: 'PREMIUM_CODE_REVOKED',
    entityType: 'PremiumCode',
    entityId: cleanCode,
    result: 'SUCCESS',
    metadata: {},
  });
  await aegisStore.commitMutation('premium:code_revoked', undefined, { code: cleanCode });
  return NextResponse.json({ ok: true, message: `Código ${cleanCode} revocado.` });
}
