import { Client, Events } from 'discord.js';
import { aegisLogger } from '../../lib/server/logger';
import { aegisStore } from '../../lib/server/store';
import { handleGuildAuditLogEntryCreate } from './modules/audit-guard';
import { handleDiscordInteraction, handleSlashCommand } from './modules/interactions';
import { handleGuildMemberAdd } from './modules/member-join';
import { handleMessageCreate } from './modules/message-guard';
import { auditGuildBotPermissions } from './modules/permissions';

export interface AttachAegisBotHandlersOptions {
  onGuildJoined?: (guildId: string, guildName: string) => Promise<void>;
  canProcessEvents?: () => boolean;
  trackOperation?: <T>(promise: Promise<T>) => Promise<T>;
}

const ATTACHED_CLIENTS = new WeakSet<Client>();

export { handleSlashCommand };

export function attachAegisBotHandlers(
  client: Client,
  options: AttachAegisBotHandlersOptions = {}
): void {
  if (ATTACHED_CLIENTS.has(client)) return;
  ATTACHED_CLIENTS.add(client);

  const allowEvent = () => (options.canProcessEvents ? options.canProcessEvents() : true);
  const track = <T>(p: Promise<T>): Promise<T> =>
    options.trackOperation ? options.trackOperation(p) : p;

  client.on(Events.GuildCreate, async (guild) => {
    if (!allowEvent()) return;
    const correlationId = aegisLogger.createCorrelationId('join_guild');
    await track(
      (async () => {
        try {
          const state = await aegisStore.getState();
          aegisStore.ensureGuildStructures(state, guild.id, guild.name);
          const permAudit = auditGuildBotPermissions(guild);
          if (state.antiRaidConfigs[guild.id]) {
            state.antiRaidConfigs[guild.id].botPermissionsMissing = permAudit.missingPermissions;
          }
          const nowIso = new Date().toISOString();
          aegisStore.syncGuildRecord(state, guild.id, {
            name: guild.name,
            iconUrl: guild.iconURL({ size: 256 }),
            ownerDiscordId: guild.ownerId,
            botStatus: permAudit.ok ? 'BOT_CONNECTED' : 'INSUFFICIENT_PERMISSIONS',
            botPermissionsOk: permAudit.ok,
            memberCount: guild.memberCount,
            memberCountKnown: typeof guild.memberCount === 'number' && guild.memberCount > 0,
            lastSyncAt: nowIso,
            linkedAt: nowIso,
          });
          await aegisStore.commitMutation(
            'guild:bot_joined',
            guild.id,
            { guildName: guild.name, missingPermissions: permAudit.missingPermissions },
            { correlationId }
          );
          if (options.onGuildJoined) {
            await options.onGuildJoined(guild.id, guild.name);
          }
        } catch (err) {
          aegisLogger.error('DISCORD', 'GuildCreate handler error', {
            guildId: guild.id,
            correlationId,
            meta: { error: err instanceof Error ? err.message : String(err) },
          });
        }
      })()
    );
  });

  client.on(Events.GuildDelete, async (guild) => {
    if (!allowEvent()) return;
    const correlationId = aegisLogger.createCorrelationId('leave_guild');
    await track(
      (async () => {
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
          await aegisStore.commitMutation('guild:bot_disconnected', guild.id, {}, { correlationId });
        } catch (err) {
          aegisLogger.error('DISCORD', 'GuildDelete handler error', {
            guildId: guild.id,
            correlationId,
            meta: { error: err instanceof Error ? err.message : String(err) },
          });
        }
      })()
    );
  });

  client.on(Events.GuildUpdate, async (_oldGuild, newGuild) => {
    if (!allowEvent()) return;
    const correlationId = aegisLogger.createCorrelationId('upd_guild');
    await track(
      (async () => {
        try {
          const state = await aegisStore.getState();
          aegisStore.syncGuildRecord(state, newGuild.id, {
            name: newGuild.name,
            iconUrl: newGuild.iconURL({ size: 256 }),
            ownerDiscordId: newGuild.ownerId,
            lastSyncAt: new Date().toISOString(),
          });
          await aegisStore.commitMutation(
            'guild:updated',
            newGuild.id,
            { guildName: newGuild.name },
            { correlationId }
          );
        } catch (err) {
          aegisLogger.error('DISCORD', 'GuildUpdate handler error', {
            guildId: newGuild.id,
            correlationId,
            meta: { error: err instanceof Error ? err.message : String(err) },
          });
        }
      })()
    );
  });

  client.on(Events.GuildMemberAdd, (member) => {
    if (!allowEvent()) return;
    void track(handleGuildMemberAdd(member));
  });

  client.on(Events.MessageCreate, (message) => {
    if (!allowEvent()) return;
    void track(handleMessageCreate(message));
  });

  client.on(Events.GuildAuditLogEntryCreate, (entry, guild) => {
    if (!allowEvent()) return;
    void track(handleGuildAuditLogEntryCreate(entry, guild));
  });

  client.on(Events.InteractionCreate, (interaction) => {
    if (!allowEvent()) return;
    void track(handleDiscordInteraction(interaction));
  });
}
