import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import {
  detectImageFormatFromMagicBytes,
  isSafeSinglePathSegment,
} from '@/lib/aegis/security-helpers';
import { requireSuperOwner } from '@/lib/server/auth-guard';
import { EVIDENCE_DIR } from '@/lib/server/store';

export const dynamic = 'force-dynamic';

const SAFE_BAN_ID = /^GB-[A-Z0-9]+$/;

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ banId: string; filename: string }> }
) {
  const auth = await requireSuperOwner();
  if (!auth.ok) return auth.response;

  const { banId, filename } = await context.params;
  if (
    !SAFE_BAN_ID.test(banId) ||
    !isSafeSinglePathSegment(banId) ||
    !isSafeSinglePathSegment(filename)
  ) {
    return NextResponse.json({ error: 'INVALID_PATH' }, { status: 400 });
  }

  const rootDir = path.resolve(EVIDENCE_DIR);
  const resolved = path.resolve(rootDir, banId, filename);
  if (!resolved.startsWith(rootDir + path.sep)) {
    return NextResponse.json({ error: 'INVALID_PATH' }, { status: 400 });
  }

  if (!fs.existsSync(resolved)) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const buf = await fs.promises.readFile(resolved);
  const detected = detectImageFormatFromMagicBytes(new Uint8Array(buf));
  const ext = path.extname(filename).toLowerCase();
  const mime = detected?.mime ?? MIME_BY_EXT[ext] ?? 'application/octet-stream';
  const safeDownloadName = path.basename(resolved).replace(/"/g, '');

  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': mime,
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `inline; filename="${safeDownloadName}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
