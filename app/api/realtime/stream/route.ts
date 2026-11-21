import { NextRequest } from 'next/server';
import { isUserAuthorizedForGuildCollection, requireAuthenticatedUser } from '@/lib/server/auth-guard';
import { aegisStore } from '@/lib/server/store';
import { redisCoordinator } from '@/lib/server/redis';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const tokenParam = req.nextUrl.searchParams.get('token');
  const auth = await requireAuthenticatedUser(tokenParam);
  if (!auth.ok) return auth.response;

  const encoder = new TextEncoder();
  const { user } = auth.ctx;

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          closed = true;
        }
      };

      send('connected', {
        timestamp: new Date().toISOString(),
        userId: user.id,
      });

      const onStoreUpdate = (msg: {
        event: string;
        guildId: string | null;
        payload: unknown;
        timestamp: string;
      }) => {
        const liveState = aegisStore.getHotStateSync();
        if (msg.guildId && !isUserAuthorizedForGuildCollection(liveState, user, msg.guildId)) {
          return;
        }
        send('aegis_update', msg);
      };

      aegisStore.on('aegis:update', onStoreUpdate);

      const unsubRedis = redisCoordinator.subscribe((msg) => {
        if (msg.originProcessId && msg.originProcessId === aegisStore.instanceId) {
          return;
        }
        aegisStore.reloadFromDiskIfNewer();
        const liveState = aegisStore.getHotStateSync();
        if (msg.guildId && !isUserAuthorizedForGuildCollection(liveState, user, msg.guildId)) {
          return;
        }
        send('aegis_update', msg);
      });

      const heartbeat = setInterval(() => {
        send('heartbeat', { timestamp: new Date().toISOString() });
      }, 15_000);

      req.signal.addEventListener('abort', () => {
        closed = true;
        clearInterval(heartbeat);
        aegisStore.off('aegis:update', onStoreUpdate);
        unsubRedis();
        try {
          controller.close();
        } catch {
          // Stream already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
