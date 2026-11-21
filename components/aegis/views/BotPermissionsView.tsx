'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Crown,
  Info,
  Lock,
  Plus,
  ShieldCheck,
  Trash2,
  UserX,
  Users,
} from 'lucide-react';
import type {
  BotCommandPermission,
  BotPermissionGrantRecord,
  GuildPlanRecord,
  LanguageCode,
} from '@/lib/aegis/types';
import { getSuiteCopy } from '@/lib/aegis/dashboard-i18n';
import { aegisFetch } from '@/lib/aegis/client-auth';
import { getPlanDisplayName, isPaidTier, normalizePlanTier } from '@/lib/aegis/premium';

interface BotPermissionsViewProps {
  language: LanguageCode;
  activeGuildId: string;
  syncNonce?: number;
  onNavigatePremium: () => void;
  onNavigateServers: () => void;
  onSyncCompleted: () => void;
}

const ALL_PERMS: BotCommandPermission[] = [
  'BAN',
  'UNBAN',
  'MUTE',
  'UNMUTE',
  'CLEAR_MESSAGES',
  'KICK',
];

export function BotPermissionsView({
  language,
  activeGuildId,
  syncNonce = 0,
  onNavigatePremium,
  onNavigateServers,
  onSyncCompleted,
}: BotPermissionsViewProps) {
  const c = getSuiteCopy(language);
  const b = c.botPermissions;
  const [grants, setGrants] = useState<BotPermissionGrantRecord[]>([]);
  const [plan, setPlan] = useState<GuildPlanRecord | null>(null);
  const [usage, setUsage] = useState({
    usersUsed: 0,
    usersLimit: 10,
    rolesUsed: 0,
    rolesLimit: 5,
  });
  const [loading, setLoading] = useState(true);
  const [infoOpen, setInfoOpen] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const loadedGuildRef = useRef<string>('');

  // Form
  const [targetType, setTargetType] = useState<'USER' | 'ROLE'>('USER');
  const [targetId, setTargetId] = useState('');
  const [targetName, setTargetName] = useState('');
  const [selectedPerms, setSelectedPerms] = useState<BotCommandPermission[]>(['MUTE', 'KICK']);
  const [rateLimitActions, setRateLimitActions] = useState(5);
  const [rateLimitWindowMinutes, setRateLimitWindowMinutes] = useState(10);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = async () => {
    if (!activeGuildId) return;
    const res = await aegisFetch(`/api/guilds/${activeGuildId}/bot-permissions`);
    const json = await res.json().catch(() => null);
    if (res.ok && json) {
      setGrants(json.grants || []);
      setPlan(json.plan);
      setUsage(json.usage);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const isInitialForGuild = loadedGuildRef.current !== activeGuildId;
    const loadPerms = async () => {
      if (!activeGuildId) {
        if (!cancelled) setLoading(false);
        return;
      }
      if (isInitialForGuild) setLoading(true);
      try {
        const res = await aegisFetch(`/api/guilds/${activeGuildId}/bot-permissions`);
        const json = await res.json().catch(() => null);
        if (cancelled || !res.ok || !json) return;
        loadedGuildRef.current = activeGuildId;
        setGrants(json.grants || []);
        setPlan(json.plan);
        setUsage(json.usage);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void Promise.resolve().then(loadPerms);
    return () => {
      cancelled = true;
    };
  }, [activeGuildId, syncNonce]);

  if (!activeGuildId) {
    return (
      <div className="rounded-3xl border border-slate-200 dark:border-white/[0.08] bg-white/80 dark:bg-[#0B0F19]/85 backdrop-blur-xl p-8 text-center">
        <Lock className="w-10 h-10 text-indigo-500 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{c.common.noServerTitle}</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
          {c.common.noServerDesc}
        </p>
        <button
          type="button"
          onClick={onNavigateServers}
          className="mt-5 px-4 py-2 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-semibold cursor-pointer"
        >
          {c.common.goToServers}
        </button>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await aegisFetch(`/api/guilds/${activeGuildId}/bot-permissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetType,
          targetId: targetId.trim(),
          targetName: targetName.trim(),
          permissions: selectedPerms,
          rateLimitActions,
          rateLimitWindowMinutes,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setFeedback({ ok: false, text: json?.message || 'Error granting bot permissions.' });
        return;
      }
      setTargetId('');
      setTargetName('');
      setModalOpen(false);
      setFeedback({ ok: true, text: c.common.saved });
      await reload();
      onSyncCompleted();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    const res = await aegisFetch(`/api/guilds/${activeGuildId}/bot-permissions?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      await reload();
      onSyncCompleted();
    }
  };

  const togglePerm = (perm: BotCommandPermission) => {
    setSelectedPerms((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-display font-bold text-slate-900 dark:text-white flex items-center gap-2.5 tracking-tight">
          <Lock className="w-6 h-6 text-[#5865F2]" />
          <span>{b.title}</span>
        </h1>
        <button
          type="button"
          onClick={() => setModalOpen((v) => !v)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-semibold shadow-sm cursor-pointer transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>{b.addBtn.replace(/^\+\s*/, '')}</span>
        </button>
      </div>

      {/* Collapsible Explainer Card matching screenshot */}
      <div className="rounded-2xl border border-cyan-500/40 bg-white/85 dark:bg-[#0B0F19]/90 backdrop-blur-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setInfoOpen((o) => !o)}
          className="w-full px-5 py-3.5 flex items-center justify-between text-left cursor-pointer hover:bg-slate-50 dark:hover:bg-white/[0.02]"
        >
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-cyan-600 dark:text-cyan-400">
            <Info className="w-4 h-4" />
            {b.infoTitle}
          </span>
          {infoOpen ? (
            <ChevronUp className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          )}
        </button>

        <AnimatePresence initial={false}>
          {infoOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="px-5 pb-4 space-y-3 overflow-hidden"
            >
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                {b.infoDesc}
              </p>
              <ul className="space-y-1 text-xs text-slate-500 dark:text-slate-400 list-disc pl-5">
                {b.bullets.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="px-2.5 py-1 rounded-md text-[11px] font-mono font-semibold bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 border border-indigo-500/25">
                  {b.usersBadge}: {usage.usersUsed}/{usage.usersLimit}
                </span>
                <span className="px-2.5 py-1 rounded-md text-[11px] font-mono font-semibold bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 border border-cyan-500/25">
                  {b.rolesBadge}: {usage.rolesUsed}/{usage.rolesLimit}
                </span>
                <button
                  type="button"
                  onClick={onNavigatePremium}
                  className="px-2.5 py-1 rounded-md text-[11px] font-mono font-semibold bg-slate-200/70 dark:bg-white/10 text-slate-700 dark:text-slate-200 hover:bg-amber-500/20 hover:text-amber-400 inline-flex items-center gap-1 cursor-pointer"
                >
                  {isPaidTier(normalizePlanTier(plan?.tier)) ? (
                    <>
                      <Crown className="w-3 h-3 text-amber-400" /> {getPlanDisplayName(normalizePlanTier(plan?.tier), language).toUpperCase()}
                    </>
                  ) : (
                    'PLAN FREE'
                  )}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {feedback && (
        <div
          className={`rounded-xl px-4 py-2.5 text-xs font-medium flex items-center gap-2 border ${
            feedback.ok
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500'
              : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Add permission form */}
      <AnimatePresence>
        {modalOpen && (
          <motion.form
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            onSubmit={handleSubmit}
            className="rounded-2xl border border-indigo-500/35 bg-white/95 dark:bg-[#0B0F19]/95 p-5 space-y-4 shadow-lg"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <label className="text-xs text-slate-600 dark:text-slate-300">
                {b.targetType}
                <select
                  value={targetType}
                  onChange={(e) => setTargetType(e.target.value as 'USER' | 'ROLE')}
                  className="mt-1 w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-3 py-2 text-xs text-slate-900 dark:text-white"
                >
                  <option value="USER">{b.userOption}</option>
                  <option value="ROLE">{b.roleOption}</option>
                </select>
              </label>

              <label className="text-xs text-slate-600 dark:text-slate-300">
                {b.targetIdLabel}
                <input
                  type="text"
                  required
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  placeholder="123456789012345678"
                  className="mt-1 w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-3 py-2 text-xs font-mono text-slate-900 dark:text-white"
                />
              </label>

              <label className="text-xs text-slate-600 dark:text-slate-300">
                {b.targetNameLabel}
                <input
                  type="text"
                  required
                  value={targetName}
                  onChange={(e) => setTargetName(e.target.value)}
                  placeholder={targetType === 'USER' ? 'staff_mod' : 'Moderador Jr'}
                  className="mt-1 w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-3 py-2 text-xs text-slate-900 dark:text-white"
                />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-slate-600 dark:text-slate-300">
                  Max
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={rateLimitActions}
                    onChange={(e) => setRateLimitActions(Math.max(1, Number(e.target.value) || 5))}
                    className="mt-1 w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-2.5 py-2 text-xs font-mono text-slate-900 dark:text-white"
                  />
                </label>
                <label className="text-xs text-slate-600 dark:text-slate-300">
                  Min
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={rateLimitWindowMinutes}
                    onChange={(e) =>
                      setRateLimitWindowMinutes(Math.max(1, Number(e.target.value) || 10))
                    }
                    className="mt-1 w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-2.5 py-2 text-xs font-mono text-slate-900 dark:text-white"
                  />
                </label>
              </div>
            </div>

            <div>
              <div className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-2">
                {b.permsLabel}
              </div>
              <div className="flex flex-wrap gap-2">
                {ALL_PERMS.map((perm) => {
                  const active = selectedPerms.includes(perm);
                  return (
                    <button
                      key={perm}
                      type="button"
                      onClick={() => togglePerm(perm)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                        active
                          ? 'bg-[#5865F2] border-[#5865F2] text-white'
                          : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:border-indigo-400'
                      }`}
                    >
                      {b.permLabels[perm]}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-white/10 text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer"
              >
                {c.common.cancel}
              </button>
              <button
                type="submit"
                disabled={submitting || selectedPerms.length === 0}
                className="px-4 py-2 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
              >
                {c.common.save}
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {/* Grants List / Empty State */}
      {loading ? (
        <div className="h-44 rounded-2xl bg-slate-200/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-white/[0.06]" />
      ) : grants.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white/80 dark:bg-[#0B0F19]/85 py-14 px-6 text-center space-y-4">
          <UserX className="w-9 h-9 text-slate-400 mx-auto" />
          <p className="text-sm text-slate-500 dark:text-slate-400">{b.emptyText}</p>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-semibold cursor-pointer"
          >
            {b.addNowBtn}
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white/85 dark:bg-[#0B0F19]/90 overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-white/[0.06] text-[11px] font-mono uppercase tracking-wider text-slate-400">
                <th className="py-3 px-4">{b.tableTarget}</th>
                <th className="py-3 px-4">{b.tablePerms}</th>
                <th className="py-3 px-4">{b.tableRateLimit}</th>
                <th className="py-3 px-4 text-right">{b.tableActions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-white/[0.05] text-xs">
              {grants.map((g) => (
                <tr key={g.id} className="hover:bg-slate-50/70 dark:hover:bg-white/[0.02]">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2.5">
                      {g.targetType === 'ROLE' ? (
                        <Users className="w-4 h-4 text-cyan-400 shrink-0" />
                      ) : (
                        <ShieldCheck className="w-4 h-4 text-indigo-400 shrink-0" />
                      )}
                      <div>
                        <div className="font-semibold text-slate-900 dark:text-white">{g.targetName}</div>
                        <div className="font-mono text-[11px] text-slate-400">{g.targetId}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex flex-wrap gap-1">
                      {g.permissions.map((p) => (
                        <span
                          key={p}
                          className="px-2 py-0.5 rounded-md bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 text-[11px] font-medium"
                        >
                          {b.permLabels[p]}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-300">
                    {g.rateLimitActions} / {g.rateLimitWindowMinutes}m
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => handleDelete(g.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-red-500/35 text-red-500 hover:bg-red-500/10 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{c.common.delete}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
