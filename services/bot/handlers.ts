import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  AttachmentBuilder,
  AuditLogEvent,
  Client,
  Events,
  GuildMember,
  MessageFlags,
  PermissionFlagsBits,
  UserFlagsBitField,
  type ChatInputCommandInteraction,
  type Guild,
  type Interaction,
} from 'discord.js';
import { DEFAULT_RISK_WEIGHTS, evaluateJoinRisk } from '../../lib/aegis/risk-engine';
import { evaluateFastJoinMitigation } from '../../lib/aegis/fast-antiraid';
import {
  countActiveAutoModRules,
  evaluateAntiAlt,
  evaluateAntiBot,
  evaluateAntiEveryoneUpdate,
  evaluateAntiFloodBurst,
  evaluateAntiInviteMessage,
  evaluateAntiLinkMessage,
  evaluateAntiScamMessage,
} from '../../lib/aegis/additional-security';
import {
  buildPlanQuotas,
  formatDurationHuman,
  formatExactDateTime,
  isPaidTier,
  isSubscriptionActive,
  normalizePlanTier,
  parseDurationString,
} from '../../lib/aegis/premium';
import { isSuperOwner } from '../../lib/aegis/rbac';
import { getServerEnv } from '../../lib/server/env';
import { aegisStore, EVIDENCE_DIR, type PersistedDatabaseState } from '../../lib/server/store';
import {
  buildAntiRaidPanelV2,
  buildCriticalAlertV2,
  buildSimpleNoticeV2,
} from './components/v2-panels';
import { enforceDiscordLockdown } from '../../lib/server/discord-api';

export interface AttachAegisBotHandlersOptions {
  onGuildJoined?: (guildId: string, guildName: string) => Promise<void>;
}

const ATTACHED_CLIENTS = new WeakSet<Client>();
const IN_FLIGHT_MITIGATIONS = new Map<string, number>();

function tryClaimMitigation(key: string, ttlMs = 2_500): boolean {
  const now = Date.now();
  const exp = IN_FLIGHT_MITIGATIONS.get(key);
  if (exp && exp > now) return false;
  IN_FLIGHT_MITIGATIONS.set(key, now + ttlMs);
  if (IN_FLIGHT_MITIGATIONS.size > 2000) {
    for (const [k, v] of IN_FLIGHT_MITIGATIONS.entries()) {
      if (v <= now) IN_FLIGHT_MITIGATIONS.delete(k);
    }
  }
  return true;
}

export function attachAegisBotHandlers(
  client: Client,
  options: AttachAegisBotHandlersOptions = {}
): void {
  if (ATTACHED_CLIENTS.has(client)) return;
  ATTACHED_CLIENTS.add(client);

  // Instant slash registration & structure init whenever bot joins, leaves, or renames a guild
  client.on(Events.GuildCreate, async (guild) => {
    try {
      const state = await aegisStore.getState();
      aegisStore.ensureGuildStructures(state, guild.id, guild.name);
      const nowIso = new Date().toISOString();
      aegisStore.syncGuildRecord(state, guild.id, {
        name: guild.name,
        iconUrl: guild.iconURL({ size: 256 }),
        ownerDiscordId: guild.ownerId,
        botStatus: 'BOT_CONNECTED',
        botPermissionsOk: true,
        memberCount: guild.memberCount,
        memberCountKnown: typeof guild.memberCount === 'number' && guild.memberCount > 0,
        lastSyncAt: nowIso,
        linkedAt: nowIso,
      });
      await aegisStore.commitMutation('guild:bot_joined', guild.id, { guildName: guild.name });
      if (options.onGuildJoined) {
        await options.onGuildJoined(guild.id, guild.name);
      }
    } catch (err) {
      console.error('[AEGIS BOT] GuildCreate handler error:', err);
    }
  });

  client.on(Events.GuildDelete, async (guild) => {
    try {
      const state = await aegisStore.getState();
      const nowIso = new Date().toISOString();
      aegisStore.syncGuildRecord(state, guild.id, {
        botStatus: 'BOT_NOT_INSTALLED',
        botPermissionsOk: false,
        protectionEnabled: false,
        lastSyncAt: nowIso,
      });
      if (state.antiRaidConfigs[guild.id]) {
        state.antiRaidConfigs[guild.id].enabled = false;
        state.antiRaidConfigs[guild.id].syncVersion += 1;
      }
      await aegisStore.commitMutation('guild:bot_disconnected', guild.id);
    } catch (err) {
      console.error('[AEGIS BOT] GuildDelete handler error:', err);
    }
  });

  client.on(Events.GuildUpdate, async (_oldGuild, newGuild) => {
    try {
      const state = await aegisStore.getState();
      aegisStore.syncGuildRecord(state, newGuild.id, {
        name: newGuild.name,
        iconUrl: newGuild.iconURL({ size: 256 }),
        ownerDiscordId: newGuild.ownerId,
        lastSyncAt: new Date().toISOString(),
      });
      await aegisStore.commitMutation('guild:updated', newGuild.id, { guildName: newGuild.name });
    } catch (err) {
      console.error('[AEGIS BOT] GuildUpdate handler error:', err);
    }
  });

  // High-speed GuildMemberAdd Protection (Global Ban + Seguridad Adicional + Anti-Raid)
  client.on(Events.GuildMemberAdd, async (member: GuildMember) => {
    try {
      const guildId = member.guild.id;
      const state = aegisStore.getHotStateSync();
      aegisStore.ensureGuildStructures(state, guildId, member.guild.name);
      const suite = state.guildSecuritySuites[guildId];
      const addSec = suite.additionalSecurity;

      // 1. O(1) Globalban check across ALL servers (DM user BEFORE banning + ban + DM server owner)
      const activeBan = aegisStore.getHotGlobalBan(member.id);
      if (activeBan && tryClaimMitigation(`globalban:${guildId}:${member.id}`, 5000)) {
        const tiempoLabel =
          activeBan.durationKind === 'INDEFINITE'
            ? 'Indefinido'
            : activeBan.sanctionType === 'TEMPORARY' && activeBan.expiresAt
            ? `Temporal (hasta ${formatExactDateTime(activeBan.expiresAt, 'es')})`
            : 'Permanente';
        const gravedadLabel =
          activeBan.severityLabel ||
          (activeBan.severity === 'CRITICAL'
            ? 'Peligro'
            : activeBan.severity === 'HIGH'
            ? 'Alto'
            : activeBan.severity === 'MODERATE'
            ? 'Medio'
            : 'Bajo');
        const apelableLabel = activeBan.appealable === false ? 'No' : 'Sí';

        const evidenceAttachments: AttachmentBuilder[] = [];
        for (const evFile of (activeBan.evidenceFiles ?? []).slice(0, 5)) {
          const safeName = path.basename(evFile.filename);
          const absPath = path.join(EVIDENCE_DIR, activeBan.id, safeName);
          if (fs.existsSync(absPath)) {
            evidenceAttachments.push(new AttachmentBuilder(absPath, { name: safeName }));
          }
        }

        const dmNotice = buildSimpleNoticeV2(
          'AEGIS SECURITY — NOTIFICACIÓN DE GLOBALBAN',
          [
            `Has sido expulsado/baneado automáticamente de **${member.guild.name}** por encontrarte registrado en el sistema Globalban de AEGIS SECURITY.`,
            `**ID de Usuario:** ${activeBan.discordId}`,
            `**ID de Sanción:** ${activeBan.id}`,
            `**Motivo:** ${activeBan.reason}`,
            `**Tiempo:** ${tiempoLabel}`,
            `**Gravedad:** ${gravedadLabel}`,
            `**Apelable:** ${apelableLabel}`,
            `**Fecha de Sanción:** ${formatExactDateTime(activeBan.createdAt, 'es')}`,
            activeBan.evidence ? `**Detalle de Evidencia:** ${activeBan.evidence}` : '',
            evidenceAttachments.length > 0
              ? `**Archivos adjuntos:** ${evidenceAttachments.length} imagen(es) de evidencia.`
              : '',
          ].filter(Boolean),
          0xef4444
        );

        // Step A: DM the sanctioned user BEFORE banning (Discord blocks DMs once no mutual guild remains)
        await Promise.race([
          member.user
            .send({
              ...dmNotice,
              files: evidenceAttachments,
            })
            .catch(() => undefined),
          new Promise((resolve) => setTimeout(resolve, 2000)),
        ]);

        // Step B: Ban user immediately from this server
        if (member.bannable) {
          await member
            .ban({
              reason: `AEGIS Globalban (${activeBan.id}) | Gravedad: ${gravedadLabel} | Motivo: ${activeBan.reason}`.slice(
                0,
                500
              ),
            })
            .catch(() => undefined);
        }

        // Step C: DM the Server Owner explaining why the user was expelled/banned
        member.guild
          .fetchOwner()
          .then((owner) =>
            owner.user
              .send(
                buildSimpleNoticeV2(
                  'AEGIS SECURITY — EXPULSIÓN AUTOMÁTICA POR GLOBALBAN',
                  [
                    `El sistema Globalban detectó e impidió el ingreso de un usuario sancionado en tu servidor **${member.guild.name}**.`,
                    `**Usuario Expulsado:** ${member.user.username} (${member.id})`,
                    `**ID de Sanción:** ${activeBan.id}`,
                    `**Motivo del Globalban:** ${activeBan.reason}`,
                    `**Tiempo:** ${tiempoLabel}`,
                    `**Gravedad:** ${gravedadLabel}`,
                    `**Apelable:** ${apelableLabel}`,
                    `**Acción Aplicada:** Baneo automático al ingresar`,
                  ],
                  0xef4444
                )
              )
              .catch(() => undefined)
          )
          .catch(() => undefined);

        const incidentId = `INC-${new Date().getFullYear()}-${crypto
          .randomBytes(3)
          .toString('hex')
          .toUpperCase()}`;
        aegisStore.pushIncident(state, {
          id: incidentId,
          guildId,
          guildName: member.guild.name,
          threatType: 'GLOBAL_BAN_MATCH',
          riskScore: 100,
          riskLevel: 'CRITICAL',
          affectedUserId: member.id,
          affectedUsername: member.user.username,
          responsibleUserId: activeBan.moderatorId,
          responsibleUsername: activeBan.moderatorName,
          appliedAction: 'BAN',
          status: 'MITIGATED',
          assignedTo: null,
          evidenceSummary: `Globalban ${activeBan.id} (${gravedadLabel}, ${tiempoLabel}): ${activeBan.reason}`,
          signals: [],
          comments: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        aegisStore.scheduleHotCommit('security:globalban_enforced', guildId, {
          incidentId,
          banId: activeBan.id,
        });

        const settings = state.guildSettings[guildId];
        const participation = state.participatingServers[guildId];
        const alertChannelId = settings?.alertChannelId || participation?.notificationChannelId;
        if (alertChannelId) {
          const cachedCh = member.guild.channels.cache.get(alertChannelId);
          void (cachedCh
            ? Promise.resolve(cachedCh)
            : member.guild.channels.fetch(alertChannelId).catch(() => null)
          ).then((ch) => {
            if (ch?.isTextBased() && 'send' in ch) {
              return ch
                .send(
                  buildSimpleNoticeV2(
                    'AEGIS SEGURIDAD — GLOBALBAN APLICADO',
                    [
                      `**Usuario:** ${member.user.username} (${activeBan.discordId})`,
                      `**Motivo:** ${activeBan.reason}`,
                      `**Gravedad:** ${gravedadLabel} · **Tiempo:** ${tiempoLabel} · **Apelable:** ${apelableLabel}`,
                      `**Acción:** Baneo automático ejecutado y aviso enviado al dueño.`,
                    ],
                    0xef4444
                  )
                )
                .catch(() => undefined);
            }
          });
        }
        return;
      }

      // 2. Anti Bots (Seguridad Adicional) — bans unauthorized bots + inviter if traceable
      if (member.user.bot) {
        const isWhitelistedBot = aegisStore.isUserWhitelistedFast(
          guildId,
          member.id,
          'BOT_DETECTION'
        );
        const isVerifiedBot = Boolean(member.user.flags?.has(UserFlagsBitField.Flags.VerifiedBot));
        const botDecision = evaluateAntiBot(addSec, {
          isBot: true,
          isVerifiedBot,
          isWhitelisted: isWhitelistedBot,
        });
        if (botDecision.triggered) {
          if (member.bannable) {
            await member.ban({ reason: botDecision.reason }).catch(() => undefined);
          }
          const logs = await member.guild
            .fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 3 })
            .catch(() => null);
          const addEntry = logs?.entries.find((e) => e.targetId === member.id);
          if (addEntry?.executorId && addEntry.executorId !== member.guild.ownerId) {
            const inviter = await member.guild.members
              .fetch(addEntry.executorId)
              .catch(() => null);
            if (inviter?.moderatable) {
              await inviter
                .timeout(
                  24 * 3600_000,
                  `AEGIS Anti Bots: Bot no autorizado (${member.user.username})`
                )
                .catch(() => undefined);
            }
          }
          const incidentId = `INC-${new Date().getFullYear()}-${crypto
            .randomBytes(3)
            .toString('hex')
            .toUpperCase()}`;
          aegisStore.pushIncident(state, {
            id: incidentId,
            guildId,
            guildName: member.guild.name,
            threatType: 'BOT_INFILTRATION',
            riskScore: 92,
            riskLevel: 'CRITICAL',
            affectedUserId: member.id,
            affectedUsername: member.user.username,
            responsibleUserId: addEntry?.executorId ?? member.id,
            responsibleUsername: addEntry?.executor?.username ?? member.user.username,
            appliedAction: 'BAN',
            status: 'MITIGATED',
            assignedTo: null,
            evidenceSummary: botDecision.reason,
            signals: [],
            comments: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          aegisStore.scheduleHotCommit('security:antibots_triggered', guildId, { incidentId });
          return;
        }
      }

      // 3. Anti Alts (Seguridad Adicional)
      const bypassAccountAge = aegisStore.isUserWhitelistedFast(guildId, member.id, 'ACCOUNT_AGE');
      if (!member.user.bot && !bypassAccountAge) {
        const altDecision = evaluateAntiAlt(addSec, member.user.createdTimestamp);
        if (altDecision.triggered && member.kickable) {
          await member.kick(`AEGIS Anti Alts: ${altDecision.reason}`).catch(() => undefined);
          const incidentId = `INC-${new Date().getFullYear()}-${crypto
            .randomBytes(3)
            .toString('hex')
            .toUpperCase()}`;
          aegisStore.pushIncident(state, {
            id: incidentId,
            guildId,
            guildName: member.guild.name,
            threatType: 'SUSPICIOUS_ACCOUNT_WAVE',
            riskScore: 72,
            riskLevel: 'HIGH',
            affectedUserId: member.id,
            affectedUsername: member.user.username,
            responsibleUserId: member.id,
            responsibleUsername: member.user.username,
            appliedAction: 'KICK',
            status: 'MITIGATED',
            assignedTo: null,
            evidenceSummary: altDecision.reason,
            signals: [],
            comments: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          aegisStore.scheduleHotCommit('security:antialts_triggered', guildId, { incidentId });
          return;
        }
      }

      // 4. Ultra-Fast In-Memory Guild Anti-Raid Evaluation (O(1) Sliding Window + RaidBurstShield)
      const config = state.antiRaidConfigs[guildId];
      if (!config?.enabled) return;

      if (aegisStore.isUserWhitelistedFast(guildId, member.id, 'JOIN_BURST')) return;

      const nowMs = Date.now();
      const burst = aegisStore.joinWindow.recordAndAnalyze(
        `guild:${guildId}:joins`,
        member.id,
        config.timeWindowSeconds,
        config.maxJoins,
        member.user.username,
        nowMs
      );

      if (burst.thresholdExceeded) {
        aegisStore.raidShield.markBurstDetected(guildId, config.timeWindowSeconds, nowMs);
      }

      const underActiveRaidShield = aegisStore.raidShield.isUnderActiveRaid(guildId, nowMs);
      const accountAgeDays = Math.floor(
        (nowMs - member.user.createdTimestamp) / 86_400_000
      );

      const fastDecision = evaluateFastJoinMitigation({
        guildId,
        accountAgeDays,
        isBot: member.user.bot,
        hasAvatar: Boolean(member.user.avatar),
        joinsInWindow: burst.countInWindow,
        thresholdExceeded: burst.thresholdExceeded,
        similarUsernameCount: burst.similarUsernameCount,
        repetitiveJoinCount: burst.repetitiveSubjectCount,
        underActiveRaidShield,
        config,
      });

      config.eventsProcessed += 1;
      if (fastDecision.shouldMitigate) {
        config.attacksDetected += 1;
        let actionTaken = fastDecision.action;

        if (actionTaken === 'BAN' && member.bannable) {
          await member
            .ban({ reason: `AEGIS Anti-Raid Riesgo ${fastDecision.evaluation.score}/100` })
            .catch(() => undefined);
          config.attacksPrevented += 1;
        } else if (actionTaken === 'KICK' && member.kickable) {
          await member
            .kick(`AEGIS Anti-Raid Riesgo ${fastDecision.evaluation.score}/100`)
            .catch(() => undefined);
          config.attacksPrevented += 1;
        } else if (
          (actionTaken === 'QUARANTINE' || actionTaken === 'TIMEOUT') &&
          member.moderatable
        ) {
          await member
            .timeout(3600_000, `AEGIS Cuarentena Riesgo ${fastDecision.evaluation.score}/100`)
            .catch(() => undefined);
          config.attacksPrevented += 1;
        } else {
          actionTaken = 'ALERT';
        }

        const incidentId = `INC-${new Date().getFullYear()}-${crypto
          .randomBytes(3)
          .toString('hex')
          .toUpperCase()}`;
        const createdAtIso = new Date().toISOString();

        aegisStore.pushIncident(state, {
          id: incidentId,
          guildId,
          guildName: member.guild.name,
          threatType: burst.thresholdExceeded ? 'JOIN_RAID' : 'SUSPICIOUS_ACCOUNT_WAVE',
          riskScore: fastDecision.evaluation.score,
          riskLevel: fastDecision.evaluation.level,
          affectedUserId: member.id,
          affectedUsername: member.user.username,
          responsibleUserId: member.id,
          responsibleUsername: member.user.username,
          appliedAction: actionTaken,
          status: 'MITIGATED',
          assignedTo: null,
          evidenceSummary: `${burst.countInWindow} ingresos en ${config.timeWindowSeconds}s (límite ${config.maxJoins})${fastDecision.escalatedByRaidShield ? ' · Escudo Activo de Ráfaga' : ''}.`,
          signals: fastDecision.evaluation.signals,
          comments: [],
          createdAt: createdAtIso,
          updatedAt: createdAtIso,
        });

        aegisStore.pushEvent(state, {
          id: `EVT-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
          guildId,
          guildName: member.guild.name,
          eventType: burst.thresholdExceeded ? 'JOIN_BURST_MITIGATED' : 'FAST_ANTIRAID_ACTION',
          threatType: burst.thresholdExceeded ? 'JOIN_RAID' : 'SUSPICIOUS_ACCOUNT_WAVE',
          targetDiscordId: member.id,
          targetUsername: member.user.username,
          riskScore: fastDecision.evaluation.score,
          riskLevel: fastDecision.evaluation.level,
          actionTaken,
          status: 'MITIGATED',
          createdAt: createdAtIso,
        });

        aegisStore.scheduleHotCommit('incident:created', guildId, { incidentId });

        // Non-blocking alert channel notification after mitigation so rapid bursts never stall
        const settings = state.guildSettings[guildId];
        if (settings?.alertChannelId) {
          const dedup = aegisStore.alertDedup.shouldEmit(
            `guild:${guildId}:raid_alert`,
            settings.alertBatchIntervalSeconds || 15,
            nowMs
          );
          if (dedup.emit) {
            const alertChannelId = settings.alertChannelId;
            const cachedChannel = member.guild.channels.cache.get(alertChannelId);
            void (cachedChannel
              ? Promise.resolve(cachedChannel)
              : member.guild.channels.fetch(alertChannelId).catch(() => null)
            ).then((ch) => {
              if (ch?.isTextBased() && 'send' in ch) {
                return ch
                  .send(
                    buildCriticalAlertV2({
                      guildName: member.guild.name,
                      joinsDetected: burst.countInWindow,
                      windowSeconds: config.timeWindowSeconds,
                      configuredThreshold: config.maxJoins,
                      riskScore: fastDecision.evaluation.score,
                      actionTaken,
                      incidentId,
                    })
                  )
                  .catch(() => undefined);
              }
            });
          }
        }
      }
    } catch (err) {
      console.error('[AEGIS BOT] GuildMemberAdd handler error:', err);
    }
  });

  // High-speed Message Pipeline: Anti-Flood, Anti-Scam, Anti-Invites, Anti-Links & Webhook Spam
  client.on(Events.MessageCreate, async (message) => {
    try {
      if (!message.guild || message.author.id === client.user?.id) return;
      const guildId = message.guild.id;
      const state = aegisStore.getHotStateSync();
      aegisStore.ensureGuildStructures(state, guildId, message.guild.name);
      const addSec = state.guildSecuritySuites[guildId].additionalSecurity;

      if (message.webhookId && addSec.antiWebhookSpam) {
        const whBurst = aegisStore.joinWindow.recordAndAnalyze(
          `guild:${guildId}:wh_msg:${message.webhookId}`,
          message.webhookId,
          10,
          4
        );
        if (whBurst.thresholdExceeded) {
          await message.delete().catch(() => undefined);
          if (tryClaimMitigation(`wh:${guildId}:${message.webhookId}`, 5000)) {
            const webhooks = await message.guild.fetchWebhooks().catch(() => null);
            const rogue = webhooks?.get(message.webhookId);
            if (rogue) {
              await rogue.delete('AEGIS Anti Spam Webhooks').catch(() => undefined);
            }
          }
        }
        return;
      }

      if (message.author.bot || message.author.id === message.guild.ownerId) return;

      if (aegisStore.isUserWhitelistedFast(guildId, message.author.id)) return;
      const isChannelWhitelisted = aegisStore.isChannelWhitelistedFast(guildId, message.channelId);

      if (addSec.antiFlood.enabled && !isChannelWhitelisted) {
        const floodBurst = aegisStore.joinWindow.recordAndAnalyze(
          `guild:${guildId}:flood:${message.author.id}`,
          message.author.id,
          addSec.antiFlood.windowSeconds,
          addSec.antiFlood.maxMessages
        );
        const floodDecision = evaluateAntiFloodBurst(addSec, {
          countInWindow: floodBurst.countInWindow,
          channelWhitelisted: isChannelWhitelisted,
        });
        if (floodDecision.triggered) {
          await message.delete().catch(() => undefined);
          if (
            message.member?.moderatable &&
            tryClaimMitigation(`flood:${guildId}:${message.author.id}`, 4000)
          ) {
            await message.member
              .timeout((floodDecision.durationMinutes ?? 10) * 60_000, floodDecision.reason)
              .catch(() => undefined);
          }
          return;
        }
      }

      const content = message.content || '';
      if (!content) return;

      const scamDecision = evaluateAntiScamMessage(addSec, content);
      if (scamDecision.triggered) {
        await message.delete().catch(() => undefined);
        if (
          message.member?.moderatable &&
          tryClaimMitigation(`scam:${guildId}:${message.author.id}`, 4000)
        ) {
          await message.member
            .timeout((scamDecision.durationMinutes ?? 30) * 60_000, scamDecision.reason)
            .catch(() => undefined);
        }
        return;
      }

      const inviteDecision = evaluateAntiInviteMessage(addSec, content, isChannelWhitelisted);
      if (inviteDecision.triggered) {
        await message.delete().catch(() => undefined);
        return;
      }

      const linkDecision = evaluateAntiLinkMessage(addSec, content, isChannelWhitelisted);
      if (linkDecision.triggered) {
        await message.delete().catch(() => undefined);
      }
    } catch (err) {
      console.error('[AEGIS BOT] MessageCreate handler error:', err);
    }
  });

  // High-speed Anti-Nuke + Anti Everyone Perms + Anti Mass Mute + 12 Granular Anti-Raid Audit Analyzer
  client.on(Events.GuildAuditLogEntryCreate, async (entry, guild) => {
    try {
      const state = aegisStore.getHotStateSync();
      aegisStore.ensureGuildStructures(state, guild.id, guild.name);
      if (!entry.executorId) return;
      if (entry.executorId === client.user?.id || entry.executorId === guild.ownerId) return;

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
            .catch(() => undefined);
          if (tryClaimMitigation(`everyone:${guild.id}:${entry.executorId}`, 4000)) {
            const actor = await guild.members.fetch(entry.executorId).catch(() => null);
            if (actor?.manageable) {
              await actor
                .timeout(12 * 3600_000, 'AEGIS Anti Everyone Permisos')
                .catch(() => undefined);
            }
          }
          aegisStore.scheduleHotCommit('security:antieveryone_reverted', guild.id);
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
            if (actor?.moderatable) {
              await actor
                .timeout(6 * 3600_000, 'AEGIS Anti Mass Mute')
                .catch(() => undefined);
            }
            aegisStore.scheduleHotCommit('security:antimassmute_triggered', guild.id);
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
              if (suite.punishmentAction === 'BAN' && actor.bannable) {
                await actor
                  .ban({ reason: `AEGIS Anti-Raid (${matchedRuleKey})` })
                  .catch(() => undefined);
              } else if (suite.punishmentAction === 'KICK' && actor.kickable) {
                await actor.kick(`AEGIS Anti-Raid (${matchedRuleKey})`).catch(() => undefined);
              } else if (suite.punishmentAction === 'QUARANTINE' && actor.moderatable) {
                await actor
                  .timeout(6 * 3600_000, `AEGIS Anti-Raid (${matchedRuleKey})`)
                  .catch(() => undefined);
              } else if (actor.manageable) {
                const rolesToStrip = actor.roles.cache.filter(
                  (r) => r.editable && r.id !== guild.id
                );
                if (rolesToStrip.size > 0) {
                  await actor.roles
                    .remove(rolesToStrip, `AEGIS Anti-Raid (${matchedRuleKey})`)
                    .catch(() => undefined);
                }
              }
            }
            aegisStore.scheduleHotCommit('antiraid:granular_triggered', guild.id);
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
                .catch(() => undefined);
            }
          }
          if (antiNuke.autoResponse.quarantineExecutor && executorMember.moderatable) {
            await executorMember
              .timeout(6 * 3600_000, `AEGIS Anti-Nuke Containment ${incidentId}`)
              .then(() => actionsTaken.push('EXECUTOR_QUARANTINED'))
              .catch(() => undefined);
          }
        }

        if (antiNuke.autoResponse.triggerLockdown && state.lockdowns[guild.id]) {
          const lockdownState = state.lockdowns[guild.id];
          lockdownState.active = true;
          lockdownState.mode = 'AUTOMATIC';
          lockdownState.reason = `Auto-Lockdown Anti-Nuke (${incidentId})`;
          lockdownState.activatedAt = new Date().toISOString();
          actionsTaken.push('LOCKDOWN_ACTIVATED');
          void enforceDiscordLockdown({
            guildId: guild.id,
            active: true,
            reason: lockdownState.reason,
            restrictions: lockdownState.restrictions,
            previousSnapshots: lockdownState.snapshots,
          }).then((syncRes) => {
            lockdownState.affectedChannelCount = syncRes.affectedChannelCount;
            lockdownState.snapshots = syncRes.snapshots;
          });
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
        aegisStore.scheduleHotCommit('antinuke:triggered', guild.id, { incidentId });
      }
    } catch (err) {
      console.error('[AEGIS BOT] AuditLog handler error:', err);
    }
  });

  // Slash Command & Components V2 Button Interactions
  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    try {
      if (interaction.isButton()) {
        if (!interaction.guildId || !interaction.guild) return;
        const state = await aegisStore.getState();
        aegisStore.ensureGuildStructures(state, interaction.guildId, interaction.guild.name);

        if (!isAuthorizedGuildOperator(state, interaction.guild, interaction.user.id)) {
          await interaction.reply({
            ...buildSimpleNoticeV2(
              'AEGIS SECURITY — ACCESO RESTRINGIDO',
              [
                'Solo el Dueño del servidor o el Segundo Dueño designado pueden operar este panel.',
              ],
              0xef4444
            ),
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
          });
          return;
        }

        const config = state.antiRaidConfigs[interaction.guildId];
        if (!config) return;
        const planTier = normalizePlanTier(state.guildPlans[interaction.guildId]?.tier);

        if (interaction.customId === 'aegis:toggle:enable') {
          const nowIso = new Date().toISOString();
          config.enabled = true;
          config.activatedAt = config.activatedAt ?? nowIso;
          config.syncVersion += 1;
          config.lastSyncedAt = nowIso;
          aegisStore.syncGuildRecord(state, interaction.guildId, {
            protectionEnabled: true,
            lastSyncAt: nowIso,
          });
          await aegisStore.commitMutation('antiraid:enabled', interaction.guildId);
          await interaction.update(
            buildAntiRaidPanelV2({
              guildName: interaction.guild.name,
              config,
              antiNukeEnabled: Boolean(state.antiNukeConfigs[interaction.guildId]?.enabled),
              lockdown: state.lockdowns[interaction.guildId],
              planTier,
            })
          );
          return;
        }

        if (interaction.customId === 'aegis:toggle:disable') {
          const nowIso = new Date().toISOString();
          config.enabled = false;
          config.syncVersion += 1;
          config.lastSyncedAt = nowIso;
          aegisStore.raidShield.clear(interaction.guildId);
          aegisStore.syncGuildRecord(state, interaction.guildId, {
            protectionEnabled: false,
            lastSyncAt: nowIso,
          });
          await aegisStore.commitMutation('antiraid:disabled', interaction.guildId);
          await interaction.update(
            buildAntiRaidPanelV2({
              guildName: interaction.guild.name,
              config,
              antiNukeEnabled: Boolean(state.antiNukeConfigs[interaction.guildId]?.enabled),
              lockdown: state.lockdowns[interaction.guildId],
              planTier,
            })
          );
          return;
        }

        if (interaction.customId === 'aegis:panel:refresh') {
          await interaction.update(
            buildAntiRaidPanelV2({
              guildName: interaction.guild.name,
              config,
              antiNukeEnabled: Boolean(state.antiNukeConfigs[interaction.guildId]?.enabled),
              lockdown: state.lockdowns[interaction.guildId],
              planTier,
            })
          );
          return;
        }

        if (interaction.customId === 'aegis:panel:incidents') {
          const recent = state.incidents
            .filter((i) => i.guildId === interaction.guildId)
            .slice(0, 6);
          await interaction.reply({
            ...buildSimpleNoticeV2(
              'AEGIS — INCIDENTES RECIENTES',
              recent.length === 0
                ? ['No se registraron incidentes de seguridad en este servidor.']
                : recent.map((i) => `${i.id} · ${i.threatType} · Riesgo ${i.riskScore}/100 (${i.status})`)
            ),
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
          });
          return;
        }

        if (interaction.customId === 'aegis:panel:config' || interaction.customId === 'aegis:panel:status') {
          const addSec = state.guildSecuritySuites[interaction.guildId]?.additionalSecurity;
          await interaction.reply({
            ...buildSimpleNoticeV2('AEGIS — CONFIGURACIÓN ACTUAL', [
              `Anti-Raid: ${config.enabled ? 'ACTIVO' : 'DESACTIVADO'} (${config.mode})`,
              `Límite de Ingresos: ${config.maxJoins} ingresos / ${config.timeWindowSeconds}s · Edad Mín.: ${config.minAccountAgeDays}d`,
              `Anti-Nuke: ${state.antiNukeConfigs[interaction.guildId]?.enabled ? 'ACTIVO' : 'DESACTIVADO'}`,
              `Capas AutoMod Activas: ${addSec ? countActiveAutoModRules(addSec) : 0}/6`,
              `Latencia del Bot: ${interaction.client.ws.ping} ms`,
            ]),
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
          });
          return;
        }
        return;
      }

      if (!interaction.isChatInputCommand()) return;
      await handleSlashCommand(interaction);
    } catch (err) {
      console.error('[AEGIS BOT] Interaction error:', err);
    }
  });
}

function isBotStaffMember(state: PersistedDatabaseState, discordId: string): boolean {
  if (isSuperOwner(discordId)) return true;
  const env = getServerEnv();
  if (env.ownerIds.includes(discordId) || env.globalAdminIds.includes(discordId)) {
    return true;
  }
  const activeMod = state.globalModerators.find(
    (m) =>
      m.discordId === discordId &&
      m.status === 'ACTIVE' &&
      (m.role === 'OWNER' || m.role === 'GLOBAL_ADMINISTRATOR')
  );
  return Boolean(activeMod);
}

function isAuthorizedGuildOperator(
  state: PersistedDatabaseState,
  guild: Guild,
  discordId: string
): boolean {
  if (guild.ownerId === discordId) return true;
  const secondary = Object.hasOwn(state.secondaryOwners, guild.id)
    ? state.secondaryOwners[guild.id]
    : undefined;
  return Boolean(secondary && secondary.discordId === discordId);
}

export async function handleSlashCommand(interaction: ChatInputCommandInteraction) {
  const state = await aegisStore.getState();
  const guildId = interaction.guildId;
  const sub = interaction.options.getSubcommand(false);

  if (interaction.commandName === 'aegis') {
    if (sub === 'ayuda' || sub === 'help') {
      await interaction.reply({
        ...buildSimpleNoticeV2('AEGIS SECURITY — GUÍA DE COMANDOS', [
          '⚡ `/aegis` `panel | estado | diagnostico | ayuda`',
          '🛡️ `/antiraid` `estado | activar | desactivar | modo | configurar | probar | incidentes`',
          '💣 `/antinuke` `estado | activar | desactivar | configurar | incidentes`',
          '🔐 `/seguridad` `estado | antialts | antibots | antiinvitaciones | antienlaces | antiflood | antiscam | antieveryone`',
          '🚨 `/bloqueo` `estado | activar | desactivar | configurar`',
          '⛓️ `/cuarentena` `aislar | liberar | lista | detalle`',
          '📜 `/whitelist` `agregar | quitar | lista | verificar`',
          '👑 `/premium` `ver | canjear | anadir | eliminar | codigo`',
          '**Control de acceso:** Dueño Principal del servidor o Segundo Dueño asignado.',
        ]),
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
      return;
    }

    if (!guildId || !interaction.guild) {
      await interaction.reply({
        ...buildSimpleNoticeV2(
          'AEGIS SECURITY',
          ['Los comandos de servidor deben ejecutarse dentro de un servidor de Discord.'],
          0xf59e0b
        ),
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
      return;
    }

    aegisStore.ensureGuildStructures(state, guildId, interaction.guild.name);
    if (!isAuthorizedGuildOperator(state, interaction.guild, interaction.user.id)) {
      await interaction.reply({
        ...buildSimpleNoticeV2(
          'AEGIS SECURITY — ACCESO DENEGADO',
          ['Solo el Dueño Principal o el Segundo Dueño asignado pueden gestionar este servidor.'],
          0xef4444
        ),
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
      return;
    }

    const config = state.antiRaidConfigs[guildId];
    const planTier = normalizePlanTier(state.guildPlans[guildId]?.tier);

    if (sub === 'panel') {
      await interaction.reply(
        buildAntiRaidPanelV2({
          guildName: interaction.guild.name,
          config,
          antiNukeEnabled: Boolean(state.antiNukeConfigs[guildId]?.enabled),
          lockdown: state.lockdowns[guildId],
          planTier,
        })
      );
      return;
    }

    if (sub === 'estado' || sub === 'diagnostico' || sub === 'status' || sub === 'diagnostics') {
      const me = interaction.guild.members.me;
      const missingCritical = !me?.permissions.has([
        PermissionFlagsBits.ManageRoles,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ModerateMembers,
      ]);
      await interaction.reply({
        ...buildSimpleNoticeV2(
          'AEGIS — DIAGNÓSTICO DEL SERVIDOR',
          [
            `**Servidor:** ${interaction.guild.name} (${guildId})`,
            `**Plan:** ${planTier === 'DIAMANTE' ? 'Plan Diamante' : planTier === 'ORO' ? 'Plan Oro' : 'Plan Gratuito'}`,
            `**Anti-Raid:** ${config.enabled ? 'ACTIVO' : 'DESACTIVADO'} (${config.mode})`,
            `**Escudo de Ráfaga L1:** ${aegisStore.raidShield.isUnderActiveRaid(guildId) ? 'EN CONTENCIÓN ACTIVA' : 'En espera rápida (<1ms)'}`,
            `**Anti-Nuke:** ${state.antiNukeConfigs[guildId]?.enabled ? 'ACTIVO' : 'DESACTIVADO'}`,
            `**Bloqueo de Emergencia:** ${state.lockdowns[guildId]?.active ? 'ACTIVO' : 'En espera'}`,
            `**Latencia del Gateway:** ${interaction.client.ws.ping} ms`,
            `**Permisos del Bot:** ${missingCritical ? 'Faltan permisos de moderación' : 'Operativo'}`,
          ],
          missingCritical ? 0xf59e0b : 0x10b981
        ),
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
      return;
    }
  }

  if (interaction.commandName === 'premium') {
    const isStaff = isBotStaffMember(state, interaction.user.id);

    if (sub === 'anadir') {
      if (!isStaff) {
        await interaction.reply({
          ...buildSimpleNoticeV2(
            'AEGIS PREMIUM — ACCESO DENEGADO',
            ['Solo el Staff autorizado de AEGIS puede otorgar membresías manualmente.'],
            0xef4444
          ),
          flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        });
        return;
      }
      const targetUser = interaction.options.getUser('usuario', true);
      const tipo = interaction.options.getString('tipo', true) as 'ORO' | 'DIAMANTE';
      const rawTime = interaction.options.getString('tiempo', true);
      const parsedTime = parseDurationString(rawTime);
      if (!parsedTime.ok) {
        await interaction.reply({
          ...buildSimpleNoticeV2('AEGIS PREMIUM — TIEMPO INVÁLIDO', [parsedTime.error], 0xef4444),
          flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        });
        return;
      }

      const subRecord = aegisStore.grantUserPremium(state, {
        discordId: targetUser.id,
        username: targetUser.username,
        tier: tipo,
        durationMs: parsedTime.durationMs,
        source: 'DISCORD_SLASH',
        updatedBy: interaction.user.username,
      });
      aegisStore.appendAuditLog(state, {
        guildId: guildId ?? null,
        actorId: interaction.user.id,
        actorName: interaction.user.username,
        action: 'PREMIUM_STAFF_GRANTED',
        entityType: 'UserPremiumSubscription',
        entityId: targetUser.id,
        result: 'SUCCESS',
        metadata: { tier: subRecord.tier, durationLabel: parsedTime.normalizedLabel },
      });
      await aegisStore.commitMutation('premium:staff_granted', undefined, { discordId: targetUser.id });

      const remainingMs = subRecord.expiresAt ? new Date(subRecord.expiresAt).getTime() - Date.now() : 0;
      await interaction.reply({
        ...buildSimpleNoticeV2(
          'AEGIS PREMIUM — MEMBRESÍA AÑADIDA',
          [
            `**Usuario:** ${targetUser.username} (${targetUser.id})`,
            `**Plan Activo:** ${subRecord.tier === 'DIAMANTE' ? 'Plan Diamante' : 'Plan Oro'}`,
            `**Tiempo Añadido:** ${parsedTime.normalizedLabel}`,
            `**Tiempo Total Acumulado:** ${formatDurationHuman(remainingMs, 'es')}`,
            `**Servidores Premium Disponibles:** ${subRecord.activatedGuildIds.length}/${buildPlanQuotas(subRecord.tier).maxPremiumServers}`,
          ],
          0x10b981
        ),
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'eliminar') {
      if (!isStaff) {
        await interaction.reply({
          ...buildSimpleNoticeV2(
            'AEGIS PREMIUM — ACCESO DENEGADO',
            ['Solo el Staff autorizado de AEGIS puede eliminar membresías.'],
            0xef4444
          ),
          flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        });
        return;
      }
      const targetUser = interaction.options.getUser('usuario', true);
      const revoked = aegisStore.revokeUserPremium(state, {
        discordId: targetUser.id,
        revokedBy: interaction.user.username,
      });
      if (!revoked) {
        await interaction.reply({
          ...buildSimpleNoticeV2(
            'AEGIS PREMIUM',
            [`${targetUser.username} no tiene ninguna suscripción Premium registrada.`],
            0xf59e0b
          ),
          flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        });
        return;
      }
      aegisStore.appendAuditLog(state, {
        guildId: guildId ?? null,
        actorId: interaction.user.id,
        actorName: interaction.user.username,
        action: 'PREMIUM_STAFF_REVOKED',
        entityType: 'UserPremiumSubscription',
        entityId: targetUser.id,
        result: 'SUCCESS',
        metadata: {},
      });
      await aegisStore.commitMutation('premium:staff_revoked', undefined, { discordId: targetUser.id });
      await interaction.reply({
        ...buildSimpleNoticeV2(
          'AEGIS PREMIUM — MEMBRESÍA REVOCADA',
          [
            `La membresía de **${targetUser.username}** fue revocada.`,
            'Todas las configuraciones y ranuras de servidor Premium fueron desactivadas automáticamente.',
          ],
          0xef4444
        ),
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'codigo') {
      if (!isStaff) {
        await interaction.reply({
          ...buildSimpleNoticeV2(
            'AEGIS PREMIUM — ACCESO DENEGADO',
            ['Solo el Staff autorizado de AEGIS puede generar códigos canjeables.'],
            0xef4444
          ),
          flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        });
        return;
      }
      const tipo = interaction.options.getString('tipo', true) as 'ORO' | 'DIAMANTE';
      const rawTime = interaction.options.getString('tiempo', true);
      const usos = interaction.options.getInteger('usos') ?? 1;
      const customCode = interaction.options.getString('codigo') ?? undefined;
      const parsedTime = parseDurationString(rawTime);
      if (!parsedTime.ok) {
        await interaction.reply({
          ...buildSimpleNoticeV2('AEGIS PREMIUM — TIEMPO INVÁLIDO', [parsedTime.error], 0xef4444),
          flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        });
        return;
      }
      const created = aegisStore.createPremiumCode(state, {
        tier: tipo,
        durationMs: parsedTime.durationMs,
        durationLabel: parsedTime.normalizedLabel,
        maxUses: usos,
        createdBy: interaction.user.username,
        customCode,
      });
      if (!created.ok) {
        await interaction.reply({
          ...buildSimpleNoticeV2('AEGIS PREMIUM — ERROR', [created.message], 0xef4444),
          flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        });
        return;
      }
      await aegisStore.commitMutation('premium:code_created', undefined, { code: created.record.code });
      await interaction.reply({
        ...buildSimpleNoticeV2(
          'AEGIS PREMIUM — CÓDIGO GENERADO',
          [
            `**Código:** \`${created.record.code}\``,
            `**Plan:** ${created.record.tier === 'DIAMANTE' ? 'Plan Diamante' : 'Plan Oro'}`,
            `**Duración:** ${created.record.durationLabel} (${formatDurationHuman(created.record.durationMs, 'es')})`,
            `**Usos Máximos:** ${created.record.maxUses}`,
            `Los usuarios pueden canjearlo con \`/premium canjear codigo:${created.record.code}\` o desde el panel web.`,
          ],
          0x10b981
        ),
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'canjear') {
      const codeInput = interaction.options.getString('codigo', true);
      const res = aegisStore.redeemPremiumCode(state, {
        code: codeInput,
        discordId: interaction.user.id,
        username: interaction.user.username,
        source: 'DISCORD_SLASH',
      });
      if (!res.ok) {
        await interaction.reply({
          ...buildSimpleNoticeV2('AEGIS PREMIUM — NO CANJEADO', [res.message], 0xef4444),
          flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        });
        return;
      }
      await aegisStore.commitMutation('premium:code_redeemed', undefined, {
        discordId: interaction.user.id,
      });
      const subRecord = res.subscription;
      const remainingMs = subRecord.expiresAt ? new Date(subRecord.expiresAt).getTime() - Date.now() : 0;
      await interaction.reply({
        ...buildSimpleNoticeV2(
          'AEGIS PREMIUM — CÓDIGO CANJEADO',
          [
            `**Plan Actual:** ${subRecord.tier === 'DIAMANTE' ? 'Plan Diamante' : 'Plan Oro'}`,
            `**Tiempo Total Acumulado:** ${formatDurationHuman(remainingMs, 'es')}`,
            `**Servidores Activos:** ${subRecord.activatedGuildIds.length}/${buildPlanQuotas(subRecord.tier).maxPremiumServers}`,
            'Asigna tus servidores desde la pestaña Premium en el Dashboard web.',
          ],
          0x10b981
        ),
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
      return;
    }

    // /premium ver
    const requestedUser = interaction.options.getUser('usuario');
    const targetUser = requestedUser && isStaff ? requestedUser : interaction.user;
    const subRecord = Object.hasOwn(state.userSubscriptions, targetUser.id)
      ? state.userSubscriptions[targetUser.id]
      : undefined;
    const active = isSubscriptionActive(subRecord);
    const tier = active && subRecord ? normalizePlanTier(subRecord.tier) : 'FREE';
    const remainingMs =
      active && subRecord?.expiresAt ? new Date(subRecord.expiresAt).getTime() - Date.now() : 0;
    const maxSlots = buildPlanQuotas(tier).maxPremiumServers;
    await interaction.reply({
      ...buildSimpleNoticeV2(
        `AEGIS PREMIUM — ${targetUser.username}`,
        [
          `**Plan Vigente:** ${tier === 'DIAMANTE' ? 'Plan Diamante' : tier === 'ORO' ? 'Plan Oro' : 'Plan Gratuito'}`,
          `**Estado:** ${active ? 'Activo' : 'Sin membresía activa'}`,
          `**Tiempo Restante:** ${active ? formatDurationHuman(remainingMs, 'es') : 'N/A'}`,
          `**Servidores Asignados:** ${active && subRecord ? subRecord.activatedGuildIds.length : 0}/${maxSlots}`,
        ],
        isPaidTier(tier) ? 0x5865f2 : 0x64748b
      ),
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });
    return;
  }

  if (!guildId || !interaction.guild) {
    await interaction.reply({
      ...buildSimpleNoticeV2(
        'AEGIS SECURITY',
        ['Este comando debe ejecutarse dentro de un servidor de Discord.'],
        0xf59e0b
      ),
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });
    return;
  }

  aegisStore.ensureGuildStructures(state, guildId, interaction.guild.name);

  if (!isAuthorizedGuildOperator(state, interaction.guild, interaction.user.id)) {
    await interaction.reply({
      ...buildSimpleNoticeV2(
        'AEGIS SECURITY — ACCESO DENEGADO',
        [
          'Solo el Dueño Principal del servidor o el Segundo Dueño asignado en AEGIS pueden ejecutar comandos de configuración.',
        ],
        0xef4444
      ),
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.commandName === 'antiraid') {
    const config = state.antiRaidConfigs[guildId];
    if (sub === 'activar' || sub === 'enable') {
      const nowIso = new Date().toISOString();
      config.enabled = true;
      config.activatedAt = nowIso;
      config.syncVersion += 1;
      config.lastSyncedAt = nowIso;
      aegisStore.syncGuildRecord(state, guildId, {
        protectionEnabled: true,
        lastSyncAt: nowIso,
      });
      await aegisStore.commitMutation('antiraid:enabled', guildId);
    } else if (sub === 'desactivar' || sub === 'disable') {
      const nowIso = new Date().toISOString();
      config.enabled = false;
      config.syncVersion += 1;
      config.lastSyncedAt = nowIso;
      aegisStore.raidShield.clear(guildId);
      aegisStore.syncGuildRecord(state, guildId, {
        protectionEnabled: false,
        lastSyncAt: nowIso,
      });
      await aegisStore.commitMutation('antiraid:disabled', guildId);
    } else if (sub === 'modo' || sub === 'mode') {
      const mode = (interaction.options.getString('modo') ??
        interaction.options.getString('mode', true)) as 'NORMAL' | 'STRICT' | 'EMERGENCY';
      config.mode = mode;
      config.syncVersion += 1;
      await aegisStore.commitMutation('antiraid:config_updated', guildId);
    } else if (sub === 'configurar' || sub === 'config') {
      const joins =
        interaction.options.getInteger('ingresos') ?? interaction.options.getInteger('joins');
      const win =
        interaction.options.getInteger('ventana') ?? interaction.options.getInteger('window');
      const minAge =
        interaction.options.getInteger('dias_minimos') ??
        interaction.options.getInteger('min_age_days');
      if (joins !== null) config.maxJoins = joins;
      if (win !== null) config.timeWindowSeconds = win;
      if (minAge !== null) config.minAccountAgeDays = minAge;
      config.syncVersion += 1;
      await aegisStore.commitMutation('antiraid:config_updated', guildId);
    } else if (sub === 'probar' || sub === 'test') {
      const simEval = evaluateJoinRisk({
        accountAgeDays: 1,
        isBot: false,
        hasAvatar: false,
        joinsInWindow: Math.max(config.maxJoins, config.maxJoins + 3),
        maxJoinsThreshold: config.maxJoins,
        similarUsernameCount: 4,
        repetitiveJoinCount: 3,
        hasActiveGlobalBan: false,
        mode: config.mode,
        weights: config.riskWeights ?? DEFAULT_RISK_WEIGHTS,
        rules: config.riskRules,
      });
      await interaction.reply({
        ...buildSimpleNoticeV2(
          'AEGIS — DIAGNÓSTICO DEL MOTOR DE RIESGO',
          [
            `**Puntuación Simulada:** ${simEval.score}/100 (${simEval.level})`,
            `**Acción Recomendada:** ${simEval.recommendedAction}`,
            `**Modo Activo:** ${config.mode} (Umbral ${config.riskThreshold}/100)`,
            `**Señales Principales:** ${simEval.signals.slice(0, 3).map((s) => `${s.label} (+${s.weightedPoints})`).join(', ')}`,
          ],
          simEval.score >= config.riskThreshold ? 0xef4444 : 0x10b981
        ),
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
      return;
    } else if (sub === 'incidentes' || sub === 'incidents') {
      const recent = state.incidents.filter((i) => i.guildId === guildId).slice(0, 6);
      await interaction.reply({
        ...buildSimpleNoticeV2(
          'AEGIS — INCIDENTES RECIENTES',
          recent.length === 0
            ? ['No hay incidentes de seguridad registrados en este servidor.']
            : recent.map((i) => `${i.id} · ${i.threatType} · ${i.riskScore}/100 (${i.status})`)
        ),
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply(
      buildSimpleNoticeV2('AEGIS — PROTECCIÓN ANTI-RAID', [
        `**Estado:** ${config.enabled ? 'ACTIVO' : 'DESACTIVADO'}`,
        `**Modo:** ${config.mode}`,
        `**Umbral:** ${config.maxJoins} ingresos / ${config.timeWindowSeconds}s`,
        `**Antigüedad Mínima:** ${config.minAccountAgeDays} días`,
        `**Sincronización:** v${config.syncVersion}`,
      ])
    );
    return;
  }

  if (interaction.commandName === 'antinuke') {
    const antiNuke = state.antiNukeConfigs[guildId];
    if (sub === 'activar' || sub === 'enable') {
      antiNuke.enabled = true;
      antiNuke.updatedAt = new Date().toISOString();
      await aegisStore.commitMutation('antinuke:updated', guildId);
    } else if (sub === 'desactivar' || sub === 'disable') {
      antiNuke.enabled = false;
      antiNuke.updatedAt = new Date().toISOString();
      await aegisStore.commitMutation('antinuke:updated', guildId);
    } else if (sub === 'configurar' || sub === 'config') {
      const chDel =
        interaction.options.getInteger('max_canales_borrados') ??
        interaction.options.getInteger('max_channel_deletes');
      const roleMut =
        interaction.options.getInteger('max_cambios_roles') ??
        interaction.options.getInteger('max_role_mutations');
      if (chDel !== null) antiNuke.maxChannelDeletions = chDel;
      if (roleMut !== null) antiNuke.maxRoleMutations = roleMut;
      antiNuke.updatedAt = new Date().toISOString();
      await aegisStore.commitMutation('antinuke:updated', guildId);
    } else if (sub === 'incidentes' || sub === 'incidents') {
      const recent = state.incidents
        .filter((i) => i.guildId === guildId && i.riskLevel === 'CRITICAL')
        .slice(0, 6);
      await interaction.reply({
        ...buildSimpleNoticeV2(
          'AEGIS — INCIDENTES ANTI-NUKE',
          recent.length === 0
            ? ['No hay incidentes críticos Anti-Nuke registrados.']
            : recent.map((i) => `${i.id} · ${i.threatType} · Ejecutor ${i.responsibleUsername}`)
        ),
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply(
      buildSimpleNoticeV2('AEGIS — DEFENSA ANTI-NUKE', [
        `**Estado:** ${antiNuke.enabled ? 'ACTIVO' : 'DESACTIVADO'}`,
        `**Máx. Canales Eliminados:** ${antiNuke.maxChannelDeletions}`,
        `**Máx. Cambios de Roles:** ${antiNuke.maxRoleMutations}`,
        `**Ventana de Análisis:** ${antiNuke.timeWindowSeconds}s`,
      ])
    );
    return;
  }

  if (interaction.commandName === 'cuarentena' || interaction.commandName === 'quarantine') {
    if (sub === 'aislar' || sub === 'add') {
      const targetUser =
        interaction.options.getUser('usuario') ?? interaction.options.getUser('user', true);
      const reason =
        interaction.options.getString('motivo') ?? interaction.options.getString('reason', true);
      const hours =
        interaction.options.getInteger('horas') ?? interaction.options.getInteger('hours') ?? 24;
      const targetMember =
        interaction.guild.members.cache.get(targetUser.id) ??
        (await interaction.guild.members.fetch(targetUser.id).catch(() => null));
      if (targetMember?.moderatable) {
        await targetMember
          .timeout(hours * 3600_000, `AEGIS Cuarentena: ${reason}`)
          .catch(() => undefined);
      }
      const nowIso = new Date().toISOString();
      const entry = {
        id: `QRT-${Date.now().toString(36).toUpperCase()}-${crypto
          .randomBytes(2)
          .toString('hex')
          .toUpperCase()}`,
        guildId,
        guildName: interaction.guild.name,
        discordId: targetUser.id,
        username: targetUser.username,
        avatarUrl: null,
        reason,
        riskScore: 75,
        riskLevel: 'CRITICAL' as const,
        incidentId: null,
        responsibleActor: interaction.user.username,
        previousRoleIds: [],
        status: 'ACTIVE' as const,
        createdAt: nowIso,
        expiresAt: new Date(Date.now() + hours * 3600_000).toISOString(),
        releasedAt: null,
        releasedBy: null,
      };
      const { entry: savedEntry } = aegisStore.upsertQuarantineEntry(state, entry);
      await aegisStore.commitMutation('quarantine:created', guildId, { entry: savedEntry });
      await interaction.reply(
        buildSimpleNoticeV2('AEGIS — CUARENTENA APLICADA', [
          `**Usuario:** ${targetUser.username} (${targetUser.id})`,
          `**Duración:** ${hours} horas`,
          `**Motivo:** ${reason}`,
        ])
      );
      return;
    }

    if (sub === 'liberar' || sub === 'release') {
      const targetUser =
        interaction.options.getUser('usuario') ?? interaction.options.getUser('user', true);
      const activeEntry = state.quarantines.find(
        (q) => q.guildId === guildId && q.discordId === targetUser.id && q.status === 'ACTIVE'
      );
      if (!activeEntry) {
        await interaction.reply({
          ...buildSimpleNoticeV2(
            'AEGIS — CUARENTENA',
            ['No se encontró una cuarentena activa para ese usuario.'],
            0xf59e0b
          ),
          flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        });
        return;
      }
      const targetMember =
        interaction.guild.members.cache.get(targetUser.id) ??
        (await interaction.guild.members.fetch(targetUser.id).catch(() => null));
      if (targetMember?.moderatable) {
        await targetMember.timeout(null, 'AEGIS Cuarentena Liberada').catch(() => undefined);
      }
      activeEntry.status = 'RELEASED';
      activeEntry.releasedAt = new Date().toISOString();
      activeEntry.releasedBy = interaction.user.username;
      await aegisStore.commitMutation('quarantine:updated', guildId, { id: activeEntry.id });
      await interaction.reply(
        buildSimpleNoticeV2(
          'AEGIS — CUARENTENA LIBERADA',
          [`${targetUser.username} fue liberado por ${interaction.user.username}.`],
          0x10b981
        )
      );
      return;
    }

    if (sub === 'detalle' || sub === 'info') {
      const targetUser =
        interaction.options.getUser('usuario') ?? interaction.options.getUser('user', true);
      const entries = state.quarantines.filter(
        (q) => q.guildId === guildId && q.discordId === targetUser.id
      );
      await interaction.reply({
        ...buildSimpleNoticeV2(
          `AEGIS CUARENTENA — ${targetUser.username}`,
          entries.length === 0
            ? [`No hay registros de cuarentena para ${targetUser.username} (${targetUser.id}).`]
            : entries
                .slice(0, 6)
                .map(
                  (q) =>
                    `${q.id} · ${q.status} · Riesgo ${q.riskScore}/100 · Por ${q.responsibleActor} — ${q.reason}`
                )
        ),
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
      return;
    }

    const active = state.quarantines.filter((q) => q.guildId === guildId && q.status === 'ACTIVE');
    await interaction.reply({
      ...buildSimpleNoticeV2(
        'AEGIS — CUARENTENAS ACTIVAS',
        active.length === 0
          ? ['No hay usuarios en cuarentena activa en este servidor.']
          : active.slice(0, 8).map((q) => `${q.id} · ${q.username} (${q.discordId}) — ${q.reason}`)
      ),
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.commandName === 'bloqueo' || interaction.commandName === 'lockdown') {
    const lockdown = state.lockdowns[guildId];
    if (sub === 'activar' || sub === 'activate') {
      const reason =
        interaction.options.getString('motivo') ??
        interaction.options.getString('reason') ??
        'Bloqueo de Emergencia desde Discord';
      const minutes =
        interaction.options.getInteger('minutos') ?? interaction.options.getInteger('minutes') ?? 30;
      const syncResult = await enforceDiscordLockdown({
        guildId,
        active: true,
        reason,
        restrictions: lockdown.restrictions,
        previousSnapshots: lockdown.snapshots,
      });
      lockdown.active = true;
      lockdown.mode = 'MANUAL';
      lockdown.reason = reason;
      lockdown.activatedBy = interaction.user.username;
      lockdown.activatedAt = new Date().toISOString();
      lockdown.scheduledEndAt = new Date(Date.now() + minutes * 60_000).toISOString();
      lockdown.affectedChannelCount = syncResult.affectedChannelCount;
      lockdown.snapshots = syncResult.snapshots;
      await aegisStore.commitMutation('lockdown:activated', guildId);
    } else if (sub === 'desactivar' || sub === 'deactivate') {
      await enforceDiscordLockdown({
        guildId,
        active: false,
        reason: 'AEGIS Bloqueo Restaurado',
        restrictions: lockdown.restrictions,
        previousSnapshots: lockdown.snapshots,
      });
      lockdown.active = false;
      lockdown.lastRestoredAt = new Date().toISOString();
      lockdown.scheduledEndAt = null;
      lockdown.snapshots = [];
      lockdown.affectedChannelCount = 0;
      await aegisStore.commitMutation('lockdown:deactivated', guildId);
    } else if (sub === 'configurar' || sub === 'config') {
      const lockSend =
        interaction.options.getBoolean('bloquear_mensajes') ??
        interaction.options.getBoolean('lock_send_messages');
      const lockVoice =
        interaction.options.getBoolean('bloquear_voz') ??
        interaction.options.getBoolean('lock_voice');
      if (lockSend !== null) lockdown.restrictions.lockSendMessages = lockSend;
      if (lockVoice !== null) lockdown.restrictions.lockVoiceConnect = lockVoice;
      await aegisStore.commitMutation('lockdown:config_updated', guildId);
    }

    await interaction.reply(
      buildSimpleNoticeV2(
        'AEGIS — BLOQUEO DE EMERGENCIA',
        [
          `**Estado:** ${lockdown.active ? 'ACTIVO' : 'EN ESPERA'}`,
          `**Canales Bloqueados:** ${lockdown.affectedChannelCount}`,
          `**Restricciones:** Mensajes=${lockdown.restrictions.lockSendMessages ? 'DENEGADO' : 'PERMITIDO'} | Voz=${lockdown.restrictions.lockVoiceConnect ? 'DENEGADO' : 'PERMITIDO'}`,
          `**Motivo:** ${lockdown.reason || 'Ninguno'}`,
        ],
        lockdown.active ? 0xef4444 : 0x10b981
      )
    );
    return;
  }

  if (interaction.commandName === 'whitelist') {
    if (sub === 'agregar' || sub === 'add') {
      const targetUser =
        interaction.options.getUser('usuario') ?? interaction.options.getUser('user', true);
      const reason =
        interaction.options.getString('motivo') ?? interaction.options.getString('reason', true);
      const scope = (interaction.options.getString('regla') ??
        interaction.options.getString('scope', true)) as
        | 'JOIN_BURST'
        | 'ACCOUNT_AGE'
        | 'BOT_DETECTION'
        | 'ANTI_NUKE'
        | 'LOCKDOWN_BYPASS';
      const entry = {
        id: `WL-${Date.now().toString(36).toUpperCase()}-${crypto
          .randomBytes(2)
          .toString('hex')
          .toUpperCase()}`,
        guildId,
        targetId: targetUser.id,
        targetName: targetUser.username,
        targetType: targetUser.bot ? ('BOT' as const) : ('USER' as const),
        reason,
        excludedRules: [scope],
        authorId: interaction.user.id,
        authorName: interaction.user.username,
        status: 'ACTIVE' as const,
        createdAt: new Date().toISOString(),
        expiresAt: null,
      };
      const { entry: savedEntry, updatedExisting } = aegisStore.upsertWhitelistEntry(state, entry);
      await aegisStore.commitMutation('whitelist:updated', guildId, { entry: savedEntry });
      await interaction.reply(
        buildSimpleNoticeV2(
          updatedExisting ? 'AEGIS — WHITELIST ACTUALIZADA' : 'AEGIS — WHITELIST AÑADIDA',
          [
            `${targetUser.username} quedó exento para: ${savedEntry.excludedRules.join(', ')}.`,
          ],
          0x10b981
        )
      );
      return;
    }

    if (sub === 'quitar' || sub === 'remove') {
      const targetId = (
        interaction.options.getString('id_objetivo') ??
        interaction.options.getString('target_id', true)
      ).trim();
      const found = state.whitelists.find(
        (w) => w.guildId === guildId && w.targetId === targetId && w.status === 'ACTIVE'
      );
      if (!found) {
        await interaction.reply({
          ...buildSimpleNoticeV2('AEGIS — WHITELIST', [`No existe una entrada activa para ${targetId}.`], 0xf59e0b),
          flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        });
        return;
      }
      found.status = 'REVOKED';
      await aegisStore.commitMutation('whitelist:updated', guildId, { id: found.id });
      await interaction.reply(
        buildSimpleNoticeV2('AEGIS — WHITELIST REVOCADA', [`Excepción revocada para ${targetId}.`])
      );
      return;
    }

    if (sub === 'verificar' || sub === 'check') {
      const targetId = (
        interaction.options.getString('id_objetivo') ??
        interaction.options.getString('target_id', true)
      ).trim();
      const matches = state.whitelists.filter(
        (w) => w.guildId === guildId && w.targetId === targetId
      );
      await interaction.reply({
        ...buildSimpleNoticeV2(
          'AEGIS — VERIFICACIÓN DE WHITELIST',
          matches.length === 0
            ? [`El objetivo ${targetId} no tiene excepciones en este servidor.`]
            : matches
                .slice(0, 6)
                .map((w) => `${w.id} · ${w.status} · Reglas: ${w.excludedRules.join(', ')} — ${w.reason}`)
        ),
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
      return;
    }

    const active = state.whitelists.filter((w) => w.guildId === guildId && w.status === 'ACTIVE');
    await interaction.reply({
      ...buildSimpleNoticeV2(
        'AEGIS — WHITELIST ACTIVA',
        active.length === 0
          ? ['No hay entradas activas en la whitelist de este servidor.']
          : active
              .slice(0, 8)
              .map((w) => `${w.id} · ${w.targetName} (${w.excludedRules.join(', ')})`)
      ),
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.commandName === 'seguridad' || interaction.commandName === 'security') {
    const suite = state.guildSecuritySuites[guildId];
    const addSec = suite.additionalSecurity;
    const enabledOption =
      interaction.options.getBoolean('activo') ?? interaction.options.getBoolean('enabled');
    if (sub === 'antialts') {
      if (enabledOption !== null) addSec.antiAlts.enabled = enabledOption;
      const minDays =
        interaction.options.getInteger('dias_minimos') ?? interaction.options.getInteger('min_days');
      if (minDays !== null) addSec.antiAlts.minAccountAgeDays = minDays;
      suite.updatedAt = new Date().toISOString();
      await aegisStore.commitMutation('security_suite:updated', guildId);
    } else if (sub === 'antibots') {
      addSec.antiBots = (interaction.options.getString('politica') ??
        interaction.options.getString('mode', true)) as
        | 'DISABLED'
        | 'UNVERIFIED_ONLY'
        | 'BAN_ALL';
      suite.updatedAt = new Date().toISOString();
      await aegisStore.commitMutation('security_suite:updated', guildId);
    } else if (sub === 'antiinvitaciones' || sub === 'antiinvites') {
      if (enabledOption !== null) addSec.antiInvites = enabledOption;
      suite.updatedAt = new Date().toISOString();
      await aegisStore.commitMutation('security_suite:updated', guildId);
    } else if (sub === 'antienlaces' || sub === 'antilinks') {
      if (enabledOption !== null) addSec.antiLinks.enabled = enabledOption;
      suite.updatedAt = new Date().toISOString();
      await aegisStore.commitMutation('security_suite:updated', guildId);
    } else if (sub === 'antiflood') {
      if (enabledOption !== null) addSec.antiFlood.enabled = enabledOption;
      suite.updatedAt = new Date().toISOString();
      await aegisStore.commitMutation('security_suite:updated', guildId);
    } else if (sub === 'antiscam') {
      if (enabledOption !== null) addSec.antiScam.enabled = enabledOption;
      suite.updatedAt = new Date().toISOString();
      await aegisStore.commitMutation('security_suite:updated', guildId);
    } else if (sub === 'antieveryone') {
      if (enabledOption !== null) addSec.antiEveryonePerms = enabledOption;
      suite.updatedAt = new Date().toISOString();
      await aegisStore.commitMutation('security_suite:updated', guildId);
    }

    const autoModCount = countActiveAutoModRules(addSec);
    await interaction.reply({
      ...buildSimpleNoticeV2(
        'AEGIS — SEGURIDAD ADICIONAL',
        [
          `**Banear Usuarios Maliciosos:** ${addSec.banMaliciousUsers ? 'ACTIVO' : 'DESACTIVADO'}`,
          `**Anti Flood:** ${addSec.antiFlood.enabled ? `ACTIVO (${addSec.antiFlood.maxMessages} msgs / ${addSec.antiFlood.windowSeconds}s)` : 'DESACTIVADO'}`,
          `**Anti Scam:** ${addSec.antiScam.enabled ? 'ACTIVO' : 'DESACTIVADO'}`,
          `**Anti Everyone Permisos:** ${addSec.antiEveryonePerms ? 'ACTIVO' : 'DESACTIVADO'}`,
          `**Anti Spam Webhooks:** ${addSec.antiWebhookSpam ? 'ACTIVO' : 'DESACTIVADO'}`,
          `**Anti Alts:** ${addSec.antiAlts.enabled ? `ACTIVO (mín. ${addSec.antiAlts.minAccountAgeDays}d)` : 'DESACTIVADO'}`,
          `**Anti Bots:** ${addSec.antiBots}`,
          `**Anti Invitaciones:** ${addSec.antiInvites ? 'ACTIVO' : 'DESACTIVADO'} | **Anti Enlaces:** ${addSec.antiLinks.enabled ? 'ACTIVO' : 'DESACTIVADO'}`,
          `**Reglas AutoMod Activas:** ${autoModCount}/6`,
        ],
        0x5865f2
      ),
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    ...buildSimpleNoticeV2(
      'AEGIS SECURITY',
      [`Comando no reconocido: /${interaction.commandName} ${sub ?? ''}.`],
      0xf59e0b
    ),
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  });
}
