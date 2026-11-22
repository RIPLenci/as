import crypto from 'node:crypto';
import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Interaction,
} from 'discord.js';
import { countActiveAutoModRules } from '../../../lib/aegis/additional-security';
import {
  buildPlanQuotas,
  formatDurationHuman,
  isPaidTier,
  isSubscriptionActive,
  normalizePlanTier,
  parseDurationString,
} from '../../../lib/aegis/premium';
import { DEFAULT_RISK_WEIGHTS, evaluateJoinRisk } from '../../../lib/aegis/risk-engine';
import type { ProtectionMode } from '../../../lib/aegis/types';
import { enforceDiscordLockdown } from '../../../lib/server/discord-api';
import { aegisLogger } from '../../../lib/server/logger';
import { aegisStore } from '../../../lib/server/store';
import { buildAntiRaidPanelV2, buildSimpleNoticeV2 } from '../components/v2-panels';
import {
  auditGuildBotPermissions,
  isAuthorizedGuildOperator,
  isBotStaffMember,
} from './permissions';

export async function handleDiscordInteraction(interaction: Interaction): Promise<void> {
  try {
    if (interaction.isButton()) {
      if (!interaction.guildId || !interaction.guild) return;
      const state = await aegisStore.getState();
      aegisStore.ensureGuildStructures(state, interaction.guildId, interaction.guild.name);

      if (!isAuthorizedGuildOperator(state, interaction.guild, interaction.user.id)) {
        await interaction.reply({
          ...buildSimpleNoticeV2(
            'AEGIS SECURITY — ACCESO RESTRINGIDO',
            ['Solo el Dueño del servidor o el Segundo Dueño designado pueden operar este panel.'],
            0xef4444
          ),
          flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        });
        return;
      }

      const config = state.antiRaidConfigs[interaction.guildId];
      if (!config) return;
      const planTier = normalizePlanTier(state.guildPlans[interaction.guildId]?.tier);
      const correlationId = aegisLogger.createCorrelationId('btn');

      if (interaction.customId === 'aegis:toggle:enable') {
        const permAudit = auditGuildBotPermissions(interaction.guild);
        config.botPermissionsMissing = permAudit.missingPermissions;
        if (!permAudit.ok) {
          aegisStore.syncGuildRecord(state, interaction.guildId, {
            botStatus: 'INSUFFICIENT_PERMISSIONS',
            botPermissionsOk: false,
          });
          await interaction.reply({
            ...buildSimpleNoticeV2(
              'AEGIS — PERMISOS INSUFICIENTES',
              [
                'El bot no tiene los permisos necesarios para activar la protección automática.',
                `**Permisos faltantes:** ${permAudit.missingPermissions.join(', ')}`,
              ],
              0xf59e0b
            ),
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
          });
          return;
        }

        const nowIso = new Date().toISOString();
        config.enabled = true;
        config.activatedAt = config.activatedAt ?? nowIso;
        config.syncVersion += 1;
        config.lastSyncedAt = nowIso;
        aegisStore.syncGuildRecord(state, interaction.guildId, {
          botStatus: 'BOT_CONNECTED',
          botPermissionsOk: true,
          protectionEnabled: true,
          lastSyncAt: nowIso,
        });
        const syncRes = await aegisStore.commitMutation(
          'antiraid:enabled',
          interaction.guildId,
          { config },
          { correlationId }
        );
        config.syncStatus = syncRes.redisPublished
          ? 'SYNCHRONIZED'
          : syncRes.mongoPersisted
          ? 'PENDING_SYNC'
          : 'SYNC_ERROR';

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
        const syncRes = await aegisStore.commitMutation(
          'antiraid:disabled',
          interaction.guildId,
          { config },
          { correlationId }
        );
        config.syncStatus = syncRes.redisPublished
          ? 'SYNCHRONIZED'
          : syncRes.mongoPersisted
          ? 'PENDING_SYNC'
          : 'SYNC_ERROR';

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
    aegisLogger.error('DISCORD', 'Interaction handler error', {
      guildId: interaction.guildId ?? undefined,
      userId: interaction.user.id,
      meta: { error: err instanceof Error ? err.message : String(err) },
    });
  }
}

export async function handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const state = await aegisStore.getState();
  const guildId = interaction.guildId;
  const sub = interaction.options.getSubcommand(false);
  const correlationId = aegisLogger.createCorrelationId('cmd');

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
      const permAudit = auditGuildBotPermissions(interaction.guild);
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
            `**Permisos del Bot:** ${permAudit.ok ? 'Operativo (todos presentes)' : `Faltantes: ${permAudit.missingPermissions.join(', ')}`}`,
          ],
          permAudit.ok ? 0x10b981 : 0xf59e0b
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
      await aegisStore.commitMutation(
        'premium:staff_granted',
        undefined,
        { discordId: targetUser.id },
        { correlationId }
      );

      const remainingMs = subRecord.expiresAt
        ? new Date(subRecord.expiresAt).getTime() - Date.now()
        : 0;
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
      await aegisStore.commitMutation(
        'premium:staff_revoked',
        undefined,
        { discordId: targetUser.id },
        { correlationId }
      );
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
      await aegisStore.commitMutation(
        'premium:code_created',
        undefined,
        { code: created.record.code },
        { correlationId }
      );
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
      await aegisStore.commitMutation(
        'premium:code_redeemed',
        undefined,
        { discordId: interaction.user.id },
        { correlationId }
      );
      const subRecord = res.subscription;
      const remainingMs = subRecord.expiresAt
        ? new Date(subRecord.expiresAt).getTime() - Date.now()
        : 0;
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
      const permAudit = auditGuildBotPermissions(interaction.guild);
      config.botPermissionsMissing = permAudit.missingPermissions;
      if (!permAudit.ok) {
        aegisStore.syncGuildRecord(state, guildId, {
          botStatus: 'INSUFFICIENT_PERMISSIONS',
          botPermissionsOk: false,
        });
        await interaction.reply({
          ...buildSimpleNoticeV2(
            'AEGIS — PERMISOS INSUFICIENTES',
            [
              'El bot requiere los siguientes permisos antes de activar Anti-Raid:',
              permAudit.missingPermissions.join(', '),
            ],
            0xf59e0b
          ),
          flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        });
        return;
      }

      const nowIso = new Date().toISOString();
      config.enabled = true;
      config.activatedAt = nowIso;
      config.syncVersion += 1;
      config.lastSyncedAt = nowIso;
      aegisStore.syncGuildRecord(state, guildId, {
        botStatus: 'BOT_CONNECTED',
        botPermissionsOk: true,
        protectionEnabled: true,
        lastSyncAt: nowIso,
      });
      await aegisStore.commitMutation('antiraid:enabled', guildId, { config }, { correlationId });
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
      await aegisStore.commitMutation('antiraid:disabled', guildId, { config }, { correlationId });
    } else if (sub === 'modo' || sub === 'mode') {
      const mode = (interaction.options.getString('modo') ??
        interaction.options.getString('mode', true)) as ProtectionMode;
      config.mode = mode;
      config.syncVersion += 1;
      config.lastSyncedAt = new Date().toISOString();
      await aegisStore.commitMutation(
        'antiraid:config_updated',
        guildId,
        { config },
        { correlationId }
      );
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
      config.lastSyncedAt = new Date().toISOString();
      await aegisStore.commitMutation(
        'antiraid:config_updated',
        guildId,
        { config },
        { correlationId }
      );
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
        enabledDetectors: {
          suspiciousAccountDetection: config.suspiciousAccountDetection,
          botJoinDetection: config.botJoinDetection,
          joinPatternDetection: config.joinPatternDetection,
          burstDetection: config.burstDetection,
        },
      });
      await interaction.reply({
        ...buildSimpleNoticeV2(
          'AEGIS — DIAGNÓSTICO DEL MOTOR DE RIESGO',
          [
            `**Puntuación Simulada:** ${simEval.score}/100 (${simEval.level})`,
            `**Acción Recomendada:** ${simEval.recommendedAction}`,
            `**Modo Activo:** ${config.mode} (Umbral ${config.riskThreshold}/100)`,
            `**Señales Principales:** ${simEval.signals.slice(0, 3).map((s) => `${s.label} (+${s.weightedPoints})`).join(', ') || 'Sin señales'}`,
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
      await aegisStore.commitMutation('antinuke:updated', guildId, { config: antiNuke }, { correlationId });
    } else if (sub === 'desactivar' || sub === 'disable') {
      antiNuke.enabled = false;
      antiNuke.updatedAt = new Date().toISOString();
      await aegisStore.commitMutation('antinuke:updated', guildId, { config: antiNuke }, { correlationId });
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
      await aegisStore.commitMutation('antinuke:updated', guildId, { config: antiNuke }, { correlationId });
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
      await aegisStore.commitMutation('quarantine:created', guildId, { entry: savedEntry }, { correlationId });
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
      await aegisStore.commitMutation('quarantine:updated', guildId, { id: activeEntry.id }, { correlationId });
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
    let syncWarning = '';
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
      if (syncResult.failedChannelCount > 0) {
        syncWarning = `**Advertencia:** ${syncResult.failedChannelCount} canal(es) no pudieron modificarse por falta de permisos del bot.`;
      }
      await aegisStore.commitMutation('lockdown:activated', guildId, { lockdown }, { correlationId });
    } else if (sub === 'desactivar' || sub === 'deactivate') {
      const syncResult = await enforceDiscordLockdown({
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
      if (syncResult.failedChannelCount > 0) {
        syncWarning = `**Advertencia:** ${syncResult.failedChannelCount} canal(es) no pudieron restaurarse por falta de permisos del bot.`;
      } else if (syncResult.affectedChannelCount > 0) {
        syncWarning = `**Canales Restaurados:** ${syncResult.affectedChannelCount}`;
      }
      await aegisStore.commitMutation('lockdown:deactivated', guildId, { lockdown }, { correlationId });
    } else if (sub === 'configurar' || sub === 'config') {
      const lockSend =
        interaction.options.getBoolean('bloquear_mensajes') ??
        interaction.options.getBoolean('lock_send_messages');
      const lockVoice =
        interaction.options.getBoolean('bloquear_voz') ??
        interaction.options.getBoolean('lock_voice');
      if (lockSend !== null) lockdown.restrictions.lockSendMessages = lockSend;
      if (lockVoice !== null) lockdown.restrictions.lockVoiceConnect = lockVoice;
      await aegisStore.commitMutation('lockdown:config_updated', guildId, { lockdown }, { correlationId });
    }

    await interaction.reply(
      buildSimpleNoticeV2(
        'AEGIS — BLOQUEO DE EMERGENCIA',
        [
          `**Estado:** ${lockdown.active ? 'ACTIVO' : 'EN ESPERA'}`,
          `**Canales Bloqueados:** ${lockdown.affectedChannelCount}`,
          `**Restricciones:** Mensajes=${lockdown.restrictions.lockSendMessages ? 'DENEGADO' : 'PERMITIDO'} | Voz=${lockdown.restrictions.lockVoiceConnect ? 'DENEGADO' : 'PERMITIDO'}`,
          `**Motivo:** ${lockdown.reason || 'Ninguno'}`,
          syncWarning,
        ].filter(Boolean),
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
      await aegisStore.commitMutation('whitelist:updated', guildId, { entry: savedEntry }, { correlationId });
      await interaction.reply(
        buildSimpleNoticeV2(
          updatedExisting ? 'AEGIS — WHITELIST ACTUALIZADA' : 'AEGIS — WHITELIST AÑADIDA',
          [`${targetUser.username} quedó exento para: ${savedEntry.excludedRules.join(', ')}.`],
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
      await aegisStore.commitMutation('whitelist:updated', guildId, { id: found.id }, { correlationId });
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
      await aegisStore.commitMutation('security_suite:updated', guildId, { suite }, { correlationId });
    } else if (sub === 'antibots') {
      addSec.antiBots = (interaction.options.getString('politica') ??
        interaction.options.getString('mode', true)) as
        | 'DISABLED'
        | 'UNVERIFIED_ONLY'
        | 'BAN_ALL';
      suite.updatedAt = new Date().toISOString();
      await aegisStore.commitMutation('security_suite:updated', guildId, { suite }, { correlationId });
    } else if (sub === 'antiinvitaciones' || sub === 'antiinvites') {
      if (enabledOption !== null) addSec.antiInvites = enabledOption;
      suite.updatedAt = new Date().toISOString();
      await aegisStore.commitMutation('security_suite:updated', guildId, { suite }, { correlationId });
    } else if (sub === 'antienlaces' || sub === 'antilinks') {
      if (enabledOption !== null) addSec.antiLinks.enabled = enabledOption;
      suite.updatedAt = new Date().toISOString();
      await aegisStore.commitMutation('security_suite:updated', guildId, { suite }, { correlationId });
    } else if (sub === 'antiflood') {
      if (enabledOption !== null) addSec.antiFlood.enabled = enabledOption;
      suite.updatedAt = new Date().toISOString();
      await aegisStore.commitMutation('security_suite:updated', guildId, { suite }, { correlationId });
    } else if (sub === 'antiscam') {
      if (enabledOption !== null) addSec.antiScam.enabled = enabledOption;
      suite.updatedAt = new Date().toISOString();
      await aegisStore.commitMutation('security_suite:updated', guildId, { suite }, { correlationId });
    } else if (sub === 'antieveryone') {
      if (enabledOption !== null) addSec.antiEveryonePerms = enabledOption;
      suite.updatedAt = new Date().toISOString();
      await aegisStore.commitMutation('security_suite:updated', guildId, { suite }, { correlationId });
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
