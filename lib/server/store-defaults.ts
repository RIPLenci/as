import path from 'node:path';
import type {
  AntiNukeConfigRecord,
  AntiRaidConfigRecord,
  AuditLogRecord,
  BotPermissionGrantRecord,
  ChannelWhitelistRecord,
  DiscordAccountRecord,
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
  LockdownStateRecord,
  NotificationRecord,
  PremiumCodeRecord,
  QuarantineEntryRecord,
  RiskAssessmentRecord,
  SecondaryOwnerRecord,
  SecurityEventRecord,
  SecurityIncidentRecord,
  SlashCommandDefinition,
  SystemSettingsRecord,
  UserPremiumSubscription,
  UserRecord,
  UserTwoFactorRecord,
  WhitelistEntryRecord,
} from '../aegis/types';
import { buildFreeGuildPlan, buildPlanQuotas, normalizePlanTier } from '../aegis/premium';
import { DEFAULT_RISK_WEIGHTS } from '../aegis/risk-engine';
import { dedupePreserveOrder, stripUnsafeKeys } from '../aegis/security-helpers';

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
  userGuildAccess: Record<string, string[]>;
  userGuildRoster: Record<string, GuildRecord[]>;
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

export const DATA_DIR = path.join(process.cwd(), '.aegis-data');
export const DATA_FILE = path.join(DATA_DIR, 'store.json');
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
      { name: 'modo', description: '⚡ | Cambiar el modo de sensibilidad (Observación, Solo Alerta, Normal, Estricto o Emergencia)', optionsCount: 1 },
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

export function normalizeLoadedState(loaded: PersistedDatabaseState): PersistedDatabaseState {
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

export function initializeGuildDefaults(
  state: PersistedDatabaseState,
  guildId: string,
  guildName: string
): void {
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
      threatsInvestigated: 0,
      actionsAttempted: 0,
      actionsSucceeded: 0,
      actionsFailed: 0,
      actionsCancelled: 0,
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
}
