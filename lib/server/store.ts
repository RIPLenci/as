import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import type {
  AuditLogRecord,
  BotClusterTelemetry,
  BotShardTelemetry,
  GlobalBanAnalyticsResponse,
  GlobalBanRecord,
  GuildBackupRecord,
  GuildPlanRecord,
  GuildRecord,
  NotificationRecord,
  OverviewAnalyticsResponse,
  OverviewPeriod,
  PlanTier,
  PremiumCodeRecord,
  QuarantineEntryRecord,
  SanctionActionRecord,
  SecurityEventRecord,
  SecurityIncidentRecord,
  SystemHealthSnapshot,
  UserPremiumSubscription,
  WhitelistEntryRecord,
} from '../aegis/types';
import { normalizeHonestBotState } from '../aegis/bot-slash-plan';
import {
  applyAccumulatedPremium,
  buildFreeGuildPlan,
  buildPlanQuotas,
  evaluateAutoBackupSchedule,
  formatDurationHuman,
  isPaidTier,
  isSubscriptionActive,
  normalizePlanTier,
} from '../aegis/premium';
import {
  dedupePreserveOrder,
  mergeWhitelistExcludedRules,
} from '../aegis/security-helpers';
import { RaidBurstShield } from '../aegis/fast-antiraid';
import {
  AlertBatchDeduplicator,
  BoundedMemoryCache,
  SlidingWindowTracker,
} from '../aegis/sliding-window';
import { aegisTelemetry } from '../aegis/telemetry';
import { getLiveBotRunnerSnapshot } from './bot-runner';
import { getServerEnv } from './env';
import { verifyBotTelemetryLive } from './discord-api';
import { aegisLogger } from './logger';
import {
  AegisSnapshotModel,
  ensureMongoConnected,
  getMongoStatus,
  SyncOutboxModel,
} from './mongodb';
import { redisCoordinator } from './redis';
import {
  computeGlobalBanAnalytics,
  computeOverviewAnalytics,
} from './store-analytics';
import {
  AEGIS_SLASH_COMMANDS_METADATA,
  createEmptyState,
  DATA_DIR,
  DATA_FILE,
  EVIDENCE_DIR,
  initializeGuildDefaults,
  normalizeLoadedState,
  type PersistedDatabaseState,
} from './store-defaults';
import {
  flushPendingSyncOutbox,
  type GuildConfigDocumentShape,
  persistGuildConfigVersioned,
  pullGuildConfigsFromMongo,
} from './sync-coordinator';

export {
  AEGIS_SLASH_COMMANDS_METADATA,
  buildFreeGuildPlan,
  buildPlanQuotas,
  createEmptyState,
  EVIDENCE_DIR,
  type PersistedDatabaseState,
};

class AegisStore extends EventEmitter {
  private state: PersistedDatabaseState | null = null;
  public readonly instanceId = crypto.randomBytes(6).toString('hex');
  public readonly l1Cache = new BoundedMemoryCache<unknown>(2000, 30_000);
  public readonly joinWindow = new SlidingWindowTracker();
  public readonly alertDedup = new AlertBatchDeduplicator();
  public readonly raidShield = new RaidBurstShield();
  private lastSyncAt = new Date().toISOString();
  private lastHousekeepingAt = 0;
  private lastDiskMtimeMs = 0;
  private lastHotDiskCheckAt = 0;
  private hotCommitTimer: NodeJS.Timeout | null = null;
  private diskWriteInFlight: Promise<void> = Promise.resolve();
  private mongoHydrationPromise: Promise<void> | null = null;
  private mongoHydrated = false;
  private hotGlobalBanMap = new Map<string, GlobalBanRecord>();
  private hotWhitelistMap = new Map<string, Set<string>>();
  private hotChannelWhitelistMap = new Map<string, Set<string>>();
  private knownInitializedGuilds = new Set<string>();
  private reconnectHookAttached = false;
  private pendingGuildSyncIds = new Set<string>();
  private botLiveCache: {
    checkedAt: number;
    online: boolean;
    id: string | null;
    tag: string | null;
    avatarUrl: string | null;
    pingMs: number | null;
    guildCount: number | null;
    userCount: number | null;
  } = {
    checkedAt: 0,
    online: false,
    id: null,
    tag: null,
    avatarUrl: null,
    pingMs: null,
    guildCount: null,
    userCount: null,
  };

  constructor() {
    super();
    this.setMaxListeners(100);
    this.attachRedisReconnectHook();
  }

  private attachRedisReconnectHook(): void {
    if (this.reconnectHookAttached) return;
    this.reconnectHookAttached = true;
    redisCoordinator.onReconnect(() => {
      void this.handleRedisReconnected();
    });
  }

  private async handleRedisReconnected(): Promise<void> {
    try {
      const flushed = await flushPendingSyncOutbox(this.instanceId);
      const pulled = await this.reconcileGuildConfigsFromMongo();
      if (flushed > 0 || pulled > 0) {
        aegisLogger.info('SYNC', 'Redis reconnect reconciliation finished', {
          meta: { flushedOutbox: flushed, pulledGuildConfigs: pulled },
        });
      }
    } catch (err) {
      aegisLogger.warn('SYNC', 'Redis reconnect reconciliation warning', {
        meta: { err },
      });
    }
  }

  public rebuildHotIndexes(stateArg?: PersistedDatabaseState | null): void {
    const st = stateArg ?? this.state;
    if (!st) return;

    const banMap = new Map<string, GlobalBanRecord>();
    for (const ban of st.globalBans) {
      if (ban.status === 'ACTIVE') {
        banMap.set(ban.discordId, ban);
      }
    }
    this.hotGlobalBanMap = banMap;

    const wlMap = new Map<string, Set<string>>();
    for (const w of st.whitelists) {
      if (w.status !== 'ACTIVE') continue;
      if (w.expiresAt && new Date(w.expiresAt).getTime() <= Date.now()) continue;
      const key = `${w.guildId}:${w.targetId}`;
      let scopes = wlMap.get(key);
      if (!scopes) {
        scopes = new Set<string>();
        wlMap.set(key, scopes);
      }
      for (const sc of w.excludedRules) {
        scopes.add(sc);
      }
    }
    this.hotWhitelistMap = wlMap;

    const chMap = new Map<string, Set<string>>();
    for (const [gid, entries] of Object.entries(st.channelWhitelists ?? {})) {
      const set = new Set<string>();
      for (const item of entries ?? []) {
        set.add(item.channelId);
      }
      chMap.set(gid, set);
    }
    this.hotChannelWhitelistMap = chMap;
  }

  public getHotGlobalBan(discordId: string): GlobalBanRecord | undefined {
    const entry = this.hotGlobalBanMap.get(discordId);
    if (!entry) return undefined;
    if (entry.status !== 'ACTIVE') {
      this.hotGlobalBanMap.delete(discordId);
      return undefined;
    }
    if (
      entry.sanctionType === 'TEMPORARY' &&
      entry.expiresAt &&
      new Date(entry.expiresAt).getTime() <= Date.now()
    ) {
      this.hotGlobalBanMap.delete(discordId);
      return undefined;
    }
    return entry;
  }

  public isUserWhitelistedFast(guildId: string, targetId: string, ruleScope?: string): boolean {
    const scopes = this.hotWhitelistMap.get(`${guildId}:${targetId}`);
    if (!scopes || scopes.size === 0) return false;
    if (!ruleScope) return true;
    return scopes.has(ruleScope);
  }

  public isChannelWhitelistedFast(guildId: string, channelId: string): boolean {
    return this.hotChannelWhitelistMap.get(guildId)?.has(channelId) ?? false;
  }

  /**
   * Reloads local disk fallback ONLY when MongoDB is unconfigured (single-host / test mode).
   * In multi-container deployments with MONGODB_URI, MongoDB + Redis Pub/Sub is authoritative.
   */
  public reloadFromDiskIfNewer(): boolean {
    if (getServerEnv().mongodbConfigured && getMongoStatus() === 'CONNECTED') {
      return false;
    }
    if (!fs.existsSync(DATA_FILE)) return false;
    try {
      const stat = fs.statSync(DATA_FILE);
      this.lastHotDiskCheckAt = Date.now();
      if (stat.mtimeMs <= this.lastDiskMtimeMs && this.state) {
        return false;
      }
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedDatabaseState>;
      this.state = normalizeLoadedState({
        ...createEmptyState(),
        ...parsed,
      });
      this.lastDiskMtimeMs = stat.mtimeMs;
      this.knownInitializedGuilds.clear();
      this.rebuildHotIndexes(this.state);
      return true;
    } catch (err) {
      aegisLogger.warn('SYSTEM', 'Failed reloading local store fallback file', { meta: { err } });
      return false;
    }
  }

  public getHotStateSync(): PersistedDatabaseState {
    if (this.state) {
      const now = Date.now();
      if (
        (!getServerEnv().mongodbConfigured || getMongoStatus() !== 'CONNECTED') &&
        now - this.lastHotDiskCheckAt >= 1500
      ) {
        this.reloadFromDiskIfNewer();
      }
      return this.state;
    }
    const loaded = this.loadFromDisk();
    this.rebuildHotIndexes(loaded);
    return loaded;
  }

  private loadFromDisk(): PersistedDatabaseState {
    if (this.state) return this.state;

    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    }

    if (fs.existsSync(DATA_FILE)) {
      try {
        const stat = fs.statSync(DATA_FILE);
        const raw = fs.readFileSync(DATA_FILE, 'utf8');
        const parsed = JSON.parse(raw) as Partial<PersistedDatabaseState>;
        this.state = normalizeLoadedState({
          ...createEmptyState(),
          ...parsed,
        });
        this.lastDiskMtimeMs = stat.mtimeMs;
        this.rebuildHotIndexes(this.state);
        return this.state;
      } catch (err) {
        aegisLogger.warn('SYSTEM', 'Corrupted store.json encountered; initializing clean state', {
          meta: { err },
        });
      }
    }

    this.state = createEmptyState();
    this.rebuildHotIndexes(this.state);
    this.persistToDisk();
    return this.state;
  }

  /**
   * Applies an authoritative versioned guild configuration from MongoDB while rejecting
   * out-of-order stale versions (`doc.syncVersion < local.syncVersion`).
   */
  public applyVersionedGuildConfig(doc: GuildConfigDocumentShape): boolean {
    const state = this.state ?? this.loadFromDisk();
    const guildName = state.guilds[doc.guildId]?.name ?? `Servidor ${doc.guildId}`;
    this.ensureGuildStructures(state, doc.guildId, guildName);

    const localAntiRaid = state.antiRaidConfigs[doc.guildId];
    if (localAntiRaid && doc.syncVersion < localAntiRaid.syncVersion) {
      aegisLogger.debug('SYNC', 'Ignoring stale GuildConfig version from remote pull', {
        guildId: doc.guildId,
        syncVersion: doc.syncVersion,
        meta: { localSyncVersion: localAntiRaid.syncVersion },
      });
      return false;
    }

    state.antiRaidConfigs[doc.guildId] = {
      ...localAntiRaid,
      ...doc.antiRaidConfig,
      syncVersion: doc.syncVersion,
      configHash: doc.configHash,
      syncStatus: 'SYNCHRONIZED',
      lastSyncedAt: doc.updatedAt || new Date().toISOString(),
    };
    if (doc.guildSettings) {
      state.guildSettings[doc.guildId] = { ...doc.guildSettings };
    }
    if (doc.antiNukeConfig) {
      state.antiNukeConfigs[doc.guildId] = { ...doc.antiNukeConfig };
    }
    if (doc.securitySuite) {
      state.guildSecuritySuites[doc.guildId] = { ...doc.securitySuite };
    }
    this.syncGuildRecord(state, doc.guildId, {
      protectionEnabled: doc.antiRaidConfig.enabled,
      lastSyncAt: doc.updatedAt || new Date().toISOString(),
    });
    this.l1Cache.invalidateByPrefix(`guild:${doc.guildId}:`);
    this.lastSyncAt = new Date().toISOString();
    return true;
  }

  public async reconcileGuildConfigsFromMongo(targetGuildId?: string): Promise<number> {
    if (!getServerEnv().mongodbConfigured) return 0;
    const status = await ensureMongoConnected();
    if (status !== 'CONNECTED') return 0;

    const docs = await pullGuildConfigsFromMongo(targetGuildId);
    let applied = 0;
    for (const doc of docs) {
      if (this.applyVersionedGuildConfig(doc)) {
        applied += 1;
      }
    }
    if (applied > 0) {
      this.rebuildHotIndexes(this.state);
      this.emit('aegis:update', {
        event: targetGuildId ? 'guild_config:reconciled' : 'guild_configs:reconciled',
        guildId: targetGuildId ?? null,
        payload: { applied },
        timestamp: new Date().toISOString(),
      });
    }
    return applied;
  }

  private async tryHydrateFromMongoIfEmpty(loaded: PersistedDatabaseState): Promise<void> {
    if (this.mongoHydrated) return;
    if (this.mongoHydrationPromise) {
      await this.mongoHydrationPromise;
      return;
    }

    const env = getServerEnv();
    if (!env.mongodbConfigured) {
      this.mongoHydrated = true;
      return;
    }

    const isBlank =
      Object.keys(loaded.users).length === 0 &&
      Object.keys(loaded.guilds).length === 0 &&
      Object.keys(loaded.userSubscriptions).length === 0 &&
      loaded.incidents.length === 0;

    this.mongoHydrationPromise = (async () => {
      try {
        const status = await ensureMongoConnected();
        if (status !== 'CONNECTED') return;

        if (isBlank) {
          const doc = (await AegisSnapshotModel.findOne({ key: 'aegis_primary_state' }).lean()) as {
            payload?: PersistedDatabaseState;
          } | null;
          if (doc?.payload && typeof doc.payload === 'object') {
            this.state = normalizeLoadedState({
              ...createEmptyState(),
              ...doc.payload,
            });
            this.rebuildHotIndexes(this.state);
            this.persistToDisk();
          }
        }

        // Always overlay authoritative per-guild versioned configs from MongoDB
        await this.reconcileGuildConfigsFromMongo();
      } catch (err) {
        aegisLogger.error('MONGODB', 'Initial MongoDB hydration failed', { meta: { err } });
      } finally {
        this.mongoHydrated = true;
        this.mongoHydrationPromise = null;
      }
    })();

    await this.mongoHydrationPromise;
  }

  ensureGuildStructures(
    state: PersistedDatabaseState,
    guildId: string,
    guildName: string
  ): void {
    if (
      this.knownInitializedGuilds.has(guildId) &&
      Object.hasOwn(state.antiRaidConfigs, guildId) &&
      Object.hasOwn(state.guildSecuritySuites, guildId) &&
      Object.hasOwn(state.guildSettings, guildId)
    ) {
      return;
    }
    initializeGuildDefaults(state, guildId, guildName);
    this.knownInitializedGuilds.add(guildId);
  }

  private persistToDisk(): void {
    if (!this.state) return;
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
      }
      const tmp = `${DATA_FILE}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tmp, DATA_FILE);
      try {
        this.lastDiskMtimeMs = fs.statSync(DATA_FILE).mtimeMs;
      } catch {
        // ignore stat race
      }
      this.lastSyncAt = new Date().toISOString();
    } catch (err) {
      aegisLogger.error('SYSTEM', 'Synchronous store persistence failed', { meta: { err } });
    }
  }

  private async persistToDiskAsync(): Promise<void> {
    if (!this.state) return;
    const payload = JSON.stringify(this.state, null, 2);
    this.diskWriteInFlight = this.diskWriteInFlight
      .then(async () => {
        await fs.promises.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
        const tmp = `${DATA_FILE}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
        await fs.promises.writeFile(tmp, payload, { encoding: 'utf8', mode: 0o600 });
        await fs.promises.rename(tmp, DATA_FILE);
        try {
          this.lastDiskMtimeMs = (await fs.promises.stat(DATA_FILE)).mtimeMs;
        } catch {
          // ignore stat race
        }
        this.lastSyncAt = new Date().toISOString();
      })
      .catch((err) => {
        aegisLogger.error('SYSTEM', 'Asynchronous store flush failed', { meta: { err } });
      });
    return this.diskWriteInFlight;
  }

  scheduleHotCommit(
    eventName: string,
    guildId?: string,
    payload?: unknown,
    options?: { reindexSecurityLists?: boolean }
  ): void {
    if (
      options?.reindexSecurityLists ||
      eventName.startsWith('globalban:') ||
      eventName.startsWith('whitelist:')
    ) {
      this.rebuildHotIndexes(this.state);
    }
    if (guildId) {
      this.pendingGuildSyncIds.add(guildId);
      this.l1Cache.invalidateByPrefix(`guild:${guildId}:`);
    } else {
      this.l1Cache.invalidateByPrefix('global:');
    }

    this.emit('aegis:update', {
      event: eventName,
      guildId: guildId ?? null,
      payload: payload ?? null,
      timestamp: new Date().toISOString(),
    });

    // Non-starving 120ms coalescing timer so heavy raid waves never defer persistence indefinitely
    if (!this.hotCommitTimer) {
      this.hotCommitTimer = setTimeout(() => {
        this.hotCommitTimer = null;
        void this.persistToDiskAsync();
        const guildIdsToFlush = Array.from(this.pendingGuildSyncIds);
        this.pendingGuildSyncIds.clear();

        if (getMongoStatus() === 'CONNECTED' && this.state) {
          AegisSnapshotModel.findOneAndUpdate(
            { key: 'aegis_primary_state' },
            { key: 'aegis_primary_state', payload: this.state, updatedAt: new Date() },
            { upsert: true }
          ).catch((err) => {
            aegisLogger.error('MONGODB', 'Hot snapshot upsert failed', { meta: { err } });
          });

          for (const gid of guildIdsToFlush) {
            const cfg = this.state.antiRaidConfigs[gid];
            if (cfg) {
              void persistGuildConfigVersioned({
                guildId: gid,
                eventName,
                correlationId: aegisLogger.createCorrelationId('hot'),
                originProcessId: this.instanceId,
                antiRaidConfig: cfg,
                guildSettings: this.state.guildSettings[gid] ?? null,
                antiNukeConfig: this.state.antiNukeConfigs[gid] ?? null,
                securitySuite: this.state.guildSecuritySuites[gid] ?? null,
              });
            }
          }
        }

        if (guildIdsToFlush.length === 0 || getMongoStatus() !== 'CONNECTED') {
          void redisCoordinator
            .publish('aegis:sync', eventName, payload ?? {}, guildId, this.instanceId)
            .catch((err) => {
              aegisLogger.warn('REDIS', 'Hot commit Redis publish failed', {
                guildId,
                meta: { eventName, err },
              });
            });
        }
      }, 120);
    }
  }

  async getState(): Promise<PersistedDatabaseState> {
    this.reloadFromDiskIfNewer();
    let loaded = this.loadFromDisk();
    await this.tryHydrateFromMongoIfEmpty(loaded);
    loaded = this.state ?? loaded;
    const now = Date.now();
    if (now - this.lastHousekeepingAt >= 15_000) {
      this.lastHousekeepingAt = now;
      const expiredBans = this.expireDueGlobalBans(loaded);
      const expiredQuarantines = this.expireDueQuarantines(loaded);
      const expiredPremium = this.expireDuePremiumSubscriptions(loaded);
      const autoBackedUp = this.runDueAutoBackups(loaded);
      if (expiredBans > 0 || expiredQuarantines > 0 || expiredPremium > 0 || autoBackedUp > 0) {
        this.rebuildHotIndexes(loaded);
        this.persistToDisk();
      }
    }
    return loaded;
  }

  async commitMutation(
    eventName: string,
    guildId?: string,
    payload?: unknown,
    options?: { correlationId?: string; skipVersionBump?: boolean }
  ): Promise<{ syncVersion?: number; mongoPersisted: boolean; redisPublished: boolean }> {
    if (this.hotCommitTimer) {
      clearTimeout(this.hotCommitTimer);
      this.hotCommitTimer = null;
      this.pendingGuildSyncIds.clear();
    }
    this.rebuildHotIndexes(this.state);
    this.persistToDisk();
    if (guildId) {
      this.l1Cache.invalidateByPrefix(`guild:${guildId}:`);
    } else {
      this.l1Cache.invalidateByPrefix('global:');
    }

    const correlationId = options?.correlationId ?? aegisLogger.createCorrelationId('mut');
    let mongoPersisted = false;
    let redisPublished = false;
    let syncVersion: number | undefined;

    if (getMongoStatus() === 'CONNECTED' && this.state) {
      try {
        await AegisSnapshotModel.findOneAndUpdate(
          { key: 'aegis_primary_state' },
          { key: 'aegis_primary_state', payload: this.state, updatedAt: new Date() },
          { upsert: true }
        );
        mongoPersisted = true;
      } catch (err) {
        aegisLogger.error('MONGODB', 'commitMutation snapshot write failed', {
          guildId,
          correlationId,
          meta: { eventName, err },
        });
      }

      if (guildId && this.state.antiRaidConfigs[guildId]) {
        const res = await persistGuildConfigVersioned({
          guildId,
          eventName,
          correlationId,
          originProcessId: this.instanceId,
          antiRaidConfig: this.state.antiRaidConfigs[guildId],
          guildSettings: this.state.guildSettings[guildId] ?? null,
          antiNukeConfig: this.state.antiNukeConfigs[guildId] ?? null,
          securitySuite: this.state.guildSecuritySuites[guildId] ?? null,
        });
        syncVersion = res.syncVersion;
        mongoPersisted = mongoPersisted || res.mongoPersisted;
        redisPublished = res.redisPublished;
      }
    }

    if (!guildId || !redisPublished) {
      redisPublished = await redisCoordinator.publish(
        'aegis:sync',
        eventName,
        payload ?? {},
        guildId,
        this.instanceId,
        { syncVersion, correlationId }
      );
    }

    this.lastSyncAt = new Date().toISOString();
    this.emit('aegis:update', {
      event: eventName,
      guildId: guildId ?? null,
      payload: payload ?? null,
      timestamp: this.lastSyncAt,
    });

    return { syncVersion, mongoPersisted, redisPublished };
  }

  /**
   * Records exact sanction attempt outcome on guild counters without inflating mitigated metrics
   * when Discord API rejected or bot lacked required permissions.
   */
  recordSanctionOutcome(
    state: PersistedDatabaseState,
    guildId: string,
    record: SanctionActionRecord,
    timestamps?: { eventAt?: string; detectorRunAt?: string }
  ): void {
    const cfg = state.antiRaidConfigs[guildId];
    if (!cfg) return;

    cfg.lastEventAt = timestamps?.eventAt ?? record.createdAt;
    cfg.lastDetectorRunAt = timestamps?.detectorRunAt ?? record.createdAt;
    cfg.actionsAttempted = (cfg.actionsAttempted ?? 0) + 1;

    if (record.status === 'SUCCESS') {
      cfg.attacksPrevented += 1;
      cfg.actionsSucceeded = (cfg.actionsSucceeded ?? 0) + 1;
      cfg.lastSuccessfulActionAt = record.completedAt ?? new Date().toISOString();
    } else if (record.status === 'CANCELLED') {
      cfg.actionsCancelled = (cfg.actionsCancelled ?? 0) + 1;
      cfg.lastErrorAt = record.completedAt ?? new Date().toISOString();
      cfg.lastErrorMessage =
        record.errorMessage ||
        (record.missingPermissions?.length
          ? `Permisos faltantes: ${record.missingPermissions.join(', ')}`
          : 'Acción cancelada por precondiciones');
      if (record.missingPermissions?.length) {
        cfg.botPermissionsMissing = [...record.missingPermissions];
      }
    } else if (record.status === 'FAILED') {
      cfg.actionsFailed = (cfg.actionsFailed ?? 0) + 1;
      cfg.lastErrorAt = record.completedAt ?? new Date().toISOString();
      cfg.lastErrorMessage = record.errorMessage || 'Fallo al ejecutar sanción en Discord API';
    }
  }

  syncGuildRecord(
    state: PersistedDatabaseState,
    guildId: string,
    patch: Partial<GuildRecord>
  ): GuildRecord | null {
    const existingShared = Object.hasOwn(state.guilds, guildId) ? state.guilds[guildId] : undefined;
    let updatedShared: GuildRecord | null = existingShared ?? null;

    if (existingShared) {
      Object.assign(existingShared, patch);
      updatedShared = existingShared;
    }

    for (const roster of Object.values(state.userGuildRoster)) {
      for (const item of roster) {
        if (item.guildId === guildId) {
          Object.assign(item, patch);
          if (!updatedShared) {
            updatedShared = { ...item };
          }
        }
      }
    }

    if (!existingShared && updatedShared) {
      state.guilds[guildId] = { ...updatedShared };
    }

    return updatedShared;
  }

  pushIncident(state: PersistedDatabaseState, incident: SecurityIncidentRecord): void {
    state.incidents.unshift(incident);
    if (state.incidents.length > 500) {
      state.incidents = state.incidents.slice(0, 500);
    }
  }

  pushEvent(state: PersistedDatabaseState, event: SecurityEventRecord): void {
    state.events.unshift(event);
    if (state.events.length > 500) {
      state.events = state.events.slice(0, 500);
    }
  }

  upsertQuarantineEntry(
    state: PersistedDatabaseState,
    entry: QuarantineEntryRecord
  ): { entry: QuarantineEntryRecord; updatedExisting: boolean } {
    const existing = state.quarantines.find(
      (q) => q.guildId === entry.guildId && q.discordId === entry.discordId && q.status === 'ACTIVE'
    );
    if (existing) {
      existing.username = entry.username;
      existing.reason = entry.reason;
      existing.riskScore = Math.max(existing.riskScore, entry.riskScore);
      existing.riskLevel = entry.riskLevel;
      existing.responsibleActor = entry.responsibleActor;
      existing.expiresAt = entry.expiresAt;
      return { entry: existing, updatedExisting: true };
    }
    state.quarantines.unshift(entry);
    if (state.quarantines.length > 1000) {
      state.quarantines = state.quarantines.slice(0, 1000);
    }
    return { entry, updatedExisting: false };
  }

  upsertWhitelistEntry(
    state: PersistedDatabaseState,
    entry: WhitelistEntryRecord
  ): { entry: WhitelistEntryRecord; updatedExisting: boolean } {
    const existing = state.whitelists.find(
      (w) => w.guildId === entry.guildId && w.targetId === entry.targetId && w.status === 'ACTIVE'
    );
    if (existing) {
      existing.targetName = entry.targetName;
      existing.targetType = entry.targetType;
      existing.reason = entry.reason;
      existing.excludedRules = mergeWhitelistExcludedRules(
        existing.excludedRules,
        entry.excludedRules
      );
      existing.authorId = entry.authorId;
      existing.authorName = entry.authorName;
      existing.expiresAt = entry.expiresAt;
      return { entry: existing, updatedExisting: true };
    }
    state.whitelists.unshift(entry);
    if (state.whitelists.length > 1000) {
      state.whitelists = state.whitelists.slice(0, 1000);
    }
    return { entry, updatedExisting: false };
  }

  appendAuditLog(
    state: PersistedDatabaseState,
    entry: Omit<AuditLogRecord, 'id' | 'createdAt'>
  ): AuditLogRecord {
    const record: AuditLogRecord = {
      ...entry,
      id: `AUD-${Date.now().toString(36).toUpperCase()}-${crypto
        .randomBytes(3)
        .toString('hex')
        .toUpperCase()}`,
      createdAt: new Date().toISOString(),
    };
    state.auditLogs.unshift(record);
    if (state.auditLogs.length > 1000) {
      state.auditLogs = state.auditLogs.slice(0, 1000);
    }
    return record;
  }

  pushNotification(
    state: PersistedDatabaseState,
    notification: Omit<NotificationRecord, 'id' | 'createdAt' | 'read'>
  ): NotificationRecord {
    const record: NotificationRecord = {
      ...notification,
      id: `NTF-${Date.now().toString(36).toUpperCase()}-${crypto
        .randomBytes(2)
        .toString('hex')
        .toUpperCase()}`,
      read: false,
      createdAt: new Date().toISOString(),
    };
    state.notifications.unshift(record);
    if (state.notifications.length > 200) {
      state.notifications = state.notifications.slice(0, 200);
    }
    return record;
  }

  private expireDueGlobalBans(state: PersistedDatabaseState): number {
    const now = Date.now();
    let expiredCount = 0;
    for (const ban of state.globalBans) {
      if (
        (ban.status === 'ACTIVE' || ban.status === 'PENDING_APPEAL') &&
        ban.sanctionType === 'TEMPORARY' &&
        ban.expiresAt &&
        new Date(ban.expiresAt).getTime() <= now
      ) {
        ban.status = 'EXPIRED';
        ban.history.push({
          id: `GBH-${Date.now()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
          action: 'EXPIRED',
          actorId: 'SYSTEM_WORKER',
          actorName: 'AEGIS Expiration Worker',
          note: 'Temporary sanction expired automatically; caches invalidated and participating guilds synchronized.',
          timestamp: new Date().toISOString(),
        });
        this.pushNotification(state, {
          guildId: null,
          type: 'GLOBAL_BAN_EXPIRED',
          severity: 'LOW',
          title: `Global Ban Expired — ${ban.username}`,
          message: `Sanction ${ban.id} (${ban.discordId}) expired and was synced across participating guilds.`,
          groupedCount: 1,
        });
        expiredCount += 1;
      }
    }
    return expiredCount;
  }

  private expireDueQuarantines(state: PersistedDatabaseState): number {
    const now = Date.now();
    let expiredCount = 0;
    for (const q of state.quarantines) {
      if (q.status === 'ACTIVE' && q.expiresAt && new Date(q.expiresAt).getTime() <= now) {
        q.status = 'EXPIRED';
        q.releasedAt = new Date().toISOString();
        q.releasedBy = 'AEGIS Expiration Worker';
        expiredCount += 1;
      }
    }
    return expiredCount;
  }

  isGuildOwnerOrSecondaryOwner(
    state: PersistedDatabaseState,
    guildId: string,
    discordId: string
  ): boolean {
    const guild = Object.hasOwn(state.guilds, guildId) ? state.guilds[guildId] : undefined;
    if (guild?.ownerDiscordId === discordId) return true;
    const sec = Object.hasOwn(state.secondaryOwners, guildId)
      ? state.secondaryOwners[guildId]
      : undefined;
    if (sec?.discordId === discordId) return true;
    for (const roster of Object.values(state.userGuildRoster)) {
      const match = roster.find((g) => g.guildId === guildId && g.userIsOwner);
      if (match && match.ownerDiscordId === discordId) return true;
    }
    return false;
  }

  disableGuildPremiumFeatures(state: PersistedDatabaseState, guildId: string): void {
    const nowIso = new Date().toISOString();
    const suite = Object.hasOwn(state.guildSecuritySuites, guildId)
      ? state.guildSecuritySuites[guildId]
      : undefined;
    if (suite) {
      for (const mod of Object.values(suite.antiRaidModules)) {
        if (mod.premiumOnly) {
          mod.enabled = false;
        }
      }
      suite.additionalSecurity.antiMassMute.enabled = false;
      suite.additionalSecurity.antiFlood.maxMessages = 6;
      suite.additionalSecurity.antiFlood.windowSeconds = 5;
      suite.additionalSecurity.antiFlood.muteMinutes = 10;
      suite.additionalSecurity.antiScam.muteMinutes = 30;
      suite.additionalSecurity.antiLinks.allowedDomains = [];
      suite.updatedAt = nowIso;
    }

    const verif = Object.hasOwn(state.guildVerifications, guildId)
      ? state.guildVerifications[guildId]
      : undefined;
    if (verif) {
      if (verif.mode === 'STRICT_2FA') {
        verif.mode = 'BUTTON';
      }
      verif.kickUnverifiedAfterMinutes = null;
      verif.updatedAt = nowIso;
    }
  }

  expireDuePremiumSubscriptions(state: PersistedDatabaseState): number {
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    let changedCount = 0;

    for (const [discordId, sub] of Object.entries(state.userSubscriptions)) {
      if (!isPaidTier(normalizePlanTier(sub.tier))) continue;
      if (isSubscriptionActive(sub, nowMs)) continue;

      const guildIds = [...(sub.activatedGuildIds ?? [])];
      for (const gid of guildIds) {
        state.guildPlans[gid] = buildFreeGuildPlan(gid);
        this.disableGuildPremiumFeatures(state, gid);
        this.appendAuditLog(state, {
          guildId: gid,
          actorId: 'SYSTEM_WORKER',
          actorName: 'AEGIS Expiration Worker',
          action: 'GUILD_PREMIUM_EXPIRED_DISABLED',
          entityType: 'GuildPlan',
          entityId: gid,
          result: 'SUCCESS',
          metadata: { ownerDiscordId: discordId },
        });
      }

      sub.tier = 'FREE';
      sub.expiresAt = null;
      sub.activatedGuildIds = [];
      sub.source = 'EXPIRED';
      sub.updatedBy = 'AEGIS Expiration Worker';
      sub.updatedAt = nowIso;
      changedCount += 1;
    }

    for (const [gid, plan] of Object.entries(state.guildPlans)) {
      if (
        isPaidTier(normalizePlanTier(plan.tier)) &&
        plan.expiresAt &&
        new Date(plan.expiresAt).getTime() <= nowMs
      ) {
        state.guildPlans[gid] = buildFreeGuildPlan(gid);
        this.disableGuildPremiumFeatures(state, gid);
        changedCount += 1;
      }
    }

    return changedCount;
  }

  grantUserPremium(
    state: PersistedDatabaseState,
    params: {
      discordId: string;
      username: string;
      tier: 'ORO' | 'DIAMANTE';
      durationMs: number;
      reason?: string;
      source: UserPremiumSubscription['source'];
      updatedBy: string;
    }
  ): UserPremiumSubscription {
    const existing = Object.hasOwn(state.userSubscriptions, params.discordId)
      ? state.userSubscriptions[params.discordId]
      : undefined;
    const nextSub = applyAccumulatedPremium(existing, params);
    state.userSubscriptions[params.discordId] = nextSub;

    for (const gid of nextSub.activatedGuildIds) {
      if (Object.hasOwn(state.guildPlans, gid)) {
        state.guildPlans[gid] = {
          guildId: gid,
          tier: nextSub.tier,
          ownerUserId: params.discordId,
          activatedAt: nextSub.grantedAt,
          expiresAt: nextSub.expiresAt,
          activatedBy: params.updatedBy,
          activationSource:
            params.source === 'DISCORD_SLASH'
              ? 'DISCORD_SLASH'
              : params.source === 'STAFF_PANEL'
              ? 'STAFF_PANEL'
              : 'CODE_REDEEM',
          quotas: buildPlanQuotas(nextSub.tier),
        };
      }
    }
    return nextSub;
  }

  revokeUserPremium(
    state: PersistedDatabaseState,
    params: { discordId: string; revokedBy: string }
  ): UserPremiumSubscription | null {
    const existing = Object.hasOwn(state.userSubscriptions, params.discordId)
      ? state.userSubscriptions[params.discordId]
      : undefined;
    if (!existing) return null;

    for (const gid of existing.activatedGuildIds) {
      state.guildPlans[gid] = buildFreeGuildPlan(gid);
      this.disableGuildPremiumFeatures(state, gid);
    }

    const updated: UserPremiumSubscription = {
      ...existing,
      tier: 'FREE',
      expiresAt: null,
      activatedGuildIds: [],
      source: 'EXPIRED',
      updatedBy: params.revokedBy,
      updatedAt: new Date().toISOString(),
    };
    state.userSubscriptions[params.discordId] = updated;
    return updated;
  }

  createPremiumCode(
    state: PersistedDatabaseState,
    params: {
      tier: 'ORO' | 'DIAMANTE';
      durationMs: number;
      durationLabel: string;
      maxUses: number;
      createdBy: string;
      customCode?: string;
    }
  ): { ok: true; record: PremiumCodeRecord } | { ok: false; message: string } {
    const cleanCode = params.customCode
      ? params.customCode.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '')
      : `AEGIS-${params.tier === 'DIAMANTE' ? 'DIA' : 'ORO'}-${crypto
          .randomBytes(4)
          .toString('hex')
          .toUpperCase()}`;

    if (cleanCode.length < 4) {
      return { ok: false, message: 'El código debe tener al menos 4 caracteres válidos.' };
    }
    if (Object.hasOwn(state.premiumCodes, cleanCode)) {
      return { ok: false, message: `El código ${cleanCode} ya existe.` };
    }

    const record: PremiumCodeRecord = {
      code: cleanCode,
      tier: params.tier,
      durationMs: params.durationMs,
      durationLabel: params.durationLabel,
      maxUses: Math.max(1, params.maxUses),
      usedCount: 0,
      usedByIds: [],
      createdBy: params.createdBy,
      createdAt: new Date().toISOString(),
      revoked: false,
    };
    state.premiumCodes[cleanCode] = record;
    return { ok: true, record };
  }

  redeemPremiumCode(
    state: PersistedDatabaseState,
    params: {
      code: string;
      discordId: string;
      username: string;
      source: 'CODE_REDEEM' | 'DISCORD_SLASH';
    }
  ):
    | { ok: true; subscription: UserPremiumSubscription; codeRecord: PremiumCodeRecord }
    | { ok: false; message: string } {
    const cleanCode = params.code.trim().toUpperCase();
    if (!Object.hasOwn(state.premiumCodes, cleanCode)) {
      return { ok: false, message: 'El código ingresado no existe o es inválido.' };
    }
    const record = state.premiumCodes[cleanCode];
    if (record.revoked) {
      return { ok: false, message: 'Este código fue revocado por administración.' };
    }
    if (record.usedCount >= record.maxUses) {
      return { ok: false, message: 'Este código ya alcanzó su límite de usos.' };
    }
    if (record.usedByIds.includes(params.discordId)) {
      return { ok: false, message: 'Ya has canjeado este código anteriormente.' };
    }

    record.usedCount += 1;
    record.usedByIds.push(params.discordId);

    const subscription = this.grantUserPremium(state, {
      discordId: params.discordId,
      username: params.username,
      tier: record.tier,
      durationMs: record.durationMs,
      source: params.source,
      updatedBy: `CODE:${cleanCode}`,
    });

    this.appendAuditLog(state, {
      guildId: null,
      actorId: params.discordId,
      actorName: params.username,
      action: 'PREMIUM_CODE_REDEEMED',
      entityType: 'PremiumCode',
      entityId: cleanCode,
      result: 'SUCCESS',
      metadata: {
        tier: record.tier,
        durationLabel: record.durationLabel,
        addedHuman: formatDurationHuman(record.durationMs, 'es'),
      },
    });

    return { ok: true, subscription, codeRecord: record };
  }

  assignGuildPremiumSlot(
    state: PersistedDatabaseState,
    params: { discordId: string; guildId: string; username: string }
  ):
    | { ok: true; plan: GuildPlanRecord; subscription: UserPremiumSubscription }
    | { ok: false; status: number; message: string } {
    const sub = Object.hasOwn(state.userSubscriptions, params.discordId)
      ? state.userSubscriptions[params.discordId]
      : undefined;

    if (!sub || !isSubscriptionActive(sub)) {
      return {
        ok: false,
        status: 402,
        message:
          'No tienes una suscripción Premium activa. Canjea un código o solicita activación al Staff.',
      };
    }

    const tier = normalizePlanTier(sub.tier) as 'ORO' | 'DIAMANTE';
    const maxServers = buildPlanQuotas(tier).maxPremiumServers;
    if (sub.activatedGuildIds.includes(params.guildId)) {
      const guildName = state.guilds[params.guildId]?.name ?? `Servidor ${params.guildId}`;
      this.ensureGuildStructures(state, params.guildId, guildName);
      const existingPlan = Object.hasOwn(state.guildPlans, params.guildId)
        ? state.guildPlans[params.guildId]
        : undefined;
      const ensuredPlan: GuildPlanRecord = existingPlan
        ? {
            ...existingPlan,
            tier,
            ownerUserId: existingPlan.ownerUserId ?? params.discordId,
            expiresAt: sub.expiresAt,
            quotas: buildPlanQuotas(tier),
          }
        : {
            guildId: params.guildId,
            tier,
            ownerUserId: params.discordId,
            activatedAt: new Date().toISOString(),
            expiresAt: sub.expiresAt,
            activatedBy: params.username,
            activationSource: 'USER_SLOT',
            quotas: buildPlanQuotas(tier),
          };
      state.guildPlans[params.guildId] = ensuredPlan;
      return {
        ok: true,
        plan: ensuredPlan,
        subscription: sub,
      };
    }
    if (sub.activatedGuildIds.length >= maxServers) {
      return {
        ok: false,
        status: 402,
        message: `Tu ${tier === 'DIAMANTE' ? 'Plan Diamante' : 'Plan Oro'} permite activar hasta ${maxServers} servidor(es) a la vez. Libera un servidor primero.`,
      };
    }

    sub.activatedGuildIds.push(params.guildId);
    sub.updatedAt = new Date().toISOString();

    const plan: GuildPlanRecord = {
      guildId: params.guildId,
      tier,
      ownerUserId: params.discordId,
      activatedAt: new Date().toISOString(),
      expiresAt: sub.expiresAt,
      activatedBy: params.username,
      activationSource: 'USER_SLOT',
      quotas: buildPlanQuotas(tier),
    };
    state.guildPlans[params.guildId] = plan;

    this.appendAuditLog(state, {
      guildId: params.guildId,
      actorId: params.discordId,
      actorName: params.username,
      action: 'GUILD_PREMIUM_ACTIVATED',
      entityType: 'GuildPlan',
      entityId: params.guildId,
      result: 'SUCCESS',
      metadata: { tier, slotsUsed: sub.activatedGuildIds.length, maxServers },
    });

    return { ok: true, plan, subscription: sub };
  }

  releaseGuildPremiumSlot(
    state: PersistedDatabaseState,
    params: { discordId: string; guildId: string; username: string }
  ): { ok: true; plan: GuildPlanRecord } {
    const currentPlan = Object.hasOwn(state.guildPlans, params.guildId)
      ? state.guildPlans[params.guildId]
      : undefined;

    if (
      currentPlan?.ownerUserId &&
      Object.hasOwn(state.userSubscriptions, currentPlan.ownerUserId)
    ) {
      const ownerSub = state.userSubscriptions[currentPlan.ownerUserId];
      ownerSub.activatedGuildIds = ownerSub.activatedGuildIds.filter(
        (id) => id !== params.guildId
      );
      ownerSub.updatedAt = new Date().toISOString();
    }
    if (Object.hasOwn(state.userSubscriptions, params.discordId)) {
      const callerSub = state.userSubscriptions[params.discordId];
      callerSub.activatedGuildIds = callerSub.activatedGuildIds.filter(
        (id) => id !== params.guildId
      );
      callerSub.updatedAt = new Date().toISOString();
    }

    const downgraded = buildFreeGuildPlan(params.guildId);
    state.guildPlans[params.guildId] = downgraded;
    this.disableGuildPremiumFeatures(state, params.guildId);

    this.appendAuditLog(state, {
      guildId: params.guildId,
      actorId: params.discordId,
      actorName: params.username,
      action: 'GUILD_PREMIUM_DEACTIVATED',
      entityType: 'GuildPlan',
      entityId: params.guildId,
      result: 'SUCCESS',
      metadata: {},
    });

    return { ok: true, plan: downgraded };
  }

  runDueAutoBackups(state: PersistedDatabaseState): number {
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    let createdCount = 0;

    for (const guild of Object.values(state.guilds)) {
      if (guild.botStatus !== 'BOT_CONNECTED') continue;
      const plan = state.guildPlans[guild.guildId] ?? buildFreeGuildPlan(guild.guildId);
      const tier: PlanTier = normalizePlanTier(plan.tier);
      const backups = state.guildBackups[guild.guildId] ?? [];
      const bSettings = state.guildBackupSettings[guild.guildId] ?? {
        guildId: guild.guildId,
        autoBackupSchedule: 'OFF' as const,
        lastAutoBackupAt: null,
      };

      const evalResult = evaluateAutoBackupSchedule({
        tier,
        currentBackupCount: backups.length,
        settings: bSettings,
        nowMs,
      });
      if (!evalResult.shouldCreate) continue;

      const backup: GuildBackupRecord = {
        id: `BKP-AUTO-${Date.now().toString(36).toUpperCase()}-${crypto
          .randomBytes(2)
          .toString('hex')
          .toUpperCase()}`,
        guildId: guild.guildId,
        guildName: guild.name,
        name: `Respaldo automático (${new Date(nowMs).toISOString().slice(0, 10)})`,
        createdBy: 'SYSTEM_AUTO_BACKUP',
        creatorName: 'AEGIS Respaldo Automático',
        createdAt: nowIso,
        automatic: true,
        stats: {
          rolesCount: 0,
          channelsCount: 0,
          whitelistCount:
            state.whitelists.filter((w) => w.guildId === guild.guildId && w.status === 'ACTIVE')
              .length + (state.channelWhitelists[guild.guildId]?.length ?? 0),
          botPermissionsCount: state.botPermissions[guild.guildId]?.length ?? 0,
        },
        snapshot: {
          antiRaidConfig: structuredClone(state.antiRaidConfigs[guild.guildId] ?? null),
          antiNukeConfig: structuredClone(state.antiNukeConfigs[guild.guildId] ?? null),
          securitySuite: structuredClone(state.guildSecuritySuites[guild.guildId] ?? null),
          verification: structuredClone(state.guildVerifications[guild.guildId] ?? null),
          logConfig: structuredClone(state.guildLogConfigs[guild.guildId] ?? null),
          roles: [],
          channels: [],
        },
      };

      backups.unshift(backup);
      state.guildBackups[guild.guildId] = backups;
      state.guildBackupSettings[guild.guildId] = {
        ...bSettings,
        autoBackupSchedule: bSettings.autoBackupSchedule || 'AUTO',
        lastAutoBackupAt: nowIso,
      };
      this.appendAuditLog(state, {
        guildId: guild.guildId,
        actorId: 'SYSTEM_AUTO_BACKUP',
        actorName: 'AEGIS Respaldo Automático',
        action: 'AUTO_BACKUP_CREATED',
        entityType: 'GuildBackup',
        entityId: backup.id,
        result: 'SUCCESS',
        metadata: {
          tier,
          intervalDays: evalResult.intervalDays,
          totalStored: backups.length,
          maxBackups: evalResult.maxBackups,
        },
      });
      createdCount += 1;
    }

    return createdCount;
  }

  /**
   * Pure read-only telemetry probe — NEVER initiates or spawns a Discord Gateway client.
   */
  async getSystemHealth(): Promise<SystemHealthSnapshot> {
    const env = getServerEnv();
    const telemetry = aegisTelemetry.getSnapshot();

    const withTimeout = <T>(p: Promise<T>, fallback: T, ms = 1200): Promise<T> =>
      Promise.race([
        p,
        new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
      ]);

    const [mongoStatus, redisStatus] = await Promise.all([
      env.mongodbConfigured
        ? withTimeout(ensureMongoConnected(), getMongoStatus())
        : Promise.resolve<'UNCONFIGURED'>('UNCONFIGURED'),
      env.redisConfigured
        ? withTimeout(redisCoordinator.ensureConnected(), redisCoordinator.getStatus())
        : Promise.resolve<'UNCONFIGURED'>('UNCONFIGURED'),
    ]);

    let botTag: string | null = null;
    let botId: string | null = null;
    let botAvatarUrl: string | null = null;
    let pingMs: number | null = null;
    let guildCount: number | null = null;
    let userCount: number | null = null;
    let shards: BotShardTelemetry[] = [];
    let cluster: BotClusterTelemetry | undefined;
    let effectiveLatencyMetrics = {
      antiRaidEval: telemetry.antiRaidEvalLatency,
      sanctionExec: telemetry.sanctionExecLatency,
    };

    const liveRunner = getLiveBotRunnerSnapshot();
    const redisHeartbeat =
      !liveRunner.connected && redisStatus === 'CONNECTED'
        ? await redisCoordinator.getBotHeartbeat()
        : null;

    let restOnline = false;
    if (liveRunner.connected) {
      botTag = liveRunner.tag;
      botId = liveRunner.id;
      botAvatarUrl = liveRunner.avatarUrl;
      pingMs = liveRunner.pingMs;
      guildCount = liveRunner.guildCount;
      userCount = liveRunner.userCount;
      shards = liveRunner.shards;
      cluster = liveRunner.cluster ?? undefined;
    } else if (redisHeartbeat?.online) {
      botTag = redisHeartbeat.tag;
      botId = redisHeartbeat.id;
      botAvatarUrl = redisHeartbeat.avatarUrl;
      pingMs = redisHeartbeat.pingMs;
      guildCount = redisHeartbeat.guildCount;
      userCount = redisHeartbeat.userCount;
      if (redisHeartbeat.latencyMetrics) {
        effectiveLatencyMetrics = redisHeartbeat.latencyMetrics;
      }
      shards =
        redisHeartbeat.shards && redisHeartbeat.shards.length > 0
          ? redisHeartbeat.shards
          : [
              {
                id: 0,
                clusterId: 1,
                status: 'READY',
                pingMs: redisHeartbeat.pingMs ?? 0,
                guildCount: redisHeartbeat.guildCount ?? 0,
                uptimeSeconds: Math.floor(process.uptime()),
                memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                eventThroughputPerSec: telemetry.eventThroughputPerSec,
              },
            ];
      cluster = redisHeartbeat.cluster ?? {
        clusterId: 1,
        clusterName: 'Cluster-Alpha (Standalone Bot via Redis)',
        totalShards: shards.length,
        mode: 'CLUSTERED_MULTI_WORKER',
        workerPid: redisHeartbeat.pid ?? process.pid,
        memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        cpuPercent: telemetry.cpuPercent,
        averagePingMs: redisHeartbeat.pingMs ?? 0,
        status: (redisHeartbeat.pingMs ?? 0) < 120 ? 'OPTIMAL' : 'HEALTHY',
        eventLoopLagMs: telemetry.eventLoopLagMs,
        activeSockets: shards.length,
        queueSize: 0,
      };
    } else if (env.botConfigured) {
      if (Date.now() - this.botLiveCache.checkedAt > 20_000) {
        const verified = await withTimeout(
          verifyBotTelemetryLive(),
          {
            online: this.botLiveCache.online,
            id: this.botLiveCache.id,
            tag: this.botLiveCache.tag,
            avatarUrl: this.botLiveCache.avatarUrl,
            pingMs: this.botLiveCache.pingMs,
            guildCount: this.botLiveCache.guildCount,
            userCount: this.botLiveCache.userCount,
          },
          2200
        );
        this.botLiveCache = {
          checkedAt: Date.now(),
          online: verified.online,
          id: verified.id,
          tag: verified.tag,
          avatarUrl: verified.avatarUrl,
          pingMs: verified.pingMs,
          guildCount: verified.guildCount,
          userCount: verified.userCount,
        };
      }
      if (this.botLiveCache.online) {
        restOnline = true;
        botId = this.botLiveCache.id;
        botTag = this.botLiveCache.tag;
        botAvatarUrl = this.botLiveCache.avatarUrl;
        pingMs = this.botLiveCache.pingMs;
        guildCount = this.botLiveCache.guildCount;
        userCount = this.botLiveCache.userCount;
      }
    }

    const botState = normalizeHonestBotState({
      botConfigured: env.botConfigured,
      liveConnected: liveRunner.connected,
      redisOnline: Boolean(redisHeartbeat?.online),
      restOnline,
      invalidToken:
        env.botConfigured && !liveRunner.connected && !redisHeartbeat?.online && !restOnline,
    });

    let outboxPendingCount = 0;
    if (mongoStatus === 'CONNECTED') {
      outboxPendingCount = await withTimeout(
        SyncOutboxModel.countDocuments({ status: 'PENDING' }),
        0,
        600
      );
    }

    const recentErrors = aegisLogger
      .getRecentEntries({ level: 'ERROR', limit: 12 })
      .map((entry, idx) => ({
        id: `ERR-${idx + 1}-${entry.correlationId || 'sys'}`,
        timestamp: entry.timestamp,
        category: entry.category,
        message: entry.message,
        guildId: entry.guildId,
        correlationId: entry.correlationId,
      }));

    const syncStatus: 'SYNCHRONIZED' | 'PENDING_SYNC' | 'SYNC_ERROR' | 'OFFLINE' =
      botState === 'OFFLINE'
        ? 'OFFLINE'
        : outboxPendingCount > 0 || (env.redisConfigured && redisStatus !== 'CONNECTED')
        ? 'PENDING_SYNC'
        : mongoStatus === 'DEGRADED' || mongoStatus === 'OFFLINE'
        ? 'SYNC_ERROR'
        : 'SYNCHRONIZED';

    return {
      api: 'ONLINE',
      mongodb: mongoStatus,
      redis: redisStatus,
      bot: botState,
      degradedMode: botState !== 'ONLINE' || (env.redisConfigured && redisStatus !== 'CONNECTED'),
      lastSynchronization:
        redisHeartbeat?.lastSlashSyncAt ?? liveRunner.lastSlashSyncAt ?? this.lastSyncAt,
      l1CacheStats: this.l1Cache.getStats(),
      botIdentity: {
        configured: env.botConfigured,
        tag: botTag,
        id: botId,
        avatarUrl: botAvatarUrl,
        pingMs,
        guildCount,
        userCount,
      },
      shards,
      cluster,
      slashCommands: AEGIS_SLASH_COMMANDS_METADATA,
      oauthConfigured: env.oauthConfigured,
      syncHealth: {
        status: syncStatus,
        lastReconcileAt: this.lastSyncAt,
        pendingOutboxCount: outboxPendingCount,
      },
      latencyMetrics: effectiveLatencyMetrics,
      recentErrors,
    };
  }

  async buildOverviewAnalytics(
    period: OverviewPeriod,
    guildId?: string,
    authorizedGuildIds?: string[]
  ): Promise<OverviewAnalyticsResponse> {
    const state = await this.getState();
    const systemHealth = await this.getSystemHealth();
    return computeOverviewAnalytics(state, systemHealth, period, guildId, authorizedGuildIds);
  }

  async buildGlobalBanAnalytics(): Promise<GlobalBanAnalyticsResponse> {
    const state = await this.getState();
    return computeGlobalBanAnalytics(state);
  }
}

const globalForStore = globalThis as unknown as { __aegisStore?: AegisStore };
export const aegisStore = globalForStore.__aegisStore ?? new AegisStore();
if (!globalForStore.__aegisStore) {
  globalForStore.__aegisStore = aegisStore;
}
