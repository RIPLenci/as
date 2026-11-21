import { NextRequest, NextResponse } from 'next/server';
import { dedupePreserveOrder } from '@/lib/aegis/security-helpers';
import { antiNukePatchSchema } from '@/lib/aegis/validators';
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

  return NextResponse.json({
    config: auth.ctx.state.antiNukeConfigs[guildId] ?? null,
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
  const parsed = antiNukePatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { state, user } = auth.ctx;
  const existing = state.antiNukeConfigs[guildId];
  if (!existing) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const d = parsed.data;
  const updated = {
    ...existing,
    ...d,
    authorizedAdminIds:
      d.authorizedAdminIds !== undefined
        ? dedupePreserveOrder(d.authorizedAdminIds)
        : dedupePreserveOrder(existing.authorizedAdminIds),
    autoResponse: d.autoResponse ?? existing.autoResponse,
    updatedAt: new Date().toISOString(),
  };
  state.antiNukeConfigs[guildId] = updated;

  aegisStore.appendAuditLog(state, {
    guildId,
    actorId: user.discordId,
    actorName: user.username,
    action: 'ANTINUKE_CONFIG_UPDATED',
    entityType: 'AntiNukeConfig',
    entityId: guildId,
    result: 'SUCCESS',
    metadata: { enabled: updated.enabled, adminCount: updated.authorizedAdminIds.length },
  });

  await aegisStore.commitMutation('antinuke:config_updated', guildId, { config: updated });
  return NextResponse.json({ confirmed: true, config: updated });
}
