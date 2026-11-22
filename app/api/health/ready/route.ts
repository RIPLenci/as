import { NextResponse } from 'next/server';
import { sanitizeSystemHealthForPublic } from '@/lib/aegis/bot-slash-plan';
import { aegisStore } from '@/lib/server/store';

export async function GET() {
  await aegisStore.getState();
  const health = await aegisStore.getSystemHealth();
  return NextResponse.json({
    live: true,
    ready: health.api === 'ONLINE',
    degradedMode: health.degradedMode,
    services: sanitizeSystemHealthForPublic(health),
    syncHealth: health.syncHealth ?? null,
    latencyMetrics: health.latencyMetrics ?? null,
  });
}

