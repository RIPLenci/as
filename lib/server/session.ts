import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cookies, headers } from 'next/headers';
import { getServerEnv } from './env';

export const SESSION_COOKIE_NAME = 'aegis_session';
export const OAUTH_STATE_COOKIE_NAME = 'aegis_oauth_state';

export interface SessionPayload {
  sessionId: string;
  userId: string;
  discordId: string;
  authMode: 'DISCORD_OAUTH';
  issuedAt: number;
  expiresAt: number;
}

export interface OAuthStatePayload {
  state: string;
  codeVerifier: string;
  redirectUri: string;
  issuedAt: number;
}

export interface OAuthExchangeRecord {
  code: string;
  userId: string;
  discordId: string;
  sessionId: string;
  maxAgeSeconds: number;
  issuedAt: number;
}

function getSigningKey(): Buffer {
  const { sessionSecret } = getServerEnv();
  return crypto.createHash('sha256').update(sessionSecret).digest();
}

export function signPayload<T extends object>(payload: T): string {
  const json = JSON.stringify(payload);
  const encoded = Buffer.from(json, 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSigningKey())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyPayload<T extends object>(token: string | undefined | null): T | null {
  if (!token || !token.includes('.')) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  if (!encoded || !sig) return null;

  const expectedSig = crypto
    .createHmac('sha256', getSigningKey())
    .update(encoded)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as T;
    return parsed;
  } catch {
    return null;
  }
}

export function generatePkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  return { codeVerifier, codeChallenge };
}

export function generateRandomState(): string {
  // Embed an HMAC check tag directly into the state string so tamper attempts fail
  // even before consulting the pending-state registry.
  const nonce = crypto.randomBytes(20).toString('base64url');
  const tag = crypto
    .createHmac('sha256', getSigningKey())
    .update(`oauth_state:${nonce}`)
    .digest('base64url')
    .slice(0, 16);
  return `${nonce}.${tag}`;
}

export function verifyStateSignature(state: string | undefined | null): boolean {
  if (!state || !state.includes('.')) return false;
  const [nonce, tag] = state.split('.');
  if (!nonce || !tag) return false;
  const expected = crypto
    .createHmac('sha256', getSigningKey())
    .update(`oauth_state:${nonce}`)
    .digest('base64url')
    .slice(0, 16);
  const a = Buffer.from(tag);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ==============================================================================
// Server-side Single-Use Pending OAuth State & Exchange Registry
// Solves cross-origin AI Studio iframe vs. top-level popup cookie partitioning.
// ==============================================================================

const OAUTH_PENDING_DIR = path.join(process.cwd(), '.aegis-data');
const OAUTH_PENDING_FILE = path.join(OAUTH_PENDING_DIR, 'oauth-pending.json');
const PENDING_STATE_TTL_MS = 10 * 60_000;
const EXCHANGE_CODE_TTL_MS = 2 * 60_000;

interface PendingStoreSnapshot {
  states: Record<string, OAuthStatePayload>;
  exchanges: Record<string, OAuthExchangeRecord>;
  revokedSessions: Record<string, number>;
}

const globalForOAuth = globalThis as unknown as {
  __aegisOAuthPending?: PendingStoreSnapshot;
};

function readPendingSnapshot(): PendingStoreSnapshot {
  const now = Date.now();
  let snap: PendingStoreSnapshot = globalForOAuth.__aegisOAuthPending ?? {
    states: {},
    exchanges: {},
    revokedSessions: {},
  };

  if (fs.existsSync(OAUTH_PENDING_FILE)) {
    try {
      const disk = JSON.parse(fs.readFileSync(OAUTH_PENDING_FILE, 'utf8')) as Partial<PendingStoreSnapshot>;
      snap = {
        states: { ...(disk.states || {}), ...snap.states },
        exchanges: { ...(disk.exchanges || {}), ...snap.exchanges },
        revokedSessions: { ...(disk.revokedSessions || {}), ...snap.revokedSessions },
      };
    } catch {
      // Ignore corrupt transient file
    }
  }

  for (const [k, v] of Object.entries(snap.states)) {
    if (!v || now - v.issuedAt > PENDING_STATE_TTL_MS) delete snap.states[k];
  }
  for (const [k, v] of Object.entries(snap.exchanges)) {
    if (!v || now - v.issuedAt > EXCHANGE_CODE_TTL_MS) delete snap.exchanges[k];
  }
  for (const [k, exp] of Object.entries(snap.revokedSessions)) {
    if (typeof exp !== 'number' || now > exp) delete snap.revokedSessions[k];
  }

  globalForOAuth.__aegisOAuthPending = snap;
  return snap;
}

function writePendingSnapshot(snap: PendingStoreSnapshot): void {
  globalForOAuth.__aegisOAuthPending = snap;
  try {
    if (!fs.existsSync(OAUTH_PENDING_DIR)) {
      fs.mkdirSync(OAUTH_PENDING_DIR, { recursive: true, mode: 0o700 });
    }
    const tmp = `${OAUTH_PENDING_FILE}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(snap), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, OAUTH_PENDING_FILE);
  } catch {
    // Non-fatal if read-only fs; in-memory globalThis map remains active
  }
}

export function generateSessionId(): string {
  return `ses_${crypto.randomBytes(16).toString('hex')}`;
}

export function revokeSessionId(sessionId: string | undefined | null, expiresAtMs?: number): void {
  if (!sessionId) return;
  const snap = readPendingSnapshot();
  snap.revokedSessions[sessionId] =
    expiresAtMs && expiresAtMs > Date.now() ? expiresAtMs : Date.now() + 24 * 3600_000;
  writePendingSnapshot(snap);
}

export function isSessionRevoked(sessionId: string | undefined | null): boolean {
  if (!sessionId) return true;
  const snap = readPendingSnapshot();
  if (!Object.hasOwn(snap.revokedSessions, sessionId)) return false;
  return snap.revokedSessions[sessionId] >= Date.now();
}

export function savePendingOAuthState(payload: OAuthStatePayload): void {
  const snap = readPendingSnapshot();
  snap.states[payload.state] = payload;
  writePendingSnapshot(snap);
}

export function consumePendingOAuthState(state: string): OAuthStatePayload | null {
  if (!verifyStateSignature(state)) return null;
  const snap = readPendingSnapshot();
  if (!Object.hasOwn(snap.states, state)) return null;
  const found = snap.states[state];
  delete snap.states[state];
  writePendingSnapshot(snap);
  if (Date.now() - found.issuedAt > PENDING_STATE_TTL_MS) return null;
  return found;
}

export function createOAuthExchangeCode(params: {
  userId: string;
  discordId: string;
  sessionId: string;
  maxAgeSeconds: number;
}): string {
  const nonce = crypto.randomBytes(24).toString('base64url');
  const tag = crypto
    .createHmac('sha256', getSigningKey())
    .update(`oauth_exchange:${nonce}`)
    .digest('base64url')
    .slice(0, 16);
  const code = `${nonce}.${tag}`;
  const snap = readPendingSnapshot();
  snap.exchanges[code] = {
    code,
    userId: params.userId,
    discordId: params.discordId,
    sessionId: params.sessionId,
    maxAgeSeconds: params.maxAgeSeconds,
    issuedAt: Date.now(),
  };
  writePendingSnapshot(snap);
  return code;
}

export function consumeOAuthExchangeCode(code: string | undefined | null): OAuthExchangeRecord | null {
  if (!code || !code.includes('.')) return null;
  const [nonce, tag] = code.split('.');
  if (!nonce || !tag) return null;
  const expected = crypto
    .createHmac('sha256', getSigningKey())
    .update(`oauth_exchange:${nonce}`)
    .digest('base64url')
    .slice(0, 16);
  const a = Buffer.from(tag);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const snap = readPendingSnapshot();
  if (!Object.hasOwn(snap.exchanges, code)) return null;
  const record = snap.exchanges[code];
  delete snap.exchanges[code];
  writePendingSnapshot(snap);
  if (Date.now() - record.issuedAt > EXCHANGE_CODE_TTL_MS) return null;
  return record;
}

export function getIframeSafeCookieOptions(maxAgeSeconds: number) {
  // Per oauth-integration guidelines: SameSite=None and Secure=true are required
  // for cookies inside the cross-origin AI Studio preview iframe.
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'none' as const,
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

export async function readSessionFromCookies(explicitBearer?: string | null): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  let raw = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!raw && explicitBearer) {
    raw = explicitBearer;
  }

  if (!raw) {
    const headerStore = await headers();
    const authHeader = headerStore.get('authorization');
    if (authHeader?.toLowerCase().startsWith('bearer ')) {
      raw = authHeader.slice(7).trim();
    }
  }

  const payload = verifyPayload<SessionPayload>(raw);
  if (!payload) return null;
  if (!payload.sessionId || typeof payload.expiresAt !== 'number') return null;
  if (Date.now() > payload.expiresAt) return null;
  if (isSessionRevoked(payload.sessionId)) return null;
  return payload;
}

// ==============================================================================
// Volatile Server-Only Discord OAuth Token Cache (Never Persisted or Sent to UI)
// Allows live guild roster refreshes (?refresh=1) during the active session.
// ==============================================================================

interface VolatileOAuthToken {
  accessToken: string;
  expiresAt: number;
}

const globalForDiscordTokens = globalThis as unknown as {
  __aegisDiscordOAuthTokens?: Map<string, VolatileOAuthToken>;
};

function getTokenMap(): Map<string, VolatileOAuthToken> {
  if (!globalForDiscordTokens.__aegisDiscordOAuthTokens) {
    globalForDiscordTokens.__aegisDiscordOAuthTokens = new Map();
  }
  return globalForDiscordTokens.__aegisDiscordOAuthTokens;
}

export function setUserDiscordAccessToken(
  userId: string,
  accessToken: string,
  expiresInSeconds?: number
): void {
  if (!userId || !accessToken) return;
  const ttlMs = Math.max(60, expiresInSeconds || 3600) * 1000;
  getTokenMap().set(userId, {
    accessToken,
    expiresAt: Date.now() + ttlMs - 15_000,
  });
}

export function getUserDiscordAccessToken(userId: string): string | null {
  if (!userId) return null;
  const entry = getTokenMap().get(userId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    getTokenMap().delete(userId);
    return null;
  }
  return entry.accessToken;
}

export function clearUserDiscordAccessToken(userId: string): void {
  if (!userId) return;
  getTokenMap().delete(userId);
}

