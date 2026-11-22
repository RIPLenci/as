import crypto from 'node:crypto';
import {
  AuditLogEvent,
  PermissionFlagsBits,
  type Guild,
  type GuildAuditLogsEntry,
} from 'discord.js';
import { evaluateAntiEveryoneUpdate } from '../../../lib/aegis/additional-security';
import { executeVerifiedSanction } from '../../../lib/aegis/sanction-executor';
import { aegisTelemetry } from '../../../lib/aegis/telemetry';
import { enforceDiscordLockdown } from '../../../lib/server/discord-api';
import { aegisLogger } from '../../../lib/server/logger';
import { aegisStore } from '../../../lib/server/store';
import { recordSanctionActionToMongo } from '../../../lib/server/sync-coordinator';
import {
  buildSanctionHooks,
  inspectMemberCapability,
  tryClaimMitigation,
} from './permissions';

export async function handleGuildAuditLogEntryCreate(
  entry: GuildAuditLogsEntry,
  guild: Guild
): Promise<void> {
  const correlationId = aegisLogger.createCorrelationId('aud');
  try {
    aegisTelemetry.recordEventProcessed(guild.id);
    const state = aegisStore.getHotStateSync();
    aegisStore.ensureGuildStructures(state, guild.id, guild.name);
    if (!entry.executorId) return;
    const botUserId = guild.client.user?.id;
    if (entry.executorId === botUserId || entry.executorId === guild.ownerId) return;

    const suite = state.guildSecuritySuites[guild.id];
    const addSec = suite.additionalSecurity;
    const antiNuke = state.antiNukeConfigs[guild.id];
    if (antiNuke?.authorizedAdminIds.includes(entry.executorId)) return;
    if (aegisStore.isUserWhitelistedFast(guild.id, entry.executorId, 'ANTI_NUKE')) return;

    if (
      addSec.antiEveryonePerms &&
      entry.action === AuditLogEvent.RoleUpdate &&
      entry.targetId === guild.id
    ) {
      const dangerousCheck = evaluateAntiEveryoneUpdate(addSec, {
        isEveryoneRole: true,
        addedDangerousPermissions: ['PrivilegeEscalationCheck'],
      });
      const everyoneRole = guild.roles.everyone;
      const dangerousBits =
        PermissionFlagsBits.Administrator |
        PermissionFlagsBits.ManageGuild |
        PermissionFlagsBits.ManageChannels |
        PermissionFlagsBits.ManageRoles |
        PermissionFlagsBits.BanMembers |
        PermissionFlagsBits.KickMembers |
        PermissionFlagsBits.ManageWebhooks;
      if (dangerousCheck.triggered && everyoneRole.permissions.any(dangerousBits)) {
        await everyoneRole
          .setPermissions(
            everyoneRole.permissions.remove(dangerousBits),
            'AEGIS Anti Everyone Permisos: Privilegios peligrosos revertidos'
          )
          .catch((err) => {
            aegisLogger.warn('PERMISSIONS', 'Failed reverting @everyone dangerous permissions', {
              guildId: guild.id,
              correlationId,
              meta: { error: err instanceof Error ? err.message : String(err) },
            });
          });
        if (tryClaimMitigation(`everyone:${guild.id}:${entry.executorId}`, 4000)) {
          const actor = await guild.members.fetch(entry.executorId).catch(() => null);
          if (actor) {
            const sanction = await executeVerifiedSanction({
              correlationId,
              idempotencyKey: `everyone:${guild.id}:${entry.executorId}`,
              guildId: guild.id,
              requestedAction: 'TIMEOUT',
              timeoutDurationMs: 12 * 3600_000,
              reason: 'AEGIS Anti Everyone Permisos',
              capability: inspectMemberCapability(actor, botUserId),
              hooks: buildSanctionHooks(actor),
            });
            aegisStore.recordSanctionOutcome(state, guild.id, sanction);
            void recordSanctionActionToMongo(sanction);
          }
        }
        aegisStore.scheduleHotCommit('security:antieveryone_reverted', guild.id, { correlationId });
      }
    }

    if (addSec.antiMassMute.enabled && entry.action === AuditLogEvent.MemberUpdate) {
      const hasTimeoutChange = entry.changes?.some(
        (ch) => ch.key === 'communication_disabled_until' && Boolean(ch.new)
      );
      if (hasTimeoutChange) {
        const muteBurst = aegisStore.joinWindow.recordAndAnalyze(
          `guild:${guild.id}:mass_mute:${entry.executorId}`,
          entry.executorId,
          60,
          addSec.antiMassMute.maxMutesPerMinute
        );
        if (
          muteBurst.thresholdExceeded &&
          tryClaimMitigation(`massmute:${guild.id}:${entry.executorId}`, 4000)
        ) {
          const actor = await guild.members.fetch(entry.executorId).catch(() => null);
          if (actor) {
            const sanction = await executeVerifiedSanction({
              correlationId,
              idempotencyKey: `massmute:${guild.id}:${entry.executorId}`,
              guildId: guild.id,
              requestedAction: 'TIMEOUT',
              timeoutDurationMs: 6 * 3600_000,
              reason: 'AEGIS Anti Mass Mute',
              capability: inspectMemberCapability(actor, botUserId),
              hooks: buildSanctionHooks(actor),
            });
            aegisStore.recordSanctionOutcome(state, guild.id, sanction);
            void recordSanctionActionToMongo(sanction);
          }
          aegisStore.scheduleHotCommit('security:antimassmute_triggered', guild.id, {
            correlationId,
          });
          return;
        }
      }
    }

    const ruleByAudit: Partial<Record<AuditLogEvent, keyof typeof suite.antiRaidModules>> = {
      [AuditLogEvent.ChannelCreate]: 'channelCreate',
      [AuditLogEvent.ChannelDelete]: 'channelDelete',
      [AuditLogEvent.ChannelUpdate]: 'channelEdit',
      [AuditLogEvent.RoleCreate]: 'roleCreate',
      [AuditLogEvent.RoleDelete]: 'roleDelete',
      [AuditLogEvent.RoleUpdate]: 'roleEdit',
      [AuditLogEvent.EmojiCreate]: 'emojiCreate',
      [AuditLogEvent.EmojiDelete]: 'emojiDelete',
      [AuditLogEvent.MemberKick]: 'memberKick',
      [AuditLogEvent.MemberBanAdd]: 'memberBan',
      [AuditLogEvent.MemberBanRemove]: 'memberUnban',
      [AuditLogEvent.WebhookCreate]: 'webhookEdit',
      [AuditLogEvent.WebhookUpdate]: 'webhookEdit',
    };
    const matchedRuleKey = ruleByAudit[entry.action];
    if (matchedRuleKey) {
      const ruleCfg = suite.antiRaidModules[matchedRuleKey];
      if (ruleCfg?.enabled) {
        const granularBurst = aegisStore.joinWindow.recordAndAnalyze(
          `guild:${guild.id}:suite:${matchedRuleKey}:${entry.executorId}`,
          entry.executorId,
          60,
          ruleCfg.actionsPerMinute
        );
        if (
          granularBurst.thresholdExceeded &&
          tryClaimMitigation(`suite:${guild.id}:${entry.executorId}`, 3000)
        ) {
          const actor =
            guild.members.cache.get(entry.executorId) ??
            (await guild.members.fetch(entry.executorId).catch(() => null));
          if (actor) {
            if (suite.punishmentAction === 'STRIP_ROLES') {
              if (actor.manageable) {
                const rolesToStrip = actor.roles.cache.filter(
                  (r) => r.editable && r.id !== guild.id
                );
                if (rolesToStrip.size > 0) {
                  await actor.roles
                    .remove(rolesToStrip, `AEGIS Anti-Raid (${matchedRuleKey})`)
                    .catch((err) => {
                      aegisLogger.warn('SANCTION', 'Failed stripping actor roles', {
                        guildId: guild.id,
                        userId: entry.executorId ?? undefined,
                        correlationId,
                        meta: { error: err instanceof Error ? err.message : String(err) },
                      });
                    });
                }
              }
            } else {
              const requested =
                suite.punishmentAction === 'BAN'
                  ? 'BAN'
                  : suite.punishmentAction === 'KICK'
                  ? 'KICK'
                  : 'QUARANTINE';
              const sanction = await executeVerifiedSanction({
                correlationId,
                idempotencyKey: `suite:${guild.id}:${matchedRuleKey}:${entry.executorId}`,
                guildId: guild.id,
                requestedAction: requested,
                timeoutDurationMs: 6 * 3600_000,
                reason: `AEGIS Anti-Raid (${matchedRuleKey})`,
                capability: inspectMemberCapability(actor, botUserId),
                hooks: buildSanctionHooks(actor),
              });
              aegisStore.recordSanctionOutcome(state, guild.id, sanction);
              void recordSanctionActionToMongo(sanction);
            }
          }
          aegisStore.scheduleHotCommit('antiraid:granular_triggered', guild.id, { correlationId });
          return;
        }
      }
    }

    if (!antiNuke?.enabled) return;

    const thresholdByAction: Partial<Record<AuditLogEvent, number>> = {
      [AuditLogEvent.ChannelDelete]: antiNuke.maxChannelDeletions,
      [AuditLogEvent.ChannelCreate]: antiNuke.maxChannelCreations,
      [AuditLogEvent.RoleDelete]: antiNuke.maxRoleMutations,
      [AuditLogEvent.RoleUpdate]: antiNuke.maxRoleMutations,
      [AuditLogEvent.MemberBanAdd]: antiNuke.maxMassBansKicks,
      [AuditLogEvent.MemberKick]: antiNuke.maxMassBansKicks,
      [AuditLogEvent.WebhookCreate]: antiNuke.maxWebhookMutations,
    };
    const threshold = thresholdByAction[entry.action];
    if (!threshold) return;

    const burst = aegisStore.joinWindow.recordAndAnalyze(
      `guild:${guild.id}:nuke:${entry.action}:${entry.executorId}`,
      entry.executorId,
      antiNuke.timeWindowSeconds,
      threshold
    );

    if (
      burst.thresholdExceeded &&
      tryClaimMitigation(`nuke:${guild.id}:${entry.executorId}`, 3000)
    ) {
      const incidentId = `INC-${new Date().getFullYear()}-${crypto
        .randomBytes(3)
        .toString('hex')
        .toUpperCase()}`;
      const actionsTaken: string[] = [];

      const executorMember =
        guild.members.cache.get(entry.executorId) ??
        (await guild.members.fetch(entry.executorId).catch(() => null));
      if (executorMember) {
        if (antiNuke.autoResponse.stripDangerousPermissions && executorMember.manageable) {
          const dangerousFlags =
            PermissionFlagsBits.Administrator |
            PermissionFlagsBits.ManageGuild |
            PermissionFlagsBits.ManageChannels |
            PermissionFlagsBits.ManageRoles |
            PermissionFlagsBits.BanMembers |
            PermissionFlagsBits.KickMembers |
            PermissionFlagsBits.ManageWebhooks;
          const dangerousRoles = executorMember.roles.cache.filter(
            (r) => r.editable && r.permissions.any(dangerousFlags)
          );
          if (dangerousRoles.size > 0) {
            await executorMember.roles
              .remove(dangerousRoles, `AEGIS Anti-Nuke ${incidentId}`)
              .then(() => actionsTaken.push('PERMISSIONS_STRIPPED'))
              .catch((err) => {
                aegisLogger.warn('SANCTION', 'Anti-Nuke role strip failed', {
                  guildId: guild.id,
                  userId: entry.executorId ?? undefined,
                  correlationId,
                  meta: { error: err instanceof Error ? err.message : String(err) },
                });
              });
          }
        }
        if (antiNuke.autoResponse.quarantineExecutor) {
          const sanction = await executeVerifiedSanction({
            correlationId,
            idempotencyKey: `nuke:${guild.id}:${entry.executorId}`,
            guildId: guild.id,
            requestedAction: 'QUARANTINE',
            timeoutDurationMs: 6 * 3600_000,
            reason: `AEGIS Anti-Nuke Containment ${incidentId}`,
            capability: inspectMemberCapability(executorMember, botUserId),
            hooks: buildSanctionHooks(executorMember),
          });
          aegisStore.recordSanctionOutcome(state, guild.id, sanction);
          void recordSanctionActionToMongo(sanction);
          if (sanction.status === 'SUCCESS') {
            actionsTaken.push('EXECUTOR_QUARANTINED');
          }
        }
      }

      if (antiNuke.autoResponse.triggerLockdown && state.lockdowns[guild.id]) {
        const lockdownState = state.lockdowns[guild.id];
        lockdownState.active = true;
        lockdownState.mode = 'AUTOMATIC';
        lockdownState.reason = `Auto-Lockdown Anti-Nuke (${incidentId})`;
        lockdownState.activatedAt = new Date().toISOString();
        actionsTaken.push('LOCKDOWN_ACTIVATED');
        try {
          const syncRes = await enforceDiscordLockdown({
            guildId: guild.id,
            active: true,
            reason: lockdownState.reason,
            restrictions: lockdownState.restrictions,
            previousSnapshots: lockdownState.snapshots,
          });
          lockdownState.affectedChannelCount = syncRes.affectedChannelCount;
          lockdownState.snapshots = syncRes.snapshots;
        } catch (lockErr) {
          aegisLogger.error('SANCTION', 'Auto-Lockdown enforcement failed during Anti-Nuke', {
            guildId: guild.id,
            correlationId,
            meta: { error: lockErr instanceof Error ? lockErr.message : String(lockErr) },
          });
        }
      }

      aegisStore.pushIncident(state, {
        id: incidentId,
        guildId: guild.id,
        guildName: guild.name,
        threatType:
          entry.action === AuditLogEvent.WebhookCreate
            ? 'WEBHOOK_ABUSE'
            : entry.action === AuditLogEvent.MemberBanAdd ||
              entry.action === AuditLogEvent.MemberKick
            ? 'MASS_BAN_KICK'
            : entry.action === AuditLogEvent.RoleDelete ||
              entry.action === AuditLogEvent.RoleUpdate
            ? 'MASS_ROLE_MUTATION'
            : 'MASS_CHANNEL_DELETE',
        riskScore: 95,
        riskLevel: 'CRITICAL',
        affectedUserId: entry.executorId,
        affectedUsername: executorMember?.user.username ?? entry.executorId,
        responsibleUserId: entry.executorId,
        responsibleUsername: executorMember?.user.username ?? entry.executorId,
        appliedAction: actionsTaken[0] || 'ALERT',
        status: actionsTaken.length > 0 ? 'MITIGATED' : 'OPEN',
        assignedTo: null,
        evidenceSummary: `Anti-Nuke activado: ${burst.countInWindow} acciones (límite ${threshold}) en ${antiNuke.timeWindowSeconds}s. Acciones: ${actionsTaken.join(', ') || 'ALERT_ONLY'}.`,
        signals: [],
        comments: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      aegisStore.scheduleHotCommit('antinuke:triggered', guild.id, { incidentId, correlationId });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    aegisTelemetry.recordError(guild.id, msg);
    aegisLogger.error('ANTIRAID', 'AuditLog handler error', {
      guildId: guild.id,
      correlationId,
      meta: { error: msg },
    });
  }
}
