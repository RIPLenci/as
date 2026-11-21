import { NextRequest, NextResponse } from 'next/server';
import type { UserPremiumSubscription } from '@/lib/aegis/types';
import {
  formatDurationHuman,
  formatDurationPrecise,
  formatExactDateTime,
  isSubscriptionActive,
  normalizePlanTier,
  parseDurationString,
  PLAN_CATALOG,
} from '@/lib/aegis/premium';
import { requireSuperOwner } from '@/lib/server/auth-guard';
import { aegisStore } from '@/lib/server/store';

export const dynamic = 'force-dynamic';

const SNOWFLAKE_RE = /^\d{17,20}$/;

function serializeAdminSubscription(sub: UserPremiumSubscription | undefined) {
  if (!sub) return null;
  const nowMs = Date.now();
  const active = isSubscriptionActive(sub, nowMs);
  const expiresMs = sub.expiresAt ? new Date(sub.expiresAt).getTime() : 0;
  const remainingMs = active ? Math.max(0, expiresMs - nowMs) : 0;
  return {
    ...sub,
    active,
    remainingMs,
    remainingHuman: active ? formatDurationHuman(remainingMs, 'es') : 'Expirado / Inactivo',
    remainingPrecise: active
      ? formatDurationPrecise(remainingMs, 'es')
      : '0 días, 0 horas, 0 minutos, 0 segundos (Inactivo)',
    grantedAtExact: formatExactDateTime(sub.grantedAt, 'es'),
    expiresAtExact: formatExactDateTime(sub.expiresAt, 'es'),
    maxServers: PLAN_CATALOG[normalizePlanTier(sub.tier)].quotas.maxPremiumServers,
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireSuperOwner();
  if (!auth.ok) return auth.response;

  const { state } = auth.ctx;
  const discordId = req.nextUrl.searchParams.get('discordId')?.trim() || '';

  let inspected: ReturnType<typeof serializeAdminSubscription> | null = null;
  let found = false;

  if (discordId) {
    if (!SNOWFLAKE_RE.test(discordId)) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'El Discord ID debe tener entre 17 y 20 dígitos.' },
        { status: 400 }
      );
    }
    const sub = Object.hasOwn(state.userSubscriptions, discordId)
      ? state.userSubscriptions[discordId]
      : undefined;
    if (sub) {
      found = true;
      inspected = serializeAdminSubscription(sub as never);
    }
  }

  const subscriptions = Object.values(state.userSubscriptions)
    .map((s) => serializeAdminSubscription(s as never))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
    .sort((a, b) => Number((b as { remainingMs: number }).remainingMs) - Number((a as { remainingMs: number }).remainingMs));

  const codes = Object.values(state.premiumCodes).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return NextResponse.json({
    ok: true,
    lookup: discordId ? { discordId, found, subscription: inspected } : null,
    subscriptions,
    codes,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireSuperOwner();
  if (!auth.ok) return auth.response;

  const { state, user } = auth.ctx;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== 'string') {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', message: 'Solicitud inválida.' },
      { status: 400 }
    );
  }

  const action = body.action;

  if (action === 'ADD') {
    const discordId = String(body.discordId || '').trim();
    const username = String(body.username || '').trim();
    const reason = String(body.reason || '').trim();
    const durationRaw = String(body.duration || '').trim();
    const tier = body.tier === 'DIAMANTE' ? 'DIAMANTE' : body.tier === 'ORO' ? 'ORO' : null;

    if (!SNOWFLAKE_RE.test(discordId)) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Ingresa un Discord ID válido (17 a 20 dígitos).' },
        { status: 400 }
      );
    }
    if (reason.length < 2) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Debes indicar la razón de asignación Premium.' },
        { status: 400 }
      );
    }
    if (!tier) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Selecciona un plan válido (Plan Oro o Plan Diamante).' },
        { status: 400 }
      );
    }
    const dur = parseDurationString(durationRaw);
    if (!dur.ok) {
      return NextResponse.json({ error: 'VALIDATION_ERROR', message: dur.error }, { status: 400 });
    }

    const targetUser = Object.hasOwn(state.users, discordId) ? state.users[discordId] : undefined;
    const sub = aegisStore.grantUserPremium(state, {
      discordId,
      username: username || targetUser?.username || `Usuario ${discordId.slice(-4)}`,
      tier,
      durationMs: dur.durationMs,
      reason,
      source: 'STAFF_PANEL',
      updatedBy: `${user.globalName || user.username} (${user.discordId})`,
    });

    aegisStore.appendAuditLog(state, {
      guildId: null,
      actorId: user.discordId,
      actorName: user.username,
      action: 'OWNER_ADMIN_PREMIUM_ADDED',
      entityType: 'UserPremiumSubscription',
      entityId: discordId,
      result: 'SUCCESS',
      metadata: { tier: sub.tier, duration: dur.normalizedLabel, reason },
    });

    await aegisStore.commitMutation('premium:owner_granted', undefined, { discordId });
    return NextResponse.json({
      ok: true,
      message: `${PLAN_CATALOG[sub.tier].nameEs} añadido a ${discordId} (+${dur.normalizedLabel}).`,
      subscription: serializeAdminSubscription(sub as never),
    });
  }

  if (action === 'EDIT_ADD_TIME') {
    const discordId = String(body.discordId || '').trim();
    const durationRaw = String(body.duration || '').trim();
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    const explicitTier =
      body.tier === 'DIAMANTE' ? 'DIAMANTE' : body.tier === 'ORO' ? 'ORO' : null;

    if (!SNOWFLAKE_RE.test(discordId)) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Ingresa un Discord ID válido (17 a 20 dígitos).' },
        { status: 400 }
      );
    }
    const existing = Object.hasOwn(state.userSubscriptions, discordId)
      ? state.userSubscriptions[discordId]
      : undefined;
    if (!existing) {
      return NextResponse.json(
        {
          error: 'NOT_FOUND',
          message: 'No existe un registro Premium previo para este Discord ID. Usa la pestaña Añadir primero.',
        },
        { status: 404 }
      );
    }

    const dur = parseDurationString(durationRaw);
    if (!dur.ok) {
      return NextResponse.json({ error: 'VALIDATION_ERROR', message: dur.error }, { status: 400 });
    }

    const existingPaidTier = normalizePlanTier(existing.tier);
    const resolvedTier: 'ORO' | 'DIAMANTE' =
      explicitTier ?? (existingPaidTier === 'DIAMANTE' ? 'DIAMANTE' : 'ORO');

    const sub = aegisStore.grantUserPremium(state, {
      discordId,
      username: existing.username,
      tier: resolvedTier,
      durationMs: dur.durationMs,
      reason: reason || existing.reason || 'Extensión de tiempo administrativo',
      source: 'STAFF_PANEL',
      updatedBy: `${user.globalName || user.username} (${user.discordId})`,
    });

    aegisStore.appendAuditLog(state, {
      guildId: null,
      actorId: user.discordId,
      actorName: user.username,
      action: 'OWNER_ADMIN_PREMIUM_TIME_EXTENDED',
      entityType: 'UserPremiumSubscription',
      entityId: discordId,
      result: 'SUCCESS',
      metadata: { added: dur.normalizedLabel, tier: sub.tier },
    });

    await aegisStore.commitMutation('premium:owner_extended', undefined, { discordId });
    return NextResponse.json({
      ok: true,
      message: `Tiempo añadido (+${dur.normalizedLabel}) a ${discordId}. Nuevo vencimiento: ${formatExactDateTime(sub.expiresAt, 'es')}.`,
      subscription: serializeAdminSubscription(sub as never),
    });
  }

  if (action === 'REMOVE') {
    const discordId = String(body.discordId || '').trim();
    if (!SNOWFLAKE_RE.test(discordId)) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Ingresa un Discord ID válido (17 a 20 dígitos).' },
        { status: 400 }
      );
    }
    const revoked = aegisStore.revokeUserPremium(state, {
      discordId,
      revokedBy: `${user.globalName || user.username} (${user.discordId})`,
    });
    if (!revoked) {
      return NextResponse.json(
        { error: 'NOT_FOUND', message: 'No se encontró una suscripción Premium para ese ID.' },
        { status: 404 }
      );
    }

    aegisStore.appendAuditLog(state, {
      guildId: null,
      actorId: user.discordId,
      actorName: user.username,
      action: 'OWNER_ADMIN_PREMIUM_REMOVED',
      entityType: 'UserPremiumSubscription',
      entityId: discordId,
      result: 'SUCCESS',
      metadata: {},
    });

    await aegisStore.commitMutation('premium:owner_removed', undefined, { discordId });
    return NextResponse.json({
      ok: true,
      message: `Plan Premium removido de ${discordId}. Todos sus servidores volvieron al Plan Gratuito automáticamente.`,
    });
  }

  if (action === 'CREATE_CODE') {
    const tier = body.tier === 'DIAMANTE' ? 'DIAMANTE' : body.tier === 'ORO' ? 'ORO' : null;
    const durationRaw = String(body.duration || '').trim();
    const maxUses = Math.max(1, Math.min(500, Number(body.maxUses) || 1));
    const customCode = typeof body.customCode === 'string' && body.customCode.trim()
      ? body.customCode.trim()
      : undefined;

    if (!tier) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Plan inválido.' },
        { status: 400 }
      );
    }
    const dur = parseDurationString(durationRaw);
    if (!dur.ok) {
      return NextResponse.json({ error: 'VALIDATION_ERROR', message: dur.error }, { status: 400 });
    }

    const created = aegisStore.createPremiumCode(state, {
      tier,
      durationMs: dur.durationMs,
      durationLabel: dur.normalizedLabel,
      maxUses,
      createdBy: user.username,
      customCode,
    });
    if (!created.ok) {
      return NextResponse.json({ error: 'VALIDATION_ERROR', message: created.message }, { status: 400 });
    }

    aegisStore.appendAuditLog(state, {
      guildId: null,
      actorId: user.discordId,
      actorName: user.username,
      action: 'OWNER_ADMIN_CODE_CREATED',
      entityType: 'PremiumCode',
      entityId: created.record.code,
      result: 'SUCCESS',
      metadata: { tier, duration: dur.normalizedLabel, maxUses },
    });

    await aegisStore.commitMutation('premium:code_created', undefined, { code: created.record.code });
    return NextResponse.json(
      {
        ok: true,
        message: `Código ${created.record.code} generado (${PLAN_CATALOG[tier].nameEs}, ${dur.normalizedLabel}).`,
        codeRecord: created.record,
      },
      { status: 201 }
    );
  }

  if (action === 'REVOKE_CODE') {
    const cleanCode = String(body.code || '').trim().toUpperCase();
    if (!Object.hasOwn(state.premiumCodes, cleanCode)) {
      return NextResponse.json({ error: 'NOT_FOUND', message: 'Código no encontrado.' }, { status: 404 });
    }
    state.premiumCodes[cleanCode].revoked = true;
    await aegisStore.commitMutation('premium:code_revoked', undefined, { code: cleanCode });
    return NextResponse.json({ ok: true, message: `Código ${cleanCode} revocado.` });
  }

  return NextResponse.json(
    { error: 'VALIDATION_ERROR', message: 'Acción administrativa desconocida.' },
    { status: 400 }
  );
}
