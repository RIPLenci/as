import { NextRequest, NextResponse } from 'next/server';
import { evaluateMutationCsrf } from './lib/aegis/csrf';

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith('/api/')) {
    const csrf = evaluateMutationCsrf({
      method: req.method,
      authorization: req.headers.get('authorization'),
      secFetchSite: req.headers.get('sec-fetch-site'),
      origin: req.headers.get('origin'),
      forwardedHost: req.headers.get('x-forwarded-host'),
      host: req.headers.get('host'),
      appUrl: process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || null,
    });

    if (!csrf.allowed) {
      return NextResponse.json(
        {
          error: 'CSRF_BLOCKED',
          message: csrf.reason || 'Solicitud cross-site bloqueada.',
        },
        {
          status: 403,
          headers: {
            'Cache-Control': 'no-store, private',
            'X-Content-Type-Options': 'nosniff',
          },
        }
      );
    }

    const res = NextResponse.next();
    res.headers.set('X-Content-Type-Options', 'nosniff');
    if (pathname.startsWith('/api/auth/')) {
      res.headers.set('Cache-Control', 'no-store, private');
    }
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};
