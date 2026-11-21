import { NextResponse } from 'next/server';
import { sanitizeSystemHealthForPublic } from '@/lib/aegis/bot-slash-plan';
import { ensureBotStarted } from '@/lib/server/bot-runner';
import { getServerEnv } from '@/lib/server/env';
import { aegisStore } from '@/lib/server/store';

export async function GET() {
  if (getServerEnv().botConfigured) {
    ensureBotStarted();
  }
  await aegisStore.getState();
  const health = await aegisStore.getSystemHealth();
  return NextResponse.json({
    ready: health.api === 'ONLINE',
    degradedMode: health.degradedMode,
    services: sanitizeSystemHealthForPublic(health),
  });
}
