import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from 'discord.js';
import type { AntiRaidConfigRecord, LockdownStateRecord, PlanTier } from '../../../lib/aegis/types';

/**
 * Paneles oficiales Discord Components V2 para AEGIS SECURITY.
 * Reglas estrictas:
 * - MessageFlags.IsComponentsV2 activado
 * - Sin embeds ni campos de texto tradicionales fuera de TextDisplayBuilder
 * - Cero emojis en textos y botones
 */

export function buildAntiRaidPanelV2(params: {
  guildName: string;
  config: AntiRaidConfigRecord;
  antiNukeEnabled: boolean;
  lockdown: LockdownStateRecord | undefined;
  planTier?: PlanTier;
}) {
  const { guildName, config, antiNukeEnabled, lockdown, planTier = 'FREE' } = params;
  const statusLabel = config.enabled ? 'ACTIVO' : 'DESACTIVADO';
  const planLabel =
    planTier === 'DIAMANTE'
      ? 'Plan Diamante'
      : planTier === 'ORO'
      ? 'Plan Oro'
      : 'Plan Gratuito';

  const headerText = new TextDisplayBuilder().setContent(
    `# AEGIS SECURITY\n**Centro de Protección del Servidor**`
  );

  const overviewSection = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          `**Estado de Protección:** ${statusLabel}`,
          `**Servidor:** ${guildName}`,
          `**Plan Activo:** ${planLabel}`,
          `**Modo:** ${config.mode}`,
          `**Umbral de Ingresos:** ${config.maxJoins} ingresos / ${config.timeWindowSeconds}s`,
          `**Umbral de Riesgo:** ${config.riskThreshold}/100`,
        ].join('\n')
      )
    )
    .setButtonAccessory(
      new ButtonBuilder()
        .setCustomId(config.enabled ? 'aegis:toggle:disable' : 'aegis:toggle:enable')
        .setLabel(config.enabled ? 'Desactivar Protección' : 'Activar Protección')
        .setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
    );

  const modulesText = new TextDisplayBuilder().setContent(
    [
      `**Módulos de Seguridad**`,
      `- Protección de Ingresos: ${config.enabled ? 'Activa' : 'Inactiva'}`,
      `- Defensa Anti-Nuke: ${antiNukeEnabled ? 'Activa' : 'Inactiva'}`,
      `- Motor de Riesgo: Operativo (Sync v${config.syncVersion})`,
      `- Cuarentena: Lista`,
      `- Lockdown de Emergencia: ${lockdown?.active ? 'ACTIVO' : 'En espera'}`,
    ].join('\n')
  );

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('aegis:panel:config')
      .setLabel('Configuración')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('aegis:panel:incidents')
      .setLabel('Incidentes')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('aegis:panel:status')
      .setLabel('Estado Actual')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('aegis:panel:refresh')
      .setLabel('Actualizar')
      .setStyle(ButtonStyle.Secondary)
  );

  const container = new ContainerBuilder()
    .setAccentColor(config.enabled ? 0x5865f2 : 0x64748b)
    .addTextDisplayComponents(headerText)
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    )
    .addSectionComponents(overviewSection)
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    )
    .addTextDisplayComponents(modulesText)
    .addActionRowComponents(actionRow);

  return {
    flags: MessageFlags.IsComponentsV2 as const,
    components: [container],
  };
}

export function buildCriticalAlertV2(params: {
  guildName: string;
  joinsDetected: number;
  windowSeconds: number;
  configuredThreshold: number;
  riskScore: number;
  actionTaken: string;
  incidentId: string;
}) {
  const container = new ContainerBuilder()
    .setAccentColor(0xef4444)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# AEGIS SECURITY — INCIDENTE CRÍTICO\nPosible raid detectado en el servidor.`
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          `**Servidor:** ${params.guildName}`,
          `**Actividad:** ${params.joinsDetected} ingresos detectados en ${params.windowSeconds} segundos.`,
          `**Umbral configurado:** ${params.configuredThreshold} ingresos.`,
          `**Puntuación de Riesgo:** ${params.riskScore}/100`,
          `**Acción Ejecutada:** ${params.actionTaken}`,
          `**Referencia:** Incidente registrado (${params.incidentId}).`,
        ].join('\n')
      )
    );

  return {
    flags: MessageFlags.IsComponentsV2 as const,
    components: [container],
  };
}

export function buildSimpleNoticeV2(
  title: string,
  lines: string[],
  accentColor = 0x5865f2,
  attachmentNames?: string[]
) {
  const container = new ContainerBuilder()
    .setAccentColor(accentColor)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`))
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    )
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));

  if (attachmentNames && attachmentNames.length > 0) {
    const gallery = new MediaGalleryBuilder().addItems(
      attachmentNames.slice(0, 5).map((name) =>
        new MediaGalleryItemBuilder().setURL(`attachment://${name}`)
      )
    );
    container.addMediaGalleryComponents(gallery);
  }

  return {
    flags: MessageFlags.IsComponentsV2 as const,
    components: [container],
  };
}
