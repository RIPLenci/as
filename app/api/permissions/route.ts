import { NextResponse } from 'next/server';
import { ALL_PERMISSIONS, ALL_ROLES, ROLE_PERMISSION_MATRIX } from '@/lib/aegis/rbac';
import { requireAuthenticatedUser } from '@/lib/server/auth-guard';

export async function GET() {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  return NextResponse.json({
    roles: ALL_ROLES,
    permissions: ALL_PERMISSIONS,
    matrix: ROLE_PERMISSION_MATRIX,
    currentUserRole: auth.ctx.user.globalRole,
    systemSettings: auth.ctx.state.systemSettings,
  });
}
