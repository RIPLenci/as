import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import {
  detectImageFormatFromMagicBytes,
  isSafeSinglePathSegment,
} from '@/lib/aegis/security-helpers';
import type { GlobalBanEvidenceFile, GlobalBanRecord, RiskLevel } from '@/lib/aegis/types';
import { requireSuperOwner, verifyMutationOrigin } from '@/lib/server/auth-guard';
import { aegisStore, EVIDENCE_DIR } from '@/lib/server/store';

export const dynamic = 'force-dynamic';

const SNOWFLAKE_RE = /^\d{17,20}$/;
const MAX_EVIDENCE_FILES = 5;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

function mapSeverityInput(raw: string): {
  severity: RiskLevel;
  severityLabel: 'Bajo' | 'Medio' | 'Alto' | 'Peligro';
} {
  const norm = raw.trim().toUpperCase();
  if (norm === 'BAJO' || norm === 'LOW') return { severity: 'LOW', severityLabel: 'Bajo' };
  if (norm === 'MEDIO' || norm === 'MODERATE')
    return { severity: 'MODERATE', severityLabel: 'Medio' };
  if (norm === 'ALTO' || norm === 'HIGH') return { severity: 'HIGH', severityLabel: 'Alto' };
  return { severity: 'CRITICAL', severityLabel: 'Peligro' };
}

export async function GET(req: NextRequest) {
  const auth = await requireSuperOwner();
  if (!auth.ok) return auth.response;

  const { state } = auth.ctx;
  const q = (req.nextUrl.searchParams.get('q') || '').trim().toLowerCase();

  const bans = state.globalBans
    .filter((b) => {
      if (!q) return true;
      const hay = `${b.id} ${b.discordId} ${b.username} ${b.reason} ${b.severityLabel ?? ''}`.toLowerCase();
      return hay.includes(q);
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return NextResponse.json({ ok: true, bans });
}

export async function POST(req: NextRequest) {
  const originErr = verifyMutationOrigin(req);
  if (originErr) return originErr;

  const auth = await requireSuperOwner();
  if (!auth.ok) return auth.response;

  const { state, user } = auth.ctx;
  const contentType = req.headers.get('content-type') || '';

  let discordId = '';
  let username = '';
  let reason = '';
  let durationKindRaw = 'PERMANENT';
  let severityRaw = 'ALTO';
  let appealableRaw = 'SI';
  let evidenceText = '';
  const uploadedFiles: File[] = [];

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    discordId = String(form.get('discordId') || '').trim();
    username = String(form.get('username') || '').trim();
    reason = String(form.get('reason') || '').trim();
    durationKindRaw = String(form.get('durationKind') || 'PERMANENT').trim();
    severityRaw = String(form.get('severityLevel') || 'ALTO').trim();
    appealableRaw = String(form.get('appealable') || 'SI').trim();
    evidenceText = String(form.get('evidenceText') || '').trim();

    for (const item of form.getAll('files')) {
      if (item instanceof File && item.size > 0) {
        uploadedFiles.push(item);
      }
    }
  } else {
    const json = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!json) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Cuerpo de solicitud inválido.' },
        { status: 400 }
      );
    }
    discordId = String(json.discordId || '').trim();
    username = String(json.username || '').trim();
    reason = String(json.reason || '').trim();
    durationKindRaw = String(json.durationKind || 'PERMANENT').trim();
    severityRaw = String(json.severityLevel || 'ALTO').trim();
    appealableRaw = String(json.appealable || 'SI').trim();
    evidenceText = String(json.evidenceText || '').trim();
  }

  if (!SNOWFLAKE_RE.test(discordId)) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', message: 'Ingresa un Discord ID válido (17 a 20 dígitos).' },
      { status: 400 }
    );
  }
  if (reason.length < 2) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', message: 'Debes especificar el motivo del Globalban.' },
      { status: 400 }
    );
  }
  if (uploadedFiles.length > MAX_EVIDENCE_FILES) {
    return NextResponse.json(
      {
        error: 'VALIDATION_ERROR',
        message: `Solo puedes adjuntar un máximo de ${MAX_EVIDENCE_FILES} imágenes de evidencia.`,
      },
      { status: 400 }
    );
  }

  const verifiedUploads: Array<{
    buffer: Buffer;
    ext: string;
    mime: string;
    sizeBytes: number;
  }> = [];

  for (const file of uploadedFiles) {
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        {
          error: 'VALIDATION_ERROR',
          message: `La imagen ${file.name} supera el límite máximo de 8 MB.`,
        },
        { status: 400 }
      );
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const detected = detectImageFormatFromMagicBytes(new Uint8Array(buffer));
    if (!detected) {
      return NextResponse.json(
        {
          error: 'VALIDATION_ERROR',
          message: `Archivo inválido (${file.name}). El contenido real debe ser una imagen PNG, JPG, WEBP o GIF válida.`,
        },
        { status: 400 }
      );
    }
    verifiedUploads.push({
      buffer,
      ext: detected.ext,
      mime: detected.mime,
      sizeBytes: buffer.byteLength,
    });
  }

  const duplicate = state.globalBans.find(
    (b) => b.discordId === discordId && (b.status === 'ACTIVE' || b.status === 'PENDING_APPEAL')
  );
  if (duplicate) {
    return NextResponse.json(
      {
        error: 'DUPLICATE_SANCTION',
        message: `El usuario ${discordId} ya tiene un Globalban activo (${duplicate.id}).`,
      },
      { status: 409 }
    );
  }

  const banId = `GB-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const evidenceFiles: GlobalBanEvidenceFile[] = [];

  if (verifiedUploads.length > 0 && isSafeSinglePathSegment(banId)) {
    const rootDir = path.resolve(EVIDENCE_DIR);
    const targetDir = path.resolve(rootDir, banId);
    if (!targetDir.startsWith(rootDir + path.sep)) {
      return NextResponse.json({ error: 'INVALID_PATH' }, { status: 400 });
    }
    await fs.promises.mkdir(targetDir, { recursive: true, mode: 0o700 });

    for (let idx = 0; idx < verifiedUploads.length; idx += 1) {
      const upload = verifiedUploads[idx];
      const safeFilename = `evidencia-${idx + 1}-${crypto.randomBytes(3).toString('hex')}${upload.ext}`;
      const absPath = path.resolve(targetDir, safeFilename);
      if (!absPath.startsWith(targetDir + path.sep)) {
        return NextResponse.json({ error: 'INVALID_PATH' }, { status: 400 });
      }
      await fs.promises.writeFile(absPath, upload.buffer, { mode: 0o600 });

      evidenceFiles.push({
        id: `EV-${idx + 1}`,
        filename: safeFilename,
        mimeType: upload.mime,
        sizeBytes: upload.sizeBytes,
        url: `/api/admin/globalban/evidence/${banId}/${safeFilename}`,
      });
    }
  }

  const durationKind: 'INDEFINITE' | 'PERMANENT' =
    durationKindRaw.toUpperCase() === 'INDEFINITE' || durationKindRaw.toUpperCase() === 'INDEFINIDO'
      ? 'INDEFINITE'
      : 'PERMANENT';
  const { severity, severityLabel } = mapSeverityInput(severityRaw);
  const appealable =
    appealableRaw.toUpperCase() !== 'NO' && appealableRaw.toUpperCase() !== 'FALSE';

  const nowIso = new Date().toISOString();
  const knownUser = Object.hasOwn(state.users, discordId) ? state.users[discordId] : undefined;

  const ban: GlobalBanRecord = {
    id: banId,
    discordId,
    username: username || knownUser?.username || `Usuario ${discordId.slice(-4)}`,
    reason,
    description: reason,
    category: 'NETWORK_THREAT',
    severity,
    severityLabel,
    durationKind,
    appealable,
    sanctionType: 'PERMANENT',
    evidence:
      evidenceText ||
      (evidenceFiles.length > 0
        ? `${evidenceFiles.length} archivo(s) de evidencia adjuntos.`
        : 'Sanción emitida desde Panel Administrativo Owner.'),
    evidenceFiles,
    moderatorId: user.discordId,
    moderatorName: user.globalName || user.username,
    status: 'ACTIVE',
    createdAt: nowIso,
    expiresAt: null,
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
    history: [
      {
        id: `GBH-${Date.now()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
        action: 'CREATED',
        actorId: user.discordId,
        actorName: user.username,
        note: `Globalban creado (${durationKind === 'INDEFINITE' ? 'Indefinido' : 'Permanente'} · Gravedad: ${severityLabel} · Apelable: ${appealable ? 'Sí' : 'No'}).`,
        timestamp: nowIso,
      },
    ],
  };

  state.globalBans.unshift(ban);
  aegisStore.appendAuditLog(state, {
    guildId: null,
    actorId: user.discordId,
    actorName: user.username,
    action: 'OWNER_ADMIN_GLOBALBAN_CREATED',
    entityType: 'GlobalBan',
    entityId: ban.id,
    result: 'SUCCESS',
    metadata: {
      discordId,
      durationKind,
      severityLabel,
      appealable,
      evidenceFilesCount: evidenceFiles.length,
    },
  });

  await aegisStore.commitMutation('globalban:created', undefined, { ban });

  return NextResponse.json(
    {
      ok: true,
      message: `Globalban ${ban.id} aplicado a ${discordId} (${severityLabel}, ${durationKind === 'INDEFINITE' ? 'Indefinido' : 'Permanente'}).`,
      ban,
    },
    { status: 201 }
  );
}

export async function DELETE(req: NextRequest) {
  const originErr = verifyMutationOrigin(req);
  if (originErr) return originErr;

  const auth = await requireSuperOwner();
  if (!auth.ok) return auth.response;

  const { state, user } = auth.ctx;
  let discordId = req.nextUrl.searchParams.get('discordId')?.trim() || '';
  if (!discordId) {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    discordId = String(body?.discordId || '').trim();
  }

  if (!SNOWFLAKE_RE.test(discordId)) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', message: 'Debes ingresar un Discord ID válido (17 a 20 dígitos).' },
      { status: 400 }
    );
  }

  const target = state.globalBans.find(
    (b) => b.discordId === discordId && (b.status === 'ACTIVE' || b.status === 'PENDING_APPEAL')
  );
  if (!target) {
    return NextResponse.json(
      {
        error: 'NOT_FOUND',
        message: `No se encontró ningún Globalban activo para el ID ${discordId}.`,
      },
      { status: 404 }
    );
  }

  const nowIso = new Date().toISOString();
  target.status = 'REVOKED';
  target.revokedAt = nowIso;
  target.revokedBy = user.globalName || user.username;
  target.revokeReason = 'Eliminado desde Panel Administrativo Owner';
  target.history.push({
    id: `GBH-${Date.now()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
    action: 'REVOKED',
    actorId: user.discordId,
    actorName: user.username,
    note: 'Globalban eliminado por el Owner desde el Panel Administrativo.',
    timestamp: nowIso,
  });

  aegisStore.appendAuditLog(state, {
    guildId: null,
    actorId: user.discordId,
    actorName: user.username,
    action: 'OWNER_ADMIN_GLOBALBAN_REMOVED',
    entityType: 'GlobalBan',
    entityId: target.id,
    result: 'SUCCESS',
    metadata: { discordId },
  });

  await aegisStore.commitMutation('globalban:revoked', undefined, {
    banId: target.id,
    discordId,
  });

  return NextResponse.json({
    ok: true,
    message: `Globalban eliminado para el ID ${discordId} (${target.id}).`,
    ban: target,
  });
}
