import { NextResponse } from 'next/server';
import { sanitizeSystemHealthForPublic } from '@/lib/aegis/bot-slash-plan';
import { aegisStore } from '@/lib/server/store';

export async function GET() {
  const health = await aegisStore.getSystemHealth();
  return NextResponse.json({
    status: health.degradedMode ? 'degraded' : 'ok',
    timestamp: new Date().toISOString(),
    services: sanitizeSystemHealthForPublic(health),
  });
}
