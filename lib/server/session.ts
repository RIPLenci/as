import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cookies, headers } from 'next/headers';
import { getServerEnv } from './env';
import { redisCoordinator } from './redis';

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

function getEncryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY?.trim() || getServerEnv().sessionSecret;
  return crypto.createHash('sha256').update(`aegis:token-enc:${raw}`).digest();
}

function encryptSecretValue(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

function decryptSecretValue(ciphertext: string): string | null {
  try {
    const parts = ciphertext.split('.');
    if (parts.length !== 3) return null;
    const [ivB64, tagB64, dataB64] = parts;
    const iv = Buffer.from(ivB64, 'base64url');
    const tag = Buffer.from(tagB64, 'base64url');
    const data = Buffer.from(dataB64, 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

function hashKeySegment(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

async function isRedisSharedAvailable(): Promise<boolean> {
  if (redisCoordinator.getStatus() === 'CONNECTED') return true;
  if (getServerEnv().redisConfigured) {
    const status = await redisCoordinator.ensureConnected();
    return status === 'CONNECTED';
  }
  return false;
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
// Distributed Single-Use Pending OAuth State, Exchange Codes & Revocations
// Uses shared Redis atomically across all Web/API instances; falls back to
// local file/memory ONLY when Redis is unconfigured/unavailable.
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
      const disk = JSON.parse(
        fs.readFileSync(OAUTH_PENDING_FILE, 'utf8')
      ) as Partial<PendingStoreSnapshot>;
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
    // Non-fatal if read-only fs; in-memory map remains active
  }
}

export function generateSessionId(): string {
  return `ses_${crypto.randomBytes(16).toString('hex')}`;
}

export async function revokeSessionId(
  sessionId: string | undefined | null,
  expiresAtMs?: number
): Promise<void> {
  if (!sessionId) return;
  const now = Date.now();
  const targetExp = expiresAtMs && expiresAtMs > now ? expiresAtMs : now + 24 * 3600_000;
  const ttlMs = Math.max(60_000, targetExp - now);

  if (await isRedisSharedAvailable()) {
    const ok = await redisCoordinator.setSharedKey(
      `aegis:session:revoked:${hashKeySegment(sessionId)}`,
      String(targetExp),
      ttlMs
    );
    if (ok) return;
  }

  const snap = readPendingSnapshot();
  snap.revokedSessions[sessionId] = targetExp;
  writePendingSnapshot(snap);
}

export async function isSessionRevoked(sessionId: string | undefined | null): Promise<boolean> {
  if (!sessionId) return true;

  if (await isRedisSharedAvailable()) {
    const raw = await redisCoordinator.getSharedKey(
      `aegis:session:revoked:${hashKeySegment(sessionId)}`
    );
    if (raw) {
      const exp = Number(raw);
      return Number.isFinite(exp) ? exp >= Date.now() : true;
    }
    // Check local cache as well in case session was revoked right before Redis came online
  }

  const snap = readPendingSnapshot();
  if (!Object.hasOwn(snap.revokedSessions, sessionId)) return false;
  return snap.revokedSessions[sessionId] >= Date.now();
}

export async function savePendingOAuthState(payload: OAuthStatePayload): Promise<void> {
  if (await isRedisSharedAvailable()) {
    const ok = await redisCoordinator.setSharedKey(
      `aegis:oauth:state:${hashKeySegment(payload.state)}`,
      JSON.stringify(payload),
      PENDING_STATE_TTL_MS
    );
    if (ok) return;
  }

  const snap = readPendingSnapshot();
  snap.states[payload.state] = payload;
  writePendingSnapshot(snap);
}

export async function consumePendingOAuthState(
  state: string
): Promise<OAuthStatePayload | null> {
  if (!verifyStateSignature(state)) return null;

  if (await isRedisSharedAvailable()) {
    const raw = await redisCoordinator.consumeSharedKeyAtomically(
      `aegis:oauth:state:${hashKeySegment(state)}`
    );
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as OAuthStatePayload;
        if (parsed.state !== state || Date.now() - parsed.issuedAt > PENDING_STATE_TTL_MS) {
          return null;
        }
        return parsed;
      } catch {
        return null;
      }
    }
  }

  const snap = readPendingSnapshot();
  if (!Object.hasOwn(snap.states, state)) return null;
  const found = snap.states[state];
  delete snap.states[state];
  writePendingSnapshot(snap);
  if (Date.now() - found.issuedAt > PENDING_STATE_TTL_MS) return null;
  return found;
}

export async function createOAuthExchangeCode(params: {
  userId: string;
  discordId: string;
  sessionId: string;
  maxAgeSeconds: number;
}): Promise<string> {
  const nonce = crypto.randomBytes(24).toString('base64url');
  const tag = crypto
    .createHmac('sha256', getSigningKey())
    .update(`oauth_exchange:${nonce}`)
    .digest('base64url')
    .slice(0, 16);
  const code = `${nonce}.${tag}`;
  const record: OAuthExchangeRecord = {
    code,
    userId: params.userId,
    discordId: params.discordId,
    sessionId: params.sessionId,
    maxAgeSeconds: params.maxAgeSeconds,
    issuedAt: Date.now(),
  };

  if (await isRedisSharedAvailable()) {
    const ok = await redisCoordinator.setSharedKey(
      `aegis:oauth:exchange:${hashKeySegment(code)}`,
      JSON.stringify(record),
      EXCHANGE_CODE_TTL_MS
    );
    if (ok) return code;
  }

  const snap = readPendingSnapshot();
  snap.exchanges[code] = record;
  writePendingSnapshot(snap);
  return code;
}

export async function consumeOAuthExchangeCode(
  code: string | undefined | null
): Promise<OAuthExchangeRecord | null> {
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

  if (await isRedisSharedAvailable()) {
    const raw = await redisCoordinator.consumeSharedKeyAtomically(
      `aegis:oauth:exchange:${hashKeySegment(code)}`
    );
    if (raw) {
      try {
        const record = JSON.parse(raw) as OAuthExchangeRecord;
        if (Date.now() - record.issuedAt > EXCHANGE_CODE_TTL_MS) return null;
        return record;
      } catch {
        return null;
      }
    }
  }

  const snap = readPendingSnapshot();
  if (!Object.hasOwn(snap.exchanges, code)) return null;
  const record = snap.exchanges[code];
  delete snap.exchanges[code];
  writePendingSnapshot(snap);
  if (Date.now() - record.issuedAt > EXCHANGE_CODE_TTL_MS) return null;
  return record;
}

export function getIframeSafeCookieOptions(maxAgeSeconds: number) {
  // SameSite=None and Secure=true are required for cookies inside cross-origin preview iframes.
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'none' as const,
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

export async function readSessionFromCookies(
  explicitBearer?: string | null
): Promise<SessionPayload | null> {
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
  if (await isSessionRevoked(payload.sessionId)) return null;
  return payload;
}

// ==============================================================================
// Encrypted Shared Discord OAuth Access Token Cache (AES-256-GCM in Redis / Memory)
// Never persisted in MongoDB snapshots or exposed to client browsers.
// ==============================================================================

interface VolatileOAuthToken {
  encryptedToken: string;
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

export async function setUserDiscordAccessToken(
  userId: string,
  accessToken: string,
  expiresInSeconds?: number
): Promise<void> {
  if (!userId || !accessToken) return;
  const ttlMs = Math.max(60, expiresInSeconds || 3600) * 1000 - 15_000;
  const encryptedToken = encryptSecretValue(accessToken);

  if (await isRedisSharedAvailable()) {
    const ok = await redisCoordinator.setSharedKey(
      `aegis:oauth:token:${hashKeySegment(userId)}`,
      encryptedToken,
      Math.max(30_000, ttlMs)
    );
    if (ok) return;
  }

  getTokenMap().set(userId, {
    encryptedToken,
    expiresAt: Date.now() + Math.max(30_000, ttlMs),
  });
}

export async function getUserDiscordAccessToken(userId: string): Promise<string | null> {
  if (!userId) return null;

  if (await isRedisSharedAvailable()) {
    const encrypted = await redisCoordinator.getSharedKey(
      `aegis:oauth:token:${hashKeySegment(userId)}`
    );
    if (encrypted) {
      return decryptSecretValue(encrypted);
    }
  }

  const entry = getTokenMap().get(userId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    getTokenMap().delete(userId);
    return null;
  }
  return decryptSecretValue(entry.encryptedToken);
}

export async function clearUserDiscordAccessToken(userId: string): Promise<void> {
  if (!userId) return;
  getTokenMap().delete(userId);
  if (await isRedisSharedAvailable()) {
    await redisCoordinator.deleteSharedKey(`aegis:oauth:token:${hashKeySegment(userId)}`);
  }
}
