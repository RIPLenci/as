'use client';

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import { motion } from 'motion/react';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  Ban,
  Bot,
  Cpu,
  Crown,
  Database,
  ExternalLink,
  HardDrive,
  Network,
  RefreshCw,
  ScrollText,
  Server,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldPlus,
  UserCheck,
  UserPlus,
  UserX,
  WifiOff,
} from 'lucide-react';
import type {
  LanguageCode,
  OverviewAnalyticsResponse,
  OverviewPeriod,
  SecondaryOwnerRecord,
  ServiceHealthState,
  UserRecord,
} from '@/lib/aegis/types';
import { getDict, type NavSectionId } from '@/lib/aegis/i18n';
import { getSuiteCopy } from '@/lib/aegis/dashboard-i18n';
import { aegisFetch } from '@/lib/aegis/client-auth';
import { summarizeSlashCommands } from '@/lib/aegis/bot-slash-plan';
import { EChart } from '../EChart';
import { AnimatedNumber } from '../MotionPrimitives';

interface OverviewViewProps {
  user?: UserRecord | null;
  language: LanguageCode;
  isDark: boolean;
  activeGuildId: string;
  searchQuery: string;
  syncNonce?: number;
  onInspectIncident: (incidentId: string) => void;
  onNavigateSection?: (section: NavSectionId) => void;
}

const PERIODS: OverviewPeriod[] = ['24h', '7d', '30d', '90d'];

function HealthBadge({
  label,
  state,
  language,
}: {
  label: string;
  state: ServiceHealthState;
  language: LanguageCode;
}) {
  const isEs = language === 'es';
  const stateLabel =
    state === 'ONLINE'
      ? isEs
        ? 'EN LÍNEA'
        : 'ONLINE'
      : state === 'CONNECTED'
      ? isEs
        ? 'CONECTADO'
        : 'CONNECTED'
      : state === 'DEGRADED'
      ? isEs
        ? 'PARCIAL'
        : 'DEGRADED'
      : state === 'UNCONFIGURED'
      ? isEs
        ? 'SIN CONFIGURAR'
        : 'UNCONFIGURED'
      : isEs
      ? 'DESCONECTADO'
      : 'OFFLINE';

  const colorClass =
    state === 'ONLINE' || state === 'CONNECTED'
      ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/25'
      : state === 'DEGRADED' || state === 'UNCONFIGURED'
      ? 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/25'
      : 'text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/25';

  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b last:border-b-0 border-slate-200 dark:border-[#1E2640]">
      <span className="text-xs text-slate-600 dark:text-slate-400">{label}</span>
      <span className={`text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md border ${colorClass}`}>
        {stateLabel}
      </span>
    </div>
  );
}

export function OverviewView({
  user,
  language,
  isDark,
  activeGuildId,
  searchQuery,
  syncNonce = 0,
  onInspectIncident,
  onNavigateSection,
}: OverviewViewProps) {
  const isEs = language === 'es';
  const t = getDict(language);
  const suiteCopy = getSuiteCopy(language);
  const [period, setPeriod] = useState<OverviewPeriod>('7d');
  const [data, setData] = useState<OverviewAnalyticsResponse | null>(null);
  const [genericInviteUrl, setGenericInviteUrl] = useState<string>('');
  const [guildMeta, setGuildMeta] = useState<{
    backupsCount: number;
    whitelistUsersCount: number;
    secondaryOwner: SecondaryOwnerRecord | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [riskFilter, setRiskFilter] = useState<string>('ALL');
  const [page, setPage] = useState(1);
  const [visibleSeries, setVisibleSeries] = useState({
    detectedRaids: true,
    preventedAttacks: true,
    suspiciousJoins: true,
    criticalEvents: true,
  });

  const loadOverview = async (p: OverviewPeriod, gId?: string) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ period: p });
      if (gId) qs.set('guildId', gId);
      const res = await aegisFetch(`/api/overview?${qs.toString()}`);
      const json = await res.json().catch(() => null);
      if (!res.ok || !json) {
        setLoadError(
          json?.message ||
            (isEs
              ? 'No se pudieron cargar las métricas de seguridad.'
              : 'Failed to load security overview metrics.')
        );
        return;
      }
      setLoadError(null);
      setData(json as OverviewAnalyticsResponse);
    } catch {
      setLoadError(
        isEs
          ? 'Error de red al cargar las métricas de seguridad.'
          : 'Network error while loading security overview metrics.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams({ period });
    if (activeGuildId) qs.set('guildId', activeGuildId);

    const overviewReq = aegisFetch(`/api/overview?${qs.toString()}`)
      .then(async (res) => {
        if (cancelled) return;
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !json) {
          setLoadError(
            json?.message ||
              (isEs
                ? 'No se pudieron cargar las métricas de seguridad.'
                : 'Failed to load security overview metrics.')
          );
          return;
        }
        setLoadError(null);
        setData(json as OverviewAnalyticsResponse);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError(
            isEs
              ? 'Error de red al cargar las métricas de seguridad.'
              : 'Network error while loading security overview metrics.'
          );
        }
      });

    const guildMetaReq = activeGuildId
      ? aegisFetch(`/api/guilds/${activeGuildId}/security-suite`)
          .then(async (res) => {
            if (!res.ok || cancelled) return;
            const json = await res.json().catch(() => null);
            if (!cancelled && json) {
              setGuildMeta({
                backupsCount: json.backupsCount ?? 0,
                whitelistUsersCount: json.whitelistUsersCount ?? 0,
                secondaryOwner: json.secondaryOwner ?? null,
              });
            }
          })
          .catch(() => null)
      : Promise.resolve();

    const serversInviteReq = aegisFetch('/api/auth/servers')
      .then(async (res) => {
        if (!res.ok || cancelled) return;
        const json = await res.json().catch(() => null);
        if (!cancelled && json?.genericInviteUrl) {
          setGenericInviteUrl(json.genericInviteUrl);
        }
      })
      .catch(() => null);

    Promise.all([overviewReq, guildMetaReq, serversInviteReq]).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [period, activeGuildId, syncNonce, isEs]);

  const currentHour = new Date().getHours();
  const timeGreeting = isEs
    ? currentHour < 12
      ? '¡Buenos días'
      : currentHour < 19
      ? '¡Buenas tardes'
      : '¡Buenas noches'
    : currentHour < 12
    ? 'Good morning'
    : currentHour < 19
    ? 'Good afternoon'
    : 'Good evening';

  const userDisplayName =
    user?.globalName || user?.username || (isEs ? 'Comandante' : 'Commander');

  const cardSpecs = data
    ? [
        {
          title: t.overview.cards.totalRaidsDetected,
          metric: data.metrics.totalRaidsDetected,
          icon: ShieldAlert,
          accent: 'text-red-500 dark:text-red-400',
        },
        {
          title: t.overview.cards.attacksPrevented,
          metric: data.metrics.attacksPrevented,
          icon: ShieldCheck,
          accent: 'text-emerald-600 dark:text-emerald-400',
        },
        {
          title: t.overview.cards.suspiciousJoins,
          metric: data.metrics.suspiciousJoins,
          icon: UserPlus,
          accent: 'text-amber-600 dark:text-amber-400',
        },
        {
          title: t.overview.cards.criticalIncidents,
          metric: data.metrics.criticalIncidents,
          icon: AlertOctagon,
          accent: 'text-red-500 dark:text-red-400',
        },
        {
          title: t.overview.cards.usersQuarantined,
          metric: data.metrics.usersQuarantined,
          icon: UserX,
          accent: 'text-[#5865F2]',
        },
        {
          title: t.overview.cards.activeProtection,
          metric: data.metrics.activeProtection,
          icon: Activity,
          accent: 'text-emerald-600 dark:text-emerald-400',
        },
      ]
    : [];

  const filteredIncidents = (data?.recentIncidents ?? []).filter((inc) => {
    if (riskFilter !== 'ALL' && inc.riskLevel !== riskFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        inc.id.toLowerCase().includes(q) ||
        inc.affectedUsername.toLowerCase().includes(q) ||
        inc.threatType.toLowerCase().includes(q) ||
        inc.guildName.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const pageSize = 5;
  const totalPages = Math.max(1, Math.ceil(filteredIncidents.length / pageSize));
  const pagedIncidents = filteredIncidents.slice((page - 1) * pageSize, page * pageSize);

  const activityTotals = (data?.securityActivity ?? []).reduce(
    (acc, pt) => {
      acc.raids += pt.detectedRaids;
      acc.mitigated += pt.preventedAttacks;
      acc.suspicious += pt.suspiciousJoins;
      acc.critical += pt.criticalEvents;
      return acc;
    },
    { raids: 0, mitigated: 0, suspicious: 0, critical: 0 }
  );
  const totalEventsCount = activityTotals.raids + activityTotals.suspicious + activityTotals.critical;
  const mitigationRate =
    totalEventsCount > 0
      ? Math.min(100, Math.round((activityTotals.mitigated / totalEventsCount) * 100))
      : 100;

  const lineOption = data
    ? {
        tooltip: {
          trigger: 'axis' as const,
          axisPointer: {
            type: 'shadow' as const,
            shadowStyle: {
              color: isDark ? 'rgba(88,101,242,0.08)' : 'rgba(88,101,242,0.06)',
            },
          },
          backgroundColor: isDark ? '#0B0F1C' : '#FFFFFF',
          borderColor: isDark ? '#1E2640' : '#E2E8F0',
          borderWidth: 1,
          padding: [10, 12],
          textStyle: { color: isDark ? '#F1F5F9' : '#0F172A', fontSize: 12 },
        },
        grid: { left: 38, right: 16, top: 20, bottom: 28 },
        xAxis: {
          type: 'category' as const,
          data: data.securityActivity.map((pt) => pt.label),
          axisLine: { lineStyle: { color: isDark ? '#1E2640' : '#CBD5E1' } },
          axisTick: { show: false },
          axisLabel: { color: isDark ? '#94A3B8' : '#64748B', fontSize: 11, fontFamily: 'monospace' },
        },
        yAxis: {
          type: 'value' as const,
          minInterval: 1,
          splitLine: { lineStyle: { type: 'dashed' as const, color: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.07)' } },
          axisLabel: { color: isDark ? '#94A3B8' : '#64748B', fontSize: 11, fontFamily: 'monospace' },
        },
        series: [
          visibleSeries.preventedAttacks && {
            name: t.overview.series.preventedAttacks,
            type: 'bar' as const,
            barMaxWidth: 18,
            itemStyle: { color: '#10B981', borderRadius: [4, 4, 0, 0] },
            data: data.securityActivity.map((pt) => pt.preventedAttacks),
          },
          visibleSeries.detectedRaids && {
            name: t.overview.series.detectedRaids,
            type: 'bar' as const,
            barMaxWidth: 18,
            itemStyle: { color: '#EF4444', borderRadius: [4, 4, 0, 0] },
            data: data.securityActivity.map((pt) => pt.detectedRaids),
          },
          visibleSeries.suspiciousJoins && {
            name: t.overview.series.suspiciousJoins,
            type: 'line' as const,
            smooth: true,
            symbol: 'circle',
            symbolSize: 6,
            lineStyle: { width: 2.5, color: '#F59E0B' },
            itemStyle: { color: '#F59E0B' },
            areaStyle: { color: 'rgba(245,158,11,0.08)' },
            data: data.securityActivity.map((pt) => pt.suspiciousJoins),
          },
          visibleSeries.criticalEvents && {
            name: t.overview.series.criticalEvents,
            type: 'line' as const,
            smooth: true,
            symbol: 'circle',
            symbolSize: 6,
            lineStyle: { width: 2.5, color: '#5865F2' },
            itemStyle: { color: '#5865F2' },
            areaStyle: { color: 'rgba(88,101,242,0.1)' },
            data: data.securityActivity.map((pt) => pt.criticalEvents),
          },
        ].filter(Boolean) as NonNullable<unknown>[],
      }
    : {};

  const pieLabelMap: Record<string, string> = {
    RAID_ATTEMPTS: t.overview.distribution.raidAttempts,
    SUSPICIOUS_ACCOUNTS: t.overview.distribution.suspiciousAccounts,
    QUARANTINED_USERS: t.overview.distribution.quarantinedUsers,
    GLOBAL_BAN_MATCHES: t.overview.distribution.globalBanMatches,
  };

  const pieOption = data
    ? {
        tooltip: {
          trigger: 'item' as const,
          backgroundColor: isDark ? '#0D1222' : '#FFFFFF',
          borderColor: isDark ? '#1E2640' : '#E2E8F0',
          textStyle: { color: isDark ? '#F1F5F9' : '#0F172A', fontSize: 12 },
          formatter: '{b}: {c} ({d}%)',
        },
        series: [
          {
            type: 'pie' as const,
            radius: ['54%', '78%'],
            avoidLabelOverlap: true,
            label: { show: false },
            data: data.threatDistribution.map((s, idx) => ({
              name: pieLabelMap[s.key] || s.key,
              value: s.count,
              itemStyle: {
                color: ['#EF4444', '#F59E0B', '#5865F2', '#10B981'][idx % 4],
              },
            })),
          },
        ],
      }
    : {};

  // Truthful Discord bot status derived strictly from server telemetry
  const sys = data?.systemHealth;
  const botState: ServiceHealthState = sys?.bot ?? 'UNCONFIGURED';
  const botId = sys?.botIdentity.id ?? null;
  const botTag = sys?.botIdentity.tag || 'AEGIS SECURITY';
  const botPing = sys?.botIdentity.pingMs ?? null;
  const shardCount = sys?.shards?.length ?? 0;
  const clusterName = sys?.cluster?.clusterName || (isEs ? 'En espera' : 'Standby');
  const slashSummary = summarizeSlashCommands(sys?.slashCommands || []);

  const botBadgeLabel =
    botState === 'ONLINE'
      ? t.botHub.onlineBadge
      : botState === 'DEGRADED'
      ? t.botHub.degradedBadge
      : botState === 'UNCONFIGURED'
      ? t.botHub.unconfiguredBadge
      : t.botHub.offlineBadge;

  const botBadgeClass =
    botState === 'ONLINE'
      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
      : botState === 'DEGRADED'
      ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30'
      : 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30';

  const resolvedInviteUrl =
    genericInviteUrl ||
    (botId
      ? `https://discord.com/oauth2/authorize?client_id=${botId}&permissions=8&scope=bot%20applications.commands`
      : '');

  return (
    <div className="space-y-6">
      {loadError && (
        <div
          role="alert"
          className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs font-medium text-red-600 dark:text-red-300 flex items-center justify-between gap-3"
        >
          <span className="inline-flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{loadError}</span>
          </span>
          <button
            type="button"
            onClick={() => void loadOverview(period, activeGuildId)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-500/15 hover:bg-red-500/25 font-semibold cursor-pointer shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{isEs ? 'Reintentar' : 'Retry'}</span>
          </button>
        </div>
      )}
      {/* Welcome Hero Banner */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="relative overflow-hidden rounded-3xl border border-slate-200 dark:border-[#1E2640] bg-gradient-to-br from-white via-slate-50 to-indigo-50/50 dark:from-[#0D1222] dark:via-[#0A0E1A] dark:to-[#070A14] backdrop-blur-2xl p-6 sm:p-8 shadow-sm dark:shadow-2xl"
      >
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-3 max-w-2xl">
            <div className="text-xs font-mono font-semibold text-[#5865F2] dark:text-indigo-400 tracking-wide">
              {isEs ? 'Centro de Operaciones Zero-Trust' : 'Zero-Trust Control Center'}
            </div>

            <div>
              <h1 className="text-2xl sm:text-3xl font-display font-bold text-slate-900 dark:text-white tracking-tight text-balance">
                {timeGreeting},{' '}
                <span className="text-[#5865F2] dark:text-indigo-400">{userDisplayName}</span>
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1.5 leading-relaxed">
                {isEs
                  ? 'Administra tu servidor desde un panel aislado con detección Anti-Raid en tiempo real, Seguridad Adicional, Anti-Nuke auditado y copias automáticas.'
                  : 'Manage your server from an isolated console with real-time Anti-Raid detection, Additional Security, audited Anti-Nuke, and automated backups.'}
              </p>
            </div>

            {/* Quick Navigation Actions */}
            <div className="flex flex-wrap items-center gap-2 pt-2">
              {onNavigateSection && (
                <>
                  <button
                    type="button"
                    onClick={() => onNavigateSection('additional-security')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-indigo-500/35 bg-indigo-500/10 hover:bg-indigo-500/20 text-[#5865F2] dark:text-indigo-300 text-xs font-semibold cursor-pointer transition-all whitespace-nowrap"
                  >
                    <ShieldPlus className="w-3.5 h-3.5" />
                    <span>{isEs ? 'Seguridad Adicional' : 'Additional Security'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigateSection('protection-overview')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-[#1E2640] bg-white dark:bg-[#11172A] hover:bg-slate-50 dark:hover:bg-[#161F38] text-slate-700 dark:text-slate-300 text-xs font-semibold cursor-pointer transition-all whitespace-nowrap"
                  >
                    <Shield className="w-3.5 h-3.5 text-emerald-500" />
                    <span>{isEs ? 'Antiraid' : 'Anti-Raid'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigateSection('whitelist')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-[#1E2640] bg-white dark:bg-[#11172A] hover:bg-slate-50 dark:hover:bg-[#161F38] text-slate-700 dark:text-slate-300 text-xs font-semibold cursor-pointer transition-all whitespace-nowrap"
                  >
                    <UserCheck className="w-3.5 h-3.5 text-sky-500" />
                    <span>Whitelist</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigateSection('log-channel')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-[#1E2640] bg-white dark:bg-[#11172A] hover:bg-slate-50 dark:hover:bg-[#161F38] text-slate-700 dark:text-slate-300 text-xs font-semibold cursor-pointer transition-all whitespace-nowrap"
                  >
                    <ScrollText className="w-3.5 h-3.5 text-amber-500" />
                    <span>{isEs ? 'Canal de Logs' : 'Log Channel'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigateSection('premium')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 text-xs font-semibold cursor-pointer transition-all whitespace-nowrap"
                  >
                    <Crown className="w-3.5 h-3.5 text-amber-500" />
                    <span>Premium</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Truthful Discord Bot Status & Invite Card */}
          <div className="shrink-0 w-full lg:w-80 rounded-2xl border border-slate-200 dark:border-[#1E2640] bg-white dark:bg-[#0A0D18]/95 p-4 space-y-3 shadow-sm dark:shadow-lg">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                {sys?.botIdentity.avatarUrl ? (
                  <Image
                    src={sys.botIdentity.avatarUrl}
                    alt={botTag}
                    width={40}
                    height={40}
                    referrerPolicy="no-referrer"
                    className="w-10 h-10 rounded-xl object-cover border border-slate-200 dark:border-[#1E2640] shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-xl bg-[#5865F2] flex items-center justify-center text-white shrink-0">
                    <Bot className="w-5 h-5" />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                    {botTag}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                    {botId
                      ? `ID: ${botId}`
                      : isEs
                      ? 'Sin Client ID activo'
                      : 'No active Client ID'}
                  </div>
                </div>
              </div>

              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono font-bold border shrink-0 ${botBadgeClass}`}
              >
                {botState === 'ONLINE' ? (
                  <ShieldCheck className="w-3 h-3" />
                ) : botState === 'DEGRADED' ? (
                  <AlertTriangle className="w-3 h-3" />
                ) : (
                  <WifiOff className="w-3 h-3" />
                )}
                <span>{botBadgeLabel}</span>
              </span>
            </div>

            <div className="text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-400 space-y-1 bg-slate-50 dark:bg-[#0F1424] p-2.5 rounded-xl border border-slate-200 dark:border-[#1E2640]/60">
              <div className="flex justify-between gap-2">
                <span>{isEs ? 'Clúster / Shards:' : 'Cluster / Shards:'}</span>
                <span className="text-slate-900 dark:text-white font-semibold">
                  {shardCount > 0 ? `${clusterName} (${shardCount})` : clusterName}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span>Ping Gateway:</span>
                <span
                  className={`font-semibold ${
                    botPing !== null
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {botPing !== null ? `${botPing} ms` : '-- ms'}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span>{isEs ? 'Comandos Slash:' : 'Slash Commands:'}</span>
                <span className="text-[#5865F2] dark:text-indigo-300 font-semibold">
                  {slashSummary.commandCount} ({slashSummary.totalSubcommands} sub)
                </span>
              </div>
            </div>

            {resolvedInviteUrl ? (
              <a
                href={resolvedInviteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-semibold cursor-pointer shadow-sm transition-colors"
              >
                <span>{isEs ? 'Añadir Bot a Discord' : 'Add Bot to Discord'}</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            ) : (
              onNavigateSection && (
                <button
                  type="button"
                  onClick={() => onNavigateSection('protection-overview')}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-semibold cursor-pointer shadow-sm transition-colors"
                >
                  <Bot className="w-3.5 h-3.5" />
                  <span>{isEs ? 'Ver Antiraid y Seguridad' : 'View Anti-Raid & Security'}</span>
                </button>
              )
            )}
          </div>
        </div>
      </motion.div>

      {/* Header + Period Selector */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
            {t.overview.title}
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">{t.overview.subtitle}</p>
        </div>

        <div className="flex flex-wrap xl:flex-nowrap items-center gap-2 shrink-0">
          <div className="flex items-center p-1 rounded-xl bg-white dark:bg-[#0D1222] border border-slate-200 dark:border-[#1E2640] shrink-0">
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setPeriod(p);
                  setPage(1);
                }}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                  period === p
                    ? 'bg-[#5865F2] text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {t.periods[p]}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => loadOverview(period, activeGuildId)}
            aria-label={t.common.refresh}
            className="p-2.5 rounded-xl border border-slate-200 dark:border-[#1E2640] bg-white dark:bg-[#0D1222] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer shrink-0 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Secondary Owner Alert + 3 Server Hygiene Summary Cards */}
      {activeGuildId && guildMeta && (
        <div className="space-y-4">
          {!guildMeta.secondaryOwner && (
            <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
              <div className="space-y-1">
                <div className="text-sm font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0" />
                  <span>{suiteCopy.overviewExtras.secondOwnerMissingTitle}</span>
                </div>
                <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                  {suiteCopy.overviewExtras.secondOwnerMissingBody}
                </p>
              </div>
              {onNavigateSection && (
                <button
                  type="button"
                  onClick={() => onNavigateSection('secondary-owner')}
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold shrink-0 cursor-pointer transition-colors shadow-xs"
                >
                  {suiteCopy.overviewExtras.secondOwnerMissingLink}
                </button>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-2xl border border-slate-200 dark:border-[#1E2640] bg-white dark:bg-[#0D1222]/90 p-5 flex items-start justify-between gap-3 shadow-sm dark:shadow-xl hover:border-emerald-500/40 transition-colors">
              <div className="space-y-1.5">
                <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                  {data && data.recentIncidents.length > 0
                    ? `${data.recentIncidents.length} ${suiteCopy.overviewExtras.maliciousDetectedTitle}`
                    : suiteCopy.overviewExtras.maliciousOkTitle}
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  {suiteCopy.overviewExtras.maliciousDesc}{' '}
                  {onNavigateSection && (
                    <button
                      type="button"
                      onClick={() => onNavigateSection('incidents')}
                      className="text-[#5865F2] dark:text-indigo-400 hover:underline font-semibold cursor-pointer"
                    >
                      {suiteCopy.overviewExtras.moreInfo}
                    </button>
                  )}
                </p>
              </div>
              <span className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </span>
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-[#1E2640] bg-white dark:bg-[#0D1222]/90 p-5 flex items-start justify-between gap-3 shadow-sm dark:shadow-xl hover:border-cyan-500/40 transition-colors">
              <div className="space-y-1.5">
                <div className="text-sm font-semibold text-slate-900 dark:text-white">
                  {suiteCopy.overviewExtras.backupsTitle}
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-mono tabular-nums font-bold text-slate-900 dark:text-white">
                    {guildMeta.backupsCount}
                  </span>
                  {guildMeta.backupsCount === 0 && (
                    <span className="text-[11px] text-red-600 dark:text-red-400 font-medium">
                      {suiteCopy.overviewExtras.backupsZeroWarn}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  {suiteCopy.overviewExtras.backupsDesc}{' '}
                  {onNavigateSection && (
                    <button
                      type="button"
                      onClick={() => onNavigateSection('backups')}
                      className="text-[#5865F2] dark:text-indigo-400 hover:underline font-semibold cursor-pointer"
                    >
                      {suiteCopy.overviewExtras.moreInfo}
                    </button>
                  )}
                </p>
              </div>
              <span className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 shrink-0">
                <HardDrive className="w-5 h-5" />
              </span>
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-[#1E2640] bg-white dark:bg-[#0D1222]/90 p-5 flex items-start justify-between gap-3 shadow-sm dark:shadow-xl hover:border-indigo-500/40 transition-colors">
              <div className="space-y-1.5">
                <div className="text-sm font-semibold text-slate-900 dark:text-white">
                  {suiteCopy.overviewExtras.whitelistTitle}
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-mono tabular-nums font-bold text-slate-900 dark:text-white">
                    {guildMeta.whitelistUsersCount}
                  </span>
                  <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                    {suiteCopy.overviewExtras.whitelistRecommended}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  {suiteCopy.overviewExtras.whitelistDesc}{' '}
                  {onNavigateSection && (
                    <button
                      type="button"
                      onClick={() => onNavigateSection('whitelist')}
                      className="text-[#5865F2] dark:text-indigo-400 hover:underline font-semibold cursor-pointer"
                    >
                      {suiteCopy.overviewExtras.moreInfo}
                    </button>
                  )}
                </p>
              </div>
              <span className="p-2.5 rounded-xl bg-indigo-500/10 text-[#5865F2] dark:text-indigo-400 shrink-0">
                <UserCheck className="w-5 h-5" />
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 6 Per-Server Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading && !data
          ? Array.from({ length: 6 }).map((_, idx) => (
              <div
                key={idx}
                className="h-28 rounded-2xl bg-white dark:bg-[#0D1222] border border-slate-200 dark:border-[#1E2640]"
              />
            ))
          : cardSpecs.map((card, idx) => {
              const Icon = card.icon;
              const delta = card.metric.deltaPercent;
              return (
                <motion.div
                  key={card.metric.key}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.25,
                    delay: idx * 0.03,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                  whileHover={{ y: -2 }}
                  className="p-4 rounded-2xl bg-white dark:bg-[#0D1222]/90 border border-slate-200 dark:border-[#1E2640] hover:border-indigo-500/40 transition-all flex flex-col justify-between gap-3 shadow-sm dark:shadow-lg"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-400 truncate">
                      {card.title}
                    </span>
                    <div className="w-8 h-8 rounded-lg border border-slate-200 dark:border-[#1E2640] bg-slate-50 dark:bg-[#10162A] flex items-center justify-center shrink-0">
                      <Icon className={`w-4 h-4 ${card.accent}`} />
                    </div>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <AnimatedNumber
                      value={card.metric.value}
                      className="font-mono tabular-nums text-2xl font-bold text-slate-900 dark:text-white"
                    />
                    <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {delta === null
                        ? isEs
                          ? 'Sin datos'
                          : 'N/A'
                        : `${delta > 0 ? '+' : ''}${delta}%`}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 truncate">
                    {card.metric.comparisonNote === 'No prior period baseline' && isEs
                      ? 'Sin período previo comparativo'
                      : card.metric.comparisonNote}
                  </div>
                </motion.div>
              );
            })}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <section className="xl:col-span-8 p-5 rounded-2xl bg-white dark:bg-[#0D1222]/90 border border-slate-200 dark:border-[#1E2640] space-y-4 shadow-sm dark:shadow-xl">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  {t.overview.securityActivityTitle}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {isEs
                    ? 'Comparativa temporal de amenazas detectadas frente a ataques mitigados automáticamente.'
                    : 'Timeline comparing detected threats against automatically mitigated attacks.'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {(
                  [
                    { key: 'preventedAttacks', label: t.overview.series.preventedAttacks, color: 'bg-emerald-500' },
                    { key: 'detectedRaids', label: t.overview.series.detectedRaids, color: 'bg-red-500' },
                    { key: 'suspiciousJoins', label: t.overview.series.suspiciousJoins, color: 'bg-amber-500' },
                    { key: 'criticalEvents', label: t.overview.series.criticalEvents, color: 'bg-[#5865F2]' },
                  ] as const
                ).map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() =>
                      setVisibleSeries((prev) => ({ ...prev, [s.key]: !prev[s.key] }))
                    }
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-opacity cursor-pointer ${
                      visibleSeries[s.key]
                        ? 'border-slate-200 dark:border-[#1E2640] bg-slate-50 dark:bg-[#11172A] text-slate-800 dark:text-slate-200'
                        : 'border-slate-200/60 dark:border-[#1E2640]/50 text-slate-400 dark:text-slate-500 opacity-50'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-xs ${s.color}`} aria-hidden="true" />
                    <span>{s.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Precision Period Breakdown */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
              <div className="rounded-xl border border-slate-200/80 dark:border-[#1E2640] bg-slate-50/70 dark:bg-[#0A0F1D] px-3 py-2">
                <div className="text-[10px] font-mono uppercase text-slate-500">{isEs ? 'Tasa Mitigación' : 'Mitigation Rate'}</div>
                <div className="text-sm font-mono tabular-nums font-bold text-emerald-600 dark:text-emerald-400">
                  {mitigationRate}%
                </div>
              </div>
              <div className="rounded-xl border border-slate-200/80 dark:border-[#1E2640] bg-slate-50/70 dark:bg-[#0A0F1D] px-3 py-2">
                <div className="text-[10px] font-mono uppercase text-slate-500">{t.overview.series.preventedAttacks}</div>
                <div className="text-sm font-mono tabular-nums font-bold text-slate-900 dark:text-white">
                  {activityTotals.mitigated}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200/80 dark:border-[#1E2640] bg-slate-50/70 dark:bg-[#0A0F1D] px-3 py-2">
                <div className="text-[10px] font-mono uppercase text-slate-500">{t.overview.series.detectedRaids}</div>
                <div className="text-sm font-mono tabular-nums font-bold text-red-500 dark:text-red-400">
                  {activityTotals.raids}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200/80 dark:border-[#1E2640] bg-slate-50/70 dark:bg-[#0A0F1D] px-3 py-2">
                <div className="text-[10px] font-mono uppercase text-slate-500">{t.overview.series.suspiciousJoins}</div>
                <div className="text-sm font-mono tabular-nums font-bold text-amber-500 dark:text-amber-400">
                  {activityTotals.suspicious}
                </div>
              </div>
            </div>
          </div>
          <EChart option={lineOption} height={260} isDark={isDark} />
        </section>

        <section className="xl:col-span-4 space-y-5">
          <div className="p-5 rounded-2xl bg-white dark:bg-[#0D1222]/90 border border-slate-200 dark:border-[#1E2640] space-y-3 shadow-sm dark:shadow-xl">
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              {t.overview.threatDistributionTitle}
            </h2>
            <EChart option={pieOption} height={175} isDark={isDark} />
            <div className="space-y-1.5 pt-1">
              {(data?.threatDistribution ?? []).map((s, idx) => (
                <div
                  key={s.key}
                  className="flex items-center justify-between text-xs text-slate-700 dark:text-slate-300"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-xs ${
                        ['bg-red-500', 'bg-amber-500', 'bg-[#5865F2]', 'bg-sky-500'][idx]
                      }`}
                    />
                    <span>{pieLabelMap[s.key]}</span>
                  </div>
                  <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    {s.count} · {s.percentage}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          {data && (
            <div className="p-5 rounded-2xl bg-white dark:bg-[#0D1222]/90 border border-slate-200 dark:border-[#1E2640] space-y-2.5 shadow-sm dark:shadow-xl">
              <div className="flex items-center gap-2 pb-1 border-b border-slate-200 dark:border-[#1E2640]">
                <Server className="w-4 h-4 text-[#5865F2]" />
                <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                  {t.overview.systemStatusTitle}
                </h2>
              </div>
              <HealthBadge label={t.overview.infrastructure.botStatus} state={data.systemHealth.bot} language={language} />
              <HealthBadge label={t.overview.infrastructure.apiStatus} state={data.systemHealth.api} language={language} />
              <HealthBadge label={t.overview.infrastructure.mongodbStatus} state={data.systemHealth.mongodb} language={language} />
              <HealthBadge label={t.overview.infrastructure.redisStatus} state={data.systemHealth.redis} language={language} />
              <div className="flex items-center justify-between pt-1 text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-400">
                <span className="flex items-center gap-1">
                  <Cpu className="w-3 h-3 text-[#5865F2]" />
                  {t.overview.infrastructure.l1Cache}
                </span>
                <span className="text-slate-800 dark:text-slate-300 font-semibold">
                  {data.systemHealth.l1CacheStats.entries}{' '}
                  {isEs ? 'entradas' : 'entries'} ({data.systemHealth.l1CacheStats.hitRatePercent}%)
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-400">
                <span className="flex items-center gap-1">
                  <Database className="w-3 h-3 text-emerald-500" />
                  {t.overview.infrastructure.lastSync}
                </span>
                <span className="text-slate-800 dark:text-slate-300">
                  {new Date(data.systemHealth.lastSynchronization).toLocaleTimeString()}
                </span>
              </div>
              {data.systemHealth.syncHealth && (
                <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-400">
                  <span>{isEs ? 'Sincronización Outbox' : 'Outbox Sync'}</span>
                  <span
                    className={
                      data.systemHealth.syncHealth.status === 'SYNCHRONIZED'
                        ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                        : 'text-amber-600 dark:text-amber-400 font-semibold'
                    }
                  >
                    {data.systemHealth.syncHealth.status} ({data.systemHealth.syncHealth.pendingOutboxCount})
                  </span>
                </div>
              )}
              {data.systemHealth.latencyMetrics && (
                <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-400">
                  <span>{isEs ? 'Latencia Anti-Raid (p50/p95)' : 'Anti-Raid Latency (p50/p95)'}</span>
                  <span className="text-slate-800 dark:text-slate-300">
                    {data.systemHealth.latencyMetrics.antiRaidEval.count > 0
                      ? `${data.systemHealth.latencyMetrics.antiRaidEval.p50Ms}ms / ${data.systemHealth.latencyMetrics.antiRaidEval.p95Ms}ms`
                      : isEs
                      ? 'Sin muestras'
                      : 'No samples'}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-400">
                <span>{isEs ? 'Errores Recientes' : 'Recent Errors'}</span>
                <span
                  className={
                    (data.systemHealth.recentErrors?.length ?? 0) > 0
                      ? 'text-red-500 font-semibold'
                      : 'text-emerald-600 dark:text-emerald-400'
                  }
                >
                  {data.systemHealth.recentErrors?.length ?? 0}
                </span>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Recent Incidents Table */}
      <section className="rounded-2xl bg-white dark:bg-[#0D1222]/90 border border-slate-200 dark:border-[#1E2640] overflow-hidden shadow-sm dark:shadow-xl">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-[#1E2640] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
            {t.overview.recentIncidentsTitle}
          </h2>
          <div className="flex items-center gap-1.5 flex-wrap">
            {(['ALL', 'CRITICAL', 'HIGH', 'MODERATE', 'LOW'] as const).map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => {
                  setRiskFilter(lvl);
                  setPage(1);
                }}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  riskFilter === lvl
                    ? 'bg-[#5865F2] text-white shadow-xs'
                    : 'bg-slate-50 dark:bg-[#101524] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-[#1E2640]'
                }`}
              >
                {lvl === 'ALL' ? t.common.all : lvl}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-[#1E2640] text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-[#0A0D18]/60">
                <th className="py-3 px-4">{isEs ? 'ID Incidente' : 'Incident ID'}</th>
                <th className="py-3 px-4">{t.common.server}</th>
                <th className="py-3 px-4">{isEs ? 'Tipo de Amenaza' : 'Threat Type'}</th>
                <th className="py-3 px-4">{t.common.riskScore}</th>
                <th className="py-3 px-4">{t.common.status}</th>
                <th className="py-3 px-4">{t.common.date}</th>
                <th className="py-3 px-4 text-right">{t.common.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-[#1E2640] text-xs">
              {pagedIncidents.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    {t.common.noData}
                  </td>
                </tr>
              ) : (
                pagedIncidents.map((inc) => (
                  <tr
                    key={inc.id}
                    className="hover:bg-slate-50 dark:hover:bg-[#12182B]/60 transition-colors"
                  >
                    <td className="py-3 px-4 font-mono font-semibold text-slate-900 dark:text-white">
                      {inc.id}
                    </td>
                    <td className="py-3 px-4 text-slate-700 dark:text-slate-300">
                      {inc.guildName}
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                      {inc.threatType}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums">
                      <span
                        className={`font-bold ${
                          inc.riskScore >= 75
                            ? 'text-red-600 dark:text-red-400'
                            : inc.riskScore >= 50
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        {inc.riskScore}/100
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold ${
                          inc.status === 'MITIGATED'
                            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30'
                            : 'bg-red-500/15 text-red-700 dark:text-red-400 border border-red-500/30'
                        }`}
                      >
                        {inc.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-500 dark:text-slate-400 font-mono text-[11px] tabular-nums">
                      {new Date(inc.createdAt).toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => onInspectIncident(inc.id)}
                        className="px-2.5 py-1 rounded-lg text-xs font-semibold text-[#5865F2] dark:text-indigo-400 hover:text-white hover:bg-[#5865F2] transition-colors cursor-pointer"
                      >
                        {isEs ? 'Inspeccionar' : 'Inspect'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="p-4 border-t border-slate-200 dark:border-[#1E2640] flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
            <span>
              {isEs ? `Página ${page} de ${totalPages}` : `Page ${page} of ${totalPages}`}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-[#1E2640] bg-white dark:bg-[#101524] disabled:opacity-40 cursor-pointer"
              >
                {t.common.previous}
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-[#1E2640] bg-white dark:bg-[#101524] disabled:opacity-40 cursor-pointer"
              >
                {t.common.next}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
