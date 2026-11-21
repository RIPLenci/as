import { NextRequest, NextResponse } from 'next/server';
import { twoFactorActionSchema } from '@/lib/aegis/validators';
import { requireAuthenticatedUser } from '@/lib/server/auth-guard';
import { aegisStore } from '@/lib/server/store';
import {
  buildTotpOtpAuthUri,
  generateRecoveryCodes,
  generateTotpSecretBase32,
  hashRecoveryCode,
  verifyTotpCode,
} from '@/lib/server/totp';

export async function GET() {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  const { state, user } = auth.ctx;
  const record = state.userTwoFactors[user.id];

  return NextResponse.json({
    enabled: Boolean(record?.enabled),
    hasPendingSetup: Boolean(record?.pendingSecretBase32),
    recoveryCodesRemaining: record?.recoveryCodesRemaining ?? 0,
    enabledAt: record?.enabledAt ?? null,
    lastVerifiedAt: record?.lastVerifiedAt ?? null,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = twoFactorActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { state, user } = auth.ctx;
  const existing = state.userTwoFactors[user.id] ?? {
    userId: user.id,
    discordId: user.discordId,
    enabled: false,
    secretBase32: null,
    pendingSecretBase32: null,
    recoveryCodesRemaining: 0,
    recoveryCodeHashes: [],
    enabledAt: null,
    lastVerifiedAt: null,
  };

  const d = parsed.data;

  if (d.action === 'INIT_SETUP') {
    const secret = generateTotpSecretBase32();
    existing.pendingSecretBase32 = secret;
    state.userTwoFactors[user.id] = existing;
    await aegisStore.commitMutation('2fa:setup_init', undefined, { userId: user.id });

    return NextResponse.json({
      secretBase32: secret,
      otpauthUri: buildTotpOtpAuthUri(secret, user.username),
    });
  }

  if (d.action === 'CONFIRM_ENABLE') {
    if (!existing.pendingSecretBase32) {
      return NextResponse.json(
        { error: 'SETUP_NOT_INITIALIZED', message: 'Inicia primero la configuración 2FA.' },
        { status: 400 }
      );
    }
    const valid = verifyTotpCode(existing.pendingSecretBase32, d.token);
    if (!valid) {
      return NextResponse.json(
        { error: 'INVALID_TOKEN', message: 'Código de verificación de 6 dígitos inválido o expirado.' },
        { status: 400 }
      );
    }

    const recoveryCodes = generateRecoveryCodes(8);
    existing.enabled = true;
    existing.secretBase32 = existing.pendingSecretBase32;
    existing.pendingSecretBase32 = null;
    existing.recoveryCodeHashes = recoveryCodes.map(hashRecoveryCode);
    existing.recoveryCodesRemaining = recoveryCodes.length;
    existing.enabledAt = new Date().toISOString();
    existing.lastVerifiedAt = existing.enabledAt;
    state.userTwoFactors[user.id] = existing;

    aegisStore.appendAuditLog(state, {
      guildId: null,
      actorId: user.discordId,
      actorName: user.username,
      action: 'USER_2FA_ENABLED',
      entityType: 'UserTwoFactor',
      entityId: user.id,
      result: 'SUCCESS',
      metadata: {},
    });

    await aegisStore.commitMutation('2fa:enabled', undefined, { userId: user.id });
    return NextResponse.json({
      enabled: true,
      recoveryCodes,
      recoveryCodesRemaining: existing.recoveryCodesRemaining,
      enabledAt: existing.enabledAt,
    });
  }

  if (!existing.enabled || !existing.secretBase32) {
    return NextResponse.json(
      { error: 'TWO_FACTOR_DISABLED', message: '2FA no está activado en tu cuenta.' },
      { status: 400 }
    );
  }

  const verifyOrConsumeRecovery = (token: string): boolean => {
    if (verifyTotpCode(existing.secretBase32!, token)) {
      return true;
    }
    const hash = hashRecoveryCode(token);
    const idx = existing.recoveryCodeHashes.indexOf(hash);
    if (idx !== -1) {
      existing.recoveryCodeHashes.splice(idx, 1);
      existing.recoveryCodesRemaining = existing.recoveryCodeHashes.length;
      return true;
    }
    return false;
  };

  if (!verifyOrConsumeRecovery(d.token)) {
    return NextResponse.json(
      { error: 'INVALID_TOKEN', message: 'Código TOTP o de recuperación incorrecto.' },
      { status: 400 }
    );
  }

  if (d.action === 'VERIFY_TOKEN') {
    existing.lastVerifiedAt = new Date().toISOString();
    state.userTwoFactors[user.id] = existing;
    await aegisStore.commitMutation('2fa:verified', undefined, { userId: user.id });
    return NextResponse.json({
      verified: true,
      lastVerifiedAt: existing.lastVerifiedAt,
      recoveryCodesRemaining: existing.recoveryCodesRemaining,
    });
  }

  // DISABLE
  existing.enabled = false;
  existing.secretBase32 = null;
  existing.pendingSecretBase32 = null;
  existing.recoveryCodeHashes = [];
  existing.recoveryCodesRemaining = 0;
  existing.enabledAt = null;
  state.userTwoFactors[user.id] = existing;

  aegisStore.appendAuditLog(state, {
    guildId: null,
    actorId: user.discordId,
    actorName: user.username,
    action: 'USER_2FA_DISABLED',
    entityType: 'UserTwoFactor',
    entityId: user.id,
    result: 'SUCCESS',
    metadata: {},
  });

  await aegisStore.commitMutation('2fa:disabled', undefined, { userId: user.id });
  return NextResponse.json({ enabled: false });
}
