'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  AtSign,
  Ban,
  Bot,
  CheckCircle2,
  Crown,
  Link2,
  Link2Off,
  MessageSquareWarning,
  Search,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Star,
  UserX,
  VolumeX,
  Webhook,
  X,
} from 'lucide-react';
import { isPaidTier, normalizePlanTier } from '@/lib/aegis/premium';
import type {
  AntiBotsMode,
  GuildPlanRecord,
  GuildSecuritySuiteRecord,
  LanguageCode,
} from '@/lib/aegis/types';
import { getSuiteCopy } from '@/lib/aegis/dashboard-i18n';
import { aegisFetch } from '@/lib/aegis/client-auth';

interface AdditionalSecurityViewProps {
  language: LanguageCode;
  activeGuildId: string;
  syncNonce?: number;
  onNavigatePremium: () => void;
  onNavigateServers: () => void;
  onSyncCompleted: () => void;
}

type ModuleFilter = 'ALL' | 'FREE' | 'PREMIUM' | 'ACTIVE';

interface TwoOptionTileProps {
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  onClick: () => void;
  orientation?: 'horizontal' | 'vertical';
}

function TwoOptionTile({
  active,
  icon: Icon,
  title,
  desc,
  onClick,
  orientation = 'horizontal',
}: TwoOptionTileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`group text-left rounded-xl p-3.5 border transition-all cursor-pointer flex flex-col items-center justify-between text-center gap-2 ${
        orientation === 'horizontal' ? 'flex-1 min-h-[118px]' : 'w-full min-h-[92px]'
      } ${
        active
          ? 'border-[#5865F2] bg-[#5865F2]/10 dark:bg-[#5865F2]/12 shadow-[0_0_16px_rgba(88,101,242,0.16)] ring-1 ring-[#5865F2]/40'
          : 'border-slate-200 dark:border-[#1E2640] bg-slate-50/80 dark:bg-[#101524]/80 hover:border-slate-300 dark:hover:border-slate-600/80 hover:bg-slate-100/80 dark:hover:bg-[#13192B]'
      }`}
    >
      <div className="flex flex-col items-center gap-2">
        <Icon
          className={`w-5 h-5 transition-transform group-hover:scale-105 ${
            active ? 'text-[#5865F2]' : 'text-slate-500 dark:text-slate-400'
          }`}
        />
        <div className="text-sm font-semibold text-slate-900 dark:text-white tracking-tight">
          {title}
        </div>
        <div className="text-xs leading-relaxed text-slate-600 dark:text-slate-400 max-w-[260px]">
          {desc}
        </div>
      </div>
      <div
        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
          active
            ? 'border-[#5865F2] bg-[#5865F2]/20 shadow-[0_0_10px_rgba(88,101,242,0.5)]'
            : 'border-slate-400 dark:border-slate-500/70 bg-transparent'
        }`}
      >
        {active && <span className="w-2 h-2 rounded-full bg-[#5865F2]" />}
      </div>
    </button>
  );
}

export function AdditionalSecurityView({
  language,
  activeGuildId,
  syncNonce = 0,
  onNavigatePremium,
  onNavigateServers,
  onSyncCompleted,
}: AdditionalSecurityViewProps) {
  const isEs = language === 'es';
  const c = getSuiteCopy(language);
  const s = c.additionalSecurity;
  const [suite, setSuite] = useState<GuildSecuritySuiteRecord | null>(null);
  const [plan, setPlan] = useState<GuildPlanRecord | null>(null);
  const [autoModUsed, setAutoModUsed] = useState(2);
  const [autoModLimit, setAutoModLimit] = useState(6);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [domainInput, setDomainInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [moduleFilter, setModuleFilter] = useState<ModuleFilter>('ALL');
  const loadedGuildRef = useRef<string>('');

  useEffect(() => {
    let cancelled = false;
    const isInitialForGuild = loadedGuildRef.current !== activeGuildId;
    const loadSuite = async () => {
      if (!activeGuildId) {
        if (!cancelled) setLoading(false);
        return;
      }
      if (isInitialForGuild) setLoading(true);
      try {
        const res = await aegisFetch(`/api/guilds/${activeGuildId}/security-suite`);
        const json = await res.json().catch(() => null);
        if (cancelled || !res.ok || !json) return;
        loadedGuildRef.current = activeGuildId;
        setSuite(json.suite);
        setPlan(json.plan);
        setAutoModUsed(json.autoModRulesUsed ?? 2);
        setAutoModLimit(json.autoModRulesLimit ?? 6);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void Promise.resolve().then(loadSuite);
    return () => {
      cancelled = true;
    };
  }, [activeGuildId, syncNonce]);

  const patchAdditional = useCallback(
    async (keyLabel: string, payload: Record<string, unknown>) => {
      if (!activeGuildId) return;
      setSavingKey(keyLabel);
      setFeedback(null);
      try {
        const res = await aegisFetch(`/api/guilds/${activeGuildId}/security-suite`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ additionalSecurity: payload }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          setFeedback({
            ok: false,
            text:
              json?.message ||
              (isEs
                ? 'Error al actualizar la regla de seguridad'
                : 'Error updating security rule'),
          });
          return;
        }
        setSuite(json.suite);
        setPlan(json.plan);
        setAutoModUsed(json.autoModRulesUsed ?? 2);
        setFeedback({ ok: true, text: c.common.saved });
        onSyncCompleted();
      } catch {
        setFeedback({
          ok: false,
          text: isEs
            ? 'Error de red al guardar la configuración.'
            : 'Network error saving configuration.',
        });
      } finally {
        setSavingKey(null);
      }
    },
    [activeGuildId, c.common.saved, isEs, onSyncCompleted]
  );

  const visibleModules = useMemo(() => {
    if (!suite) return new Set<string>();
    const a = suite.additionalSecurity;
    const items = [
      { id: 'banMalicious', title: s.banMalicious.title, desc: s.banMalicious.desc, premium: false, active: a.banMaliciousUsers },
      { id: 'antiFlood', title: s.antiFlood.title, desc: s.antiFlood.desc, premium: false, active: a.antiFlood.enabled },
      { id: 'antiScam', title: s.antiScam.title, desc: s.antiScam.desc, premium: false, active: a.antiScam.enabled },
      { id: 'antiEveryone', title: s.antiEveryone.title, desc: s.antiEveryone.desc, premium: false, active: a.antiEveryonePerms },
      { id: 'antiWebhook', title: s.antiWebhook.title, desc: s.antiWebhook.desc, premium: false, active: a.antiWebhookSpam },
      { id: 'antiMassMute', title: s.antiMassMute.title, desc: s.antiMassMute.desc, premium: true, active: a.antiMassMute.enabled },
      { id: 'antiAlts', title: s.antiAlts.title, desc: s.antiAlts.desc, premium: false, active: a.antiAlts.enabled },
      { id: 'antiBots', title: s.antiBots.title, desc: s.antiBots.desc, premium: false, active: a.antiBots !== 'DISABLED' },
      { id: 'antiInvites', title: s.antiInvites.title, desc: s.antiInvites.desc, premium: false, active: a.antiInvites },
      { id: 'antiLinks', title: s.antiLinks.title, desc: s.antiLinks.desc, premium: false, active: a.antiLinks.enabled },
    ];
    const q = searchTerm.trim().toLowerCase();
    return new Set(
      items
        .filter((item) => {
          if (moduleFilter === 'FREE' && item.premium) return false;
          if (moduleFilter === 'PREMIUM' && !item.premium) return false;
          if (moduleFilter === 'ACTIVE' && !item.active) return false;
          if (q && !item.title.toLowerCase().includes(q) && !item.desc.toLowerCase().includes(q)) {
            return false;
          }
          return true;
        })
        .map((i) => i.id)
    );
  }, [suite, s, searchTerm, moduleFilter]);

  if (!activeGuildId) {
    return (
      <div className="rounded-2xl border border-slate-200 dark:border-[#1E2640] bg-white dark:bg-[#0D1222]/90 backdrop-blur-xl p-8 text-center shadow-sm dark:shadow-xl">
        <ShieldCheck className="w-10 h-10 text-[#5865F2] dark:text-indigo-400 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          {c.common.noServerTitle}
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 max-w-md mx-auto">
          {c.common.noServerDesc}
        </p>
        <button
          type="button"
          onClick={onNavigateServers}
          className="mt-5 px-5 py-2.5 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-semibold cursor-pointer shadow-md transition-colors"
        >
          {c.common.goToServers}
        </button>
      </div>
    );
  }

  if (loading || !suite || !plan) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {Array.from({ length: 6 }).map((_, idx) => (
          <div
            key={idx}
            className="h-64 rounded-2xl bg-white dark:bg-[#0D1222]/80 border border-slate-200 dark:border-[#1E2640]"
          />
        ))}
      </div>
    );
  }

  const isPremium = isPaidTier(normalizePlanTier(plan.tier));
  const a = suite.additionalSecurity;

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-slate-900 dark:text-white tracking-tight">
            {s.title}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{s.subtitle}</p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-[#1E2640] bg-white dark:bg-[#0D1222] text-xs font-mono tabular-nums">
            <Settings2 className="w-3.5 h-3.5 text-[#5865F2] dark:text-indigo-400" />
            <span className="text-slate-600 dark:text-slate-300">
              {s.autoModCounter}{' '}
              <strong className="text-slate-900 dark:text-white">
                {autoModUsed}/{autoModLimit}
              </strong>
            </span>
          </div>

          <button
            type="button"
            onClick={onNavigatePremium}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer whitespace-nowrap ${
              isPremium
                ? 'border-amber-500/40 bg-amber-500/15 text-amber-600 dark:text-amber-400'
                : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:border-amber-400'
            }`}
          >
            <Crown className="w-3.5 h-3.5" />
            <span>{isPremium ? 'AEGIS PREMIUM' : c.common.activatePremium}</span>
          </button>
        </div>
      </div>

      {/* Live Search Bar & Interactive Filter Segmented Control */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search
            className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={isEs ? 'Buscar módulo de seguridad...' : 'Search security module...'}
            aria-label={isEs ? 'Buscar módulo de seguridad' : 'Search security module'}
            className="w-full pl-10 pr-9 py-2.5 rounded-xl border border-slate-200 dark:border-[#1E2640] bg-white dark:bg-[#0D1222]/90 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-[#5865F2] transition-colors shadow-xs"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              aria-label={isEs ? 'Limpiar búsqueda' : 'Clear search'}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 p-1 rounded-xl border border-slate-200 dark:border-[#1E2640] bg-white dark:bg-[#0D1222] shrink-0">
          {(
            [
              { key: 'ALL', label: isEs ? 'Todos' : 'All' },
              { key: 'FREE', label: isEs ? 'Gratuito' : c.common.free },
              { key: 'PREMIUM', label: 'Premium' },
              { key: 'ACTIVE', label: isEs ? 'Activos' : 'Active' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setModuleFilter(tab.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                moduleFilter === tab.key
                  ? 'bg-[#5865F2] text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {feedback && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className={`rounded-xl px-4 py-2.5 text-xs font-medium flex items-center gap-2 border ${
            feedback.ok
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
              : 'bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300'
          }`}
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{feedback.text}</span>
        </motion.div>
      )}

      {visibleModules.size === 0 ? (
        <div className="rounded-2xl border border-slate-200 dark:border-[#1E2640] bg-white dark:bg-[#0D1222]/90 p-10 text-center space-y-3">
          <Search className="w-8 h-8 text-slate-400 mx-auto" />
          <div className="text-sm font-semibold text-slate-900 dark:text-white">
            {isEs
              ? 'No se encontraron módulos con los filtros actuales.'
              : 'No security modules match your current filters.'}
          </div>
          <button
            type="button"
            onClick={() => {
              setSearchTerm('');
              setModuleFilter('ALL');
            }}
            className="px-4 py-2 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-semibold cursor-pointer"
          >
            {isEs ? 'Limpiar filtros' : 'Clear filters'}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 items-start">
          {/* 1. Banear usuarios maliciosos */}
          {visibleModules.has('banMalicious') && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl border border-slate-200 dark:border-[#1E2640] bg-white dark:bg-[#0D1222]/90 backdrop-blur-xl p-5 flex flex-col justify-between gap-4 shadow-sm dark:shadow-xl hover:border-indigo-500/40 transition-colors"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                    {s.banMalicious.title}
                  </h3>
                  <span className="text-[11px] font-mono font-bold text-[#5865F2] dark:text-indigo-400">
                    {c.common.free}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1.5 leading-relaxed">
                  {s.banMalicious.desc}
                </p>
              </div>
              <div className="flex gap-2.5">
                <TwoOptionTile
                  active={!a.banMaliciousUsers}
                  icon={UserX}
                  title={c.common.disabled}
                  desc={s.banMalicious.off}
                  orientation="horizontal"
                  onClick={() => patchAdditional('banMaliciousUsers', { banMaliciousUsers: false })}
                />
                <TwoOptionTile
                  active={a.banMaliciousUsers}
                  icon={Ban}
                  title={c.common.enabled}
                  desc={s.banMalicious.on}
                  orientation="horizontal"
                  onClick={() => patchAdditional('banMaliciousUsers', { banMaliciousUsers: true })}
                />
              </div>
            </motion.div>
          )}

          {/* 2. Anti Flood */}
          {visibleModules.has('antiFlood') && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.02 }}
              className="rounded-2xl border border-slate-200 dark:border-[#1E2640] bg-white dark:bg-[#0D1222]/90 backdrop-blur-xl p-5 flex flex-col justify-between gap-4 shadow-sm dark:shadow-xl hover:border-indigo-500/40 transition-colors"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                    {s.antiFlood.title}
                  </h3>
                  <span className="text-[11px] font-mono font-bold text-[#5865F2] dark:text-indigo-400">
                    {c.common.free}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1.5 leading-relaxed">
                  {s.antiFlood.desc}
                </p>
              </div>
              <div className="flex gap-2.5">
                <TwoOptionTile
                  active={!a.antiFlood.enabled}
                  icon={UserX}
                  title={c.common.disabled}
                  desc={s.antiFlood.off}
                  orientation="horizontal"
                  onClick={() => patchAdditional('antiFlood', { antiFlood: { enabled: false } })}
                />
                <TwoOptionTile
                  active={a.antiFlood.enabled}
                  icon={MessageSquareWarning}
                  title={c.common.enabled}
                  desc={s.antiFlood.on}
                  orientation="horizontal"
                  onClick={() => patchAdditional('antiFlood', { antiFlood: { enabled: true } })}
                />
              </div>
              {isPremium ? (
                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200 dark:border-[#1E2640]">
                  <label className="text-[11px] text-slate-600 dark:text-slate-400">
                    {s.antiFlood.maxMsgs}
                    <input
                      type="number"
                      min={2}
                      max={50}
                      value={a.antiFlood.maxMessages}
                      onChange={(e) =>
                        patchAdditional('antiFloodParams', {
                          antiFlood: { maxMessages: Math.max(2, Number(e.target.value) || 6) },
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-slate-200 dark:border-[#1E2640] bg-slate-50 dark:bg-[#0B0F19] px-2 py-1 text-xs font-mono tabular-nums text-slate-900 dark:text-white"
                    />
                  </label>
                  <label className="text-[11px] text-slate-600 dark:text-slate-400">
                    {s.antiFlood.windowSec}
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={a.antiFlood.windowSeconds}
                      onChange={(e) =>
                        patchAdditional('antiFloodWindow', {
                          antiFlood: { windowSeconds: Math.max(1, Number(e.target.value) || 5) },
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-slate-200 dark:border-[#1E2640] bg-slate-50 dark:bg-[#0B0F19] px-2 py-1 text-xs font-mono tabular-nums text-slate-900 dark:text-white"
                    />
                  </label>
                  <label className="text-[11px] text-slate-600 dark:text-slate-400">
                    {s.antiFlood.muteMin}
                    <input
                      type="number"
                      min={1}
                      max={10080}
                      value={a.antiFlood.muteMinutes}
                      onChange={(e) =>
                        patchAdditional('antiFloodMute', {
                          antiFlood: { muteMinutes: Math.max(1, Number(e.target.value) || 10) },
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-slate-200 dark:border-[#1E2640] bg-slate-50 dark:bg-[#0B0F19] px-2 py-1 text-xs font-mono tabular-nums text-slate-900 dark:text-white"
                    />
                  </label>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={onNavigatePremium}
                  className="text-[11px] text-amber-600 dark:text-amber-400 hover:underline flex items-center justify-center gap-1.5 cursor-pointer pt-1"
                >
                  <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                  <span>{s.antiFlood.premiumHint}</span>
                </button>
              )}
            </motion.div>
          )}

          {/* 3. Anti Scam */}
          {visibleModules.has('antiScam') && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.04 }}
              className="rounded-2xl border border-slate-200 dark:border-[#1E2640] bg-white dark:bg-[#0D1222]/90 backdrop-blur-xl p-5 flex flex-col justify-between gap-4 shadow-sm dark:shadow-xl hover:border-indigo-500/40 transition-colors"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                    {s.antiScam.title}
                  </h3>
                  <span className="text-[11px] font-mono font-bold text-[#5865F2] dark:text-indigo-400">
                    {c.common.free}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1.5 leading-relaxed">
                  {s.antiScam.desc}
                </p>
              </div>
              <div className="flex gap-2.5">
                <TwoOptionTile
                  active={!a.antiScam.enabled}
                  icon={UserX}
                  title={c.common.disabled}
                  desc={s.antiScam.off}
                  orientation="horizontal"
                  onClick={() => patchAdditional('antiScam', { antiScam: { enabled: false } })}
                />
                <TwoOptionTile
                  active={a.antiScam.enabled}
                  icon={ShieldAlert}
                  title={c.common.enabled}
                  desc={s.antiScam.on}
                  orientation="horizontal"
                  onClick={() => patchAdditional('antiScam', { antiScam: { enabled: true } })}
                />
              </div>
              {isPremium ? (
                <label className="text-[11px] text-slate-600 dark:text-slate-400 flex items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-[#1E2640]">
                  <span>{s.antiScam.muteMin}</span>
                  <input
                    type="number"
                    min={1}
                    max={10080}
                    value={a.antiScam.muteMinutes}
                    onChange={(e) =>
                      patchAdditional('antiScamMute', {
                        antiScam: { muteMinutes: Math.max(1, Number(e.target.value) || 30) },
                      })
                    }
                    className="w-24 rounded-lg border border-slate-200 dark:border-[#1E2640] bg-slate-50 dark:bg-[#0B0F19] px-2.5 py-1 text-xs font-mono tabular-nums text-slate-900 dark:text-white"
                  />
                </label>
              ) : (
                <button
                  type="button"
                  onClick={onNavigatePremium}
                  className="text-[11px] text-amber-600 dark:text-amber-400 hover:underline flex items-center justify-center gap-1.5 cursor-pointer pt-1"
                >
                  <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                  <span>{s.antiScam.premiumHint}</span>
                </button>
              )}
            </motion.div>
          )}

          {/* 4. Anti Everyone Permisos */}
          {visibleModules.has('antiEveryone') && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.06 }}
              className="rounded-2xl border border-slate-200 dark:border-[#1E2640] bg-white dark:bg-[#0D1222]/90 backdrop-blur-xl p-5 flex flex-col justify-between gap-4 shadow-sm dark:shadow-xl hover:border-indigo-500/40 transition-colors"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                    {s.antiEveryone.title}
                  </h3>
                  <span className="text-[11px] font-mono font-bold text-[#5865F2] dark:text-indigo-400">
                    {c.common.free}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1.5 leading-relaxed">
                  {s.antiEveryone.desc}
                </p>
              </div>
              <div className="flex gap-2.5">
                <TwoOptionTile
                  active={!a.antiEveryonePerms}
                  icon={UserX}
                  title={c.common.disabled}
                  desc={s.antiEveryone.off}
                  orientation="horizontal"
                  onClick={() => patchAdditional('antiEveryone', { antiEveryonePerms: false })}
                />
                <TwoOptionTile
                  active={a.antiEveryonePerms}
                  icon={AtSign}
                  title={c.common.enabled}
                  desc={s.antiEveryone.on}
                  orientation="horizontal"
                  onClick={() => patchAdditional('antiEveryone', { antiEveryonePerms: true })}
                />
              </div>
            </motion.div>
          )}

          {/* 5. Anti Spam Webhooks */}
          {visibleModules.has('antiWebhook') && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 }}
              className="rounded-2xl border border-slate-200 dark:border-[#1E2640] bg-white dark:bg-[#0D1222]/90 backdrop-blur-xl p-5 flex flex-col justify-between gap-4 shadow-sm dark:shadow-xl hover:border-indigo-500/40 transition-colors"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                    {s.antiWebhook.title}
                  </h3>
                  <span className="text-[11px] font-mono font-bold text-[#5865F2] dark:text-indigo-400">
                    {c.common.free}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1.5 leading-relaxed">
                  {s.antiWebhook.desc}
                </p>
              </div>
              <div className="flex gap-2.5">
                <TwoOptionTile
                  active={!a.antiWebhookSpam}
                  icon={UserX}
                  title={c.common.disabled}
                  desc={s.antiWebhook.off}
                  orientation="horizontal"
                  onClick={() => patchAdditional('antiWebhookSpam', { antiWebhookSpam: false })}
                />
                <TwoOptionTile
                  active={a.antiWebhookSpam}
                  icon={Webhook}
                  title={c.common.enabled}
                  desc={s.antiWebhook.on}
                  orientation="horizontal"
                  onClick={() => patchAdditional('antiWebhookSpam', { antiWebhookSpam: true })}
                />
              </div>
            </motion.div>
          )}

          {/* 6. Anti Mass Mute (PREMIUM) */}
          {visibleModules.has('antiMassMute') && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="rounded-2xl border border-amber-500/40 bg-white dark:bg-[#0D1222]/90 backdrop-blur-xl p-5 flex flex-col justify-between gap-4 shadow-sm dark:shadow-xl"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                    {s.antiMassMute.title}
                  </h3>
                  <span className="text-[11px] font-mono font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1">
                    <Crown className="w-3 h-3" />
                    {c.common.premium}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1.5 leading-relaxed">
                  {s.antiMassMute.desc}
                </p>
              </div>

              {isPremium ? (
                <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-[#1E2640]">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                      <VolumeX className="w-4 h-4 text-amber-500" />
                      {a.antiMassMute.enabled ? c.common.enabled : c.common.disabled}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        patchAdditional('antiMassMute', {
                          antiMassMute: { enabled: !a.antiMassMute.enabled },
                        })
                      }
                      className={`w-11 h-6 rounded-full p-0.5 transition-colors cursor-pointer ${
                        a.antiMassMute.enabled ? 'bg-[#5865F2]' : 'bg-slate-300 dark:bg-slate-700'
                      }`}
                    >
                      <span
                        className={`block w-5 h-5 rounded-full bg-white transition-transform ${
                          a.antiMassMute.enabled ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                  <label className="text-xs text-slate-600 dark:text-slate-400 flex items-center justify-between">
                    <span>{s.antiMassMute.maxMutes}</span>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={a.antiMassMute.maxMutesPerMinute}
                      onChange={(e) =>
                        patchAdditional('antiMassMuteLimit', {
                          antiMassMute: {
                            maxMutesPerMinute: Math.max(1, Number(e.target.value) || 3),
                          },
                        })
                      }
                      className="w-20 rounded-lg border border-slate-200 dark:border-[#1E2640] bg-slate-50 dark:bg-[#0B0F19] px-2.5 py-1 text-xs font-mono tabular-nums text-slate-900 dark:text-white"
                    />
                  </label>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center text-center gap-3 py-4">
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    {c.common.premiumRequiredNote}
                  </p>
                  <button
                    type="button"
                    onClick={onNavigatePremium}
                    className="px-6 py-2.5 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-bold shadow-md cursor-pointer transition-colors"
                  >
                    {c.common.activatePremium}
                  </button>
                </div>
              )}
            </motion.div>
          )}

          {/* 7. Anti Alts */}
          {visibleModules.has('antiAlts') && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12 }}
              className="rounded-2xl border border-slate-200 dark:border-[#1E2640] bg-white dark:bg-[#0D1222]/90 backdrop-blur-xl p-5 flex flex-col justify-between gap-4 shadow-sm dark:shadow-xl hover:border-indigo-500/40 transition-colors"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                    {s.antiAlts.title}
                  </h3>
                  <span className="text-[11px] font-mono font-bold text-[#5865F2] dark:text-indigo-400">
                    {c.common.free}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1.5 leading-relaxed">
                  {s.antiAlts.desc}
                </p>
              </div>
              <div className="flex items-end justify-between gap-4 pt-2 border-t border-slate-200 dark:border-[#1E2640]">
                <div>
                  <div className="text-[11px] text-slate-600 dark:text-slate-400 mb-1.5">
                    {c.antiRaidSuite.systemState}
                  </div>
                  <button
                    type="button"
                    disabled={savingKey === 'antiAlts'}
                    onClick={() =>
                      patchAdditional('antiAlts', { antiAlts: { enabled: !a.antiAlts.enabled } })
                    }
                    className="inline-flex items-center gap-2 cursor-pointer"
                  >
                    <span
                      className={`w-11 h-6 rounded-full p-0.5 transition-colors ${
                        a.antiAlts.enabled ? 'bg-[#5865F2]' : 'bg-slate-300 dark:bg-slate-700'
                      }`}
                    >
                      <span
                        className={`block w-5 h-5 rounded-full bg-white transition-transform ${
                          a.antiAlts.enabled ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </span>
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      {a.antiAlts.enabled ? c.common.enabled : c.common.disabled}
                    </span>
                  </button>
                </div>
                <label className="text-[11px] text-slate-600 dark:text-slate-400 w-36">
                  {s.antiAlts.minDays}
                  <input
                    type="number"
                    min={1}
                    max={730}
                    value={a.antiAlts.minAccountAgeDays}
                    onChange={(e) =>
                      patchAdditional('antiAltsDays', {
                        antiAlts: {
                          minAccountAgeDays: Math.min(730, Math.max(1, Number(e.target.value) || 7)),
                        },
                      })
                    }
                    className="mt-1.5 w-full rounded-xl border border-slate-200 dark:border-[#1E2640] bg-slate-50 dark:bg-[#0B0F19] px-3 py-1.5 text-sm font-mono tabular-nums text-slate-900 dark:text-white"
                  />
                </label>
              </div>
            </motion.div>
          )}

          {/* 8. Anti Bots */}
          {visibleModules.has('antiBots') && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.14 }}
              className="rounded-2xl border border-slate-200 dark:border-[#1E2640] bg-white dark:bg-[#0D1222]/90 backdrop-blur-xl p-5 flex flex-col justify-between gap-4 shadow-sm dark:shadow-xl hover:border-indigo-500/40 transition-colors"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                    {s.antiBots.title}
                  </h3>
                  <span className="text-[11px] font-mono font-bold text-[#5865F2] dark:text-indigo-400">
                    {c.common.free}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1.5 leading-relaxed">
                  {s.antiBots.desc}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { mode: 'DISABLED' as AntiBotsMode, title: s.antiBots.offTitle, desc: s.antiBots.offDesc, icon: UserX },
                    { mode: 'UNVERIFIED_ONLY' as AntiBotsMode, title: s.antiBots.unverifiedTitle, desc: s.antiBots.unverifiedDesc, icon: Bot },
                    { mode: 'BAN_ALL' as AntiBotsMode, title: s.antiBots.allTitle, desc: s.antiBots.allDesc, icon: Ban },
                  ] as const
                ).map((opt) => (
                  <TwoOptionTile
                    key={opt.mode}
                    active={a.antiBots === opt.mode}
                    icon={opt.icon}
                    title={opt.title}
                    desc={opt.desc}
                    orientation="horizontal"
                    onClick={() => patchAdditional('antiBots', { antiBots: opt.mode })}
                  />
                ))}
              </div>
            </motion.div>
          )}

          {/* 9. Anti Invites */}
          {visibleModules.has('antiInvites') && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.16 }}
              className="rounded-2xl border border-slate-200 dark:border-[#1E2640] bg-white dark:bg-[#0D1222]/90 backdrop-blur-xl p-5 flex flex-col justify-between gap-4 shadow-sm dark:shadow-xl hover:border-indigo-500/40 transition-colors"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                    {s.antiInvites.title}
                  </h3>
                  <span className="text-[11px] font-mono font-bold text-[#5865F2] dark:text-indigo-400">
                    {c.common.free}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1.5 leading-relaxed">
                  {s.antiInvites.desc}
                </p>
                <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 mt-2 font-mono tabular-nums">
                  <Settings2 className="w-3.5 h-3.5 text-[#5865F2] dark:text-indigo-400" />
                  <span>
                    {s.autoModCounter}{' '}
                    <strong className="text-slate-900 dark:text-white">
                      {autoModUsed}/{autoModLimit}
                    </strong>
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-2.5">
                <TwoOptionTile
                  active={!a.antiInvites}
                  icon={Link2}
                  title={c.common.disabled}
                  desc={s.antiInvites.off}
                  orientation="vertical"
                  onClick={() => patchAdditional('antiInvites', { antiInvites: false })}
                />
                <TwoOptionTile
                  active={a.antiInvites}
                  icon={Link2Off}
                  title={c.common.enabled}
                  desc={s.antiInvites.on}
                  orientation="vertical"
                  onClick={() => patchAdditional('antiInvites', { antiInvites: true })}
                />
              </div>
            </motion.div>
          )}

          {/* 10. Anti Links */}
          {visibleModules.has('antiLinks') && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.18 }}
              className="rounded-2xl border border-slate-200 dark:border-[#1E2640] bg-white dark:bg-[#0D1222]/90 backdrop-blur-xl p-5 flex flex-col justify-between gap-4 shadow-sm dark:shadow-xl md:col-span-2 lg:col-span-3"
            >
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                <div className="lg:col-span-5 space-y-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                      {s.antiLinks.title}
                    </h3>
                    <span className="text-[11px] font-mono font-bold text-[#5865F2] dark:text-indigo-400">
                      {c.common.free}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    {s.antiLinks.desc}
                  </p>
                  <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 pt-1 font-mono tabular-nums">
                    <Settings2 className="w-3.5 h-3.5 text-[#5865F2] dark:text-indigo-400" />
                    <span>
                      {s.autoModCounter}{' '}
                      <strong className="text-slate-900 dark:text-white">
                        {autoModUsed}/{autoModLimit}
                      </strong>
                    </span>
                  </div>
                </div>

                <div className="lg:col-span-7 flex flex-col sm:flex-row gap-3">
                  <TwoOptionTile
                    active={!a.antiLinks.enabled}
                    icon={Link2}
                    title={c.common.disabled}
                    desc={s.antiLinks.off}
                    orientation="vertical"
                    onClick={() => patchAdditional('antiLinks', { antiLinks: { enabled: false } })}
                  />
                  <TwoOptionTile
                    active={a.antiLinks.enabled}
                    icon={ShieldCheck}
                    title={c.common.enabled}
                    desc={s.antiLinks.on}
                    orientation="vertical"
                    onClick={() => patchAdditional('antiLinks', { antiLinks: { enabled: true } })}
                  />
                </div>
              </div>

              {isPremium && (
                <div className="pt-3 border-t border-slate-200 dark:border-[#1E2640] flex flex-col sm:flex-row sm:items-center gap-3">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300 shrink-0">
                    {s.antiLinks.allowedDomains}:
                  </span>
                  <div className="flex flex-wrap gap-1.5 flex-1">
                    {a.antiLinks.allowedDomains.map((dom) => (
                      <button
                        key={dom}
                        type="button"
                        onClick={() =>
                          patchAdditional('antiLinksDomains', {
                            antiLinks: {
                              allowedDomains: a.antiLinks.allowedDomains.filter((d) => d !== dom),
                            },
                          })
                        }
                        className="px-2.5 py-1 rounded-lg text-xs font-mono bg-indigo-500/10 text-[#5865F2] dark:text-indigo-300 border border-indigo-500/25 hover:bg-red-500/15 hover:text-red-500 cursor-pointer"
                      >
                        {dom} ×
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={domainInput}
                      onChange={(e) => setDomainInput(e.target.value)}
                      placeholder={s.antiLinks.domainPlaceholder}
                      className="rounded-xl border border-slate-200 dark:border-[#1E2640] bg-slate-50 dark:bg-[#0B0F19] px-3 py-1.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-[#5865F2]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const clean = domainInput.trim().toLowerCase();
                        if (clean.length < 3) return;
                        const next = Array.from(new Set([...a.antiLinks.allowedDomains, clean]));
                        setDomainInput('');
                        patchAdditional('antiLinksDomains', {
                          antiLinks: { allowedDomains: next },
                        });
                      }}
                      className="px-3 py-1.5 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-semibold cursor-pointer shadow-sm transition-colors"
                    >
                      {c.common.add}
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </div>
      )}
    </div>
  );
}
