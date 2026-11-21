'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Crown,
  ExternalLink,
  Plus,
  RefreshCw,
  Server,
  Shield,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  UserCheck,
  Users,
} from 'lucide-react';
import type {
  ClassifiedServerItem,
  GuildRecord,
  LanguageCode,
  PlanTier,
  UserRecord,
} from '@/lib/aegis/types';
import { classifyDiscordServers } from '@/lib/aegis/servers-classifier';
import { getPlanDisplayName, isPaidTier, normalizePlanTier } from '@/lib/aegis/premium';
import { getDict } from '@/lib/aegis/i18n';
import { aegisFetch } from '@/lib/aegis/client-auth';

interface ServerItem extends GuildRecord {
  inviteUrl?: string;
}

interface ServerPremiumSlotInfo {
  tier: PlanTier;
  slottedByMe: boolean;
  slottedByOther: boolean;
}

interface ServersViewProps {
  user: UserRecord;
  language: LanguageCode;
  activeGuildId: string;
  hasEnteredServer?: boolean;
  searchQuery?: string;
  syncNonce?: number;
  onSelectGuild: (guildId: string) => void;
  onOpenOverview?: (guildId?: string) => void;
  onNavigatePremium?: () => void;
  onServersUpdated: () => void;
}

type CategoryFilter = 'ALL' | 'OWNED' | 'ADMIN' | 'INVITE';

function GuildAvatar({
  guildId,
  name,
  iconUrl,
  active,
}: {
  guildId: string;
  name: string;
  iconUrl: string | null;
  active: boolean;
}) {
  const [imgFailed, setImgFailed] = useState(false);

  const initials = useMemo(() => {
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (words.length >= 2) return `${words[0][0]}${words[1][0]}`.toUpperCase();
    return name.trim().slice(0, 2).toUpperCase() || 'DS';
  }, [name]);

  if (iconUrl && !imgFailed) {
    return (
      <div className="relative shrink-0">
        <Image
          src={iconUrl}
          alt={name}
          width={52}
          height={52}
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className="w-[52px] h-[52px] rounded-2xl object-cover border border-slate-200/80 dark:border-white/[0.12] shadow-sm bg-slate-100 dark:bg-[#13192B]"
        />
        <span
          aria-hidden="true"
          className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-[#0F1422] ${
            active ? 'bg-emerald-500' : 'bg-amber-400'
          }`}
        />
      </div>
    );
  }

  return (
    <div
      data-guild-monogram={guildId}
      className="relative w-[52px] h-[52px] rounded-2xl bg-gradient-to-br from-[#5865F2]/25 via-indigo-500/15 to-sky-500/15 border border-[#5865F2]/30 flex items-center justify-center shrink-0 shadow-sm"
    >
      <span className="font-display font-bold text-sm tracking-tight text-indigo-700 dark:text-indigo-200">
        {initials}
      </span>
      <span
        aria-hidden="true"
        className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-[#0F1422] ${
          active ? 'bg-emerald-500' : 'bg-amber-400'
        }`}
      />
    </div>
  );
}

function ServerCard({
  srv,
  index,
  isSelected,
  verifying,
  togglingSlot,
  slotInfo,
  language,
  onSelectGuild,
  onTogglePremiumSlot,
  onVerify,
  onTrackInvite,
}: {
  srv: ClassifiedServerItem;
  index: number;
  isSelected: boolean;
  verifying: boolean;
  togglingSlot: boolean;
  slotInfo?: ServerPremiumSlotInfo;
  language: LanguageCode;
  onSelectGuild: (guildId: string) => void;
  onTogglePremiumSlot: (guildId: string, action: 'ASSIGN_SLOT' | 'RELEASE_SLOT') => void;
  onVerify: (guildId: string) => void;
  onTrackInvite: (guildId: string) => void;
}) {
  const t = getDict(language);
  const botActive = srv.botStatus === 'BOT_CONNECTED';
  const showMembers = Boolean(srv.memberCountKnown) && srv.memberCount > 0;
  const guildPlanTier = normalizePlanTier(slotInfo?.tier);
  const guildHasPremium = isPaidTier(guildPlanTier);

  const roleStyle =
    srv.roleTag === 'PROPIETARIO'
      ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25'
      : srv.roleTag === 'SEGUNDO DUEÑO'
      ? 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/25'
      : srv.roleTag === 'ADMINISTRADOR'
      ? 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/25'
      : 'bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/20';

  const statusStyle = botActive
    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25'
    : 'bg-slate-100 dark:bg-white/[0.04] text-slate-600 dark:text-slate-400 border-slate-200 dark:border-white/[0.1]';

  return (
    <motion.article
      initial={{ opacity: 0, y: 12, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        duration: 0.34,
        delay: Math.min(index * 0.035, 0.28),
        ease: [0.16, 1, 0.3, 1],
      }}
      whileHover={{ y: -3 }}
      className={`group relative overflow-hidden rounded-2xl p-5 backdrop-blur-xl transition-colors duration-200 flex flex-col justify-between gap-5 shadow-[0_8px_30px_rgba(15,23,42,0.06)] dark:shadow-[0_14px_40px_rgba(0,0,0,0.38)] border ${
        isSelected && botActive
          ? 'bg-white/95 dark:bg-[#111728]/90 border-[#5865F2]/60 ring-1 ring-[#5865F2]/30'
          : 'bg-white/85 dark:bg-[#0D121E]/85 border-slate-200/80 dark:border-white/[0.08] hover:border-slate-300 dark:hover:border-white/[0.18]'
      }`}
    >
      {/* Subtle Apple glass highlight */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/70 dark:via-white/20 to-transparent"
      />

      <div className="space-y-4">
        {/* Card header: icon + name + member count */}
        <div className="flex items-start gap-3.5 min-w-0">
          <GuildAvatar
            guildId={srv.guildId}
            name={srv.name}
            iconUrl={srv.iconUrl}
            active={botActive}
          />
          <div className="min-w-0 flex-1 space-y-1">
            <h3
              title={srv.name}
              className="font-display font-semibold text-base tracking-tight text-slate-900 dark:text-white truncate"
            >
              {srv.name}
            </h3>
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <Users className="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-slate-500" />
              {showMembers ? (
                <span className="tabular-nums font-medium text-slate-700 dark:text-slate-300">
                  {srv.memberCount.toLocaleString(language === 'es' ? 'es-ES' : 'en-US')}{' '}
                  {t.servers.membersLabel}
                </span>
              ) : (
                <span className="truncate">{t.servers.membersUnknown}</span>
              )}
            </div>
          </div>
        </div>

        {/* Role & Bot Status Badges */}
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-mono font-semibold tracking-wide ${roleStyle}`}
          >
            {srv.roleTag === 'PROPIETARIO' ? (
              <Crown className="w-3 h-3" />
            ) : srv.roleTag === 'SEGUNDO DUEÑO' || srv.roleTag === 'ADMINISTRADOR' ? (
              <Shield className="w-3 h-3" />
            ) : (
              <UserCheck className="w-3 h-3" />
            )}
            <span>{t.servers.roles[srv.roleTag]}</span>
          </span>

          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-mono font-semibold tracking-wide ${statusStyle}`}
          >
            <span
              aria-hidden="true"
              className={`w-1.5 h-1.5 rounded-full ${
                botActive ? 'bg-emerald-500' : 'bg-amber-400'
              }`}
            />
            <span>{botActive ? t.servers.botStates.ACTIVE : t.servers.botStates.NOT_INSTALLED}</span>
          </span>

          {guildHasPremium && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-amber-500/35 bg-amber-500/10 text-amber-600 dark:text-amber-300 text-[11px] font-mono font-semibold">
              <Crown className="w-3 h-3" />
              <span>{getPlanDisplayName(guildPlanTier, language)}</span>
            </span>
          )}
        </div>

        {/* Protection state line ONLY when bot is installed & user can manage */}
        {srv.canManage && (
          <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-white/[0.06] text-xs">
            <span className="text-slate-500 dark:text-slate-400">
              {language === 'es' ? 'Defensa AEGIS' : 'AEGIS Defense'}
            </span>
            <span
              className={`inline-flex items-center gap-1.5 font-medium ${
                srv.protectionEnabled
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              {srv.protectionEnabled ? (
                <>
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>{t.servers.states.PROTECTION_ENABLED}</span>
                </>
              ) : (
                <>
                  <ShieldOff className="w-3.5 h-3.5 text-slate-400" />
                  <span>{t.servers.states.PROTECTION_DISABLED}</span>
                </>
              )}
            </span>
          </div>
        )}
      </div>

      {/* Actions: strictly respect bot installation and admin permission boundaries */}
      <div className="pt-1 flex flex-wrap items-center gap-2">
        {srv.canManage ? (
          <>
            <motion.button
              type="button"
              whileTap={{ scale: 0.98 }}
              onClick={() => onSelectGuild(srv.guildId)}
              className={`flex-1 min-w-[140px] inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                isSelected
                  ? 'bg-[#5865F2] text-white shadow-[0_8px_20px_rgba(88,101,242,0.35)]'
                  : 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-[#5865F2] dark:hover:bg-[#5865F2] dark:hover:text-white'
              }`}
            >
              <span>
                {srv.priorityTier === 'OWNED' ? t.servers.configureBot : t.servers.manageBot}
              </span>
              <ArrowRight className="w-3.5 h-3.5" />
            </motion.button>

            {slotInfo?.slottedByMe ? (
              <button
                type="button"
                disabled={togglingSlot}
                onClick={() => onTogglePremiumSlot(srv.guildId, 'RELEASE_SLOT')}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-amber-500/45 bg-amber-500/15 text-amber-600 dark:text-amber-300 hover:bg-amber-500/25 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                <Crown className="w-3.5 h-3.5" />
                <span>{language === 'es' ? 'Desactivar Premium' : 'Deactivate Premium'}</span>
              </button>
            ) : slotInfo?.slottedByOther ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-[11px] font-semibold text-emerald-500 whitespace-nowrap">
                <Crown className="w-3 h-3" />
                <span>{language === 'es' ? 'Premium Co-Dueño' : 'Co-Owner Premium'}</span>
              </span>
            ) : (
              <button
                type="button"
                disabled={togglingSlot}
                onClick={() => onTogglePremiumSlot(srv.guildId, 'ASSIGN_SLOT')}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-amber-500/35 bg-gradient-to-r from-amber-500/15 to-yellow-500/10 text-amber-700 dark:text-amber-300 hover:border-amber-400 hover:bg-amber-500/25 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                <Crown className="w-3.5 h-3.5" />
                <span>{language === 'es' ? 'Activar Premium' : 'Activate Premium'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => onVerify(srv.guildId)}
              disabled={verifying}
              title={t.servers.verifyConnection}
              aria-label={`${t.servers.verifyConnection} ${srv.name}`}
              className="px-3 py-2.5 rounded-xl border border-slate-200 dark:border-white/[0.1] bg-slate-50/70 dark:bg-white/[0.03] text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.08] transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${verifying ? 'animate-spin' : ''}`} />
            </button>
          </>
        ) : srv.canInvite ? (
          <>
            {srv.inviteUrl ? (
              <motion.a
                whileTap={{ scale: 0.98 }}
                href={srv.inviteUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => onTrackInvite(srv.guildId)}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-semibold shadow-[0_8px_22px_rgba(88,101,242,0.32)] transition-colors whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t.servers.inviteBot.replace(/^\+\s*/, '')}</span>
                <ExternalLink className="w-3 h-3 opacity-80" />
              </motion.a>
            ) : null}
            <button
              type="button"
              onClick={() => onVerify(srv.guildId)}
              disabled={verifying}
              className="px-3 py-2.5 rounded-xl border border-slate-200 dark:border-white/[0.1] bg-slate-50/70 dark:bg-white/[0.03] text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.08] transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60"
            >
              {verifying ? '...' : t.servers.verifyConnection}
            </button>
          </>
        ) : (
          <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-relaxed pt-1 border-t border-slate-100 dark:border-white/[0.06] w-full font-medium">
            {language === 'es'
              ? 'Solo el Dueño o el Segundo Dueño pueden configurar este servidor.'
              : 'Only the Primary Owner or Secondary Owner can configure this server.'}
          </p>
        )}
      </div>
    </motion.article>
  );
}

function ServersSkeletonGrid({ message }: { message: string }) {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-indigo-500/8 border border-indigo-500/20 text-xs font-medium text-indigo-700 dark:text-indigo-300">
        <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
        <span>{message}</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, idx) => (
          <div
            key={idx}
            className="rounded-2xl p-5 bg-white/70 dark:bg-[#0D121E]/80 border border-slate-200/70 dark:border-white/[0.07] space-y-5"
          >
            <div className="flex items-center gap-3.5">
              <div className="w-[52px] h-[52px] rounded-2xl bg-slate-200/80 dark:bg-white/[0.07]" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-3/5 rounded-md bg-slate-200/80 dark:bg-white/[0.08]" />
                <div className="h-3 w-2/5 rounded-md bg-slate-200/60 dark:bg-white/[0.05]" />
              </div>
            </div>
            <div className="flex gap-2">
              <div className="h-6 w-24 rounded-lg bg-slate-200/70 dark:bg-white/[0.06]" />
              <div className="h-6 w-20 rounded-lg bg-slate-200/70 dark:bg-white/[0.06]" />
            </div>
            <div className="h-10 w-full rounded-xl bg-slate-200/80 dark:bg-white/[0.07]" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ServersView({
  user,
  language,
  activeGuildId,
  hasEnteredServer = false,
  searchQuery = '',
  syncNonce = 0,
  onSelectGuild,
  onOpenOverview,
  onNavigatePremium,
  onServersUpdated,
}: ServersViewProps) {
  const t = getDict(language);
  const [servers, setServers] = useState<ServerItem[]>([]);
  const [genericInviteUrl, setGenericInviteUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [togglingSlotId, setTogglingSlotId] = useState<string | null>(null);
  const [premiumSub, setPremiumSub] = useState<{
    tier: PlanTier;
    remainingMs: number;
    maxServers: number;
    activatedGuildIds: string[];
  } | null>(null);
  const [serverSlots, setServerSlots] = useState<Record<string, ServerPremiumSlotInfo>>({});
  const [slotNotice, setSlotNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<CategoryFilter>('ALL');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{
    headline: string;
    serverName: string;
    botState: string;
    securityState: string;
  } | null>(null);
  const [avatarFailed, setAvatarFailed] = useState(false);

  const pendingInviteGuildRef = useRef<string | null>(null);

  const loadPremiumInfo = useCallback(async () => {
    try {
      const pRes = await aegisFetch('/api/premium');
      if (!pRes.ok) return;
      const pJson = await pRes.json().catch(() => null);
      if (!pJson) return;
      if (pJson.subscription) {
        setPremiumSub({
          tier: pJson.subscription.tier ?? 'FREE',
          remainingMs: pJson.subscription.remainingMs ?? 0,
          maxServers: pJson.subscription.maxServers ?? 0,
          activatedGuildIds: pJson.subscription.activatedGuildIds ?? [],
        });
      }
      const nextMap: Record<string, ServerPremiumSlotInfo> = {};
      for (const s of pJson.servers || []) {
        nextMap[s.guildId] = {
          tier: s.tier ?? 'FREE',
          slottedByMe: Boolean(s.slottedByMe),
          slottedByOther: Boolean(s.slottedByOther),
        };
      }
      setServerSlots(nextMap);
    } catch {
      // keep existing state cleanly
    }
  }, []);

  const loadServers = useCallback(
    async (liveRefresh = false) => {
      if (liveRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setLoadError(null);

      try {
        const [res] = await Promise.all([
          aegisFetch(liveRefresh ? '/api/auth/servers?refresh=1' : '/api/auth/servers'),
          loadPremiumInfo(),
        ]);
        if (!res.ok) {
          const errPayload = await res.json().catch(() => null);
          throw new Error(
            errPayload?.message || `Discord server sync failed (${res.status}).`
          );
        }
        const json = await res.json();
        setServers(json.servers || []);
        setGenericInviteUrl(json.genericInviteUrl || '');
        setSyncWarning(json.syncWarning || null);
      } catch (err) {
        setLoadError(
          err instanceof Error
            ? err.message
            : 'No se pudo conectar con la API de servidores de Discord.'
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [loadPremiumInfo]
  );

  useEffect(() => {
    let cancelled = false;
    Promise.all([aegisFetch('/api/auth/servers'), aegisFetch('/api/premium')])
      .then(async ([res, pRes]) => {
        if (cancelled) return;
        if (!res.ok) {
          const errPayload = await res.json().catch(() => null);
          throw new Error(
            errPayload?.message || `Discord server sync failed (${res.status}).`
          );
        }
        const json = await res.json();
        if (cancelled) return;
        setServers(json.servers || []);
        setGenericInviteUrl(json.genericInviteUrl || '');
        setSyncWarning(json.syncWarning || null);

        if (pRes.ok) {
          const pJson = await pRes.json().catch(() => null);
          if (!cancelled && pJson) {
            if (pJson.subscription) {
              setPremiumSub({
                tier: pJson.subscription.tier ?? 'FREE',
                remainingMs: pJson.subscription.remainingMs ?? 0,
                maxServers: pJson.subscription.maxServers ?? 0,
                activatedGuildIds: pJson.subscription.activatedGuildIds ?? [],
              });
            }
            const nextMap: Record<string, ServerPremiumSlotInfo> = {};
            for (const s of pJson.servers || []) {
              nextMap[s.guildId] = {
                tier: s.tier ?? 'FREE',
                slottedByMe: Boolean(s.slottedByMe),
                slottedByOther: Boolean(s.slottedByOther),
              };
            }
            setServerSlots(nextMap);
          }
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(
          err instanceof Error
            ? err.message
            : 'No se pudo conectar con la API de servidores de Discord.'
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [syncNonce]);

  const handleTogglePremiumSlot = useCallback(
    async (guildId: string, action: 'ASSIGN_SLOT' | 'RELEASE_SLOT') => {
      setActionError(null);
      setSlotNotice(null);
      setTogglingSlotId(guildId);
      try {
        const res = await aegisFetch(`/api/guilds/${guildId}/premium`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          setActionError(
            json?.message ||
              (language === 'es'
                ? 'Necesitas un Plan Oro o Plan Diamante activo para activar Premium en este servidor.'
                : 'An active Gold or Diamond plan is required to activate Premium here.')
          );
          return;
        }
        setSlotNotice(
          action === 'ASSIGN_SLOT'
            ? language === 'es'
              ? 'Premium activado correctamente en el servidor seleccionado.'
              : 'Premium activated on the selected server.'
            : language === 'es'
            ? 'Premium desactivado en este servidor. Cupo liberado.'
            : 'Premium deactivated on this server. Slot released.'
        );
        await loadPremiumInfo();
        onServersUpdated();
      } catch {
        setActionError(
          language === 'es'
            ? 'Error de red al actualizar el cupo Premium del servidor.'
            : 'Network error while updating server Premium slot.'
        );
      } finally {
        setTogglingSlotId(null);
      }
    },
    [language, loadPremiumInfo, onServersUpdated]
  );

  const handleVerify = useCallback(
    async (guildId: string) => {
      setActionError(null);
      setConfirmation(null);
      setVerifyingId(guildId);
      try {
        const res = await aegisFetch('/api/auth/servers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guildId }),
        });
        const json = await res.json();
        if (!res.ok) {
          setActionError(
            json.message ||
              (language === 'es'
                ? 'No se pudo completar la verificación.'
                : 'Verification failed.')
          );
        } else {
          setConfirmation(json.confirmation);
          await loadServers(false);
          onServersUpdated();
        }
      } catch (err) {
        setActionError(
          err instanceof Error
            ? err.message
            : language === 'es'
            ? 'Error al verificar la conexión del bot de Discord.'
            : 'Error verifying Discord bot connection.'
        );
      } finally {
        setVerifyingId(null);
      }
    },
    [loadServers, onServersUpdated, language]
  );

  // Automatic status refresh when user returns from Discord bot authorization tab
  useEffect(() => {
    const syncAfterReturn = () => {
      const targetGuild = pendingInviteGuildRef.current;
      if (!targetGuild) return;
      pendingInviteGuildRef.current = null;
      void handleVerify(targetGuild).then(() => loadServers(true));
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') syncAfterReturn();
    };

    window.addEventListener('focus', syncAfterReturn);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', syncAfterReturn);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [handleVerify, loadServers]);

  const fullClassified = useMemo(() => classifyDiscordServers(servers), [servers]);

  const filteredClassified = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    const searched = needle
      ? fullClassified.orderedAll.filter(
          (s) =>
            s.name.toLowerCase().includes(needle) ||
            s.guildId.toLowerCase().includes(needle)
        )
      : fullClassified.orderedAll;
    return classifyDiscordServers(searched);
  }, [fullClassified, searchQuery]);

  const displayName = user.globalName || user.username;
  const userInitials = displayName.slice(0, 2).toUpperCase();

  const sections = useMemo(() => {
    const list: Array<{
      key: 'OWNED' | 'ADMIN' | 'INVITE' | 'MEMBER';
      badge: string;
      title: string;
      description: string;
      icon: React.ComponentType<{ className?: string }>;
      accentClass: string;
      items: ClassifiedServerItem[];
    }> = [
      {
        key: 'OWNED',
        badge: t.servers.priorities.ownedBadge,
        title: t.servers.priorities.ownedTitle,
        description: t.servers.priorities.ownedDesc,
        icon: Crown,
        accentClass: 'text-amber-500 bg-amber-500/10 border-amber-500/25',
        items: filteredClassified.owned,
      },
      {
        key: 'ADMIN',
        badge: t.servers.priorities.adminBadge,
        title: t.servers.priorities.adminTitle,
        description: t.servers.priorities.adminDesc,
        icon: Shield,
        accentClass: 'text-indigo-500 bg-indigo-500/10 border-indigo-500/25',
        items: filteredClassified.admin,
      },
      {
        key: 'INVITE',
        badge: t.servers.priorities.inviteBadge,
        title: t.servers.priorities.inviteTitle,
        description: t.servers.priorities.inviteDesc,
        icon: Sparkles,
        accentClass: 'text-sky-500 bg-sky-500/10 border-sky-500/25',
        items: filteredClassified.invite,
      },
      {
        key: 'MEMBER',
        badge: t.servers.priorities.memberBadge,
        title: t.servers.priorities.memberTitle,
        description: t.servers.priorities.memberDesc,
        icon: UserCheck,
        accentClass: 'text-slate-500 bg-slate-500/10 border-slate-500/25',
        items: filteredClassified.memberConnected,
      },
    ];

    return list.filter((section) => {
      if (section.items.length === 0) return false;
      if (filter === 'ALL') return true;
      return section.key === filter;
    });
  }, [filteredClassified, filter, t]);

  return (
    <div className="space-y-8">
      {/* 1. APPLE-INSPIRED WELCOME HERO */}
      <motion.section
        initial={{ opacity: 0, y: 12, filter: 'blur(6px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className="relative overflow-hidden rounded-3xl border border-slate-200/80 dark:border-white/[0.09] bg-white/85 dark:bg-[#0C111E]/90 backdrop-blur-2xl p-6 sm:p-8 shadow-[0_20px_60px_rgba(15,23,42,0.07)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
      >
        {/* Subtle dynamic ambient gradients */}
        <motion.div
          aria-hidden="true"
          animate={{ opacity: [0.35, 0.55, 0.35] }}
          transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
          className="pointer-events-none -top-24 -right-24 w-[420px] h-[300px] rounded-full bg-radial from-[#5865F2]/20 via-sky-400/10 to-transparent blur-3xl absolute"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none -bottom-24 -left-16 w-[320px] h-[220px] rounded-full bg-radial from-emerald-500/10 to-transparent blur-3xl absolute"
        />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          {/* Avatar + Welcome Typography */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-5 min-w-0">
            <motion.div
              initial={{ scale: 0.88, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 220, damping: 20, delay: 0.08 }}
              className="relative shrink-0 self-start sm:self-center p-[3px] rounded-full bg-gradient-to-tr from-[#5865F2] via-sky-400/70 to-emerald-400/70 shadow-[0_0_28px_rgba(88,101,242,0.28)]"
            >
              {user.avatarUrl && !avatarFailed ? (
                <Image
                  src={user.avatarUrl}
                  alt={displayName}
                  width={68}
                  height={68}
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarFailed(true)}
                  className="w-16 h-16 sm:w-[68px] sm:h-[68px] rounded-full object-cover bg-white dark:bg-[#0B0F19]"
                />
              ) : (
                <div className="w-16 h-16 sm:w-[68px] sm:h-[68px] rounded-full bg-slate-900 dark:bg-[#13192B] flex items-center justify-center font-display font-bold text-lg text-white">
                  {userInitials}
                </div>
              )}
            </motion.div>

            <div className="space-y-1.5 min-w-0">
              <motion.p
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.12 }}
                className="text-xs sm:text-sm font-medium text-[#5865F2] dark:text-sky-300"
              >
                {t.servers.welcomeTitle}
              </motion.p>
              <motion.h1
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.38, delay: 0.16 }}
                className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-slate-900 dark:text-white truncate"
              >
                {displayName}
              </motion.h1>
              <motion.p
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.38, delay: 0.22 }}
                className="text-sm sm:text-base text-slate-600 dark:text-slate-300/80 max-w-xl"
              >
                {t.servers.welcomeSubtitle}
              </motion.p>
            </div>
          </div>

          {/* Right: Real Counter Summary + Sync Button */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.24 }}
            className="flex flex-col sm:items-end gap-3 shrink-0"
          >
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="px-3.5 py-2.5 rounded-2xl bg-slate-50/90 dark:bg-white/[0.04] border border-slate-200/70 dark:border-white/[0.08]">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  {t.servers.filters.all}
                </div>
                <div className="font-display text-lg font-bold text-slate-900 dark:text-white tabular-nums">
                  {fullClassified.stats.total}
                </div>
              </div>
              <div className="px-3.5 py-2.5 rounded-2xl bg-slate-50/90 dark:bg-white/[0.04] border border-slate-200/70 dark:border-white/[0.08]">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  {t.servers.filters.owned}
                </div>
                <div className="font-display text-lg font-bold text-amber-600 dark:text-amber-400 tabular-nums">
                  {fullClassified.stats.ownedCount}
                </div>
              </div>
              <div className="px-3.5 py-2.5 rounded-2xl bg-slate-50/90 dark:bg-white/[0.04] border border-slate-200/70 dark:border-white/[0.08]">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  {t.servers.filters.admin}
                </div>
                <div className="font-display text-lg font-bold text-indigo-600 dark:text-indigo-400 tabular-nums">
                  {fullClassified.stats.adminCount}
                </div>
              </div>
              <div className="px-3.5 py-2.5 rounded-2xl bg-slate-50/90 dark:bg-white/[0.04] border border-slate-200/70 dark:border-white/[0.08]">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  {t.servers.filters.invite}
                </div>
                <div className="font-display text-lg font-bold text-sky-600 dark:text-sky-400 tabular-nums">
                  {fullClassified.stats.inviteCount}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {premiumSub && isPaidTier(normalizePlanTier(premiumSub.tier)) && premiumSub.remainingMs > 0 && (
                <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-amber-500/35 bg-amber-500/10 text-xs font-mono font-semibold text-amber-600 dark:text-amber-300 tabular-nums">
                  <Crown className="w-3.5 h-3.5" />
                  <span>
                    {getPlanDisplayName(normalizePlanTier(premiumSub.tier), language)} ·{' '}
                    {premiumSub.activatedGuildIds.length}/{premiumSub.maxServers}{' '}
                    {language === 'es' ? 'cupos' : 'slots'}
                  </span>
                </span>
              )}
              {hasEnteredServer && onOpenOverview && activeGuildId && (
                <button
                  type="button"
                  onClick={() => onOpenOverview(activeGuildId)}
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-white/[0.1] bg-white/80 dark:bg-white/[0.04] text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.08] transition-colors cursor-pointer whitespace-nowrap"
                >
                  <BarChart3 className="w-3.5 h-3.5 text-[#5865F2]" />
                  <span>{t.navItems.overview}</span>
                </button>
              )}
              <motion.button
                type="button"
                whileTap={{ scale: 0.97 }}
                onClick={() => loadServers(true)}
                disabled={refreshing}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-[#5865F2] dark:hover:bg-[#5865F2] dark:hover:text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                <span>{refreshing ? t.servers.syncingDiscord : t.servers.syncDiscord}</span>
              </motion.button>
            </div>
          </motion.div>
        </div>
      </motion.section>

      {/* 2. TOOLBAR: Section Title + Apple Segmented Control */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold tracking-tight text-slate-900 dark:text-white">
            {t.servers.title}
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {t.servers.subtitle}
          </p>
        </div>

        {/* Apple-style Segmented Control */}
        <div
          role="tablist"
          aria-label="Filtrar servidores por prioridad"
          className="inline-flex flex-wrap sm:flex-nowrap items-center gap-1 p-1 rounded-2xl bg-slate-100/90 dark:bg-white/[0.04] border border-slate-200/80 dark:border-white/[0.08] self-start max-w-full"
        >
          {(
            [
              { id: 'ALL', label: t.servers.filters.all, count: fullClassified.stats.total },
              { id: 'OWNED', label: t.servers.filters.owned, count: fullClassified.stats.ownedCount },
              { id: 'ADMIN', label: t.servers.filters.admin, count: fullClassified.stats.adminCount },
              { id: 'INVITE', label: t.servers.filters.invite, count: fullClassified.stats.inviteCount },
            ] as const
          ).map((tab) => {
            const active = filter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(tab.id)}
                className={`inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-white dark:bg-[#182035] text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <span>{tab.label}</span>
                <span className="font-mono text-[11px] opacity-70 tabular-nums">{tab.count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Confirmation Banner */}
      {confirmation && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-sm space-y-2 backdrop-blur-md"
        >
          <div className="flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="w-5 h-5" />
            <span>{confirmation.headline}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 text-xs font-mono text-slate-700 dark:text-slate-300">
            <div>
              {t.servers.confirmedServer}: <strong>{confirmation.serverName}</strong>
            </div>
            <div>
              {t.servers.confirmedBot}:{' '}
              <strong className="text-emerald-600 dark:text-emerald-400">
                {confirmation.botState}
              </strong>
            </div>
            <div>
              {t.servers.confirmedSecurity}: <strong>{confirmation.securityState}</strong>
            </div>
          </div>
        </motion.div>
      )}

      {slotNotice && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2.5"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{slotNotice}</span>
        </motion.div>
      )}

      {/* Action / Sync Warnings */}
      {(actionError || syncWarning) && (
        <div
          role="alert"
          className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-800 dark:text-amber-200 flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500" />
            <span className="leading-relaxed">{actionError || syncWarning}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {actionError && onNavigatePremium && (
              <button
                type="button"
                onClick={onNavigatePremium}
                className="px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950 font-semibold cursor-pointer whitespace-nowrap"
              >
                {language === 'es' ? 'Ir a Premium' : 'Go to Premium'}
              </button>
            )}
            <button
              type="button"
              onClick={() => loadServers(true)}
              className="px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 font-semibold cursor-pointer whitespace-nowrap"
            >
              {t.servers.retry}
            </button>
          </div>
        </div>
      )}

      {/* 3. LOADING / ERROR / EMPTY / PRIORITY SECTIONS */}
      {loading && servers.length === 0 ? (
        <ServersSkeletonGrid message={t.servers.loadingMessage} />
      ) : loadError && servers.length === 0 ? (
        <div className="p-10 rounded-3xl bg-white/85 dark:bg-[#0D121E]/90 border border-red-500/25 text-center space-y-4 backdrop-blur-xl">
          <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/25 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-5 h-5 text-red-500" />
          </div>
          <div className="space-y-1 max-w-md mx-auto">
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              {t.servers.errorTitle}
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              {loadError}
            </p>
          </div>
          <button
            type="button"
            onClick={() => loadServers(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{t.servers.retry}</span>
          </button>
        </div>
      ) : servers.length === 0 ? (
        <div className="p-12 rounded-3xl bg-white/85 dark:bg-[#0D121E]/90 border border-slate-200/80 dark:border-white/[0.08] text-center space-y-4 backdrop-blur-xl">
          <div className="w-12 h-12 rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-white/[0.03] flex items-center justify-center mx-auto">
            <Server className="w-5 h-5 text-[#5865F2]" />
          </div>
          <div className="space-y-1.5 max-w-md mx-auto">
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              {language === 'es'
                ? 'Tu cuenta aún no tiene servidores en Discord'
                : 'No Discord servers found on your account'}
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              {language === 'es'
                ? 'Cuando crees o te unas a servidores en Discord, aparecerán aquí automáticamente al sincronizar.'
                : 'Once you create or join Discord servers, they will automatically appear here after syncing.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2.5">
            <button
              type="button"
              onClick={() => loadServers(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-white/[0.1] text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.06] cursor-pointer whitespace-nowrap"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>{t.servers.syncDiscord}</span>
            </button>
            {genericInviteUrl && (
              <a
                href={genericInviteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-semibold transition-colors whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t.servers.addBot}</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        </div>
      ) : sections.length === 0 ? (
        <div className="p-10 rounded-3xl bg-white/80 dark:bg-[#0D121E]/85 border border-slate-200/80 dark:border-white/[0.08] text-center space-y-2">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {t.common.noData}
          </p>
        </div>
      ) : (
        <div className="space-y-10">
          {sections.map((section) => {
            const SectionIcon = section.icon;
            return (
              <section key={section.key} className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-200/70 dark:border-white/[0.07]">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${section.accentClass}`}
                    >
                      <SectionIcon className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] font-semibold tracking-wider uppercase text-slate-500 dark:text-slate-400">
                          {section.badge}
                        </span>
                        <span className="font-mono text-[11px] font-semibold text-slate-400 dark:text-slate-500 tabular-nums">
                          · {section.items.length}
                        </span>
                      </div>
                      <h3 className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-white">
                        {section.title}
                      </h3>
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md">
                    {section.description}
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {section.items.map((srv, idx) => (
                    <ServerCard
                      key={srv.guildId}
                      srv={srv}
                      index={idx}
                      isSelected={srv.guildId === activeGuildId}
                      verifying={verifyingId === srv.guildId}
                      togglingSlot={togglingSlotId === srv.guildId}
                      slotInfo={serverSlots[srv.guildId]}
                      language={language}
                      onSelectGuild={onSelectGuild}
                      onTogglePremiumSlot={handleTogglePremiumSlot}
                      onVerify={handleVerify}
                      onTrackInvite={(gid) => {
                        pendingInviteGuildRef.current = gid;
                      }}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
