import { PermissionFlagsBits, type Message } from 'discord.js';
import {
  evaluateAntiFloodBurst,
  evaluateAntiInviteMessage,
  evaluateAntiLinkMessage,
  evaluateAntiScamMessage,
} from '../../../lib/aegis/additional-security';
import { aegisTelemetry } from '../../../lib/aegis/telemetry';
import { aegisLogger } from '../../../lib/server/logger';
import { aegisStore } from '../../../lib/server/store';
import { tryClaimMitigation } from './permissions';

export async function handleMessageCreate(message: Message): Promise<void> {
  if (!message.guild || message.author.id === message.client.user?.id) return;
  const guildId = message.guild.id;
  const correlationId = aegisLogger.createCorrelationId('msg');

  try {
    aegisTelemetry.recordEventProcessed(guildId);
    const state = aegisStore.getHotStateSync();
    aegisStore.ensureGuildStructures(state, guildId, message.guild.name);
    const addSec = state.guildSecuritySuites[guildId].additionalSecurity;
    const me = message.guild.members.me;
    const canManageMessages = Boolean(me?.permissions.has(PermissionFlagsBits.ManageMessages));
    const canManageWebhooks = Boolean(me?.permissions.has(PermissionFlagsBits.ManageWebhooks));

    if (message.webhookId && addSec.antiWebhookSpam) {
      const whBurst = aegisStore.joinWindow.recordAndAnalyze(
        `guild:${guildId}:wh_msg:${message.webhookId}`,
        message.webhookId,
        10,
        4
      );
      if (whBurst.thresholdExceeded) {
        if (canManageMessages) {
          await message.delete().catch((err) => {
            aegisLogger.warn('DISCORD', 'Failed deleting rogue webhook spam message', {
              guildId,
              correlationId,
              meta: { error: err instanceof Error ? err.message : String(err) },
            });
          });
        }
        if (canManageWebhooks && tryClaimMitigation(`wh:${guildId}:${message.webhookId}`, 5000)) {
          const webhooks = await message.guild.fetchWebhooks().catch(() => null);
          const rogue = webhooks?.get(message.webhookId);
          if (rogue) {
            await rogue.delete('AEGIS Anti Spam Webhooks').catch((err) => {
              aegisLogger.warn('DISCORD', 'Failed removing rogue webhook', {
                guildId,
                correlationId,
                meta: { error: err instanceof Error ? err.message : String(err) },
              });
            });
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
        if (canManageMessages) {
          await message.delete().catch(() => undefined);
        }
        if (
          message.member?.moderatable &&
          tryClaimMitigation(`flood:${guildId}:${message.author.id}`, 4000)
        ) {
          await message.member
            .timeout((floodDecision.durationMinutes ?? 10) * 60_000, floodDecision.reason)
            .catch((err) => {
              aegisLogger.warn('SANCTION', 'Anti-Flood timeout failed', {
                guildId,
                userId: message.author.id,
                correlationId,
                meta: { error: err instanceof Error ? err.message : String(err) },
              });
            });
        }
        return;
      }
    }

    const content = message.content || '';
    if (!content) return;

    const scamDecision = evaluateAntiScamMessage(addSec, content);
    if (scamDecision.triggered) {
      if (canManageMessages) {
        await message.delete().catch(() => undefined);
      }
      if (
        message.member?.moderatable &&
        tryClaimMitigation(`scam:${guildId}:${message.author.id}`, 4000)
      ) {
        await message.member
          .timeout((scamDecision.durationMinutes ?? 30) * 60_000, scamDecision.reason)
          .catch((err) => {
            aegisLogger.warn('SANCTION', 'Anti-Scam timeout failed', {
              guildId,
              userId: message.author.id,
              correlationId,
              meta: { error: err instanceof Error ? err.message : String(err) },
            });
          });
      }
      return;
    }

    const inviteDecision = evaluateAntiInviteMessage(addSec, content, isChannelWhitelisted);
    if (inviteDecision.triggered && canManageMessages) {
      await message.delete().catch(() => undefined);
      return;
    }

    const linkDecision = evaluateAntiLinkMessage(addSec, content, isChannelWhitelisted);
    if (linkDecision.triggered && canManageMessages) {
      await message.delete().catch(() => undefined);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    aegisTelemetry.recordError(guildId, msg);
    aegisLogger.error('ANTIRAID', 'MessageCreate guard error', {
      guildId,
      correlationId,
      meta: { error: msg },
    });
  }
}
