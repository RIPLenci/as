import { NextRequest, NextResponse } from 'next/server';
import { userPreferencesPatchSchema } from '@/lib/aegis/validators';
import { requireAuthenticatedUser } from '@/lib/server/auth-guard';
import { aegisStore } from '@/lib/server/store';

export async function PATCH(req: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = userPreferencesPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { user } = auth.ctx;
  if (parsed.data.language) user.language = parsed.data.language;
  if (parsed.data.theme) user.theme = parsed.data.theme;

  await aegisStore.commitMutation('preferences:updated', undefined, {
    userId: user.id,
    language: user.language,
    theme: user.theme,
  });

  return NextResponse.json({ user });
}
