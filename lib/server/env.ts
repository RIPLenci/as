// ==============================================================================
// AEGIS SECURITY — SERVER ENVIRONMENT & SECRET MANAGEMENT
// Never import this module from Client Components.
// ==============================================================================

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function parseCsvIds(val: string | undefined): string[] {
  if (!val) return [];
  return val
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d{17,20}$/.test(s));
}

const globalForSecret = globalThis as unknown as { __aegisEphemeralSecret?: string };
const RUNTIME_SECRET_DIR = path.join(process.cwd(), '.aegis-data');
const RUNTIME_SECRET_FILE = path.join(RUNTIME_SECRET_DIR, '.secret.key');

function getOrGenerateRuntimeSecret(): string {
  if (globalForSecret.__aegisEphemeralSecret) {
    return globalForSecret.__aegisEphemeralSecret;
  }

  try {
    if (fs.existsSync(RUNTIME_SECRET_FILE)) {
      const stored = fs.readFileSync(RUNTIME_SECRET_FILE, 'utf8').trim();
      if (/^[a-f0-9]{64,}$/i.test(stored)) {
        globalForSecret.__aegisEphemeralSecret = stored;
        return stored;
      }
    }
  } catch {
    // Fallback to fresh CSPRNG key generation
  }

  const generated = crypto.randomBytes(32).toString('hex');
  globalForSecret.__aegisEphemeralSecret = generated;

  try {
    if (!fs.existsSync(RUNTIME_SECRET_DIR)) {
      fs.mkdirSync(RUNTIME_SECRET_DIR, { recursive: true, mode: 0o700 });
    }
    const tmp = `${RUNTIME_SECRET_FILE}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, generated, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, RUNTIME_SECRET_FILE);
  } catch {
    // Safe in-memory fallback when filesystem is read-only
  }

  return generated;
}

export function normalizeOrigin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

export function isAllowedAppOrigin(origin: string | null | undefined): boolean {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  try {
    const u = new URL(normalized);
    if (u.hostname.endsWith('.run.app')) return u.protocol === 'https:';
    if (u.hostname === 'ai.studio' || u.hostname.endsWith('.ai.studio')) {
      return u.protocol === 'https:';
    }
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true;
    // Allow explicitly configured APP_URL / DASHBOARD_URL / DISCORD_REDIRECT_URI host
    for (const rawEnvUrl of [
      process.env.APP_URL,
      process.env.DASHBOARD_URL,
      process.env.DISCORD_REDIRECT_URI,
    ]) {
      const envOrigin = normalizeOrigin(rawEnvUrl);
      if (envOrigin && new URL(envOrigin).host === u.host) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function resolveOriginFromHeaders(
  headers: Pick<Headers, 'get'>,
  fallbackUrl?: string
): string {
  const forwardedHost = headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || headers.get('host')?.split(',')[0]?.trim();
  const forwardedProto = headers.get('x-forwarded-proto')?.split(',')[0]?.trim();

  if (host) {
    const isLocal = host.startsWith('localhost') || host.startsWith('127.0.0.1');
    const proto = forwardedProto || (isLocal ? 'http' : 'https');
    const candidate = normalizeOrigin(`${proto}://${host}`);
    if (candidate) return candidate;
  }

  const normalizedFallback = normalizeOrigin(fallbackUrl);
  if (normalizedFallback) return normalizedFallback;

  return (process.env.APP_URL || process.env.DASHBOARD_URL || 'http://localhost:3000').replace(
    /\/+$/,
    ''
  );
}

export function resolveCallbackUrl(params: {
  headers: Pick<Headers, 'get'>;
  requestedOrigin?: string | null;
}): string {
  const normalizedReqOrigin = normalizeOrigin(params.requestedOrigin);
  if (normalizedReqOrigin && isAllowedAppOrigin(normalizedReqOrigin)) {
    return `${normalizedReqOrigin}/api/auth/callback`;
  }

  const headerOrigin = resolveOriginFromHeaders(params.headers);
  const env = getServerEnv();
  const isHeaderLocal =
    headerOrigin.startsWith('http://localhost') || headerOrigin.startsWith('http://127.0.0.1');
  const envRedirectIsPublic =
    !env.discordRedirectUri.startsWith('http://localhost') &&
    !env.discordRedirectUri.startsWith('http://127.0.0.1');

  if (isHeaderLocal && envRedirectIsPublic) {
    return env.discordRedirectUri;
  }

  if (isAllowedAppOrigin(headerOrigin)) {
    return `${headerOrigin}/api/auth/callback`;
  }

  return env.discordRedirectUri;
}

export function getServerEnv() {
  const appUrl = (
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.DASHBOARD_URL ||
    'http://localhost:3000'
  ).replace(/\/+$/, '');
  const discordClientId = (process.env.DISCORD_CLIENT_ID || '').trim();
  const discordClientSecret = (process.env.DISCORD_CLIENT_SECRET || '').trim();
  const discordBotToken = (process.env.DISCORD_BOT_TOKEN || '').trim();
  const discordRedirectUri = (
    process.env.DISCORD_REDIRECT_URI || `${appUrl}/api/auth/callback`
  )
    .trim()
    .replace(/\/+$/, '');
  const mongodbUri = (process.env.MONGODB_URI || '').trim();
  const redisUrl = (process.env.REDIS_URL || '').trim();
  const sessionSecret = (process.env.SESSION_SECRET || '').trim() || getOrGenerateRuntimeSecret();
  const ownerIds = Array.from(
    new Set([
      ...parseCsvIds(process.env.OWNER_IDS),
      ...parseCsvIds(process.env.AEGIS_OWNER_DISCORD_ID),
    ])
  );
  const globalAdminIds = parseCsvIds(process.env.GLOBAL_ADMIN_IDS);
  const standaloneBot = process.env.AEGIS_STANDALONE_BOT === 'true';
  const embeddedBot = process.env.AEGIS_EMBEDDED_BOT === 'true';
  const requireDistributedLock =
    process.env.AEGIS_REQUIRE_DISTRIBUTED_LOCK === 'true' || Boolean(redisUrl);
  const localSingleInstance =
    process.env.AEGIS_LOCAL_SINGLE_INSTANCE === 'true' ||
    (!redisUrl && process.env.AEGIS_REQUIRE_DISTRIBUTED_LOCK !== 'true');
  const parsedWorkerConc = Number.parseInt(process.env.WORKER_MAX_CONCURRENCY || '4', 10);
  const workerMaxConcurrency =
    Number.isFinite(parsedWorkerConc) && parsedWorkerConc >= 1 && parsedWorkerConc <= 32
      ? parsedWorkerConc
      : 4;
  const parsedWorkerInterval = Number.parseInt(process.env.WORKER_INTERVAL_MS || '60000', 10);
  const workerIntervalMs =
    Number.isFinite(parsedWorkerInterval) && parsedWorkerInterval >= 5000
      ? parsedWorkerInterval
      : 60_000;

  return {
    nodeEnv: process.env.NODE_ENV || 'development',
    appUrl,
    discordClientId,
    discordClientSecret,
    discordBotToken,
    discordRedirectUri,
    discordBotInviteUrl: (process.env.DISCORD_BOT_INVITE_URL || '').trim(),
    mongodbUri,
    redisUrl,
    sessionSecret,
    ownerIds,
    globalAdminIds,
    standaloneBot,
    embeddedBot,
    requireDistributedLock,
    localSingleInstance,
    workerMaxConcurrency,
    workerIntervalMs,
    oauthConfigured: Boolean(discordClientId && discordClientSecret),
    botConfigured: Boolean(discordBotToken),
    mongodbConfigured: Boolean(mongodbUri),
    redisConfigured: Boolean(redisUrl),
  };
}
