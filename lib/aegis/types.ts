// ==============================================================================
// AEGIS SECURITY — SHARED DOMAIN TYPES & CONTRACTS
// Strict TypeScript definitions covering all 19 persistence models & API payloads
// ==============================================================================

export type LanguageCode = 'es' | 'en';
export type ThemeMode = 'dark' | 'light' | 'system';

export type RbacRole =
  | 'OWNER'
  | 'GLOBAL_ADMINISTRATOR'
  | 'GLOBAL_MODERATOR'
  | 'SERVER_ADMINISTRATOR'
  | 'SERVER_MODERATOR'
  | 'VIEWER';

export type PermissionKey =
  | 'overview:read'
  | 'antiraid:read'
  | 'antiraid:write'
  | 'lockdown:manage'
  | 'quarantine:manage'
  | 'globalban:read'
  | 'globalban:create'
  | 'globalban:revoke'
  | 'appeals:manage'
  | 'logs:read'
  | 'moderators:manage';

export type ProtectionMode = 'NORMAL' | 'STRICT' | 'EMERGENCY';
export type RiskLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
export type AutoAction = 'LOG_ONLY' | 'ALERT' | 'QUARANTINE' | 'TIMEOUT' | 'KICK' | 'BAN';

export type IncidentStatus =
  | 'OPEN'
  | 'INVESTIGATING'
  | 'MITIGATED'
  | 'RESOLVED'
  | 'FALSE_POSITIVE';

export type ThreatType =
  | 'JOIN_RAID'
  | 'SUSPICIOUS_ACCOUNT_WAVE'
  | 'BOT_INFILTRATION'
  | 'MASS_CHANNEL_DELETE'
  | 'MASS_ROLE_MUTATION'
  | 'WEBHOOK_ABUSE'
  | 'MASS_BAN_KICK'
  | 'GLOBAL_BAN_MATCH'
  | 'COORDINATED_ACTIVITY';

export type WhitelistTargetType = 'USER' | 'ROLE' | 'BOT' | 'EXCEPTION';
export type WhitelistRuleScope =
  | 'JOIN_BURST'
  | 'ACCOUNT_AGE'
  | 'BOT_DETECTION'
  | 'ANTI_NUKE'
  | 'LOCKDOWN_BYPASS';

export type GlobalSanctionType = 'PERMANENT' | 'TEMPORARY';
export type GlobalSanctionStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'PENDING_APPEAL';
export type GlobalBanCategory =
  | 'COORDINATED_RAID'
  | 'NUKE_ATTACK'
  | 'TOKEN_ABUSE'
  | 'MALICIOUS_AUTOMATION'
  | 'PHISHING_CAMPAIGN'
  | 'NETWORK_THREAT';

export type AppealStatus = 'PENDING' | 'REVIEWING' | 'APPROVED' | 'REJECTED';
export type EnforcementMode = 'AUTO_BAN' | 'QUARANTINE_AND_ALERT' | 'ALERT_ONLY';

export type OverviewPeriod = '24h' | '7d' | '30d' | '90d';

export type GuildBotStatus =
  | 'BOT_CONNECTED'
  | 'BOT_NOT_INSTALLED'
  | 'INSUFFICIENT_PERMISSIONS';

export type ServiceHealthState =
  | 'ONLINE'
  | 'CONNECTED'
  | 'DEGRADED'
  | 'OFFLINE'
  | 'UNCONFIGURED';

// 1. Users
export interface UserRecord {
  id: string;
  discordId: string;
  username: string;
  globalName: string | null;
  avatarUrl: string | null;
  globalRole: RbacRole;
  language: LanguageCode;
  theme: ThemeMode;
  authMode: 'DISCORD_OAUTH';
  createdAt: string;
  lastLoginAt: string;
}

// 2. DiscordAccounts
export interface DiscordAccountRecord {
  discordId: string;
  username: string;
  globalName: string | null;
  avatarHash: string | null;
  scopes: string[];
  tokenExpiresAt: string | null;
  linkedAt: string;
}

// 3. Guilds
export interface GuildRecord {
  guildId: string;
  name: string;
  iconUrl: string | null;
  memberCount: number;
  memberCountKnown?: boolean;
  ownerDiscordId: string;
  userIsOwner: boolean;
  userIsSecondaryOwner?: boolean;
  userIsAdmin?: boolean;
  userHasManageGuild: boolean;
  botStatus: GuildBotStatus;
  botPermissionsOk: boolean;
  protectionEnabled: boolean;
  lastSyncAt: string | null;
  linkedAt: string | null;
}

export type ServerPriorityTier = 'OWNED' | 'ADMIN' | 'INVITE' | 'MEMBER';
export type ServerRoleTag = 'PROPIETARIO' | 'SEGUNDO DUEÑO' | 'ADMINISTRADOR' | 'MIEMBRO';

export interface ClassifiedServerItem extends GuildRecord {
  userIsSecondaryOwner?: boolean;
  priorityTier: ServerPriorityTier;
  roleTag: ServerRoleTag;
  canManage: boolean;
  canInvite: boolean;
  inviteUrl: string;
}

export interface ClassifiedServersResult {
  owned: ClassifiedServerItem[];
  admin: ClassifiedServerItem[];
  invite: ClassifiedServerItem[];
  memberConnected: ClassifiedServerItem[];
  orderedAll: ClassifiedServerItem[];
  stats: {
    total: number;
    ownedCount: number;
    adminCount: number;
    inviteCount: number;
    invitableCount: number;
    connectedCount: number;
  };
}

// 4. GuildSettings
export interface GuildSettingsRecord {
  guildId: string;
  alertChannelId: string | null;
  alertChannelName: string | null;
  quarantineRoleId: string | null;
  quarantineRoleName: string | null;
  authorizedMentionRoleIds: string[];
  alertBatchIntervalSeconds: number;
  deduplicateAlerts: boolean;
  minAlertSeverity: RiskLevel;
  updatedAt: string;
}

// 5. AntiRaidConfigs
export interface RiskActionRule {
  level: RiskLevel;
  action: AutoAction;
  notifyAlertChannel: boolean;
}

export interface RiskWeightConfig {
  accountAge: number;
  joinPattern: number;
  eventVolume: number;
  repetitiveBehavior: number;
  globalBanMatch: number;
}

export interface AntiRaidConfigRecord {
  guildId: string;
  enabled: boolean;
  activatedAt: string | null;
  mode: ProtectionMode;
  sensitivity: 'LOW' | 'BALANCED' | 'HIGH' | 'MAXIMUM';
  maxJoins: number;
  timeWindowSeconds: number;
  minAccountAgeDays: number;
  suspiciousAccountDetection: boolean;
  botJoinDetection: boolean;
  joinPatternDetection: boolean;
  burstDetection: boolean;
  riskThreshold: number;
  defaultAction: AutoAction;
  riskRules: RiskActionRule[];
  riskWeights: RiskWeightConfig;
  eventsProcessed: number;
  attacksDetected: number;
  attacksPrevented: number;
  syncVersion: number;
  lastSyncedAt: string;
}

// 6. AntiNukeConfigs
export interface AntiNukeConfigRecord {
  guildId: string;
  enabled: boolean;
  maxChannelDeletions: number;
  maxChannelCreations: number;
  maxRoleMutations: number;
  maxMassBansKicks: number;
  maxWebhookMutations: number;
  timeWindowSeconds: number;
  detectDangerousPermissionChanges: boolean;
  authorizedAdminIds: string[];
  autoResponse: {
    logEvent: boolean;
    sendAlert: boolean;
    stripDangerousPermissions: boolean;
    quarantineExecutor: boolean;
    triggerLockdown: boolean;
  };
  updatedAt: string;
}

// 7. RiskAssessments
export interface RiskSignalContribution {
  signal: keyof RiskWeightConfig | 'botFlag';
  label: string;
  rawScore: number;
  weight: number;
  weightedPoints: number;
  evidence: string;
}

export interface RiskAssessmentRecord {
  id: string;
  guildId: string;
  targetDiscordId: string;
  targetUsername: string;
  score: number;
  level: RiskLevel;
  signals: RiskSignalContribution[];
  recommendedAction: AutoAction;
  safeguardApplied: string | null;
  evaluatedAt: string;
}

// 8. SecurityIncidents
export interface IncidentComment {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: string;
}

export interface SecurityIncidentRecord {
  id: string;
  guildId: string;
  guildName: string;
  threatType: ThreatType;
  riskScore: number;
  riskLevel: RiskLevel;
  affectedUserId: string;
  affectedUsername: string;
  responsibleUserId: string | null;
  responsibleUsername: string | null;
  appliedAction: string;
  status: IncidentStatus;
  assignedTo: string | null;
  evidenceSummary: string;
  signals: RiskSignalContribution[];
  comments: IncidentComment[];
  createdAt: string;
  updatedAt: string;
}

// 9. SecurityEvents (Real-Time Stream)
export interface SecurityEventRecord {
  id: string;
  guildId: string;
  guildName: string;
  eventType: string;
  threatType: ThreatType;
  targetDiscordId: string;
  targetUsername: string;
  riskScore: number;
  riskLevel: RiskLevel;
  actionTaken: string;
  status: 'PROCESSED' | 'MITIGATED' | 'FLAGGED' | 'LOGGED';
  createdAt: string;
}

// 10. QuarantineEntries
export interface QuarantineEntryRecord {
  id: string;
  guildId: string;
  guildName: string;
  discordId: string;
  username: string;
  avatarUrl: string | null;
  reason: string;
  riskScore: number;
  riskLevel: RiskLevel;
  incidentId: string | null;
  responsibleActor: string;
  previousRoleIds: string[];
  status: 'ACTIVE' | 'RELEASED' | 'EXPIRED';
  createdAt: string;
  expiresAt: string | null;
  releasedAt: string | null;
  releasedBy: string | null;
}

// 11. WhitelistEntries
export interface WhitelistEntryRecord {
  id: string;
  guildId: string;
  targetId: string;
  targetName: string;
  targetType: WhitelistTargetType;
  reason: string;
  excludedRules: WhitelistRuleScope[];
  authorId: string;
  authorName: string;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  createdAt: string;
  expiresAt: string | null;
}

// 12. GlobalBans
export interface GlobalBanHistoryEvent {
  id: string;
  action: 'CREATED' | 'UPDATED' | 'APPEALED' | 'REVOKED' | 'EXPIRED';
  actorId: string;
  actorName: string;
  note: string;
  timestamp: string;
}

export interface GlobalBanEvidenceFile {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
}

export interface GlobalBanRecord {
  id: string;
  discordId: string;
  username: string;
  reason: string;
  description: string;
  category: GlobalBanCategory;
  severity: RiskLevel;
  severityLabel?: 'Bajo' | 'Medio' | 'Alto' | 'Peligro';
  durationKind?: 'INDEFINITE' | 'PERMANENT';
  appealable?: boolean;
  sanctionType: GlobalSanctionType;
  evidence: string;
  evidenceFiles?: GlobalBanEvidenceFile[];
  moderatorId: string;
  moderatorName: string;
  status: GlobalSanctionStatus;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  revokeReason: string | null;
  history: GlobalBanHistoryEvent[];
}

// 13. GlobalBanAppeals
export interface GlobalBanAppealRecord {
  id: string;
  banId: string;
  appellantDiscordId: string;
  appellantUsername: string;
  reason: string;
  evidence: string;
  status: AppealStatus;
  reviewerId: string | null;
  reviewerName: string | null;
  reviewNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

// 14. GlobalModerators
export interface GlobalModeratorRecord {
  id: string;
  discordId: string;
  username: string;
  avatarUrl: string | null;
  role: 'OWNER' | 'GLOBAL_ADMINISTRATOR' | 'GLOBAL_MODERATOR';
  status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  allowedActions: PermissionKey[];
  addedBy: string;
  joinedAt: string;
}

// 15. GuildParticipation (Global Ban Network Opt-In)
export interface GuildParticipationRecord {
  guildId: string;
  guildName: string;
  globalBanEnabled: boolean;
  enforcementMode: EnforcementMode;
  actionPolicy: 'BAN_ON_JOIN' | 'QUARANTINE_ON_JOIN' | 'NOTIFY_STAFF';
  notificationChannelId: string | null;
  syncStatus: 'SYNCHRONIZED' | 'PENDING_SYNC' | 'DISABLED';
  lastSyncedAt: string;
}

// 16. AuditLogs
export interface AuditLogRecord {
  id: string;
  guildId: string | null;
  actorId: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  result: 'SUCCESS' | 'DENIED' | 'ERROR';
  metadata: Record<string, string | number | boolean | null>;
  createdAt: string;
}

// 17. Notifications
export type NotificationType =
  | 'RAID_DETECTED'
  | 'CRITICAL_INCIDENT'
  | 'PROTECTION_ENABLED'
  | 'PROTECTION_DISABLED'
  | 'LOCKDOWN_ACTIVATED'
  | 'LOCKDOWN_FINISHED'
  | 'USER_QUARANTINED'
  | 'GLOBAL_BAN_MATCH'
  | 'GLOBAL_BAN_EXPIRED'
  | 'APPEAL_SUBMITTED'
  | 'BOT_DISCONNECTED'
  | 'SERVICE_UNAVAILABLE';

export interface NotificationRecord {
  id: string;
  guildId: string | null;
  type: NotificationType;
  severity: RiskLevel;
  title: string;
  message: string;
  read: boolean;
  groupedCount: number;
  createdAt: string;
}

// 18. LockdownStates
export interface ChannelPermissionSnapshot {
  channelId: string;
  channelName: string;
  originalDenyFlags: string[];
  aegisAppliedDenyFlags: string[];
  modifiedExternallyAfterLockdown: boolean;
}

export interface LockdownStateRecord {
  guildId: string;
  active: boolean;
  mode: 'MANUAL' | 'AUTOMATIC';
  reason: string | null;
  activatedBy: string | null;
  activatedAt: string | null;
  scheduledEndAt: string | null;
  affectedChannelCount: number;
  affectedRoleIds: string[];
  restrictions: {
    lockSendMessages: boolean;
    lockAddReactions: boolean;
    lockCreateThreads: boolean;
    lockVoiceConnect: boolean;
    disableInvites: boolean;
  };
  snapshots: ChannelPermissionSnapshot[];
  lastRestoredAt: string | null;
}

// 19. SystemSettings & Infrastructure Health
export interface BotShardTelemetry {
  id: number;
  clusterId: number;
  status: 'READY' | 'CONNECTING' | 'RECONNECTING';
  pingMs: number;
  guildCount: number;
  uptimeSeconds: number;
  memoryMb: number;
  eventThroughputPerSec: number;
}

export interface BotClusterTelemetry {
  clusterId: number;
  clusterName: string;
  totalShards: number;
  mode: 'CLUSTERED_MULTI_WORKER' | 'STANDALONE_OPTIMIZED';
  workerPid: number;
  memoryMb: number;
  cpuPercent: number;
  averagePingMs: number;
  status: 'HEALTHY' | 'OPTIMAL';
  eventLoopLagMs: number;
  activeSockets: number;
  queueSize: number;
}

export interface SlashSubcommandInfo {
  name: string;
  description: string;
  optionsCount: number;
}

export interface SlashCommandDefinition {
  name: string;
  description: string;
  category: string;
  defaultMemberPermissions: string;
  subcommands: SlashSubcommandInfo[];
  status: 'DEPLOYED' | 'GLOBAL_SYNCED';
}

export interface SystemHealthSnapshot {
  api: ServiceHealthState;
  mongodb: ServiceHealthState;
  redis: ServiceHealthState;
  bot: ServiceHealthState;
  degradedMode: boolean;
  lastSynchronization: string;
  l1CacheStats: {
    entries: number;
    maxEntries: number;
    hits: number;
    misses: number;
    hitRatePercent: number;
  };
  botIdentity: {
    configured: boolean;
    tag: string | null;
    id: string | null;
    avatarUrl?: string | null;
    pingMs: number | null;
    guildCount: number | null;
    userCount?: number | null;
  };
  shards?: BotShardTelemetry[];
  cluster?: BotClusterTelemetry;
  slashCommands?: SlashCommandDefinition[];
  oauthConfigured: boolean;
}

export interface SystemSettingsRecord {
  sessionMaxAgeSeconds: number;
  requireDualApprovalForPermanentBan: boolean;
  appealCooldownHours: number;
  auditRetentionDays: number;
  updatedAt: string;
}

// Overview Analytics Contracts
export interface StatMetric {
  key: string;
  value: number;
  deltaPercent: number | null;
  comparisonNote: string;
}

export interface SecurityActivityPoint {
  label: string;
  detectedRaids: number;
  preventedAttacks: number;
  suspiciousJoins: number;
  criticalEvents: number;
}

export interface ThreatDistributionSlice {
  key: 'RAID_ATTEMPTS' | 'SUSPICIOUS_ACCOUNTS' | 'QUARANTINED_USERS' | 'GLOBAL_BAN_MATCHES';
  count: number;
  percentage: number;
}

export interface OverviewAnalyticsResponse {
  period: OverviewPeriod;
  metrics: {
    totalRaidsDetected: StatMetric;
    attacksPrevented: StatMetric;
    suspiciousJoins: StatMetric;
    criticalIncidents: StatMetric;
    usersQuarantined: StatMetric;
    activeProtection: StatMetric;
    globalBansApplied: StatMetric;
    participatingServers: StatMetric;
  };
  securityActivity: SecurityActivityPoint[];
  threatDistribution: ThreatDistributionSlice[];
  recentIncidents: SecurityIncidentRecord[];
  systemHealth: SystemHealthSnapshot;
}

export interface GlobalBanAnalyticsResponse {
  cards: {
    totalGlobalBans: number;
    activeSanctions: number;
    permanentBans: number;
    temporaryBans: number;
    pendingAppeals: number;
    participatingServers: number;
    expiringSoon: number;
    sanctionsThisMonth: number;
  };
  activitySeries: Array<{ label: string; created: number; revoked: number; expired: number }>;
  typeBreakdown: { permanent: number; temporary: number };
  appealsBreakdown: { pending: number; reviewing: number; approved: number; rejected: number };
}

// ==============================================================================
// EXTENDED GUILD SECURITY SUITE, PREMIUM, 2FA, BACKUPS & BOT PERMISSIONS
// ==============================================================================

export type PlanTier = 'FREE' | 'ORO' | 'DIAMANTE';

export interface GuildPlanQuotas {
  maxWhitelistUsers: number;
  maxWhitelistChannels: number;
  maxBotPermUsers: number;
  maxBotPermRoles: number;
  maxBackups: number;
  autoBackupDays: number;
  maxPremiumServers: number;
  maxAllowedDomains: number;
}

export interface GuildPlanRecord {
  guildId: string;
  tier: PlanTier;
  ownerUserId?: string | null;
  activatedAt: string | null;
  expiresAt: string | null;
  activatedBy: string | null;
  activationSource: 'USER_SLOT' | 'CODE_REDEEM' | 'STAFF_PANEL' | 'DISCORD_SLASH' | 'FREE_DEFAULT';
  quotas: GuildPlanQuotas;
}

export interface UserPremiumSubscription {
  discordId: string;
  username: string;
  tier: PlanTier;
  reason?: string;
  grantedAt: string | null;
  expiresAt: string | null;
  activatedGuildIds: string[];
  source: 'CODE_REDEEM' | 'STAFF_PANEL' | 'DISCORD_SLASH' | 'FREE_DEFAULT' | 'EXPIRED';
  updatedBy: string | null;
  updatedAt: string;
}

export interface PremiumCodeRecord {
  code: string;
  tier: 'ORO' | 'DIAMANTE';
  durationMs: number;
  durationLabel: string;
  maxUses: number;
  usedCount: number;
  usedByIds: string[];
  createdBy: string;
  createdAt: string;
  revoked: boolean;
}

export type AntiRaidRuleKey =
  | 'channelCreate'
  | 'channelDelete'
  | 'channelEdit'
  | 'roleCreate'
  | 'roleDelete'
  | 'roleEdit'
  | 'emojiCreate'
  | 'emojiDelete'
  | 'memberKick'
  | 'memberBan'
  | 'memberUnban'
  | 'webhookEdit';

export interface AntiRaidRateRule {
  enabled: boolean;
  actionsPerMinute: number;
  premiumOnly: boolean;
}

export type AntiBotsMode = 'DISABLED' | 'UNVERIFIED_ONLY' | 'BAN_ALL';

export interface GuildAdditionalSecurityConfig {
  banMaliciousUsers: boolean;
  antiFlood: {
    enabled: boolean;
    maxMessages: number;
    windowSeconds: number;
    muteMinutes: number;
  };
  antiScam: {
    enabled: boolean;
    muteMinutes: number;
    deleteMessage: boolean;
  };
  antiEveryonePerms: boolean;
  antiWebhookSpam: boolean;
  antiMassMute: {
    enabled: boolean;
    maxMutesPerMinute: number;
  };
  antiAlts: {
    enabled: boolean;
    minAccountAgeDays: number;
  };
  antiBots: AntiBotsMode;
  antiInvites: boolean;
  antiLinks: {
    enabled: boolean;
    allowedDomains: string[];
  };
}

export interface GuildSecuritySuiteRecord {
  guildId: string;
  punishmentAction: 'STRIP_ROLES' | 'QUARANTINE' | 'KICK' | 'BAN';
  antiRaidModules: Record<AntiRaidRuleKey, AntiRaidRateRule>;
  additionalSecurity: GuildAdditionalSecurityConfig;
  updatedAt: string;
}

export type BotCommandPermission =
  | 'BAN'
  | 'UNBAN'
  | 'MUTE'
  | 'UNMUTE'
  | 'CLEAR_MESSAGES'
  | 'KICK';

export interface BotPermissionGrantRecord {
  id: string;
  guildId: string;
  targetType: 'USER' | 'ROLE';
  targetId: string;
  targetName: string;
  permissions: BotCommandPermission[];
  rateLimitActions: number;
  rateLimitWindowMinutes: number;
  grantedBy: string;
  createdAt: string;
}

export interface ChannelWhitelistRecord {
  id: string;
  guildId: string;
  channelId: string;
  channelName: string;
  reason: string;
  addedBy: string;
  createdAt: string;
}

export interface GuildVerificationRecord {
  guildId: string;
  enabled: boolean;
  mode: 'BUTTON' | 'CAPTCHA' | 'REACTION' | 'STRICT_2FA';
  channelId: string | null;
  channelName: string | null;
  verifiedRoleId: string | null;
  verifiedRoleName: string | null;
  unverifiedRoleId: string | null;
  blockSuspiciousAccounts: boolean;
  kickUnverifiedAfterMinutes: number | null;
  panelTitle: string;
  panelDescription: string;
  updatedAt: string;
}

export interface GuildLogConfigRecord {
  guildId: string;
  channelId: string | null;
  channelName: string | null;
  events: {
    moderation: boolean;
    antiRaid: boolean;
    antiNuke: boolean;
    verification: boolean;
    backups: boolean;
  };
  updatedAt: string;
}

export interface GuildBackupRecord {
  id: string;
  guildId: string;
  guildName: string;
  name: string;
  createdBy: string;
  creatorName: string;
  createdAt: string;
  automatic: boolean;
  stats: {
    rolesCount: number;
    channelsCount: number;
    whitelistCount: number;
    botPermissionsCount: number;
  };
  snapshot: {
    antiRaidConfig: AntiRaidConfigRecord | null;
    antiNukeConfig: AntiNukeConfigRecord | null;
    securitySuite: GuildSecuritySuiteRecord | null;
    verification: GuildVerificationRecord | null;
    logConfig: GuildLogConfigRecord | null;
    roles: Array<{ id: string; name: string; color: number; permissions: string }>;
    channels: Array<{ id: string; name: string; type: number }>;
  };
}

export interface GuildBackupSettingsRecord {
  guildId: string;
  autoBackupSchedule: 'OFF' | 'AUTO' | 'DAILY' | 'WEEKLY';
  lastAutoBackupAt: string | null;
}

export interface SecondaryOwnerRecord {
  guildId: string;
  discordId: string;
  username: string;
  note: string;
  assignedBy: string;
  assignedAt: string;
}

export interface UserTwoFactorRecord {
  userId: string;
  discordId: string;
  enabled: boolean;
  secretBase32: string | null;
  pendingSecretBase32: string | null;
  recoveryCodesRemaining: number;
  recoveryCodeHashes: string[];
  enabledAt: string | null;
  lastVerifiedAt: string | null;
}

