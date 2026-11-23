import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RISK_WEIGHTS, evaluateJoinRisk, scoreToRiskLevel } from './risk-engine';
import {
  AlertBatchDeduplicator,
  BoundedMemoryCache,
  SlidingWindowTracker,
} from './sliding-window';
import { canAccessGuild, hasPermission, isSuperOwner, resolveEffectiveRole, SUPER_OWNER_DISCORD_ID } from './rbac';
import { formatDurationPrecise, parseDurationString } from './premium';
import {
  antiRaidPatchSchema,
  botPermissionCreateSchema,
  channelWhitelistCreateSchema,
  globalBanCreateSchema,
  globalModeratorCreateSchema,
  participatingServerPatchSchema,
  securitySuitePatchSchema,
  twoFactorActionSchema,
  whitelistCreateSchema,
} from './validators';
import { aegisStore, buildPlanQuotas, createEmptyState } from '../server/store';
import {
  consumeOAuthExchangeCode,
  consumePendingOAuthState,
  createOAuthExchangeCode,
  generatePkcePair,
  generateRandomState,
  generateSessionId,
  isSessionRevoked,
  revokeSessionId,
  savePendingOAuthState,
  signPayload,
  verifyPayload,
  verifyStateSignature,
} from '../server/session';
import { requireGuildAuthorization, resolveAuthoritativeGlobalRole } from '../server/auth-guard';
import {
  buildTotpOtpAuthUri,
  computeHotpCode,
  decodeBase32,
  encodeBase32,
  generateRecoveryCodes,
  generateTotpSecretBase32,
  hashRecoveryCode,
  verifyTotpCode,
} from '../server/totp';
import { isAllowedAppOrigin, resolveCallbackUrl } from '../server/env';
import { buildDiscordAvatarUrl, buildDiscordBotInviteUrl, hasAdminPermission, hasManageGuildOrAdmin, verifyBotTelemetryLive } from '../server/discord-api';
import { classifyDiscordServers, deduplicateServers } from './servers-classifier';
import {
  aegisFetch,
  installAegisApiFetchBridge,
  setStoredSessionToken,
} from './client-auth';

test('Risk Engine assigns LOW to normal established user and never bans solely on young account age', () => {
  const normalUser = evaluateJoinRisk({
    accountAgeDays: 420,
    isBot: false,
    hasAvatar: true,
    joinsInWindow: 1,
    maxJoinsThreshold: 8,
    similarUsernameCount: 1,
    repetitiveJoinCount: 0,
    hasActiveGlobalBan: false,
    mode: 'NORMAL',
    weights: DEFAULT_RISK_WEIGHTS,
  });
  assert.equal(normalUser.level, 'LOW');
  assert.equal(normalUser.score, 0);

  // Young account (0 days) with NO burst, NO pattern, NO global ban, NO repetition
  // Must NOT trigger KICK, BAN, or QUARANTINE even if rules say HIGH -> BAN
  const youngSoleSignal = evaluateJoinRisk({
    accountAgeDays: 0,
    isBot: false,
    hasAvatar: true,
    joinsInWindow: 1,
    maxJoinsThreshold: 8,
    similarUsernameCount: 1,
    repetitiveJoinCount: 0,
    hasActiveGlobalBan: false,
    mode: 'STRICT',
    weights: { ...DEFAULT_RISK_WEIGHTS, accountAge: 90 },
    rules: [
      { level: 'LOW', action: 'LOG_ONLY', notifyAlertChannel: false },
      { level: 'MODERATE', action: 'BAN', notifyAlertChannel: true },
      { level: 'HIGH', action: 'BAN', notifyAlertChannel: true },
      { level: 'CRITICAL', action: 'BAN', notifyAlertChannel: true },
    ],
  });
  assert.equal(youngSoleSignal.recommendedAction, 'ALERT');
  assert.ok(youngSoleSignal.safeguardApplied?.includes('account age'));
});

test('Risk Engine escalates coordinated burst + global ban match to CRITICAL', () => {
  const raidJoin = evaluateJoinRisk({
    accountAgeDays: 1,
    isBot: false,
    hasAvatar: false,
    joinsInWindow: 14,
    maxJoinsThreshold: 8,
    similarUsernameCount: 6,
    repetitiveJoinCount: 3,
    hasActiveGlobalBan: true,
    mode: 'STRICT',
    weights: DEFAULT_RISK_WEIGHTS,
  });
  assert.equal(raidJoin.level, 'CRITICAL');
  assert.ok(raidJoin.score >= 75);
  assert.equal(raidJoin.signals.length, 5);
  assert.equal(scoreToRiskLevel(75), 'CRITICAL');
  assert.equal(scoreToRiskLevel(50), 'HIGH');
  assert.equal(scoreToRiskLevel(25), 'MODERATE');
  assert.equal(scoreToRiskLevel(10), 'LOW');
});

test('L1 BoundedMemoryCache enforces maxEntries, TTL, and prefix invalidation', () => {
  const cache = new BoundedMemoryCache<string>(2, 5000);
  cache.set('guild:1:config', 'v1');
  cache.set('guild:2:config', 'v2');
  // Access guild:1 so guild:2 becomes oldest
  assert.equal(cache.get('guild:1:config'), 'v1');
  // Adding 3rd entry evicts guild:2
  cache.set('guild:3:config', 'v3');
  assert.equal(cache.get('guild:2:config'), undefined);
  assert.equal(cache.get('guild:1:config'), 'v1');

  const removed = cache.invalidateByPrefix('guild:1:');
  assert.equal(removed, 1);
  assert.equal(cache.get('guild:1:config'), undefined);
});

test('SlidingWindowTracker detects bursts within window and prunes expired events', () => {
  const tracker = new SlidingWindowTracker();
  const base = 1_700_000_000_000;
  for (let i = 0; i < 7; i += 1) {
    const r = tracker.recordAndAnalyze('guild:100', `user_${i}`, 10, 8, `raider_${i}`, base + i * 500);
    assert.equal(r.thresholdExceeded, false);
  }
  const eighth = tracker.recordAndAnalyze('guild:100', 'user_7', 10, 8, 'raider_7', base + 4000);
  assert.equal(eighth.thresholdExceeded, true);
  assert.equal(eighth.countInWindow, 8);
  assert.equal(eighth.similarUsernameCount, 8);

  // After 15 seconds, window is clean
  assert.equal(tracker.getCount('guild:100', 10, base + 16_000), 0);
});

test('AlertBatchDeduplicator groups floods within batch interval', () => {
  const dedup = new AlertBatchDeduplicator();
  const t0 = 1_700_000_000_000;
  assert.deepEqual(dedup.shouldEmit('guild:1:raid', 15, t0), { emit: true, groupedCount: 1 });
  assert.deepEqual(dedup.shouldEmit('guild:1:raid', 15, t0 + 1000), { emit: false, groupedCount: 2 });
  assert.deepEqual(dedup.shouldEmit('guild:1:raid', 15, t0 + 2000), { emit: false, groupedCount: 3 });
  assert.deepEqual(dedup.shouldEmit('guild:1:raid', 15, t0 + 16_000), { emit: true, groupedCount: 3 });
});

test('RBAC & anti-IDOR deny cross-guild access and unauthorized global ban mutations', () => {
  const serverAdminUser = { discordId: '100000000000000001', globalRole: 'SERVER_ADMINISTRATOR' as const };
  const ownedGuild = {
    guildId: '200000000000000001',
    ownerDiscordId: '100000000000000001',
    userIsOwner: true,
    userHasManageGuild: true,
  };
  const foreignGuild = {
    guildId: '200000000000000002',
    ownerDiscordId: '999999999999999999',
    userIsOwner: false,
    userHasManageGuild: false,
  };

  assert.equal(canAccessGuild(serverAdminUser, ownedGuild), true);
  assert.equal(canAccessGuild(serverAdminUser, foreignGuild), false);
  assert.equal(resolveEffectiveRole(serverAdminUser, ownedGuild), 'SERVER_ADMINISTRATOR');
  assert.equal(resolveEffectiveRole(serverAdminUser, foreignGuild), 'VIEWER');

  assert.equal(hasPermission('SERVER_ADMINISTRATOR', 'antiraid:write'), true);
  assert.equal(hasPermission('SERVER_ADMINISTRATOR', 'globalban:create'), false);
  assert.equal(hasPermission('GLOBAL_MODERATOR', 'globalban:create'), true);
  assert.equal(hasPermission('GLOBAL_MODERATOR', 'globalban:revoke'), false);
  assert.equal(hasPermission('OWNER', 'moderators:manage'), true);
});

test('Zod validators enforce permanent ban reinforced review and whitelist rule scoping', () => {
  const permWithoutConfirm = globalBanCreateSchema.safeParse({
    discordId: '123456789012345678',
    username: 'raider_bot',
    reason: 'Coordinated token raid across 4 guilds',
    description: 'Automated mass join flood with identical token fingerprint.',
    category: 'COORDINATED_RAID',
    severity: 'CRITICAL',
    sanctionType: 'PERMANENT',
    evidence: 'Audit export #99182 with 42 synchronized joins.',
    reinforcedAuthorizationConfirmed: false,
  });
  assert.equal(permWithoutConfirm.success, false);

  const validTemp = globalBanCreateSchema.safeParse({
    discordId: '123456789012345678',
    username: 'raider_bot',
    reason: 'Coordinated raid wave',
    description: 'Participated in 18-account burst raid.',
    category: 'COORDINATED_RAID',
    severity: 'HIGH',
    sanctionType: 'TEMPORARY',
    durationDays: 30,
    evidence: 'Incident INC-1001 logs.',
  });
  assert.equal(validTemp.success, true);

  const emptyWhitelistScope = whitelistCreateSchema.safeParse({
    targetId: '123456789012345678',
    targetName: 'PartnerBot',
    targetType: 'BOT',
    reason: 'Verified automation',
    excludedRules: [],
  });
  assert.equal(emptyWhitelistScope.success, false);

  const validAntiRaid = antiRaidPatchSchema.safeParse({
    maxJoins: 12,
    timeWindowSeconds: 10,
    mode: 'STRICT',
  });
  assert.equal(validAntiRaid.success, true);
});

test('Empty persistence store contains zero fake, seed, or sample records', () => {
  const empty = createEmptyState();
  assert.equal(Object.keys(empty.users).length, 0);
  assert.equal(Object.keys(empty.guilds).length, 0);
  assert.equal(Object.keys(empty.antiRaidConfigs).length, 0);
  assert.equal(Object.keys(empty.antiNukeConfigs).length, 0);
  assert.equal(Object.keys(empty.lockdowns).length, 0);
  assert.equal(empty.incidents.length, 0);
  assert.equal(empty.events.length, 0);
  assert.equal(empty.quarantines.length, 0);
  assert.equal(empty.whitelists.length, 0);
  assert.equal(empty.globalBans.length, 0);
  assert.equal(empty.appeals.length, 0);
  assert.equal(Object.keys(empty.participatingServers).length, 0);
  assert.equal(empty.globalModerators.length, 0);
  assert.equal(empty.auditLogs.length, 0);
  assert.equal(empty.notifications.length, 0);
});

test('OAuth2 PKCE state, HMAC signature, and single-use consumption enforce CSRF safety', async () => {
  const { codeVerifier, codeChallenge } = generatePkcePair();
  assert.ok(codeVerifier.length >= 32);
  assert.ok(codeChallenge.length >= 32);
  assert.notEqual(codeVerifier, codeChallenge);

  const state = generateRandomState();
  assert.equal(verifyStateSignature(state), true);
  assert.equal(verifyStateSignature(`${state}tamper`), false);
  assert.equal(verifyStateSignature('unsigned-token'), false);

  await savePendingOAuthState({
    state,
    codeVerifier,
    redirectUri: 'https://ais-dev-test.us-east1.run.app/api/auth/callback',
    issuedAt: Date.now(),
  });

  // First consumption succeeds with exact PKCE verifier
  const consumed = await consumePendingOAuthState(state);
  assert.ok(consumed);
  assert.equal(consumed.codeVerifier, codeVerifier);

  // Replay attempt fails (single-use)
  assert.equal(await consumePendingOAuthState(state), null);
});

test('OAuth2 single-use session exchange codes and payload HMAC signatures prevent tampering', async () => {
  const token = signPayload({ userId: 'usr_123', discordId: '123', expiresAt: Date.now() + 60_000 });
  const verified = verifyPayload<{ userId: string }>(token);
  assert.equal(verified?.userId, 'usr_123');
  assert.equal(verifyPayload(`${token}x`), null);

  const exchange = await createOAuthExchangeCode({
    userId: 'usr_999',
    discordId: '999999999999999999',
    sessionId: 'ses_abc',
    maxAgeSeconds: 3600,
  });

  const record = await consumeOAuthExchangeCode(exchange);
  assert.ok(record);
  assert.equal(record.userId, 'usr_999');
  // Second use must fail
  assert.equal(await consumeOAuthExchangeCode(exchange), null);
});

test('Callback URL resolution handles Dev .run.app, Shared .run.app, and localhost cleanly', () => {
  const emptyHeaders = new Headers();
  assert.equal(
    isAllowedAppOrigin('https://ais-dev-q4elqz4ekj3s72cqfwbaxa-521789584755.us-east1.run.app'),
    true
  );
  assert.equal(
    isAllowedAppOrigin('https://ais-pre-q4elqz4ekj3s72cqfwbaxa-521789584755.us-east1.run.app'),
    true
  );
  assert.equal(isAllowedAppOrigin('https://evil-attacker.example.com'), false);

  assert.equal(
    resolveCallbackUrl({
      headers: emptyHeaders,
      requestedOrigin: 'https://ais-dev-q4elqz4ekj3s72cqfwbaxa-521789584755.us-east1.run.app/',
    }),
    'https://ais-dev-q4elqz4ekj3s72cqfwbaxa-521789584755.us-east1.run.app/api/auth/callback'
  );

  const proxyHeaders = new Headers({
    'x-forwarded-host': 'ais-pre-q4elqz4ekj3s72cqfwbaxa-521789584755.us-east1.run.app',
    'x-forwarded-proto': 'https',
  });
  assert.equal(
    resolveCallbackUrl({ headers: proxyHeaders }),
    'https://ais-pre-q4elqz4ekj3s72cqfwbaxa-521789584755.us-east1.run.app/api/auth/callback'
  );

  // Untrusted origin param must fall back to proxy headers rather than open-redirect
  assert.equal(
    resolveCallbackUrl({
      headers: proxyHeaders,
      requestedOrigin: 'https://phishing.invalid',
    }),
    'https://ais-pre-q4elqz4ekj3s72cqfwbaxa-521789584755.us-east1.run.app/api/auth/callback'
  );

  assert.equal(
    isAllowedAppOrigin('https://axionsecurity.ai.studio/'),
    true
  );
  assert.equal(
    resolveCallbackUrl({
      headers: emptyHeaders,
      requestedOrigin: 'https://axionsecurity.ai.studio/',
    }),
    'https://axionsecurity.ai.studio/api/auth/callback'
  );
  assert.equal(
    resolveCallbackUrl({
      headers: new Headers({
        'x-forwarded-host': 'axionsecurity.ai.studio',
        'x-forwarded-proto': 'https',
      }),
    }),
    'https://axionsecurity.ai.studio/api/auth/callback'
  );

  // When proxy forwards bare localhost host header, prefer configured public APP_URL
  const prevAppUrl = process.env.APP_URL;
  process.env.APP_URL = 'https://ais-dev-q4elqz4ekj3s72cqfwbaxa-521789584755.us-east1.run.app';
  try {
    const localHeaders = new Headers({ host: 'localhost:3000' });
    assert.equal(
      resolveCallbackUrl({ headers: localHeaders }),
      'https://ais-dev-q4elqz4ekj3s72cqfwbaxa-521789584755.us-east1.run.app/api/auth/callback'
    );
    assert.equal(
      resolveCallbackUrl({ headers: localHeaders, requestedOrigin: 'http://localhost:3000' }),
      'http://localhost:3000/api/auth/callback'
    );
  } finally {
    if (prevAppUrl === undefined) {
      delete process.env.APP_URL;
    } else {
      process.env.APP_URL = prevAppUrl;
    }
  }
});

test('Discord guild permission bitmask accepts Owner, Administrator (0x8), and ManageGuild (0x20)', () => {
  assert.equal(hasManageGuildOrAdmin('0', true), true);
  assert.equal(hasManageGuildOrAdmin('8', false), true);
  assert.equal(hasManageGuildOrAdmin('32', false), true);
  assert.equal(hasManageGuildOrAdmin('104324673', false), false);
});

test('Session revocation blacklist invalidates logged-out session IDs', async () => {
  const sid = generateSessionId();
  assert.ok(sid.startsWith('ses_'));
  assert.equal(await isSessionRevoked(sid), false);
  assert.equal(await isSessionRevoked(null), true);

  await revokeSessionId(sid, Date.now() + 60_000);
  assert.equal(await isSessionRevoked(sid), true);
});

test('RBAC role resolution and customGrants enforcement', () => {
  const user = {
    discordId: '100000000000000009',
    globalRole: 'SERVER_ADMINISTRATOR' as const,
  };
  const ownedGuild = { userIsOwner: true, ownerDiscordId: '100000000000000009', userHasManageGuild: false };
  const secondaryGuild = { userIsOwner: false, ownerDiscordId: '999999999999999999', userHasManageGuild: false };

  assert.equal(resolveEffectiveRole(user, ownedGuild), 'SERVER_ADMINISTRATOR');
  assert.equal(resolveEffectiveRole(user, secondaryGuild, '100000000000000009'), 'SERVER_ADMINISTRATOR');
});

test('resolveAuthoritativeGlobalRole strips stale or revoked global roles', () => {
  const state = createEmptyState();
  // User whose global mod record was revoked or missing
  state.globalModerators.push({
    id: 'gmod_1',
    discordId: '555555555555555555',
    username: 'former_mod',
    avatarUrl: null,
    role: 'GLOBAL_MODERATOR',
    allowedActions: ['globalban:read'],
    addedBy: 'owner',
    joinedAt: new Date().toISOString(),
    status: 'REVOKED',
  });

  assert.equal(
    resolveAuthoritativeGlobalRole(state, '555555555555555555', 'GLOBAL_MODERATOR'),
    'SERVER_ADMINISTRATOR'
  );
  assert.equal(
    resolveAuthoritativeGlobalRole(state, '666666666666666666', 'GLOBAL_ADMINISTRATOR'),
    'SERVER_ADMINISTRATOR'
  );
  assert.equal(
    resolveAuthoritativeGlobalRole(state, '666666666666666666', 'OWNER'),
    'SERVER_ADMINISTRATOR'
  );

  // Active global moderator keeps GLOBAL_MODERATOR
  state.globalModerators.push({
    id: 'gmod_2',
    discordId: '777777777777777777',
    username: 'active_mod',
    avatarUrl: null,
    role: 'GLOBAL_MODERATOR',
    allowedActions: ['globalban:read', 'globalban:create'],
    addedBy: 'owner',
    joinedAt: new Date().toISOString(),
    status: 'ACTIVE',
  });
  assert.equal(
    resolveAuthoritativeGlobalRole(state, '777777777777777777', 'SERVER_ADMINISTRATOR'),
    'GLOBAL_MODERATOR'
  );
});

test('Validators block GLOBAL_MODERATOR privilege escalation and enforce Snowflake IDs', () => {
  const escalatedMod = globalModeratorCreateSchema.safeParse({
    discordId: '123456789012345678',
    username: 'mod_user',
    role: 'GLOBAL_MODERATOR',
    allowedActions: ['globalban:read', 'globalban:revoke'],
  });
  assert.equal(escalatedMod.success, false);

  const validMod = globalModeratorCreateSchema.safeParse({
    discordId: '123456789012345678',
    username: 'mod_user',
    role: 'GLOBAL_MODERATOR',
    allowedActions: ['globalban:read', 'globalban:create', 'appeals:manage'],
  });
  assert.equal(validMod.success, true);

  const badChannelAntiRaid = antiRaidPatchSchema.safeParse({
    alertChannelId: 'not-a-snowflake',
  });
  assert.equal(badChannelAntiRaid.success, false);

  const badParticipating = participatingServerPatchSchema.safeParse({
    guildId: '123456789012345678',
    globalBanEnabled: true,
    enforcementMode: 'QUARANTINE_AND_ALERT',
    actionPolicy: 'QUARANTINE_ON_JOIN',
    notificationChannelId: 'invalid-channel',
  });
  assert.equal(badParticipating.success, false);
});

test('installAegisApiFetchBridge never throws on readonly or getter-only window.fetch and aegisFetch injects Bearer token safely', async () => {
  const prevWindow = (globalThis as Record<string, unknown>).window;
  const captured: Array<{ url: string; auth: string | null }> = [];
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    captured.push({ url: String(input), auth: headers.get('Authorization') });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const storage = new Map<string, string>();
  const mockWindow: Record<string, unknown> = {
    location: { origin: 'https://ais-dev.run.app' },
    sessionStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
      removeItem: (k: string) => storage.delete(k),
    },
  };
  // Simulate Safari/WebKit getter-only non-configurable window.fetch
  Object.defineProperty(mockWindow, 'fetch', {
    get: () => fakeFetch,
    configurable: false,
  });

  (globalThis as Record<string, unknown>).window = mockWindow;
  try {
    const cleanup = installAegisApiFetchBridge();
    setStoredSessionToken('tok_readonly_test');

    await aegisFetch('/api/overview');
    await aegisFetch('https://discord.com/api/v10/users/@me');

    assert.equal(captured[0]?.url, '/api/overview');
    assert.equal(captured[0]?.auth, 'Bearer tok_readonly_test');
    assert.equal(captured[1]?.url, 'https://discord.com/api/v10/users/@me');
    assert.equal(captured[1]?.auth, null);

    cleanup();
  } finally {
    if (prevWindow === undefined) {
      delete (globalThis as Record<string, unknown>).window;
    } else {
      (globalThis as Record<string, unknown>).window = prevWindow;
    }
  }
});

test('buildDiscordAvatarUrl and verifyBotTelemetryLive return real CDN URL or honest offline fallback', async () => {
  assert.equal(
    buildDiscordAvatarUrl('1557508606767927296', 'abc123def'),
    'https://cdn.discordapp.com/avatars/1557508606767927296/abc123def.png?size=256'
  );
  assert.equal(
    buildDiscordAvatarUrl('1557508606767927296', 'a_gifhash'),
    'https://cdn.discordapp.com/avatars/1557508606767927296/a_gifhash.gif?size=256'
  );
  assert.equal(buildDiscordAvatarUrl('1557508606767927296', null), null);

  const prevToken = process.env.DISCORD_BOT_TOKEN;
  delete process.env.DISCORD_BOT_TOKEN;
  try {
    const fallback = await verifyBotTelemetryLive();
    assert.deepEqual(fallback, {
      online: false,
      id: null,
      tag: null,
      avatarUrl: null,
      pingMs: null,
      guildCount: null,
      userCount: null,
    });
  } finally {
    if (prevToken !== undefined) {
      process.env.DISCORD_BOT_TOKEN = prevToken;
    }
  }
});

test('classifyDiscordServers enforces strict OWNED -> ADMIN -> INVITE priority, deduplication, and zero admin access on uninstalled servers', () => {
  const mkGuild = (
    guildId: string,
    name: string,
    opts: {
      owner?: boolean;
      admin?: boolean;
      manage?: boolean;
      connected?: boolean;
      members?: number;
    }
  ) => ({
    guildId,
    name,
    iconUrl: null,
    memberCount: opts.members ?? 0,
    memberCountKnown: Boolean(opts.members && opts.members > 0),
    ownerDiscordId: opts.owner ? '100' : '999',
    userIsOwner: Boolean(opts.owner),
    userIsAdmin: Boolean(opts.admin || opts.owner),
    userHasManageGuild: Boolean(opts.owner || opts.admin || opts.manage),
    botStatus: (opts.connected ? 'BOT_CONNECTED' : 'BOT_NOT_INSTALLED') as
      | 'BOT_CONNECTED'
      | 'BOT_NOT_INSTALLED',
    botPermissionsOk: Boolean(opts.connected),
    protectionEnabled: Boolean(opts.connected),
    lastSyncAt: null,
    linkedAt: null,
  });

  const sample = [
    // Plain member on uninstalled guild (Priority 3 - cannot invite, cannot manage)
    mkGuild('4', 'Public Lounge', { connected: false, members: 420 }),
    // Admin on connected guild (Priority 2)
    mkGuild('2', 'Gaming Hub', { admin: true, connected: true, members: 180 }),
    // Duplicate of owned guild (should deduplicate preferring connected/owner)
    mkGuild('1', 'Alpha HQ', { owner: true, connected: false, members: 10 }),
    mkGuild('1', 'Alpha HQ', { owner: true, connected: true, members: 95 }),
    // Owned guild WITHOUT bot installed (Priority 3 - canInvite=true, canManage=false!)
    mkGuild('3', 'Pending Kingdom', { owner: true, connected: false, members: 50 }),
    // Plain member on connected guild (Member read-only)
    mkGuild('5', 'Partner Community', { connected: true, members: 800 }),
  ];

  const deduped = deduplicateServers(sample);
  assert.equal(deduped.length, 5);

  const classified = classifyDiscordServers(sample, (gid) =>
    `https://discord.com/oauth2/authorize?client_id=1557508606767927296&permissions=1099780161686&scope=bot+applications.commands&guild_id=${gid}`
  );

  // Strict Priority 1: Owned + Bot Connected
  assert.deepEqual(
    classified.owned.map((g) => g.guildId),
    ['1']
  );
  assert.equal(classified.owned[0]?.roleTag, 'PROPIETARIO');
  assert.equal(classified.owned[0]?.canManage, true);
  assert.equal(classified.owned[0]?.canInvite, false);

  // Strict Priority 2: Admin + Bot Connected (admin without owner/second-owner cannot manage)
  assert.deepEqual(
    classified.admin.map((g) => g.guildId),
    ['2']
  );
  assert.equal(classified.admin[0]?.roleTag, 'ADMINISTRADOR');
  assert.equal(classified.admin[0]?.canManage, false);

  // Strict Priority 3: Uninstalled servers ordered PROPIETARIO -> ADMINISTRADOR -> MIEMBRO
  assert.deepEqual(
    classified.invite.map((g) => g.guildId),
    ['3', '4']
  );
  assert.equal(classified.invite[0]?.roleTag, 'PROPIETARIO');
  assert.equal(classified.invite[0]?.canInvite, true);
  assert.equal(classified.invite[0]?.canManage, false);
  assert.ok(classified.invite[0]?.inviteUrl.includes('guild_id=3'));

  // Plain member cannot manage OR invite
  assert.equal(classified.invite[1]?.roleTag, 'MIEMBRO');
  assert.equal(classified.invite[1]?.canInvite, false);
  assert.equal(classified.invite[1]?.canManage, false);
  assert.equal(classified.invite[1]?.inviteUrl, '');

  // Connected member-only server exposes zero admin rights
  assert.deepEqual(
    classified.memberConnected.map((g) => g.guildId),
    ['5']
  );
  assert.equal(classified.memberConnected[0]?.canManage, false);
  assert.equal(classified.memberConnected[0]?.roleTag, 'MIEMBRO');

  // Overall ordering matches Priority 1 -> Priority 2 -> Priority 3 -> Member
  assert.deepEqual(
    classified.orderedAll.map((g) => g.guildId),
    ['1', '2', '3', '4', '5']
  );

  const empty = createEmptyState();
  assert.equal(Object.keys(empty.userGuildRoster).length, 0);
});

test('Discord invite URL and hasAdminPermission enforce exact client_id, scopes, permissions, and guild_id', () => {
  assert.equal(hasAdminPermission('8', false), true);
  assert.equal(hasAdminPermission('32', false), false); // MANAGE_GUILD without ADMINISTRATOR
  assert.equal(hasAdminPermission('0', true), true);

  const prevClientId = process.env.DISCORD_CLIENT_ID;
  process.env.DISCORD_CLIENT_ID = '1557508606767927296';
  try {
    const url = buildDiscordBotInviteUrl('987654321098765432');
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://discord.com');
    assert.equal(parsed.pathname, '/oauth2/authorize');
    assert.equal(parsed.searchParams.get('client_id'), '1557508606767927296');
    assert.equal(parsed.searchParams.get('permissions'), '1099780161686');
    assert.equal(parsed.searchParams.get('scope'), 'bot applications.commands');
    assert.equal(parsed.searchParams.get('guild_id'), '987654321098765432');
  } finally {
    if (prevClientId === undefined) delete process.env.DISCORD_CLIENT_ID;
    else process.env.DISCORD_CLIENT_ID = prevClientId;
  }
});

test('RFC-6238 TOTP secrets, Base32 round-trip, HOTP codes, otpauth URIs, and recovery hashes verify accurately', () => {
  const raw = Buffer.from('12345678901234567890');
  const b32 = encodeBase32(raw);
  assert.deepEqual(decodeBase32(b32), raw);

  const secret = generateTotpSecretBase32();
  assert.ok(secret.length >= 32);
  assert.match(secret, /^[A-Z2-7]+$/);

  const nowMs = 1_700_000_000_000;
  const step = Math.floor(nowMs / 1000 / 30);
  const validCode = computeHotpCode(secret, step);
  assert.equal(validCode.length, 6);
  assert.equal(verifyTotpCode(secret, validCode, nowMs, 1), true);
  assert.equal(verifyTotpCode(secret, '000000', nowMs, 0), validCode === '000000');

  const uri = buildTotpOtpAuthUri(secret, 'aegis_owner');
  assert.ok(uri.startsWith('otpauth://totp/'));
  assert.ok(uri.includes(`secret=${secret}`));

  const recovery = generateRecoveryCodes(8);
  assert.equal(recovery.length, 8);
  assert.equal(hashRecoveryCode(recovery[0]), hashRecoveryCode(recovery[0].toLowerCase()));
});

test('Empty persistence store initializes all security suite collections empty and buildPlanQuotas enforces FREE vs DIAMANTE limits', () => {
  const empty = createEmptyState();
  assert.equal(Object.keys(empty.guildPlans).length, 0);
  assert.equal(Object.keys(empty.guildSecuritySuites).length, 0);
  assert.equal(Object.keys(empty.botPermissions).length, 0);
  assert.equal(Object.keys(empty.channelWhitelists).length, 0);
  assert.equal(Object.keys(empty.guildVerifications).length, 0);
  assert.equal(Object.keys(empty.guildLogConfigs).length, 0);
  assert.equal(Object.keys(empty.guildBackups).length, 0);
  assert.equal(Object.keys(empty.guildBackupSettings).length, 0);
  assert.equal(Object.keys(empty.secondaryOwners).length, 0);
  assert.equal(Object.keys(empty.userTwoFactors).length, 0);

  const freeQ = buildPlanQuotas('FREE');
  const diaQ = buildPlanQuotas('DIAMANTE');
  assert.equal(freeQ.maxWhitelistUsers, 10);
  assert.equal(freeQ.maxWhitelistChannels, 3);
  assert.equal(freeQ.maxBotPermUsers, 5);
  assert.equal(freeQ.maxBotPermRoles, 3);
  assert.equal(freeQ.maxBackups, 1);
  assert.equal(diaQ.maxWhitelistUsers, 250);
  assert.equal(diaQ.maxWhitelistChannels, 100);
  assert.equal(diaQ.maxBotPermUsers, 100);
  assert.equal(diaQ.maxBotPermRoles, 50);
  assert.equal(diaQ.maxBackups, 10);
});

test('Secondary Owner RBAC delegation and suite Zod validators enforce authorization and input schemas', () => {
  const state = createEmptyState();
  const guildId = '111222333444555666';
  state.guilds[guildId] = {
    guildId,
    name: 'Test Server',
    iconUrl: null,
    memberCount: 50,
    ownerDiscordId: '100000000000000001',
    userIsOwner: false,
    userHasManageGuild: false,
    botStatus: 'BOT_CONNECTED',
    botPermissionsOk: true,
    protectionEnabled: true,
    lastSyncAt: null,
    linkedAt: null,
  };
  state.secondaryOwners[guildId] = {
    guildId,
    discordId: '200000000000000002',
    username: 'backup_owner',
    note: 'Emergency owner',
    assignedBy: 'primary_owner',
    assignedAt: new Date().toISOString(),
  };

  const backupCtx = {
    session: {
      userId: 'usr_backup',
      discordId: '200000000000000002',
      sessionId: 'ses_1',
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      authMode: 'DISCORD_OAUTH' as const,
    },
    user: {
      id: 'usr_backup',
      discordId: '200000000000000002',
      username: 'backup_owner',
      globalName: 'Backup',
      avatarUrl: null,
      globalRole: 'SERVER_ADMINISTRATOR' as const,
      language: 'es' as const,
      theme: 'dark' as const,
      authMode: 'DISCORD_OAUTH' as const,
      lastLoginAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    },
    state,
  };

  const granted = requireGuildAuthorization(backupCtx, guildId, 'antiraid:write');
  assert.equal(granted.ok, true);
  if (granted.ok) {
    assert.equal(granted.role, 'SERVER_ADMINISTRATOR');
  }

  const intruderCtx = {
    ...backupCtx,
    session: { ...backupCtx.session, userId: 'usr_other', discordId: '300000000000000003' },
    user: { ...backupCtx.user, id: 'usr_other', discordId: '300000000000000003' },
  };
  const denied = requireGuildAuthorization(intruderCtx, guildId, 'antiraid:read');
  assert.equal(denied.ok, false);

  assert.equal(
    securitySuitePatchSchema.safeParse({ antiRaidRules: { channelCreate: { limitPerMinute: 3 } } }).success,
    true
  );
  assert.equal(
    botPermissionCreateSchema.safeParse({
      targetType: 'USER',
      targetId: '123456789012345678',
      targetName: 'mod_user',
      permissions: ['BAN', 'KICK'],
      rateLimitActions: 5,
      rateLimitWindowMinutes: 10,
    }).success,
    true
  );
  assert.equal(
    channelWhitelistCreateSchema.safeParse({
      channelId: '123456789012345678',
      channelName: '#general',
      reason: 'VIP chat',
      excludedRules: ['ANTI_FLOOD', 'ANTI_LINKS'],
    }).success,
    true
  );
  assert.equal(
    twoFactorActionSchema.safeParse({ action: 'CONFIRM_ENABLE', token: '123456' }).success,
    true
  );
});

test('Premium duration parser supports 1y and combined expressions and formats exact days/hours/minutes/seconds', () => {
  const oneYear = parseDurationString('1y');
  assert.equal(oneYear.ok, true);
  if (oneYear.ok) {
    assert.equal(oneYear.durationMs, 365 * 86_400_000);
  }

  const combined = parseDurationString('1y 2d 3h 4m 5s');
  assert.equal(combined.ok, true);
  if (combined.ok) {
    const expectedMs =
      365 * 86_400_000 + 2 * 86_400_000 + 3 * 3_600_000 + 4 * 60_000 + 5_000;
    assert.equal(combined.durationMs, expectedMs);
  }

  const exactMs = 2 * 86_400_000 + 5 * 3_600_000 + 19 * 60_000 + 42_000;
  assert.equal(
    formatDurationPrecise(exactMs, 'es'),
    '2 días, 5 horas, 19 minutos, 42 segundos'
  );
});

test('Exclusive Owner Admin Panel access is locked strictly to Discord ID 1052422681569525792', () => {
  assert.equal(SUPER_OWNER_DISCORD_ID, '1052422681569525792');
  assert.equal(isSuperOwner('1052422681569525792'), true);
  assert.equal(isSuperOwner({ discordId: '1052422681569525792' }), true);
  assert.equal(isSuperOwner('1052422681569525793'), false);
  assert.equal(isSuperOwner(null), false);

  const state = createEmptyState();
  assert.equal(
    resolveAuthoritativeGlobalRole(state, '1052422681569525792', 'VIEWER'),
    'OWNER'
  );
  assert.equal(
    resolveAuthoritativeGlobalRole(state, '999999999999999999', 'OWNER'),
    'SERVER_ADMINISTRATOR'
  );
});

test('Zero-await in-memory hot indexes provide O(1) Globalban and Whitelist lookups', () => {
  const state = createEmptyState();
  state.globalBans.push({
    id: 'GB-FAST01',
    discordId: '111111111111111111',
    username: 'raider',
    reason: 'Raid',
    description: 'Raid',
    category: 'NETWORK_THREAT',
    severity: 'CRITICAL',
    severityLabel: 'Peligro',
    durationKind: 'PERMANENT',
    appealable: false,
    sanctionType: 'PERMANENT',
    evidence: 'Photo evidence',
    evidenceFiles: [],
    moderatorId: SUPER_OWNER_DISCORD_ID,
    moderatorName: 'Owner',
    status: 'ACTIVE',
    createdAt: new Date().toISOString(),
    expiresAt: null,
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
    history: [],
  });
  state.whitelists.push({
    id: 'WL-FAST01',
    guildId: '222222222222222222',
    targetId: '333333333333333333',
    targetName: 'trusted_mod',
    targetType: 'USER',
    reason: 'Trusted',
    excludedRules: ['JOIN_BURST', 'ANTI_NUKE'],
    authorId: SUPER_OWNER_DISCORD_ID,
    authorName: 'Owner',
    createdAt: new Date().toISOString(),
    expiresAt: null,
    status: 'ACTIVE',
  });
  state.channelWhitelists['222222222222222222'] = [
    {
      id: 'CWL-1',
      guildId: '222222222222222222',
      channelId: '444444444444444444',
      channelName: 'spam',
      reason: 'Bot spam',
      addedBy: 'owner',
      createdAt: new Date().toISOString(),
    },
  ];

  aegisStore.rebuildHotIndexes(state);
  const ban = aegisStore.getHotGlobalBan('111111111111111111');
  assert.equal(ban?.id, 'GB-FAST01');
  assert.equal(ban?.severityLabel, 'Peligro');

  assert.equal(
    aegisStore.isUserWhitelistedFast('222222222222222222', '333333333333333333', 'JOIN_BURST'),
    true
  );
  assert.equal(
    aegisStore.isUserWhitelistedFast('222222222222222222', '333333333333333333', 'LOCKDOWN_BYPASS'),
    false
  );
  assert.equal(
    aegisStore.isChannelWhitelistedFast('222222222222222222', '444444444444444444'),
    true
  );
  assert.equal(
    aegisStore.isChannelWhitelistedFast('222222222222222222', '555555555555555555'),
    false
  );
});







