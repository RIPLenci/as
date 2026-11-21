import { NextRequest, NextResponse } from 'next/server';
import { incidentPatchSchema } from '@/lib/aegis/validators';
import { requireAuthenticatedUser, requireGuildAuthorization } from '@/lib/server/auth-guard';
import { aegisStore } from '@/lib/server/store';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ incidentId: string }> }
) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  const { incidentId } = await context.params;
  const incident = auth.ctx.state.incidents.find((i) => i.id === incidentId);
  if (!incident) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const guard = requireGuildAuthorization(auth.ctx, incident.guildId, 'antiraid:read');
  if (!guard.ok) return guard.response;

  return NextResponse.json({ incident });
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ incidentId: string }> }
) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  const { incidentId } = await context.params;
  const { state, user } = auth.ctx;
  const incident = state.incidents.find((i) => i.id === incidentId);
  if (!incident) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const guard = requireGuildAuthorization(auth.ctx, incident.guildId, 'antiraid:write');
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => null);
  const parsed = incidentPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const d = parsed.data;
  if (d.status !== undefined) incident.status = d.status;
  if (d.assignedTo !== undefined) incident.assignedTo = d.assignedTo;
  if (d.comment) {
    incident.comments.push({
      id: `CMT-${Date.now().toString(36).toUpperCase()}`,
      authorId: user.discordId,
      authorName: user.username,
      content: d.comment,
      createdAt: new Date().toISOString(),
    });
  }
  incident.updatedAt = new Date().toISOString();

  aegisStore.appendAuditLog(state, {
    guildId: incident.guildId,
    actorId: user.discordId,
    actorName: user.username,
    action: 'INCIDENT_UPDATED',
    entityType: 'SecurityIncident',
    entityId: incident.id,
    result: 'SUCCESS',
    metadata: { status: incident.status, assignedTo: incident.assignedTo },
  });

  await aegisStore.commitMutation('incident:updated', incident.guildId, { incident });
  return NextResponse.json({ incident });
}
