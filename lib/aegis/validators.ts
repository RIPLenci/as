import { z } from 'zod';

const discordSnowflakeSchema = z
  .string()
  .trim()
  .regex(/^\d{17,20}$/, 'Must be a valid Discord Snowflake ID (17-20 digits)');

export const antiRaidPatchSchema = z.object({
  enabled: z.boolean().optional(),
  mode: z.enum(['NORMAL', 'STRICT', 'EMERGENCY']).optional(),
  sensitivity: z.enum(['LOW', 'BALANCED', 'HIGH', 'MAXIMUM']).optional(),
  maxJoins: z.number().int().min(2).max(200).optional(),
  timeWindowSeconds: z.number().int().min(2).max(300).optional(),
  minAccountAgeDays: z.number().int().min(0).max(365).optional(),
  suspiciousAccountDetection: z.boolean().optional(),
  botJoinDetection: z.boolean().optional(),
  joinPatternDetection: z.boolean().optional(),
  burstDetection: z.boolean().optional(),
  riskThreshold: z.number().int().min(10).max(100).optional(),
  defaultAction: z.enum(['LOG_ONLY', 'ALERT', 'QUARANTINE', 'TIMEOUT', 'KICK', 'BAN']).optional(),
  riskRules: z
    .array(
      z.object({
        level: z.enum(['LOW', 'MODERATE', 'HIGH', 'CRITICAL']),
        action: z.enum(['LOG_ONLY', 'ALERT', 'QUARANTINE', 'TIMEOUT', 'KICK', 'BAN']),
        notifyAlertChannel: z.boolean(),
      })
    )
    .optional(),
  riskWeights: z
    .object({
      accountAge: z.number().min(0).max(100),
      joinPattern: z.number().min(0).max(100),
      eventVolume: z.number().min(0).max(100),
      repetitiveBehavior: z.number().min(0).max(100),
      globalBanMatch: z.number().min(0).max(100),
    })
    .optional(),
  alertChannelId: discordSnowflakeSchema.nullable().optional(),
  alertChannelName: z.string().trim().max(100).nullable().optional(),
  quarantineRoleId: discordSnowflakeSchema.nullable().optional(),
  quarantineRoleName: z.string().trim().max(100).nullable().optional(),
  alertBatchIntervalSeconds: z.number().int().min(5).max(300).optional(),
  deduplicateAlerts: z.boolean().optional(),
  minAlertSeverity: z.enum(['LOW', 'MODERATE', 'HIGH', 'CRITICAL']).optional(),
});

export const antiNukePatchSchema = z.object({
  enabled: z.boolean().optional(),
  maxChannelDeletions: z.number().int().min(1).max(50).optional(),
  maxChannelCreations: z.number().int().min(1).max(50).optional(),
  maxRoleMutations: z.number().int().min(1).max(50).optional(),
  maxMassBansKicks: z.number().int().min(1).max(50).optional(),
  maxWebhookMutations: z.number().int().min(1).max(30).optional(),
  timeWindowSeconds: z.number().int().min(5).max(300).optional(),
  detectDangerousPermissionChanges: z.boolean().optional(),
  authorizedAdminIds: z.array(discordSnowflakeSchema).max(50).optional(),
  autoResponse: z
    .object({
      logEvent: z.boolean(),
      sendAlert: z.boolean(),
      stripDangerousPermissions: z.boolean(),
      quarantineExecutor: z.boolean(),
      triggerLockdown: z.boolean(),
    })
    .optional(),
});

export const quarantineCreateSchema = z.object({
  guildId: discordSnowflakeSchema,
  discordId: discordSnowflakeSchema,
  username: z.string().trim().min(2).max(64),
  reason: z.string().trim().min(4).max(300),
  riskScore: z.number().int().min(0).max(100).default(75),
  durationHours: z.number().int().min(1).max(720).nullable().optional(),
});

export const quarantinePatchSchema = z.object({
  action: z.enum(['RELEASE', 'EXTEND']),
  durationHours: z.number().int().min(1).max(720).optional(),
});

export const lockdownActionSchema = z.object({
  action: z.enum(['ACTIVATE', 'DEACTIVATE']),
  mode: z.enum(['MANUAL', 'AUTOMATIC']).default('MANUAL'),
  reason: z.string().trim().min(3).max(240).optional(),
  durationMinutes: z.number().int().min(1).max(1440).nullable().optional(),
  restrictions: z
    .object({
      lockSendMessages: z.boolean(),
      lockAddReactions: z.boolean(),
      lockCreateThreads: z.boolean(),
      lockVoiceConnect: z.boolean(),
      disableInvites: z.boolean(),
    })
    .optional(),
});

export const whitelistCreateSchema = z.object({
  targetId: discordSnowflakeSchema,
  targetName: z.string().trim().min(2).max(80),
  targetType: z.enum(['USER', 'ROLE', 'BOT', 'EXCEPTION']),
  reason: z.string().trim().min(4).max(240),
  excludedRules: z
    .array(
      z.enum(['JOIN_BURST', 'ACCOUNT_AGE', 'BOT_DETECTION', 'ANTI_NUKE', 'LOCKDOWN_BYPASS'])
    )
    .min(1, 'At least one specific rule exclusion must be selected'),
  expiresAt: z.string().datetime().nullable().optional(),
});

export const incidentPatchSchema = z.object({
  status: z
    .enum(['OPEN', 'INVESTIGATING', 'MITIGATED', 'RESOLVED', 'FALSE_POSITIVE'])
    .optional(),
  assignedTo: z.string().trim().max(80).nullable().optional(),
  comment: z.string().trim().min(2).max(600).optional(),
});

export const globalBanCreateSchema = z
  .object({
    discordId: discordSnowflakeSchema,
    username: z.string().trim().min(2).max(64).default('unknown_user'),
    reason: z.string().trim().min(5).max(200),
    description: z.string().trim().min(10).max(1200),
    category: z.enum([
      'COORDINATED_RAID',
      'NUKE_ATTACK',
      'TOKEN_ABUSE',
      'MALICIOUS_AUTOMATION',
      'PHISHING_CAMPAIGN',
      'NETWORK_THREAT',
    ]),
    severity: z.enum(['LOW', 'MODERATE', 'HIGH', 'CRITICAL']),
    sanctionType: z.enum(['PERMANENT', 'TEMPORARY']),
    evidence: z.string().trim().min(8).max(1500),
    durationDays: z.number().int().min(1).max(3650).nullable().optional(),
    reinforcedAuthorizationConfirmed: z.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    if (data.sanctionType === 'TEMPORARY' && (!data.durationDays || data.durationDays < 1)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Temporary sanctions require a valid duration in days',
        path: ['durationDays'],
      });
    }
    if (data.sanctionType === 'PERMANENT' && !data.reinforcedAuthorizationConfirmed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Permanent Global Bans require reinforced authorization review',
        path: ['reinforcedAuthorizationConfirmed'],
      });
    }
  });

export const globalBanRevokeSchema = z.object({
  reason: z.string().trim().min(6).max(300),
  confirmed: z.literal(true),
});

export const appealCreateSchema = z.object({
  banId: z.string().trim().min(3).max(40),
  appellantDiscordId: discordSnowflakeSchema,
  appellantUsername: z.string().trim().min(2).max(64),
  reason: z.string().trim().min(15).max(1500),
  evidence: z.string().trim().min(5).max(1500),
});

export const appealPatchSchema = z.object({
  status: z.enum(['REVIEWING', 'APPROVED', 'REJECTED']),
  reviewNotes: z.string().trim().min(4).max(800),
});

export const participatingServerPatchSchema = z.object({
  guildId: discordSnowflakeSchema,
  globalBanEnabled: z.boolean(),
  enforcementMode: z.enum(['AUTO_BAN', 'QUARANTINE_AND_ALERT', 'ALERT_ONLY']),
  actionPolicy: z.enum(['BAN_ON_JOIN', 'QUARANTINE_ON_JOIN', 'NOTIFY_STAFF']),
  notificationChannelId: discordSnowflakeSchema.nullable().optional(),
});

export const globalModeratorCreateSchema = z
  .object({
    discordId: discordSnowflakeSchema,
    username: z.string().trim().min(2).max(64),
    role: z.enum(['GLOBAL_ADMINISTRATOR', 'GLOBAL_MODERATOR']),
    allowedActions: z
      .array(
        z.enum([
          'overview:read',
          'antiraid:read',
          'antiraid:write',
          'lockdown:manage',
          'quarantine:manage',
          'globalban:read',
          'globalban:create',
          'globalban:revoke',
          'appeals:manage',
          'logs:read',
          'moderators:manage',
        ])
      )
      .min(1),
  })
  .superRefine((data, ctx) => {
    if (data.role === 'GLOBAL_MODERATOR') {
      const modCeiling = new Set([
        'overview:read',
        'antiraid:read',
        'globalban:read',
        'globalban:create',
        'appeals:manage',
        'logs:read',
      ]);
      const disallowed = data.allowedActions.filter((a) => !modCeiling.has(a));
      if (disallowed.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `GLOBAL_MODERATOR cannot hold privileged actions: ${disallowed.join(', ')}`,
          path: ['allowedActions'],
        });
      }
    }
  });

export const userPreferencesPatchSchema = z.object({
  language: z.enum(['es', 'en']).optional(),
  theme: z.enum(['dark', 'light', 'system']).optional(),
});

const antiRaidRateRulePatch = z.object({
  enabled: z.boolean().optional(),
  actionsPerMinute: z.number().int().min(1).max(60).optional(),
});

export const securitySuitePatchSchema = z.object({
  punishmentAction: z.enum(['STRIP_ROLES', 'QUARANTINE', 'KICK', 'BAN']).optional(),
  antiRaidModules: z
    .object({
      channelCreate: antiRaidRateRulePatch.optional(),
      channelDelete: antiRaidRateRulePatch.optional(),
      channelEdit: antiRaidRateRulePatch.optional(),
      roleCreate: antiRaidRateRulePatch.optional(),
      roleDelete: antiRaidRateRulePatch.optional(),
      roleEdit: antiRaidRateRulePatch.optional(),
      emojiCreate: antiRaidRateRulePatch.optional(),
      emojiDelete: antiRaidRateRulePatch.optional(),
      memberKick: antiRaidRateRulePatch.optional(),
      memberBan: antiRaidRateRulePatch.optional(),
      memberUnban: antiRaidRateRulePatch.optional(),
      webhookEdit: antiRaidRateRulePatch.optional(),
    })
    .optional(),
  additionalSecurity: z
    .object({
      banMaliciousUsers: z.boolean().optional(),
      antiFlood: z
        .object({
          enabled: z.boolean().optional(),
          maxMessages: z.number().int().min(2).max(50).optional(),
          windowSeconds: z.number().int().min(1).max(60).optional(),
          muteMinutes: z.number().int().min(1).max(10080).optional(),
        })
        .optional(),
      antiScam: z
        .object({
          enabled: z.boolean().optional(),
          muteMinutes: z.number().int().min(1).max(10080).optional(),
          deleteMessage: z.boolean().optional(),
        })
        .optional(),
      antiEveryonePerms: z.boolean().optional(),
      antiWebhookSpam: z.boolean().optional(),
      antiMassMute: z
        .object({
          enabled: z.boolean().optional(),
          maxMutesPerMinute: z.number().int().min(1).max(50).optional(),
        })
        .optional(),
      antiAlts: z
        .object({
          enabled: z.boolean().optional(),
          minAccountAgeDays: z.number().int().min(1).max(730).optional(),
        })
        .optional(),
      antiBots: z.enum(['DISABLED', 'UNVERIFIED_ONLY', 'BAN_ALL']).optional(),
      antiInvites: z.boolean().optional(),
      antiLinks: z
        .object({
          enabled: z.boolean().optional(),
          allowedDomains: z.array(z.string().trim().min(3).max(120)).max(50).optional(),
        })
        .optional(),
    })
    .optional(),
});

export const botPermissionCreateSchema = z.object({
  targetType: z.enum(['USER', 'ROLE']),
  targetId: discordSnowflakeSchema,
  targetName: z.string().trim().min(1).max(80),
  permissions: z
    .array(z.enum(['BAN', 'UNBAN', 'MUTE', 'UNMUTE', 'CLEAR_MESSAGES', 'KICK']))
    .min(1, 'At least one bot permission must be selected'),
  rateLimitActions: z.number().int().min(1).max(100).default(5),
  rateLimitWindowMinutes: z.number().int().min(1).max(1440).default(10),
});

export const channelWhitelistCreateSchema = z.object({
  channelId: discordSnowflakeSchema,
  channelName: z.string().trim().min(1).max(80),
  reason: z.string().trim().min(2).max(200),
});

export const verificationPatchSchema = z.object({
  enabled: z.boolean().optional(),
  mode: z.enum(['BUTTON', 'CAPTCHA', 'REACTION', 'STRICT_2FA']).optional(),
  channelId: discordSnowflakeSchema.nullable().optional(),
  channelName: z.string().trim().max(100).nullable().optional(),
  verifiedRoleId: discordSnowflakeSchema.nullable().optional(),
  verifiedRoleName: z.string().trim().max(100).nullable().optional(),
  unverifiedRoleId: discordSnowflakeSchema.nullable().optional(),
  blockSuspiciousAccounts: z.boolean().optional(),
  kickUnverifiedAfterMinutes: z.number().int().min(5).max(10080).nullable().optional(),
  panelTitle: z.string().trim().min(2).max(120).optional(),
  panelDescription: z.string().trim().min(4).max(500).optional(),
});

export const logConfigPatchSchema = z.object({
  channelId: discordSnowflakeSchema.nullable().optional(),
  channelName: z.string().trim().max(100).nullable().optional(),
  events: z
    .object({
      moderation: z.boolean(),
      antiRaid: z.boolean(),
      antiNuke: z.boolean(),
      verification: z.boolean(),
      backups: z.boolean(),
    })
    .optional(),
});

export const backupActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('CREATE'),
    name: z.string().trim().min(2).max(80),
  }),
  z.object({
    action: z.literal('SET_SCHEDULE'),
    schedule: z.enum(['OFF', 'AUTO', 'DAILY', 'WEEKLY']),
  }),
  z.object({
    action: z.literal('RESTORE'),
    backupId: z.string().trim().min(3).max(80),
  }),
]);

export const secondaryOwnerPutSchema = z.object({
  discordId: discordSnowflakeSchema,
  username: z.string().trim().min(2).max(64),
  note: z.string().trim().max(200).default(''),
});

export const premiumActionSchema = z.object({
  action: z.enum(['ASSIGN_SLOT', 'RELEASE_SLOT']),
  targetGuildId: discordSnowflakeSchema.optional(),
});

export const premiumRedeemSchema = z.object({
  code: z.string().trim().min(4).max(64),
});

export const premiumStaffGrantSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('GRANT'),
    discordId: discordSnowflakeSchema,
    username: z.string().trim().min(1).max(64).optional(),
    tier: z.enum(['ORO', 'DIAMANTE']),
    duration: z.string().trim().min(2).max(40),
  }),
  z.object({
    action: z.literal('REVOKE'),
    discordId: discordSnowflakeSchema,
  }),
  z.object({
    action: z.literal('CREATE_CODE'),
    tier: z.enum(['ORO', 'DIAMANTE']),
    duration: z.string().trim().min(2).max(40),
    maxUses: z.number().int().min(1).max(500).default(1),
    customCode: z.string().trim().min(4).max(40).optional(),
  }),
  z.object({
    action: z.literal('REVOKE_CODE'),
    code: z.string().trim().min(4).max(40),
  }),
]);

export const twoFactorActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('INIT_SETUP') }),
  z.object({
    action: z.literal('CONFIRM_ENABLE'),
    token: z.string().trim().regex(/^\d{6}$/, 'Enter a 6-digit authenticator code'),
  }),
  z.object({
    action: z.literal('VERIFY_TOKEN'),
    token: z.string().trim().min(6).max(16),
  }),
  z.object({
    action: z.literal('DISABLE'),
    token: z.string().trim().min(6).max(16),
  }),
]);

