import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ live: true, uptimeSeconds: Math.round(process.uptime()) });
}
