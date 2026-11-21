import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AntiNukeConfigRecord,
  AntiRaidConfigRecord,
  AuditLogRecord,
  BotPermissionGrantRecord,
  ChannelWhitelistRecord,
  DiscordAccountRecord,
  GlobalBanAnalyticsResponse,
  GlobalBanAppealRecord,
  GlobalBanRecord,
  GlobalModeratorRecord,
  GuildBackupRecord,
  GuildBackupSettingsRecord,
  GuildLogConfigRecord,
  GuildParticipationRecord,
  GuildPlanRecord,
  GuildRecord,
  GuildSecuritySuiteRecord,
  GuildSettingsRecord,
  GuildVerificationRecord,
  IncidentStatus,
  LockdownStateRecord,
  NotificationRecord,
  OverviewAnalyticsResponse,
  OverviewPeriod,
  PlanTier,
  PremiumCodeRecord,
  QuarantineEntryRecord,
  RiskAssessmentRecord,
  SecondaryOwnerRecord,
  SecurityEventRecord,
  SecurityIncidentRecord,
  SystemHealthSnapshot,
  SystemSettingsRecord,
  UserPremiumSubscription,
  UserRecord,
  UserTwoFactorRecord,
  WhitelistEntryRecord,
  BotShardTelemetry,
  BotClusterTelemetry,
  SlashCommandDefinition,
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
import { DEFAULT_RISK_WEIGHTS } from '../aegis/risk-engine';
import {
  dedupePreserveOrder,
  mergeWhitelistExcludedRules,
  stripUnsafeKeys,
} from '../aegis/security-helpers';
import { RaidBurstShield } from '../aegis/fast-antiraid';
import {
  AlertBatchDeduplicator,
  BoundedMemoryCache,
  SlidingWindowTracker,
} from '../aegis/sliding-window';
import { ensureBotStarted, getLiveBotRunnerSnapshot } from './bot-runner';
import { getServerEnv } from './env';
import { verifyBotTelemetryLive } from './discord-api';
import { ensureMongoConnected, getMongoStatus, AegisSnapshotModel } from './mongodb';
import { redisCoordinator } from './redis';

export { buildPlanQuotas, buildFreeGuildPlan };

export interface PersistedDatabaseState {
  users: Record<string, UserRecord>;
  discordAccounts: Record<string, DiscordAccountRecord>;
  guilds: Record<string, GuildRecord>;
  guildSettings: Record<string, GuildSettingsRecord>;
  antiRaidConfigs: Record<string, AntiRaidConfigRecord>;
  antiNukeConfigs: Record<string, AntiNukeConfigRecord>;
  riskAssessments: RiskAssessmentRecord[];
  incidents: SecurityIncidentRecord[];
  events: SecurityEventRecord[];
  quarantines: QuarantineEntryRecord[];
  whitelists: WhitelistEntryRecord[];
  globalBans: GlobalBanRecord[];
  appeals: GlobalBanAppealRecord[];
  globalModerators: GlobalModeratorRecord[];
  participatingServers: Record<string, GuildParticipationRecord>;
  auditLogs: AuditLogRecord[];
  notifications: NotificationRecord[];
  lockdowns: Record<string, LockdownStateRecord>;
  systemSettings: SystemSettingsRecord;
  userGuildAccess: Record<string, string[]>; // userId -> guildIds[]
  userGuildRoster: Record<string, GuildRecord[]>; // userId -> full Discord guild roster
  guildPlans: Record<string, GuildPlanRecord>;
  userSubscriptions: Record<string, UserPremiumSubscription>;
  premiumCodes: Record<string, PremiumCodeRecord>;
  guildSecuritySuites: Record<string, GuildSecuritySuiteRecord>;
  botPermissions: Record<string, BotPermissionGrantRecord[]>;
  channelWhitelists: Record<string, ChannelWhitelistRecord[]>;
  guildVerifications: Record<string, GuildVerificationRecord>;
  guildLogConfigs: Record<string, GuildLogConfigRecord>;
  guildBackups: Record<string, GuildBackupRecord[]>;
  guildBackupSettings: Record<string, GuildBackupSettingsRecord>;
  secondaryOwners: Record<string, SecondaryOwnerRecord>;
  userTwoFactors: Record<string, UserTwoFactorRecord>;
}

const DATA_DIR = path.join(process.cwd(), '.aegis-data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');
export const EVIDENCE_DIR = path.join(DATA_DIR, 'evidence');

export function createEmptyState(): PersistedDatabaseState {
  return {
    users: {},
    discordAccounts: {},
    guilds: {},
    guildSettings: {},
    antiRaidConfigs: {},
    antiNukeConfigs: {},
    riskAssessments: [],
    incidents: [],
    events: [],
    quarantines: [],
    whitelists: [],
    globalBans: [],
    appeals: [],
    globalModerators: [],
    participatingServers: {},
    auditLogs: [],
    notifications: [],
    lockdowns: {},
    systemSettings: {
      sessionMaxAgeSeconds: 86_400,
      requireDualApprovalForPermanentBan: true,
      appealCooldownHours: 72,
      auditRetentionDays: 365,
      updatedAt: new Date().toISOString(),
    },
    userGuildAccess: {},
    userGuildRoster: {},
    guildPlans: {},
    userSubscriptions: {},
    premiumCodes: {},
    guildSecuritySuites: {},
    botPermissions: {},
    channelWhitelists: {},
    guildVerifications: {},
    guildLogConfigs: {},
    guildBackups: {},
    guildBackupSettings: {},
    secondaryOwners: {},
    userTwoFactors: {},
  };
}

export const AEGIS_SLASH_COMMANDS_METADATA: SlashCommandDefinition[] = [
  {
    name: 'antiraid',
    description: '🛡️ | Protección Anti-Raid automática y escudos en tiempo real',
    category: 'Seguridad / Anti-Raid',
    defaultMemberPermissions: 'Dueño / Segundo Dueño',
    status: 'DEPLOYED',
    subcommands: [
      { name: 'estado', description: '📊 | Ver el estado actual y nivel del escudo Anti-Raid', optionsCount: 0 },
      { name: 'activar', description: '🟢 | Activar la protección automática Anti-Raid en este servidor', optionsCount: 0 },
      { name: 'desactivar', description: '🔴 | Desactivar la protección automática Anti-Raid', optionsCount: 0 },
      { name: 'modo', description: '⚡ | Cambiar el modo de sensibilidad (Normal, Estricto o Emergencia)', optionsCount: 1 },
      { name: 'configurar', description: '⚙️ | Ajustar límite de ingresos, ventana y antigüedad mínima', optionsCount: 3 },
      { name: 'probar', description: '🧪 | Ejecutar simulación diagnóstica del Motor de Riesgo', optionsCount: 0 },
      { name: 'incidentes', description: '🚨 | Listar incidentes recientes de seguridad Anti-Raid', optionsCount: 0 },
    ],
  },
  {
    name: 'antinuke',
    description: '💣 | Defensa Anti-Nuke contra destrucción masiva de canales y roles',
    category: 'Defensa Anti-Nuke',
    defaultMemberPermissions: 'Dueño / Segundo Dueño',
    status: 'DEPLOYED',
    subcommands: [
      { name: 'estado', description: '📊 | Consultar el estado y métricas del escudo Anti-Nuke', optionsCount: 0 },
      { name: 'activar', description: '🟢 | Activar defensa Anti-Nuke con contención inmediata', optionsCount: 0 },
      { name: 'desactivar', description: '🔴 | Desactivar temporalmente la defensa Anti-Nuke', optionsCount: 0 },
      { name: 'configurar', description: '⚙️ | Definir límites máximos de canales y roles modificados', optionsCount: 2 },
      { name: 'incidentes', description: '🚨 | Mostrar alertas críticas recientes de Anti-Nuke', optionsCount: 0 },
    ],
  },
  {
    name: 'seguridad',
    description: '🔐 | Módulos de seguridad (Anti-Alts, Anti-Bots, Anti-Scam y Anti-Flood)',
    category: 'Seguridad Adicional',
    defaultMemberPermissions: 'Dueño / Segundo Dueño',
    status: 'DEPLOYED',
    subcommands: [
      { name: 'estado', description: '📊 | Ver el estado de todas las capas de seguridad adicional', optionsCount: 0 },
      { name: 'antialts', description: '🕵️ | Configurar filtro Anti-Alts por antigüedad mínima de cuenta', optionsCount: 2 },
      { name: 'antibots', description: '🤖 | Configurar política de admisión y bloqueo de bots', optionsCount: 1 },
      { name: 'antiinvitaciones', description: '🚫 | Activar o desactivar el bloqueo de invitaciones de Discord', optionsCount: 1 },
      { name: 'antienlaces', description: '🔗 | Activar o desactivar el filtro de enlaces externos', optionsCount: 1 },
      { name: 'antiflood', description: '🌊 | Activar o desactivar la mitigación rápida Anti-Flood', optionsCount: 1 },
      { name: 'antiscam', description: '🎣 | Activar o desactivar la detección de estafas y phishing', optionsCount: 1 },
      { name: 'antieveryone', description: '📢 | Proteger el rol @everyone contra escalamiento de permisos', optionsCount: 1 },
    ],
  },
  {
    name: 'cuarentena',
    description: '⛓️ | Gestión de cuarentena y aislamiento inmediato de cuentas',
    category: 'Contención',
    defaultMemberPermissions: 'Dueño / Segundo Dueño',
    status: 'DEPLOYED',
    subcommands: [
      { name: 'aislar', description: '🔒 | Aislar a un usuario sospechoso en cuarentena de seguridad', optionsCount: 3 },
      { name: 'liberar', description: '🔓 | Liberar a un usuario de la cuarentena activa', optionsCount: 1 },
      { name: 'lista', description: '📋 | Listar las cuentas actualmente aisladas en cuarentena', optionsCount: 0 },
      { name: 'detalle', description: '🔍 | Consultar el historial y motivo de cuarentena de un usuario', optionsCount: 1 },
    ],
  },
  {
    name: 'bloqueo',
    description: '🚨 | Bloqueo de emergencia (Lockdown) reversible por servidor',
    category: 'Emergencia',
    defaultMemberPermissions: 'Dueño / Segundo Dueño',
    status: 'DEPLOYED',
    subcommands: [
      { name: 'activar', description: '🔒 | Activar bloqueo de emergencia en los canales del servidor', optionsCount: 2 },
      { name: 'desactivar', description: '🔓 | Desactivar el bloqueo y restaurar los permisos previos', optionsCount: 0 },
      { name: 'estado', description: '📊 | Consultar el estado actual del bloqueo y canales cerrados', optionsCount: 0 },
      { name: 'configurar', description: '⚙️ | Ajustar restricciones de texto y voz durante el bloqueo', optionsCount: 2 },
    ],
  },
  {
    name: 'whitelist',
    description: '📜 | Gestión de lista blanca y excepciones de seguridad por regla',
    category: 'Excepciones',
    defaultMemberPermissions: 'Dueño / Segundo Dueño',
    status: 'DEPLOYED',
    subcommands: [
      { name: 'agregar', description: '✅ | Añadir un usuario o bot de confianza a la lista blanca', optionsCount: 3 },
      { name: 'quitar', description: '🗑️ | Revocar una excepción activa de la lista blanca', optionsCount: 1 },
      { name: 'lista', description: '📋 | Listar todas las excepciones activas del servidor', optionsCount: 0 },
      { name: 'verificar', description: '🔍 | Consultar las excepciones asignadas a un ID de Discord', optionsCount: 1 },
    ],
  },
  {
    name: 'premium',
    description: '👑 | Membresías Plan Oro y Diamante, canje de códigos y gestión',
    category: 'Membresías',
    defaultMemberPermissions: 'Bot Staff / Usuarios (ver y canjear)',
    status: 'DEPLOYED',
    subcommands: [
      { name: 'anadir', description: '➕ | [Staff] Añadir tiempo de Plan Oro o Diamante a un usuario', optionsCount: 3 },
      { name: 'ver', description: '👁️ | Consultar tu plan activo, tiempo restante y servidores', optionsCount: 1 },
      { name: 'eliminar', description: '🗑️ | [Staff] Revocar membresía Premium y desactivar beneficios', optionsCount: 1 },
      { name: 'codigo', description: '🎟️ | [Staff] Generar código canjeable para Plan Oro o Diamante', optionsCount: 4 },
      { name: 'canjear', description: '🎁 | Canjear un código Premium y acumular tiempo en tu cuenta', optionsCount: 1 },
    ],
  },
  {
    name: 'aegis',
    description: '⚡ | Centro de control interactivo y diagnóstico de AEGIS SECURITY',
    category: 'Plataforma',
    defaultMemberPermissions: 'Dueño / Segundo Dueño / Ayuda',
    status: 'DEPLOYED',
    subcommands: [
      { name: 'panel', description: '🎛️ | Abrir el panel interactivo Components V2 del servidor', optionsCount: 0 },
      { name: 'estado', description: '📊 | Ver el resumen general de seguridad y plan del servidor', optionsCount: 0 },
      { name: 'diagnostico', description: '🩺 | Verificar permisos del bot, latencia y caché en vivo', optionsCount: 0 },
      { name: 'ayuda', description: '📖 | Mostrar la guía completa de comandos slash disponibles', optionsCount: 0 },
    ],
  },
];

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
  private hotGlobalBanMap = new Map<string, GlobalBanRecord>();
  private hotWhitelistMap = new Map<string, Set<string>>();
  private hotChannelWhitelistMap = new Map<string, Set<string>>();
  private knownInitializedGuilds = new Set<string>();
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
  }

  private mongoHydrated = false;

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
    if (entry.sanctionType === 'TEMPORARY' && entry.expiresAt && new Date(entry.expiresAt).getTime() <= Date.now()) {
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

  public reloadFromDiskIfNewer(): boolean {
    if (!fs.existsSync(DATA_FILE)) return false;
    try {
      const stat = fs.statSync(DATA_FILE);
      this.lastHotDiskCheckAt = Date.now();
      if (stat.mtimeMs <= this.lastDiskMtimeMs && this.state) {
        return false;
      }
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedDatabaseState>;
      this.state = this.normalizeLoadedState({
        ...createEmptyState(),
        ...parsed,
      });
      this.lastDiskMtimeMs = stat.mtimeMs;
      this.knownInitializedGuilds.clear();
      this.rebuildHotIndexes(this.state);
      return true;
    } catch {
      return false;
    }
  }

  public getHotStateSync(): PersistedDatabaseState {
    if (this.state) {
      const now = Date.now();
      if (now - this.lastHotDiskCheckAt >= 1500) {
        this.reloadFromDiskIfNewer();
      }
      return this.state;
    }
    const loaded = this.loadFromDisk();
    this.rebuildHotIndexes(loaded);
    return loaded;
  }

  private normalizeLoadedState(loaded: PersistedDatabaseState): PersistedDatabaseState {
    loaded.users = stripUnsafeKeys(
      loaded.users && typeof loaded.users === 'object' ? loaded.users : {}
    );
    loaded.discordAccounts = stripUnsafeKeys(
      loaded.discordAccounts && typeof loaded.discordAccounts === 'object'
        ? loaded.discordAccounts
        : {}
    );
    loaded.guilds = stripUnsafeKeys(
      loaded.guilds && typeof loaded.guilds === 'object' ? loaded.guilds : {}
    );
    loaded.userSubscriptions = stripUnsafeKeys(
      loaded.userSubscriptions && typeof loaded.userSubscriptions === 'object'
        ? loaded.userSubscriptions
        : {}
    );
    loaded.premiumCodes = stripUnsafeKeys(
      loaded.premiumCodes && typeof loaded.premiumCodes === 'object' ? loaded.premiumCodes : {}
    );

    for (const sub of Object.values(loaded.userSubscriptions)) {
      if (sub && Array.isArray(sub.activatedGuildIds)) {
        sub.activatedGuildIds = dedupePreserveOrder(sub.activatedGuildIds);
      }
    }

    for (const an of Object.values(loaded.antiNukeConfigs ?? {})) {
      if (an && Array.isArray(an.authorizedAdminIds)) {
        an.authorizedAdminIds = dedupePreserveOrder(an.authorizedAdminIds);
      }
    }

    for (const [gid, plan] of Object.entries(loaded.guildPlans ?? {})) {
      const normalizedTier = normalizePlanTier(plan?.tier);
      const rawSrc = plan?.activationSource as string | undefined;
      const normalizedSource: GuildPlanRecord['activationSource'] =
        rawSrc === 'USER_SLOT' ||
        rawSrc === 'CODE_REDEEM' ||
        rawSrc === 'STAFF_PANEL' ||
        rawSrc === 'DISCORD_SLASH' ||
        rawSrc === 'FREE_DEFAULT'
          ? rawSrc
          : normalizedTier === 'FREE'
          ? 'FREE_DEFAULT'
          : 'USER_SLOT';
      loaded.guildPlans[gid] = {
        guildId: gid,
        tier: normalizedTier,
        ownerUserId: plan?.ownerUserId ?? null,
        activatedAt: plan?.activatedAt ?? null,
        expiresAt: plan?.expiresAt ?? null,
        activatedBy: plan?.activatedBy ?? null,
        activationSource: normalizedSource,
        quotas: buildPlanQuotas(normalizedTier),
      };
    }
    for (const [gid, bSettings] of Object.entries(loaded.guildBackupSettings ?? {})) {
      if (bSettings) {
        loaded.guildBackupSettings[gid] = {
          ...bSettings,
          autoBackupSchedule:
            bSettings.autoBackupSchedule === 'DAILY' || bSettings.autoBackupSchedule === 'WEEKLY'
              ? 'AUTO'
              : bSettings.autoBackupSchedule || 'OFF',
        };
      }
    }
    if (Array.isArray(loaded.incidents) && loaded.incidents.length > 500) {
      loaded.incidents = loaded.incidents.slice(0, 500);
    }
    if (Array.isArray(loaded.events) && loaded.events.length > 500) {
      loaded.events = loaded.events.slice(0, 500);
    }
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
        this.state = this.normalizeLoadedState({
          ...createEmptyState(),
          ...parsed,
        });
        this.lastDiskMtimeMs = stat.mtimeMs;
        this.rebuildHotIndexes(this.state);
        return this.state;
      } catch {
        // Corrupted file fallback to fresh empty state
      }
    }

    this.state = createEmptyState();
    this.rebuildHotIndexes(this.state);
    this.persistToDisk();
    return this.state;
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
    if (!isBlank) {
      this.mongoHydrated = true;
      return;
    }

    this.mongoHydrationPromise = (async () => {
      try {
        const status = await ensureMongoConnected();
        if (status !== 'CONNECTED') return;
        const doc = (await AegisSnapshotModel.findOne({ key: 'aegis_primary_state' }).lean()) as {
          payload?: PersistedDatabaseState;
        } | null;
        if (doc?.payload && typeof doc.payload === 'object') {
          this.state = this.normalizeLoadedState({
            ...createEmptyState(),
            ...doc.payload,
          });
          this.rebuildHotIndexes(this.state);
          this.persistToDisk();
        }
      } catch {
        // Non-fatal fallback to local disk store
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
    const nowIso = new Date().toISOString();
    if (!state.guildSettings[guildId]) {
      state.guildSettings[guildId] = {
        guildId,
        alertChannelId: null,
        alertChannelName: null,
        quarantineRoleId: null,
        quarantineRoleName: null,
        authorizedMentionRoleIds: [],
        alertBatchIntervalSeconds: 15,
        deduplicateAlerts: true,
        minAlertSeverity: 'MODERATE',
        updatedAt: nowIso,
      };
    }

    if (!state.antiRaidConfigs[guildId]) {
      state.antiRaidConfigs[guildId] = {
        guildId,
        enabled: false,
        activatedAt: null,
        mode: 'NORMAL',
        sensitivity: 'BALANCED',
        maxJoins: 8,
        timeWindowSeconds: 10,
        minAccountAgeDays: 7,
        suspiciousAccountDetection: true,
        botJoinDetection: true,
        joinPatternDetection: true,
        burstDetection: true,
        riskThreshold: 70,
        defaultAction: 'QUARANTINE',
        riskRules: [
          { level: 'LOW', action: 'LOG_ONLY', notifyAlertChannel: false },
          { level: 'MODERATE', action: 'ALERT', notifyAlertChannel: true },
          { level: 'HIGH', action: 'QUARANTINE', notifyAlertChannel: true },
          { level: 'CRITICAL', action: 'QUARANTINE', notifyAlertChannel: true },
        ],
        riskWeights: { ...DEFAULT_RISK_WEIGHTS },
        eventsProcessed: 0,
        attacksDetected: 0,
        attacksPrevented: 0,
        syncVersion: 1,
        lastSyncedAt: nowIso,
      };
    }

    if (!state.antiNukeConfigs[guildId]) {
      state.antiNukeConfigs[guildId] = {
        guildId,
        enabled: false,
        maxChannelDeletions: 2,
        maxChannelCreations: 4,
        maxRoleMutations: 3,
        maxMassBansKicks: 4,
        maxWebhookMutations: 2,
        timeWindowSeconds: 15,
        detectDangerousPermissionChanges: true,
        authorizedAdminIds: [],
        autoResponse: {
          logEvent: true,
          sendAlert: true,
          stripDangerousPermissions: true,
          quarantineExecutor: true,
          triggerLockdown: false,
        },
        updatedAt: nowIso,
      };
    }

    if (!state.lockdowns[guildId]) {
      state.lockdowns[guildId] = {
        guildId,
        active: false,
        mode: 'MANUAL',
        reason: null,
        activatedBy: null,
        activatedAt: null,
        scheduledEndAt: null,
        affectedChannelCount: 0,
        affectedRoleIds: ['@everyone'],
        restrictions: {
          lockSendMessages: true,
          lockAddReactions: true,
          lockCreateThreads: true,
          lockVoiceConnect: false,
          disableInvites: true,
        },
        snapshots: [],
        lastRestoredAt: null,
      };
    }

    if (!state.participatingServers[guildId]) {
      state.participatingServers[guildId] = {
        guildId,
        guildName,
        globalBanEnabled: false,
        enforcementMode: 'ALERT_ONLY',
        actionPolicy: 'NOTIFY_STAFF',
        notificationChannelId: state.guildSettings[guildId]?.alertChannelId ?? null,
        syncStatus: 'DISABLED',
        lastSyncedAt: nowIso,
      };
    }

    if (!state.guildPlans[guildId]) {
      state.guildPlans[guildId] = buildFreeGuildPlan(guildId);
    }

    if (!state.guildSecuritySuites[guildId]) {
      state.guildSecuritySuites[guildId] = {
        guildId,
        punishmentAction: 'QUARANTINE',
        antiRaidModules: {
          channelCreate: { enabled: false, actionsPerMinute: 2, premiumOnly: false },
          channelDelete: { enabled: false, actionsPerMinute: 1, premiumOnly: false },
          channelEdit: { enabled: false, actionsPerMinute: 3, premiumOnly: true },
          roleCreate: { enabled: false, actionsPerMinute: 2, premiumOnly: false },
          roleDelete: { enabled: false, actionsPerMinute: 1, premiumOnly: false },
          roleEdit: { enabled: false, actionsPerMinute: 3, premiumOnly: true },
          emojiCreate: { enabled: false, actionsPerMinute: 3, premiumOnly: true },
          emojiDelete: { enabled: false, actionsPerMinute: 2, premiumOnly: true },
          memberKick: { enabled: false, actionsPerMinute: 2, premiumOnly: false },
          memberBan: { enabled: false, actionsPerMinute: 2, premiumOnly: false },
          memberUnban: { enabled: false, actionsPerMinute: 2, premiumOnly: false },
          webhookEdit: { enabled: false, actionsPerMinute: 2, premiumOnly: true },
        },
        additionalSecurity: {
          banMaliciousUsers: false,
          antiFlood: { enabled: false, maxMessages: 6, windowSeconds: 5, muteMinutes: 10 },
          antiScam: { enabled: false, muteMinutes: 30, deleteMessage: true },
          antiEveryonePerms: false,
          antiWebhookSpam: false,
          antiMassMute: { enabled: false, maxMutesPerMinute: 3 },
          antiAlts: { enabled: false, minAccountAgeDays: 7 },
          antiBots: 'DISABLED',
          antiInvites: false,
          antiLinks: { enabled: false, allowedDomains: [] },
        },
        updatedAt: nowIso,
      };
    }

    if (!state.botPermissions[guildId]) {
      state.botPermissions[guildId] = [];
    }

    if (!state.channelWhitelists[guildId]) {
      state.channelWhitelists[guildId] = [];
    }

    if (!state.guildVerifications[guildId]) {
      state.guildVerifications[guildId] = {
        guildId,
        enabled: false,
        mode: 'BUTTON',
        channelId: null,
        channelName: null,
        verifiedRoleId: null,
        verifiedRoleName: null,
        unverifiedRoleId: null,
        blockSuspiciousAccounts: true,
        kickUnverifiedAfterMinutes: null,
        panelTitle: 'AEGIS Security Verification',
        panelDescription: 'Complete quick verification to access community channels.',
        updatedAt: nowIso,
      };
    }

    if (!state.guildLogConfigs[guildId]) {
      state.guildLogConfigs[guildId] = {
        guildId,
        channelId: state.guildSettings[guildId]?.alertChannelId ?? null,
        channelName: state.guildSettings[guildId]?.alertChannelName ?? null,
        events: {
          moderation: true,
          antiRaid: true,
          antiNuke: true,
          verification: true,
          backups: true,
        },
        updatedAt: nowIso,
      };
    }

    if (!state.guildBackups[guildId]) {
      state.guildBackups[guildId] = [];
    }

    if (!state.guildBackupSettings[guildId]) {
      state.guildBackupSettings[guildId] = {
        guildId,
        autoBackupSchedule: 'OFF',
        lastAutoBackupAt: null,
      };
    }

    this.knownInitializedGuilds.add(guildId);
  }

  private persistToDisk(): void {
    if (!this.state) return;
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
          // ignore
        }
        this.lastSyncAt = new Date().toISOString();
      })
      .catch(() => {
        // Non-fatal async flush error
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
        if (getMongoStatus() === 'CONNECTED' && this.state) {
          AegisSnapshotModel.findOneAndUpdate(
            { key: 'aegis_primary_state' },
            { key: 'aegis_primary_state', payload: this.state, updatedAt: new Date() },
            { upsert: true }
          ).catch(() => {});
        }
        void redisCoordinator
          .publish('aegis:sync', eventName, payload ?? {}, guildId, this.instanceId)
          .catch(() => {});
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
    payload?: unknown
  ): Promise<void> {
    if (this.hotCommitTimer) {
      clearTimeout(this.hotCommitTimer);
      this.hotCommitTimer = null;
    }
    this.rebuildHotIndexes(this.state);
    this.persistToDisk();
    if (guildId) {
      this.l1Cache.invalidateByPrefix(`guild:${guildId}:`);
    } else {
      this.l1Cache.invalidateByPrefix('global:');
    }

    // Mirror state snapshot to MongoDB L3 if configured and connected
    if (getMongoStatus() === 'CONNECTED' && this.state) {
      AegisSnapshotModel.findOneAndUpdate(
        { key: 'aegis_primary_state' },
        { key: 'aegis_primary_state', payload: this.state, updatedAt: new Date() },
        { upsert: true }
      ).catch(() => {
        // Non-blocking background L3 sync
      });
    }

    await redisCoordinator.publish('aegis:sync', eventName, payload ?? {}, guildId, this.instanceId);
    this.emit('aegis:update', {
      event: eventName,
      guildId: guildId ?? null,
      payload: payload ?? null,
      timestamp: new Date().toISOString(),
    });
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

  /**
   * Automatically disables every Premium-gated feature on a guild when its Premium expires or is revoked.
   */
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

    // Also downgrade any orphaned guildPlan whose own expiresAt elapsed
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

    // Sync any currently slotted guilds for this user with the updated tier & accumulated expiration
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
  ): { ok: true; plan: GuildPlanRecord; subscription: UserPremiumSubscription } | { ok: false; status: number; message: string } {
    const sub = Object.hasOwn(state.userSubscriptions, params.discordId)
      ? state.userSubscriptions[params.discordId]
      : undefined;

    if (!sub || !isSubscriptionActive(sub)) {
      return {
        ok: false,
        status: 402,
        message: 'No tienes una suscripción Premium activa. Canjea un código o solicita activación al Staff.',
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

    if (currentPlan?.ownerUserId && Object.hasOwn(state.userSubscriptions, currentPlan.ownerUserId)) {
      const ownerSub = state.userSubscriptions[currentPlan.ownerUserId];
      ownerSub.activatedGuildIds = ownerSub.activatedGuildIds.filter((id) => id !== params.guildId);
      ownerSub.updatedAt = new Date().toISOString();
    }
    if (Object.hasOwn(state.userSubscriptions, params.discordId)) {
      const callerSub = state.userSubscriptions[params.discordId];
      callerSub.activatedGuildIds = callerSub.activatedGuildIds.filter((id) => id !== params.guildId);
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

  async getSystemHealth(): Promise<SystemHealthSnapshot> {
    const env = getServerEnv();
    if (env.botConfigured) {
      ensureBotStarted();
    }

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
      shards = [
        {
          id: 0,
          clusterId: 1,
          status: 'READY',
          pingMs: redisHeartbeat.pingMs ?? 0,
          guildCount: redisHeartbeat.guildCount ?? 0,
          uptimeSeconds: Math.floor(process.uptime()),
          memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          eventThroughputPerSec: 0,
        },
      ];
      cluster = {
        clusterId: 1,
        clusterName: 'Cluster-Alpha (Redis Synced Worker)',
        totalShards: 1,
        mode: 'CLUSTERED_MULTI_WORKER',
        workerPid: process.pid,
        memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        cpuPercent: 0,
        averagePingMs: redisHeartbeat.pingMs ?? 0,
        status: 'OPTIMAL',
        eventLoopLagMs: 0,
        activeSockets: 1,
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
      invalidToken: env.botConfigured && !liveRunner.connected && !redisHeartbeat?.online && !restOnline,
    });

    return {
      api: 'ONLINE',
      mongodb: mongoStatus,
      redis: redisStatus,
      bot: botState,
      degradedMode: botState !== 'ONLINE' || (env.redisConfigured && redisStatus !== 'CONNECTED'),
      lastSynchronization: liveRunner.lastSlashSyncAt ?? this.lastSyncAt,
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
    };
  }

  async buildOverviewAnalytics(
    period: OverviewPeriod,
    guildId?: string,
    authorizedGuildIds?: string[]
  ): Promise<OverviewAnalyticsResponse> {
    const state = await this.getState();
    const systemHealth = await this.getSystemHealth();

    const periodHoursMap: Record<OverviewPeriod, number> = {
      '24h': 24,
      '7d': 24 * 7,
      '30d': 24 * 30,
      '90d': 24 * 90,
    };
    const hours = periodHoursMap[period];
    const nowMs = Date.now();
    const currentCutoff = nowMs - hours * 3600_000;
    const prevCutoff = nowMs - hours * 2 * 3600_000;

    const allowedSet = authorizedGuildIds ? new Set(authorizedGuildIds) : null;
    const matchesScope = (targetGuildId: string) => {
      if (guildId) return targetGuildId === guildId;
      if (allowedSet) return allowedSet.has(targetGuildId);
      return false;
    };

    const scopedIncidents = state.incidents.filter((i) => matchesScope(i.guildId));
    const currentIncidents = scopedIncidents.filter(
      (i) => new Date(i.createdAt).getTime() >= currentCutoff
    );
    const prevIncidents = scopedIncidents.filter((i) => {
      const t = new Date(i.createdAt).getTime();
      return t >= prevCutoff && t < currentCutoff;
    });

    const calcDelta = (curr: number, prev: number): number | null => {
      if (prev === 0) return null;
      return Number((((curr - prev) / prev) * 100).toFixed(1));
    };

    const isRaid = (t: SecurityIncidentRecord['threatType']) =>
      t === 'JOIN_RAID' || t === 'COORDINATED_ACTIVITY';
    const isMitigated = (s: IncidentStatus) => s === 'MITIGATED' || s === 'RESOLVED';

    const currRaids = currentIncidents.filter((i) => isRaid(i.threatType)).length;
    const prevRaids = prevIncidents.filter((i) => isRaid(i.threatType)).length;

    const currPrevented = currentIncidents.filter((i) => isMitigated(i.status)).length;
    const prevPrevented = prevIncidents.filter((i) => isMitigated(i.status)).length;

    const currSuspicious = currentIncidents.filter(
      (i) => i.threatType === 'SUSPICIOUS_ACCOUNT_WAVE' || i.threatType === 'BOT_INFILTRATION'
    ).length;
    const prevSuspicious = prevIncidents.filter(
      (i) => i.threatType === 'SUSPICIOUS_ACCOUNT_WAVE' || i.threatType === 'BOT_INFILTRATION'
    ).length;

    const currCritical = currentIncidents.filter((i) => i.riskLevel === 'CRITICAL').length;
    const prevCritical = prevIncidents.filter((i) => i.riskLevel === 'CRITICAL').length;

    const scopedQuarantines = state.quarantines.filter((q) => matchesScope(q.guildId));
    const activeQuarantined = scopedQuarantines.filter((q) => q.status === 'ACTIVE').length;
    const prevQuarantined = scopedQuarantines.filter((q) => {
      const t = new Date(q.createdAt).getTime();
      return t >= prevCutoff && t < currentCutoff;
    }).length;

    const scopedGuilds = Object.values(state.guilds).filter((g) => matchesScope(g.guildId));
    const activeGuilds = scopedGuilds.filter(
      (g) => g.protectionEnabled && g.botStatus === 'BOT_CONNECTED'
    ).length;

    const bucketCount = period === '24h' ? 8 : period === '7d' ? 7 : period === '30d' ? 10 : 12;
    const bucketMs = (hours * 3600_000) / bucketCount;
    const securityActivity = Array.from({ length: bucketCount }, (_, idx) => {
      const bucketStart = currentCutoff + idx * bucketMs;
      const bucketEnd = bucketStart + bucketMs;
      const dt = new Date(bucketEnd);
      const label =
        period === '24h'
          ? `${String(dt.getHours()).padStart(2, '0')}:00`
          : `${dt.getDate()}/${dt.getMonth() + 1}`;

      const isLastBucket = idx === bucketCount - 1;
      const inBucket = currentIncidents.filter((inc) => {
        const ts = new Date(inc.createdAt).getTime();
        return ts >= bucketStart && (isLastBucket ? ts <= bucketEnd : ts < bucketEnd);
      });

      return {
        label,
        detectedRaids: inBucket.filter((i) => isRaid(i.threatType)).length,
        preventedAttacks: inBucket.filter((i) => isMitigated(i.status)).length,
        suspiciousJoins: inBucket.filter(
          (i) =>
            i.threatType === 'SUSPICIOUS_ACCOUNT_WAVE' ||
            i.threatType === 'BOT_INFILTRATION'
        ).length,
        criticalEvents: inBucket.filter((i) => i.riskLevel === 'CRITICAL').length,
      };
    });

    const raidAttemptsCount = currentIncidents.filter((i) => isRaid(i.threatType)).length;
    const suspiciousAccountsCount = currentIncidents.filter(
      (i) => i.threatType === 'SUSPICIOUS_ACCOUNT_WAVE' || i.threatType === 'BOT_INFILTRATION'
    ).length;
    const quarantinedUsersCount = scopedQuarantines.filter(
      (q) => new Date(q.createdAt).getTime() >= currentCutoff
    ).length;

    const totalDist = Math.max(
      1,
      raidAttemptsCount + suspiciousAccountsCount + quarantinedUsersCount
    );

    const toPct = (c: number) => Number(((c / totalDist) * 100).toFixed(1));

    return {
      period,
      metrics: {
        totalRaidsDetected: {
          key: 'totalRaidsDetected',
          value: currRaids,
          deltaPercent: calcDelta(currRaids, prevRaids),
          comparisonNote: `${prevRaids} vs ${period}`,
        },
        attacksPrevented: {
          key: 'attacksPrevented',
          value: currPrevented,
          deltaPercent: calcDelta(currPrevented, prevPrevented),
          comparisonNote: `${prevPrevented} vs ${period}`,
        },
        suspiciousJoins: {
          key: 'suspiciousJoins',
          value: currSuspicious,
          deltaPercent: calcDelta(currSuspicious, prevSuspicious),
          comparisonNote: `${prevSuspicious} vs ${period}`,
        },
        criticalIncidents: {
          key: 'criticalIncidents',
          value: currCritical,
          deltaPercent: calcDelta(currCritical, prevCritical),
          comparisonNote: `${prevCritical} vs ${period}`,
        },
        usersQuarantined: {
          key: 'usersQuarantined',
          value: activeQuarantined,
          deltaPercent: calcDelta(activeQuarantined, prevQuarantined),
          comparisonNote: `${scopedQuarantines.length} registros`,
        },
        activeProtection: {
          key: 'activeProtection',
          value: activeGuilds,
          deltaPercent: null,
          comparisonNote: `${scopedGuilds.length} servidor(es)`,
        },
        globalBansApplied: {
          key: 'globalBansApplied',
          value: 0,
          deltaPercent: null,
          comparisonNote: '',
        },
        participatingServers: {
          key: 'participatingServers',
          value: 0,
          deltaPercent: null,
          comparisonNote: '',
        },
      },
      securityActivity,
      threatDistribution: [
        {
          key: 'RAID_ATTEMPTS',
          count: raidAttemptsCount,
          percentage: toPct(raidAttemptsCount),
        },
        {
          key: 'SUSPICIOUS_ACCOUNTS',
          count: suspiciousAccountsCount,
          percentage: toPct(suspiciousAccountsCount),
        },
        {
          key: 'QUARANTINED_USERS',
          count: quarantinedUsersCount,
          percentage: toPct(quarantinedUsersCount),
        },
      ],
      recentIncidents: scopedIncidents.slice(0, 20),
      systemHealth,
    };
  }

  async buildGlobalBanAnalytics(): Promise<GlobalBanAnalyticsResponse> {
    const state = await this.getState();
    const now = Date.now();
    const weekMs = 7 * 86_400_000;
    const monthAgo = now - 30 * 86_400_000;

    const active = state.globalBans.filter((b) => b.status === 'ACTIVE');
    const permanent = state.globalBans.filter((b) => b.sanctionType === 'PERMANENT');
    const temporary = state.globalBans.filter((b) => b.sanctionType === 'TEMPORARY');
    const expiringSoon = active.filter(
      (b) => b.expiresAt && new Date(b.expiresAt).getTime() - now <= weekMs
    );
    const thisMonth = state.globalBans.filter(
      (b) => new Date(b.createdAt).getTime() >= monthAgo
    );

    const activitySeries = Array.from({ length: 6 }, (_, idx) => {
      const sliceDays = 30 - idx * 5;
      const start = now - sliceDays * 86_400_000;
      const end = now - (sliceDays - 5) * 86_400_000;
      const dt = new Date(end);
      const label = `${dt.getMonth() + 1}/${dt.getDate()}`;
      return {
        label,
        created: state.globalBans.filter((b) => {
          const t = new Date(b.createdAt).getTime();
          return t >= start && t < end;
        }).length,
        revoked: state.globalBans.filter((b) => {
          if (!b.revokedAt) return false;
          const t = new Date(b.revokedAt).getTime();
          return t >= start && t < end;
        }).length,
        expired: state.globalBans.filter((b) => {
          if (b.status !== 'EXPIRED' || !b.expiresAt) return false;
          const t = new Date(b.expiresAt).getTime();
          return t >= start && t < end;
        }).length,
      };
    });

    return {
      cards: {
        totalGlobalBans: state.globalBans.length,
        activeSanctions: active.length,
        permanentBans: permanent.length,
        temporaryBans: temporary.length,
        pendingAppeals: state.appeals.filter(
          (a) => a.status === 'PENDING' || a.status === 'REVIEWING'
        ).length,
        participatingServers: Object.values(state.participatingServers).filter(
          (p) => p.globalBanEnabled
        ).length,
        expiringSoon: expiringSoon.length,
        sanctionsThisMonth: thisMonth.length,
      },
      activitySeries,
      typeBreakdown: {
        permanent: permanent.length,
        temporary: temporary.length,
      },
      appealsBreakdown: {
        pending: state.appeals.filter((a) => a.status === 'PENDING').length,
        reviewing: state.appeals.filter((a) => a.status === 'REVIEWING').length,
        approved: state.appeals.filter((a) => a.status === 'APPROVED').length,
        rejected: state.appeals.filter((a) => a.status === 'REJECTED').length,
      },
    };
  }
}

const globalForStore = globalThis as unknown as { __aegisStore?: AegisStore };
export const aegisStore = globalForStore.__aegisStore ?? new AegisStore();
if (!globalForStore.__aegisStore) {
  globalForStore.__aegisStore = aegisStore;
}
