import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isUserAuthorizedForGuildCollection, requireAuthenticatedUser } from '@/lib/server/auth-guard';
import { aegisStore } from '@/lib/server/store';

const patchSchema = z
  .object({
    id: z.string().trim().min(1).max(64).optional(),
    markAllRead: z.boolean().optional(),
  })
  .refine((d) => Boolean(d.markAllRead) || Boolean(d.id), {
    message: 'Either id or markAllRead is required.',
  });

export async function GET() {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  const { user, state } = auth.ctx;
  const notifications = state.notifications.filter(
    (n) => !n.guildId || isUserAuthorizedForGuildCollection(state, user, n.guildId)
  );

  return NextResponse.json({
    notifications,
    unreadCount: notifications.filter((n) => !n.read).length,
  });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { user, state } = auth.ctx;
  const isAuthorized = (guildId: string | null) =>
    !guildId || isUserAuthorizedForGuildCollection(state, user, guildId);

  if (parsed.data.markAllRead) {
    for (const n of state.notifications) {
      if (isAuthorized(n.guildId)) {
        n.read = true;
      }
    }
  } else if (parsed.data.id) {
    const found = state.notifications.find((n) => n.id === parsed.data.id);
    if (!found) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    if (!isAuthorized(found.guildId)) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }
    found.read = true;
  }

  await aegisStore.commitMutation('notifications:updated');
  return NextResponse.json({ success: true });
}
