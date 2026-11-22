import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  AttachmentBuilder,
  AuditLogEvent,
  UserFlagsBitField,
  type GuildMember,
} from 'discord.js';
import { evaluateAntiAlt, evaluateAntiBot } from '../../../lib/aegis/additional-security';
import { evaluateFastJoinMitigation } from '../../../lib/aegis/fast-antiraid';
import { formatExactDateTime } from '../../../lib/aegis/premium';
import { executeVerifiedSanction } from '../../../lib/aegis/sanction-executor';
import { KeyedAsyncMutex } from '../../../lib/aegis/sliding-window';
import { aegisTelemetry } from '../../../lib/aegis/telemetry';
import { aegisLogger } from '../../../lib/server/logger';
import { getMongoStatus } from '../../../lib/server/mongodb';
import { aegisStore, EVIDENCE_DIR } from '../../../lib/server/store';
import { recordSanctionActionToMongo } from '../../../lib/server/sync-coordinator';
import { buildCriticalAlertV2, buildSimpleNoticeV2 } from '../components/v2-panels';
import {
  auditGuildBotPermissions,
  buildSanctionHooks,
  inspectMemberCapability,
  tryClaimMitigation,
} from './permissions';

const guildJoinMutex = new KeyedAsyncMutex();

export async function handleGuildMemberAdd(member: GuildMember): Promise<void> {
  const guildId = member.guild.id;
  await guildJoinMutex.runExclusive(guildId, async () => {
    const correlationId = aegisLogger.createCorrelationId('join');
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    try {
      aegisTelemetry.recordEventProcessed(guildId, nowMs);

      const state = aegisStore.getHotStateSync();
      const missingGuildConfig = !state.antiRaidConfigs[guildId];
      if (missingGuildConfig && getMongoStatus() === 'CONNECTED') {
        await aegisStore.reconcileGuildConfigsFromMongo(guildId);
      }

      aegisStore.ensureGuildStructures(state, guildId, member.guild.name);
      const suite = state.guildSecuritySuites[guildId];
      const addSec = suite.additionalSecurity;
      const config = state.antiRaidConfigs[guildId];
      const botUserId = member.client.user?.id;

      // Refresh bot permissions telemetry quickly from Discord cache
      const permAudit = auditGuildBotPermissions(member.guild);
      if (config) {
        config.botPermissionsMissing = permAudit.missingPermissions;
      }
      aegisStore.syncGuildRecord(state, guildId, {
        botStatus: permAudit.ok ? 'BOT_CONNECTED' : 'INSUFFICIENT_PERMISSIONS',
        botPermissionsOk: permAudit.ok,
      });

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
        const attachedNames: string[] = [];
        let totalAttachBytes = 0;
        const MAX_DM_ATTACH_BYTES = 7_500_000;
        for (const evFile of (activeBan.evidenceFiles ?? []).slice(0, 5)) {
          const safeName = path.basename(evFile.filename);
          const absPath = path.join(EVIDENCE_DIR, activeBan.id, safeName);
          if (fs.existsSync(absPath)) {
            const stat = fs.statSync(absPath);
            if (totalAttachBytes + stat.size <= MAX_DM_ATTACH_BYTES) {
              evidenceAttachments.push(new AttachmentBuilder(absPath, { name: safeName }));
              attachedNames.push(safeName);
              totalAttachBytes += stat.size;
            }
          }
        }

        const baseDmLines = [
          `Has sido expulsado/baneado automáticamente de **${member.guild.name}** por encontrarte registrado en el sistema Globalban de AEGIS SECURITY.`,
          `**ID de Usuario:** ${activeBan.discordId}`,
          `**ID de Sanción:** ${activeBan.id}`,
          `**Motivo:** ${activeBan.reason}`,
          `**Tiempo:** ${tiempoLabel}`,
          `**Gravedad:** ${gravedadLabel}`,
          `**Apelable:** ${apelableLabel}`,
          `**Fecha de Sanción:** ${formatExactDateTime(activeBan.createdAt, 'es')}`,
          activeBan.evidence ? `**Detalle de Evidencia:** ${activeBan.evidence}` : '',
          attachedNames.length > 0
            ? `**Archivos adjuntos:** ${attachedNames.length} imagen(es) de evidencia.`
            : '',
        ].filter(Boolean);

        const dmNoticeWithMedia = buildSimpleNoticeV2(
          'AEGIS SECURITY — NOTIFICACIÓN DE GLOBALBAN',
          baseDmLines,
          0xef4444,
          attachedNames.length > 0 ? attachedNames : undefined
        );

        await Promise.race([
          member.user
            .send(
              evidenceAttachments.length > 0
                ? { ...dmNoticeWithMedia, files: evidenceAttachments }
                : dmNoticeWithMedia
            )
            .catch(async (dmErr) => {
              aegisLogger.warn('DISCORD', 'Globalban DM with attachments failed; retrying plain text notice', {
                guildId,
                userId: member.id,
                correlationId,
                meta: { error: dmErr instanceof Error ? dmErr.message : String(dmErr) },
              });
              if (evidenceAttachments.length > 0) {
                await member.user
                  .send(
                    buildSimpleNoticeV2(
                      'AEGIS SECURITY — NOTIFICACIÓN DE GLOBALBAN',
                      baseDmLines,
                      0xef4444
                    )
                  )
                  .catch(() => undefined);
              }
            }),
          new Promise((resolve) => setTimeout(resolve, 2500)),
        ]);

        const capability = inspectMemberCapability(member, botUserId);
        const sanctionRecord = await executeVerifiedSanction({
          correlationId,
          idempotencyKey: `globalban:${guildId}:${member.id}`,
          guildId,
          requestedAction: 'BAN',
          reason: `AEGIS Globalban (${activeBan.id}) | Gravedad: ${gravedadLabel} | Motivo: ${activeBan.reason}`,
          capability,
          hooks: buildSanctionHooks(member),
        });

        aegisTelemetry.recordSanctionOutcome({
          guildId,
          outcome: sanctionRecord.status === 'SUCCESS' ? 'SUCCESS' : sanctionRecord.status === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
          durationMs: sanctionRecord.durationMs,
          errorMessage: sanctionRecord.errorMessage,
        });
        aegisStore.recordSanctionOutcome(state, guildId, sanctionRecord, {
          eventAt: nowIso,
          detectorRunAt: nowIso,
        });
        void recordSanctionActionToMongo(sanctionRecord);

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
                    `**Resultado:** ${sanctionRecord.status === 'SUCCESS' ? 'Baneo automático ejecutado' : `Fallo/Permisos (${sanctionRecord.errorMessage || sanctionRecord.status})`}`,
                  ],
                  0xef4444
                )
              )
              .catch((ownerErr) => {
                aegisLogger.warn('DISCORD', 'Unable to DM guild owner for Globalban alert', {
                  guildId,
                  userId: member.id,
                  correlationId,
                  meta: { error: ownerErr instanceof Error ? ownerErr.message : String(ownerErr) },
                });
              })
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
          appliedAction: sanctionRecord.executedAction,
          status: sanctionRecord.status === 'SUCCESS' ? 'MITIGATED' : 'OPEN',
          assignedTo: null,
          evidenceSummary: `Globalban ${activeBan.id} (${gravedadLabel}, ${tiempoLabel}): ${activeBan.reason}${sanctionRecord.errorMessage ? ` · Nota: ${sanctionRecord.errorMessage}` : ''}`,
          signals: [],
          comments: [],
          createdAt: nowIso,
          updatedAt: nowIso,
        });
        aegisStore.scheduleHotCommit('security:globalban_enforced', guildId, {
          incidentId,
          banId: activeBan.id,
          correlationId,
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
                    'AEGIS SEGURIDAD — GLOBALBAN DETECTADO',
                    [
                      `**Usuario:** ${member.user.username} (${activeBan.discordId})`,
                      `**Motivo:** ${activeBan.reason}`,
                      `**Gravedad:** ${gravedadLabel} · **Tiempo:** ${tiempoLabel} · **Apelable:** ${apelableLabel}`,
                      `**Acción:** ${sanctionRecord.status === 'SUCCESS' ? 'Baneo automático ejecutado y aviso enviado al dueño.' : `Requiere atención (${sanctionRecord.errorMessage || sanctionRecord.status}).`}`,
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

      // 2. Anti Bots (Seguridad Adicional)
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
          const sanctionRecord = await executeVerifiedSanction({
            correlationId,
            idempotencyKey: `antibot:${guildId}:${member.id}`,
            guildId,
            requestedAction: 'BAN',
            reason: botDecision.reason,
            capability: inspectMemberCapability(member, botUserId),
            hooks: buildSanctionHooks(member),
          });
          aegisTelemetry.recordSanctionOutcome({
            guildId,
            outcome: sanctionRecord.status === 'SUCCESS' ? 'SUCCESS' : sanctionRecord.status === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
            durationMs: sanctionRecord.durationMs,
            errorMessage: sanctionRecord.errorMessage,
          });
          aegisStore.recordSanctionOutcome(state, guildId, sanctionRecord, {
            eventAt: nowIso,
            detectorRunAt: nowIso,
          });
          void recordSanctionActionToMongo(sanctionRecord);

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
                .catch((err) => {
                  aegisLogger.warn('SANCTION', 'Failed timing out unauthorized bot inviter', {
                    guildId,
                    userId: addEntry.executorId ?? undefined,
                    correlationId,
                    meta: { error: err instanceof Error ? err.message : String(err) },
                  });
                });
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
            appliedAction: sanctionRecord.executedAction,
            status: sanctionRecord.status === 'SUCCESS' ? 'MITIGATED' : 'OPEN',
            assignedTo: null,
            evidenceSummary: `${botDecision.reason}${sanctionRecord.errorMessage ? ` · Nota: ${sanctionRecord.errorMessage}` : ''}`,
            signals: [],
            comments: [],
            createdAt: nowIso,
            updatedAt: nowIso,
          });
          aegisStore.scheduleHotCommit('security:antibots_triggered', guildId, {
            incidentId,
            correlationId,
          });
          return;
        }
      }

      // 3. Anti Alts (Seguridad Adicional)
      const bypassAccountAge = aegisStore.isUserWhitelistedFast(guildId, member.id, 'ACCOUNT_AGE');
      if (!member.user.bot && !bypassAccountAge) {
        const altDecision = evaluateAntiAlt(addSec, member.user.createdTimestamp);
        if (altDecision.triggered) {
          const sanctionRecord = await executeVerifiedSanction({
            correlationId,
            idempotencyKey: `antialts:${guildId}:${member.id}`,
            guildId,
            requestedAction: 'KICK',
            reason: `AEGIS Anti Alts: ${altDecision.reason}`,
            capability: inspectMemberCapability(member, botUserId),
            hooks: buildSanctionHooks(member),
          });
          aegisTelemetry.recordSanctionOutcome({
            guildId,
            outcome: sanctionRecord.status === 'SUCCESS' ? 'SUCCESS' : sanctionRecord.status === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
            durationMs: sanctionRecord.durationMs,
            errorMessage: sanctionRecord.errorMessage,
          });
          aegisStore.recordSanctionOutcome(state, guildId, sanctionRecord, {
            eventAt: nowIso,
            detectorRunAt: nowIso,
          });
          void recordSanctionActionToMongo(sanctionRecord);

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
            appliedAction: sanctionRecord.executedAction,
            status: sanctionRecord.status === 'SUCCESS' ? 'MITIGATED' : 'OPEN',
            assignedTo: null,
            evidenceSummary: `${altDecision.reason}${sanctionRecord.errorMessage ? ` · Nota: ${sanctionRecord.errorMessage}` : ''}`,
            signals: [],
            comments: [],
            createdAt: nowIso,
            updatedAt: nowIso,
          });
          aegisStore.scheduleHotCommit('security:antialts_triggered', guildId, {
            incidentId,
            correlationId,
          });
          return;
        }
      }

      // 4. Ultra-Fast In-Memory Guild Anti-Raid Pipeline (respects master enabled + 4 switches)
      if (!config?.enabled) {
        if (config) config.lastEventAt = nowIso;
        return;
      }

      if (aegisStore.isUserWhitelistedFast(guildId, member.id, 'JOIN_BURST')) {
        config.eventsProcessed += 1;
        config.lastEventAt = nowIso;
        return;
      }

      const evalStart = performance.now();
      const burst = aegisStore.joinWindow.recordAndAnalyze(
        `guild:${guildId}:joins`,
        member.id,
        config.timeWindowSeconds,
        config.maxJoins,
        member.user.username,
        nowMs
      );

      if (config.burstDetection && burst.thresholdExceeded) {
        aegisStore.raidShield.markBurstDetected(guildId, config.timeWindowSeconds, nowMs);
      }

      const underActiveRaidShield = config.burstDetection
        ? aegisStore.raidShield.isUnderActiveRaid(guildId, nowMs)
        : false;
      const accountAgeDays = Math.floor((nowMs - member.user.createdTimestamp) / 86_400_000);

      const fastDecision = evaluateFastJoinMitigation({
        guildId,
        targetUserId: member.id,
        accountAgeDays,
        isBot: member.user.bot,
        hasAvatar: Boolean(member.user.avatar),
        joinsInWindow: config.burstDetection ? burst.countInWindow : 1,
        thresholdExceeded: config.burstDetection ? burst.thresholdExceeded : false,
        similarUsernameCount: config.joinPatternDetection ? burst.similarUsernameCount : 0,
        repetitiveJoinCount: config.joinPatternDetection ? burst.repetitiveSubjectCount : 0,
        underActiveRaidShield,
        concentrationScore: burst.concentrationScore,
        growthRateRatio: burst.growthRateRatio,
        config,
      });

      const evalDurationMs = Number((performance.now() - evalStart).toFixed(3));
      aegisTelemetry.recordDetectorRun(guildId, evalDurationMs, fastDecision.shouldMitigate, true);

      config.eventsProcessed += 1;
      config.threatsInvestigated = (config.threatsInvestigated ?? 0) + 1;
      config.lastEventAt = nowIso;
      config.lastDetectorRunAt = nowIso;

      if (!fastDecision.shouldMitigate) {
        return;
      }

      config.attacksDetected += 1;
      const capability = inspectMemberCapability(member, botUserId);
      const isPunitive =
        fastDecision.action !== 'LOG_ONLY' && fastDecision.action !== 'ALERT';

      let executedActionLabel: string = fastDecision.action;
      let incidentStatus: 'OPEN' | 'MITIGATED' = isPunitive ? 'OPEN' : 'OPEN';
      let eventStatus: 'PROCESSED' | 'MITIGATED' | 'FLAGGED' | 'LOGGED' = 'FLAGGED';
      let sanctionNote = '';

      if (isPunitive) {
        const sanctionRecord = await executeVerifiedSanction({
          correlationId,
          idempotencyKey: `antiraid:${guildId}:${member.id}:${fastDecision.action}`,
          guildId,
          requestedAction: fastDecision.action,
          reason: `AEGIS Anti-Raid Riesgo ${fastDecision.evaluation.score}/100 (${config.mode})`,
          timeoutDurationMs: 3600_000,
          capability,
          hooks: buildSanctionHooks(member),
        });

        aegisTelemetry.recordSanctionOutcome({
          guildId,
          outcome:
            sanctionRecord.status === 'SUCCESS'
              ? 'SUCCESS'
              : sanctionRecord.status === 'CANCELLED'
              ? 'CANCELLED'
              : 'FAILED',
          durationMs: sanctionRecord.durationMs,
          errorMessage: sanctionRecord.errorMessage,
        });
        aegisStore.recordSanctionOutcome(state, guildId, sanctionRecord, {
          eventAt: nowIso,
          detectorRunAt: nowIso,
        });
        void recordSanctionActionToMongo(sanctionRecord);

        executedActionLabel = sanctionRecord.executedAction;
        if (sanctionRecord.status === 'SUCCESS') {
          incidentStatus = 'MITIGATED';
          eventStatus = 'MITIGATED';
        } else {
          incidentStatus = 'OPEN';
          eventStatus = 'FLAGGED';
          sanctionNote = sanctionRecord.errorMessage
            ? ` · Error/Permisos: ${sanctionRecord.errorMessage}`
            : '';
          aegisLogger.warn('SANCTION', 'Anti-Raid sanction did not complete cleanly', {
            guildId,
            userId: member.id,
            correlationId,
            actionId: sanctionRecord.id,
            syncVersion: config.syncVersion,
            meta: {
              requestedAction: fastDecision.action,
              status: sanctionRecord.status,
              missingPermissions: sanctionRecord.missingPermissions,
              errorMessage: sanctionRecord.errorMessage,
            },
          });
        }
      } else {
        eventStatus = fastDecision.action === 'ALERT' ? 'FLAGGED' : 'LOGGED';
      }

      const incidentId = `INC-${new Date().getFullYear()}-${crypto
        .randomBytes(3)
        .toString('hex')
        .toUpperCase()}`;

      aegisStore.pushIncident(state, {
        id: incidentId,
        guildId,
        guildName: member.guild.name,
        threatType:
          config.burstDetection && burst.thresholdExceeded
            ? 'JOIN_RAID'
            : 'SUSPICIOUS_ACCOUNT_WAVE',
        riskScore: fastDecision.evaluation.score,
        riskLevel: fastDecision.evaluation.level,
        affectedUserId: member.id,
        affectedUsername: member.user.username,
        responsibleUserId: member.id,
        responsibleUsername: member.user.username,
        appliedAction: executedActionLabel,
        status: incidentStatus,
        assignedTo: null,
        evidenceSummary: `${burst.countInWindow} ingresos en ${config.timeWindowSeconds}s (límite ${config.maxJoins}) · Eval ${evalDurationMs}ms${fastDecision.escalatedByRaidShield ? ' · Escudo Activo de Ráfaga' : ''}${sanctionNote}.`,
        signals: fastDecision.evaluation.signals,
        comments: [],
        createdAt: nowIso,
        updatedAt: nowIso,
      });

      aegisStore.pushEvent(state, {
        id: `EVT-${Date.now().toString(36).toUpperCase()}-${crypto
          .randomBytes(2)
          .toString('hex')
          .toUpperCase()}`,
        guildId,
        guildName: member.guild.name,
        eventType:
          eventStatus === 'MITIGATED'
            ? 'JOIN_BURST_MITIGATED'
            : fastDecision.action === 'ALERT'
            ? 'JOIN_ALERT_ONLY'
            : 'FAST_ANTIRAID_ACTION',
        threatType:
          config.burstDetection && burst.thresholdExceeded
            ? 'JOIN_RAID'
            : 'SUSPICIOUS_ACCOUNT_WAVE',
        targetDiscordId: member.id,
        targetUsername: member.user.username,
        riskScore: fastDecision.evaluation.score,
        riskLevel: fastDecision.evaluation.level,
        actionTaken: executedActionLabel,
        status: eventStatus,
        createdAt: nowIso,
      });

      aegisStore.scheduleHotCommit('incident:created', guildId, { incidentId, correlationId });

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
                    actionTaken: executedActionLabel,
                    incidentId,
                  })
                )
                .catch((sendErr) => {
                  aegisLogger.warn('DISCORD', 'Failed sending critical alert V2 message', {
                    guildId,
                    correlationId,
                    meta: { error: sendErr instanceof Error ? sendErr.message : String(sendErr) },
                  });
                });
            }
          });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      aegisTelemetry.recordError(guildId, msg);
      aegisLogger.error('ANTIRAID', 'Unhandled exception in GuildMemberAdd pipeline', {
        guildId,
        userId: member.id,
        correlationId,
        meta: { error: msg },
      });
    }
  });
}
