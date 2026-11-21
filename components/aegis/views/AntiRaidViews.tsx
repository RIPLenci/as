'use client';

import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Crown,
  Play,
  ShieldAlert,
  ShieldCheck,
  Sliders,
} from 'lucide-react';
import type {
  AntiNukeConfigRecord,
  AntiRaidConfigRecord,
  AntiRaidRuleKey,
  AutoAction,
  GuildPlanRecord,
  GuildRecord,
  GuildSecuritySuiteRecord,
  GuildSettingsRecord,
  LanguageCode,
  ProtectionMode,
} from '@/lib/aegis/types';
import type { RiskEvaluationResult } from '@/lib/aegis/risk-engine';
import { getDict } from '@/lib/aegis/i18n';
import { getSuiteCopy } from '@/lib/aegis/dashboard-i18n';
import { aegisFetch } from '@/lib/aegis/client-auth';
import { isPaidTier, normalizePlanTier } from '@/lib/aegis/premium';

interface AntiRaidViewsProps {
  section: 'protection-overview' | 'join-protection' | 'anti-nuke' | 'risk-engine';
  language: LanguageCode;
  activeGuildId: string;
  syncNonce?: number;
  onSyncCompleted: () => void;
  onNavigatePremium?: () => void;
}

const ANTI_RAID_RULE_ORDER: AntiRaidRuleKey[] = [
  'channelCreate',
  'channelDelete',
  'channelEdit',
  'roleCreate',
  'roleDelete',
  'roleEdit',
  'emojiCreate',
  'emojiDelete',
  'memberKick',
  'memberBan',
  'memberUnban',
  'webhookEdit',
];

export function AntiRaidViews({
  section,
  language,
  activeGuildId,
  syncNonce = 0,
  onSyncCompleted,
  onNavigatePremium,
}: AntiRaidViewsProps) {
  const isEs = language === 'es';
  const t = getDict(language);
  const suiteCopy = getSuiteCopy(language);
  const [guild, setGuild] = useState<GuildRecord | null>(null);
  const [config, setConfig] = useState<AntiRaidConfigRecord | null>(null);
  const [settings, setSettings] = useState<GuildSettingsRecord | null>(null);
  const [antiNuke, setAntiNuke] = useState<AntiNukeConfigRecord | null>(null);
  const [suite, setSuite] = useState<GuildSecuritySuiteRecord | null>(null);
  const [plan, setPlan] = useState<GuildPlanRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const [newAdminId, setNewAdminId] = useState('');

  const [simJoins, setSimJoins] = useState(12);
  const [simAgeDays, setSimAgeDays] = useState(1);
  const [simSimilar, setSimSimilar] = useState(5);
  const [simGlobalBan, setSimGlobalBan] = useState(false);
  const [simResult, setSimResult] = useState<{
    evaluation: RiskEvaluationResult;
    wouldTriggerAction: boolean;
  } | null>(null);

  useEffect(() => {
    if (!activeGuildId) return;
    let cancelled = false;
    Promise.all([
      aegisFetch(`/api/guilds/${activeGuildId}/antiraid`),
      aegisFetch(`/api/guilds/${activeGuildId}/antinuke`),
      aegisFetch(`/api/guilds/${activeGuildId}/security-suite`),
    ])
      .then(async ([arRes, anRes, suRes]) => {
        if (cancelled) return;
        const arJson = await arRes.json().catch(() => null);
        const anJson = await anRes.json().catch(() => null);
        const suJson = await suRes.json().catch(() => null);
        if (cancelled) return;

        if (!arRes.ok) {
          setLoadError(
            arJson?.message ||
              (isEs
                ? 'No se pudo cargar la configuración de protección del servidor.'
                : 'Failed to load guild protection configuration.')
          );
          return;
        }
        setLoadError(null);
        setGuild(arJson.guild);
        setConfig(arJson.config);
        setSettings(arJson.settings);

        if (!anRes.ok) {
          setLoadError(
            anJson?.message ||
              (isEs ? 'No se pudo cargar la configuración Anti-Nuke.' : 'Failed to load Anti-Nuke configuration.')
          );
        } else {
          setAntiNuke(anJson.config);
        }

        if (suRes.ok && suJson) {
          setSuite(suJson.suite ?? null);
          setPlan(suJson.plan ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError(
            isEs
              ? 'Error de red al cargar la configuración de protección.'
              : 'Network error while loading protection configuration.'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeGuildId, isEs, syncNonce]);

  const patchSuiteRule = async (
    payload:
      | { punishmentAction: GuildSecuritySuiteRecord['punishmentAction'] }
      | { antiRaidModules: Record<string, { enabled?: boolean; actionsPerMinute?: number }> }
  ) => {
    setFeedback(null);
    try {
      const res = await aegisFetch(`/api/guilds/${activeGuildId}/security-suite`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setFeedback({
          ok: false,
          text:
            json?.message ||
            (isEs ? 'Error al actualizar el módulo Anti-Raid.' : 'Failed to update Anti-Raid module.'),
        });
        return;
      }
      setSuite(json.suite);
      setPlan(json.plan);
      setFeedback({ ok: true, text: suiteCopy.common.saved });
      onSyncCompleted();
    } catch {
      setFeedback({
        ok: false,
        text: isEs ? 'Error de red al actualizar módulo Anti-Raid.' : 'Network error updating Anti-Raid module.',
      });
    }
  };

  const handleToggleMaster = async () => {
    if (!config) return;
    setSaving(true);
    setFeedback(null);
    try {
      const endpoint = config.enabled
        ? `/api/guilds/${activeGuildId}/antiraid/disable`
        : `/api/guilds/${activeGuildId}/antiraid/enable`;
      const res = await aegisFetch(endpoint, { method: 'POST' });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setFeedback({
          ok: false,
          text: json?.message || (isEs ? 'Error al cambiar estado de protección.' : 'Failed to toggle protection.'),
        });
      } else if (json) {
        setConfig(json.config);
        setGuild(json.guild);
        setFeedback({
          ok: true,
          text: `${t.common.syncConfirmed} (v${json.config.syncVersion})`,
        });
        onSyncCompleted();
      }
    } catch {
      setFeedback({
        ok: false,
        text: isEs ? 'Error de red al cambiar estado de protección.' : 'Network error while toggling protection.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAntiRaid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config) return;
    setSaving(true);
    setFeedback(null);
    try {
      const res = await aegisFetch(`/api/guilds/${activeGuildId}/antiraid`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: config.mode,
          sensitivity: config.sensitivity,
          maxJoins: config.maxJoins,
          timeWindowSeconds: config.timeWindowSeconds,
          minAccountAgeDays: config.minAccountAgeDays,
          suspiciousAccountDetection: config.suspiciousAccountDetection,
          botJoinDetection: config.botJoinDetection,
          joinPatternDetection: config.joinPatternDetection,
          burstDetection: config.burstDetection,
          riskThreshold: config.riskThreshold,
          defaultAction: config.defaultAction,
          riskRules: config.riskRules,
          riskWeights: config.riskWeights,
          alertChannelName: settings?.alertChannelName ?? null,
          alertBatchIntervalSeconds: settings?.alertBatchIntervalSeconds ?? 15,
          deduplicateAlerts: settings?.deduplicateAlerts ?? true,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setFeedback({
          ok: false,
          text: json?.message || (isEs ? 'Error de validación' : 'Validation error'),
        });
      } else if (json) {
        setConfig(json.config);
        setSettings(json.settings);
        setFeedback({
          ok: true,
          text: `${t.common.savedConfirmed} (Sync v${json.syncVersion})`,
        });
        onSyncCompleted();
      }
    } catch {
      setFeedback({
        ok: false,
        text: isEs ? 'Error de red al guardar configuración Anti-Raid.' : 'Network error saving Anti-Raid config.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAntiNuke = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!antiNuke) return;
    setSaving(true);
    setFeedback(null);
    try {
      const res = await aegisFetch(`/api/guilds/${activeGuildId}/antinuke`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(antiNuke),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setFeedback({
          ok: false,
          text: json?.message || (isEs ? 'Error de validación' : 'Validation error'),
        });
      } else if (json) {
        setAntiNuke(json.config);
        setFeedback({ ok: true, text: t.common.savedConfirmed });
        onSyncCompleted();
      }
    } catch {
      setFeedback({
        ok: false,
        text: isEs ? 'Error de red al guardar configuración Anti-Nuke.' : 'Network error saving Anti-Nuke config.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRunRiskTest = async (persistIncident: boolean) => {
    setSaving(true);
    setFeedback(null);
    try {
      const res = await aegisFetch(`/api/guilds/${activeGuildId}/antiraid/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          simulatedJoins: simJoins,
          accountAgeDays: simAgeDays,
          similarUsernameCount: simSimilar,
          hasActiveGlobalBan: simGlobalBan,
          persistIncident,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setFeedback({
          ok: false,
          text:
            json?.issues?.[0]?.message ||
            json?.message ||
            (isEs ? 'Error al ejecutar prueba diagnóstica.' : 'Failed to execute diagnostic probe.'),
        });
        return;
      }
      setSimResult(json);
      if (persistIncident && json.wouldTriggerAction) {
        setFeedback({
          ok: true,
          text: isEs
            ? 'Sonda diagnóstica de raid ejecutada y registrada en Incidentes de Seguridad.'
            : 'Diagnostic raid probe executed and recorded in Security Incidents.',
        });
        onSyncCompleted();
      }
    } catch {
      setFeedback({
        ok: false,
        text: isEs
          ? 'Error de red al ejecutar sonda diagnóstica.'
          : 'Network error while executing diagnostic probe.',
      });
    } finally {
      setSaving(false);
    }
  };

  if (!activeGuildId) {
    return (
      <div className="p-8 rounded-2xl bg-white dark:bg-[#0F1422] border border-slate-200 dark:border-white/[0.08] text-center space-y-2">
        <div className="font-display text-base font-semibold text-slate-900 dark:text-white">
          {suiteCopy.common.noServerTitle}
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          {suiteCopy.common.noServerDesc}
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-8 rounded-2xl bg-white dark:bg-[#0F1422] border border-slate-200 dark:border-white/[0.08] text-sm text-slate-500">
        {t.common.loading}
      </div>
    );
  }

  if (!config || (section === 'anti-nuke' && !antiNuke)) {
    return (
      <div
        role="alert"
        className="p-6 rounded-2xl bg-red-500/10 border border-red-500/30 text-xs text-red-700 dark:text-red-300"
      >
        {loadError ||
          (isEs
            ? 'No se pudo cargar la configuración de protección para este servidor.'
            : 'Unable to load protection configuration for this Discord server.')}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {feedback && (
        <div
          role="status"
          className={`p-3.5 rounded-xl border text-xs flex items-center gap-2 ${
            feedback.ok
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
              : 'bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300'
          }`}
        >
          {feedback.ok ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {section === 'protection-overview' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
                {t.navItems['protection-overview']} — {guild?.name}
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
                {isEs
                  ? 'Estado Anti-Raid en tiempo real, nivel de sensibilidad y telemetría de sincronización del bot.'
                  : 'Live Anti-Raid state, sensitivity mode, and bot synchronization telemetry.'}
              </p>
            </div>
            <button
              type="button"
              disabled={saving}
              onClick={handleToggleMaster}
              className={`px-5 py-2.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                config.enabled
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white'
              }`}
            >
              {config.enabled
                ? isEs
                  ? 'Desactivar Protección Anti-Raid'
                  : 'Disable Anti-Raid Protection'
                : isEs
                ? 'Activar Protección Anti-Raid'
                : 'Enable Anti-Raid Protection'}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 rounded-2xl bg-white dark:bg-[#0F1422] border border-slate-200 dark:border-white/[0.08] space-y-1">
              <div className="text-xs text-slate-500">
                {isEs ? 'Estado de Protección' : 'Protection Status'}
              </div>
              <div
                className={`font-mono text-lg font-bold ${
                  config.enabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'
                }`}
              >
                {config.enabled ? (isEs ? 'ACTIVO' : 'ACTIVE') : isEs ? 'DESACTIVADO' : 'DISABLED'}
              </div>
              <div className="text-[11px] font-mono tabular-nums text-slate-500">
                Sync v{config.syncVersion}
              </div>
            </div>
            <div className="p-4 rounded-2xl bg-white dark:bg-[#0F1422] border border-slate-200 dark:border-white/[0.08] space-y-1">
              <div className="text-xs text-slate-500">
                {isEs ? 'Modo de Protección' : 'Protection Mode'}
              </div>
              <div className="font-mono text-lg font-bold text-[#5865F2]">{config.mode}</div>
              <div className="text-[11px] font-mono text-slate-500">
                {isEs ? 'Sensibilidad:' : 'Sensitivity:'} {config.sensitivity}
              </div>
            </div>
            <div className="p-4 rounded-2xl bg-white dark:bg-[#0F1422] border border-slate-200 dark:border-white/[0.08] space-y-1">
              <div className="text-xs text-slate-500">
                {isEs ? 'Eventos Procesados' : 'Events Processed'}
              </div>
              <div className="font-mono text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                {config.eventsProcessed.toLocaleString()}
              </div>
              <div className="text-[11px] font-mono tabular-nums text-slate-500">
                {isEs ? 'Ataques detectados:' : 'Attacks detected:'} {config.attacksDetected}
              </div>
            </div>
            <div className="p-4 rounded-2xl bg-white dark:bg-[#0F1422] border border-slate-200 dark:border-white/[0.08] space-y-1">
              <div className="text-xs text-slate-500">
                {isEs ? 'Ataques Detenidos' : 'Attacks Stopped'}
              </div>
              <div className="font-mono text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                {config.attacksPrevented}
              </div>
              <div className="text-[11px] font-mono tabular-nums text-slate-500">
                {isEs ? 'Última sync:' : 'Last sync:'}{' '}
                {new Date(config.lastSyncedAt).toLocaleTimeString()}
              </div>
            </div>
          </div>

          {suite && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                    {suiteCopy.antiRaidSuite.title}
                  </h2>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    {suiteCopy.antiRaidSuite.subtitle}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 shrink-0">
                  <span>{suiteCopy.antiRaidSuite.punishmentLabel}:</span>
                  <select
                    value={suite.punishmentAction}
                    onChange={(e) =>
                      patchSuiteRule({
                        punishmentAction: e.target.value as GuildSecuritySuiteRecord['punishmentAction'],
                      })
                    }
                    className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0B0F19] px-3 py-1.5 text-xs font-medium text-slate-900 dark:text-white"
                  >
                    {(['STRIP_ROLES', 'QUARANTINE', 'KICK', 'BAN'] as const).map((act) => (
                      <option key={act} value={act}>
                        {suiteCopy.antiRaidSuite.punishments[act]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {ANTI_RAID_RULE_ORDER.map((ruleKey) => {
                  const rule = suite.antiRaidModules[ruleKey];
                  const copy = suiteCopy.antiRaidSuite.rules[ruleKey];
                  const isPremiumGuild = isPaidTier(normalizePlanTier(plan?.tier));
                  const locked = rule.premiumOnly && !isPremiumGuild;

                  return (
                    <div
                      key={ruleKey}
                      className={`rounded-2xl border p-5 flex flex-col justify-between gap-4 transition-colors backdrop-blur-xl ${
                        locked
                          ? 'border-amber-500/45 bg-white dark:bg-[#0B0F19]/90'
                          : 'border-slate-200 dark:border-indigo-500/25 bg-white dark:bg-[#0B0F19]/90 hover:border-indigo-400/50'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                            {copy.title}
                          </h3>
                          <span
                            className={`text-[11px] font-mono font-bold ${
                              rule.premiumOnly
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-[#5865F2] dark:text-indigo-400'
                            }`}
                          >
                            {rule.premiumOnly ? suiteCopy.common.premium : suiteCopy.common.free}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-400 mt-1.5 leading-relaxed">
                          {copy.desc}
                        </p>
                      </div>

                      {locked ? (
                        <div className="flex flex-col items-center justify-center text-center gap-2.5 pt-2 border-t border-slate-200 dark:border-white/[0.06]">
                          <span className="text-[11px] text-slate-600 dark:text-slate-400">
                            {suiteCopy.common.premiumRequiredNote}
                          </span>
                          <button
                            type="button"
                            onClick={onNavigatePremium}
                            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-semibold cursor-pointer"
                          >
                            <Crown className="w-3.5 h-3.5" />
                            <span>{suiteCopy.common.activatePremium}</span>
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-end justify-between gap-3 pt-3 border-t border-slate-200 dark:border-white/[0.06]">
                          <div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-1.5">
                              {suiteCopy.antiRaidSuite.systemState}
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                patchSuiteRule({
                                  antiRaidModules: { [ruleKey]: { enabled: !rule.enabled } },
                                })
                              }
                              className="inline-flex items-center gap-2 cursor-pointer"
                            >
                              <span
                                className={`w-10 h-5 rounded-full p-0.5 transition-colors ${
                                  rule.enabled ? 'bg-[#5865F2]' : 'bg-slate-300 dark:bg-slate-700'
                                }`}
                              >
                                <span
                                  className={`block w-4 h-4 rounded-full bg-white transition-transform ${
                                    rule.enabled ? 'translate-x-5' : 'translate-x-0'
                                  }`}
                                />
                              </span>
                              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                                {rule.enabled ? suiteCopy.common.enabled : suiteCopy.common.disabled}
                              </span>
                            </button>
                          </div>

                          <label className="text-[11px] text-slate-600 dark:text-slate-400 w-32">
                            {suiteCopy.antiRaidSuite.actionsPerMinute}
                            <input
                              type="number"
                              min={1}
                              max={60}
                              value={rule.actionsPerMinute}
                              onChange={(e) =>
                                patchSuiteRule({
                                  antiRaidModules: {
                                    [ruleKey]: {
                                      actionsPerMinute: Math.min(60, Math.max(1, Number(e.target.value) || 1)),
                                    },
                                  },
                                })
                              }
                              className="mt-1 w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-2.5 py-1.5 text-xs font-mono tabular-nums text-slate-900 dark:text-white"
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <form
            onSubmit={handleSaveAntiRaid}
            className="p-6 rounded-2xl bg-white dark:bg-[#0F1422] border border-slate-200 dark:border-white/[0.08] space-y-5"
          >
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#5865F2]" />
              <span>
                {isEs
                  ? 'Modos de Protección (Aplicación Selectiva sin Falsos Positivos)'
                  : 'Protection Modes (Non-Indiscriminate Enforcement)'}
              </span>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {(
                [
                  {
                    mode: 'NORMAL' as ProtectionMode,
                    desc: isEs
                      ? 'Análisis estándar de ingresos, verificación de ráfagas y alertas al equipo.'
                      : 'Standard join analysis, burst pattern checks, and staff alerts.',
                  },
                  {
                    mode: 'STRICT' as ProtectionMode,
                    desc: isEs
                      ? 'Umbrales más estrictos, multiplicador de riesgo elevado y cuarentena automática.'
                      : 'Tighter thresholds, elevated risk multiplier, automated quarantine on high risk.',
                  },
                  {
                    mode: 'EMERGENCY' as ProtectionMode,
                    desc: isEs
                      ? 'Postura de defensa reforzada, auditoría prioritaria y alertas inmediatas por lotes.'
                      : 'Reinforced raid posture, priority logging, immediate batched emergency alerts.',
                  },
                ] as const
              ).map((item) => (
                <button
                  key={item.mode}
                  type="button"
                  onClick={() => setConfig({ ...config, mode: item.mode })}
                  className={`p-4 rounded-xl border text-left transition-colors cursor-pointer space-y-1.5 ${
                    config.mode === item.mode
                      ? 'border-[#5865F2] bg-[#5865F2]/10'
                      : 'border-slate-200 dark:border-white/[0.08] hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="font-mono text-sm font-bold text-slate-900 dark:text-white">
                    {item.mode}
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    {item.desc}
                  </p>
                </button>
              ))}
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-semibold cursor-pointer"
              >
                {saving ? t.common.saving : t.common.saveChanges}
              </button>
            </div>
          </form>
        </div>
      )}

      {section === 'join-protection' && (
        <form onSubmit={handleSaveAntiRaid} className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
                {t.navItems['join-protection']} — {guild?.name}
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
                {isEs
                  ? 'Configura límites de ingreso por ventana deslizante, heurística de antigüedad de cuenta y respuestas automáticas por nivel de riesgo.'
                  : 'Configure sliding-window join limits, account age heuristics, and risk-tier automated responses.'}
              </p>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-semibold cursor-pointer self-start"
            >
              {saving ? t.common.saving : t.common.saveChanges}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 p-5 rounded-2xl bg-white dark:bg-[#0F1422] border border-slate-200 dark:border-white/[0.08]">
            <label className="space-y-1.5 text-xs">
              <span className="font-medium text-slate-700 dark:text-slate-300">
                {isEs ? 'Ingresos Máximos' : 'Maximum Joins'}
              </span>
              <input
                type="number"
                min={2}
                max={200}
                value={config.maxJoins}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (Number.isFinite(val)) setConfig({ ...config, maxJoins: val });
                }}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-white/[0.08] font-mono tabular-nums"
              />
            </label>
            <label className="space-y-1.5 text-xs">
              <span className="font-medium text-slate-700 dark:text-slate-300">
                {isEs ? 'Ventana de Tiempo (seg)' : 'Time Window (seconds)'}
              </span>
              <input
                type="number"
                min={2}
                max={300}
                value={config.timeWindowSeconds}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (Number.isFinite(val)) setConfig({ ...config, timeWindowSeconds: val });
                }}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-white/[0.08] font-mono tabular-nums"
              />
            </label>
            <label className="space-y-1.5 text-xs">
              <span className="font-medium text-slate-700 dark:text-slate-300">
                {isEs ? 'Antigüedad Mínima (días)' : 'Minimum Account Age (days)'}
              </span>
              <input
                type="number"
                min={0}
                max={365}
                value={config.minAccountAgeDays}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (Number.isFinite(val)) setConfig({ ...config, minAccountAgeDays: val });
                }}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-white/[0.08] font-mono tabular-nums"
              />
            </label>
            <label className="space-y-1.5 text-xs">
              <span className="font-medium text-slate-700 dark:text-slate-300">
                {isEs ? 'Umbral de Riesgo (0-100)' : 'Risk Threshold (0-100)'}
              </span>
              <input
                type="number"
                min={10}
                max={100}
                value={config.riskThreshold}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (Number.isFinite(val)) setConfig({ ...config, riskThreshold: val });
                }}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-white/[0.08] font-mono tabular-nums"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-5 rounded-2xl bg-white dark:bg-[#0F1422] border border-slate-200 dark:border-white/[0.08] space-y-3">
              <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <Sliders className="w-4 h-4 text-[#5865F2]" />
                <span>{isEs ? 'Señales de Detección' : 'Detection Signals'}</span>
              </h2>
              {(
                [
                  {
                    key: 'suspiciousAccountDetection',
                    label: isEs
                      ? 'Detección de Cuentas Sospechosas'
                      : 'Suspicious Account Detection',
                  },
                  {
                    key: 'botJoinDetection',
                    label: isEs ? 'Detección de Bots no Verificados' : 'Bot Join Detection',
                  },
                  {
                    key: 'joinPatternDetection',
                    label: isEs ? 'Detección de Patrones Coordinados' : 'Join Pattern Detection',
                  },
                  {
                    key: 'burstDetection',
                    label: isEs
                      ? 'Detección de Ráfagas en Ventana Deslizante'
                      : 'Sliding-Window Burst Detection',
                  },
                ] as const
              ).map((toggle) => (
                <label
                  key={toggle.key}
                  className="flex items-center justify-between py-2 border-b last:border-b-0 border-slate-100 dark:border-white/[0.08]/70 text-xs cursor-pointer"
                >
                  <span className="text-slate-700 dark:text-slate-300">{toggle.label}</span>
                  <input
                    type="checkbox"
                    checked={config[toggle.key]}
                    onChange={(e) =>
                      setConfig({ ...config, [toggle.key]: e.target.checked })
                    }
                    className="w-4 h-4 accent-[#5865F2]"
                  />
                </label>
              ))}
            </div>

            <div className="p-5 rounded-2xl bg-white dark:bg-[#0F1422] border border-slate-200 dark:border-white/[0.08] space-y-3">
              <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                {isEs
                  ? 'Reglas de Acción por Nivel de Riesgo y Alertas'
                  : 'Risk-Level Action Rules & Alert Batching'}
              </h2>
              <div className="space-y-2">
                {config.riskRules.map((rule, idx) => (
                  <div
                    key={rule.level}
                    className="flex items-center justify-between gap-3 text-xs py-1.5 border-b border-slate-100 dark:border-white/[0.08]/70"
                  >
                    <span className="font-mono font-semibold w-24 text-slate-900 dark:text-white">
                      {rule.level}
                    </span>
                    <select
                      value={rule.action}
                      onChange={(e) => {
                        const updated = [...config.riskRules];
                        updated[idx] = { ...rule, action: e.target.value as AutoAction };
                        setConfig({ ...config, riskRules: updated });
                      }}
                      className="flex-1 px-2.5 py-1.5 rounded-xl bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-white/[0.08] font-mono text-slate-900 dark:text-white"
                    >
                      <option value="LOG_ONLY">{isEs ? 'Solo registrar' : 'Log Only'}</option>
                      <option value="ALERT">{isEs ? 'Alerta a Staff' : 'Alert'}</option>
                      <option value="QUARANTINE">{isEs ? 'Cuarentena' : 'Quarantine'}</option>
                      <option value="TIMEOUT">{isEs ? 'Aislamiento (Timeout)' : 'Timeout'}</option>
                      <option value="KICK">{isEs ? 'Expulsar' : 'Kick'}</option>
                      <option value="BAN">{isEs ? 'Banear' : 'Ban'}</option>
                    </select>
                  </div>
                ))}
              </div>
              {settings && (
                <div className="grid grid-cols-2 gap-3 pt-2 text-xs">
                  <label className="space-y-1">
                    <span className="text-slate-600 dark:text-slate-400">
                      {isEs ? 'Canal de Alertas' : 'Alert Channel'}
                    </span>
                    <input
                      type="text"
                      value={settings.alertChannelName || ''}
                      onChange={(e) =>
                        setSettings({ ...settings, alertChannelName: e.target.value })
                      }
                      className="w-full px-2.5 py-1.5 rounded-xl bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-white/[0.08] font-mono text-slate-900 dark:text-white"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-slate-600 dark:text-slate-400">
                      {isEs ? 'Lote de Alertas (seg)' : 'Batch Window (sec)'}
                    </span>
                    <input
                      type="number"
                      min={5}
                      max={300}
                      value={settings.alertBatchIntervalSeconds}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (Number.isFinite(val)) {
                          setSettings({
                            ...settings,
                            alertBatchIntervalSeconds: val,
                          });
                        }
                      }}
                      className="w-full px-2.5 py-1.5 rounded-xl bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-white/[0.08] font-mono tabular-nums text-slate-900 dark:text-white"
                    />
                  </label>
                </div>
              )}
            </div>
          </div>
        </form>
      )}

      {section === 'anti-nuke' && antiNuke && (
        <form onSubmit={handleSaveAntiNuke} className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
                {t.navItems['anti-nuke']} — {guild?.name}
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
                {isEs
                  ? 'Protección verificada contra el Registro de Auditoría ante eliminaciones masivas de canales/roles, abuso de webhooks y cuentas comprometidas.'
                  : 'Audit-log verified protection against mass channel/role deletions, webhook abuse, and compromised admin tokens.'}
              </p>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-semibold cursor-pointer self-start"
            >
              {saving ? t.common.saving : t.common.saveChanges}
            </button>
          </div>

          <div className="p-5 rounded-2xl bg-white dark:bg-[#0F1422] border border-slate-200 dark:border-white/[0.08] space-y-4">
            <label className="flex items-center justify-between text-sm font-semibold text-slate-900 dark:text-white cursor-pointer">
              <span className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-red-500" />
                <span>{isEs ? 'Motor Anti-Nuke Activo' : 'Anti-Nuke Engine Active'}</span>
              </span>
              <input
                type="checkbox"
                checked={antiNuke.enabled}
                onChange={(e) => setAntiNuke({ ...antiNuke, enabled: e.target.checked })}
                className="w-4 h-4 accent-[#5865F2]"
              />
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-xs">
              <label className="space-y-1">
                <span className="text-slate-600 dark:text-slate-400">
                  {isEs ? 'Máx. Borrado Canales' : 'Max Channel Deletes'}
                </span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={antiNuke.maxChannelDeletions}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    if (Number.isFinite(val)) setAntiNuke({ ...antiNuke, maxChannelDeletions: val });
                  }}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-white/[0.08] font-mono tabular-nums text-slate-900 dark:text-white"
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-600 dark:text-slate-400">
                  {isEs ? 'Máx. Creación Canales' : 'Max Channel Creates'}
                </span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={antiNuke.maxChannelCreations}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    if (Number.isFinite(val)) setAntiNuke({ ...antiNuke, maxChannelCreations: val });
                  }}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-white/[0.08] font-mono tabular-nums text-slate-900 dark:text-white"
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-600 dark:text-slate-400">
                  {isEs ? 'Máx. Cambios de Roles' : 'Max Role Mutations'}
                </span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={antiNuke.maxRoleMutations}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    if (Number.isFinite(val)) setAntiNuke({ ...antiNuke, maxRoleMutations: val });
                  }}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-white/[0.08] font-mono tabular-nums text-slate-900 dark:text-white"
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-600 dark:text-slate-400">
                  {isEs ? 'Máx. Bans / Kicks Masivos' : 'Max Mass Bans/Kicks'}
                </span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={antiNuke.maxMassBansKicks}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    if (Number.isFinite(val)) setAntiNuke({ ...antiNuke, maxMassBansKicks: val });
                  }}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-white/[0.08] font-mono tabular-nums text-slate-900 dark:text-white"
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-600 dark:text-slate-400">
                  {isEs ? 'Máx. Cambios Webhooks' : 'Max Webhook Edits'}
                </span>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={antiNuke.maxWebhookMutations}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    if (Number.isFinite(val)) setAntiNuke({ ...antiNuke, maxWebhookMutations: val });
                  }}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-white/[0.08] font-mono tabular-nums text-slate-900 dark:text-white"
                />
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-5 rounded-2xl bg-white dark:bg-[#0F1422] border border-slate-200 dark:border-white/[0.08] space-y-3">
              <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                {isEs ? 'Respuesta Automática Reversible' : 'Reversible Automated Response'}
              </h2>
              {(
                [
                  { key: 'logEvent', label: isEs ? 'Registrar evidencia de auditoría' : 'Record Audit Evidence' },
                  { key: 'sendAlert', label: isEs ? 'Enviar alerta al canal crítico' : 'Send Critical Channel Alert' },
                  {
                    key: 'stripDangerousPermissions',
                    label: isEs
                      ? 'Revocar permisos peligrosos (reversible)'
                      : 'Strip Dangerous Permissions (Reversible)',
                  },
                  {
                    key: 'quarantineExecutor',
                    label: isEs
                      ? 'Poner ejecutor en cuarentena (jerarquía validada)'
                      : 'Quarantine Executor (Role Hierarchy Validated)',
                  },
                  {
                    key: 'triggerLockdown',
                    label: isEs ? 'Activar Lockdown de Emergencia' : 'Activate Emergency Lockdown',
                  },
                ] as const
              ).map((r) => (
                <label
                  key={r.key}
                  className="flex items-center justify-between text-xs py-1.5 border-b last:border-b-0 border-slate-100 dark:border-white/[0.08]/70 cursor-pointer"
                >
                  <span className="text-slate-700 dark:text-slate-300">{r.label}</span>
                  <input
                    type="checkbox"
                    checked={antiNuke.autoResponse[r.key]}
                    onChange={(e) =>
                      setAntiNuke({
                        ...antiNuke,
                        autoResponse: { ...antiNuke.autoResponse, [r.key]: e.target.checked },
                      })
                    }
                    className="w-4 h-4 accent-[#5865F2]"
                  />
                </label>
              ))}
            </div>

            <div className="p-5 rounded-2xl bg-white dark:bg-[#0F1422] border border-slate-200 dark:border-white/[0.08] space-y-3">
              <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                {isEs
                  ? 'Excepciones de Administradores Autorizados (Discord IDs)'
                  : 'Authorized Administrator Exceptions (Discord IDs)'}
              </h2>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newAdminId}
                  onChange={(e) => setNewAdminId(e.target.value)}
                  placeholder={isEs ? 'Discord User ID (17-20 dígitos)' : 'Discord User ID (17-20 digits)'}
                  className="flex-1 px-3 py-1.5 text-xs rounded-xl bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-white/[0.08] font-mono text-slate-900 dark:text-white"
                />
                <button
                  type="button"
                  onClick={() => {
                    const candidate = newAdminId.trim();
                    if (/^\d{17,20}$/.test(candidate)) {
                      setAntiNuke({
                        ...antiNuke,
                        authorizedAdminIds: Array.from(
                          new Set([...antiNuke.authorizedAdminIds, candidate])
                        ),
                      });
                      setNewAdminId('');
                      setFeedback(null);
                    } else {
                      setFeedback({
                        ok: false,
                        text: isEs
                          ? 'Ingresa un ID Snowflake de Discord válido (17-20 dígitos).'
                          : 'Enter a valid 17-20 digit Discord Snowflake ID.',
                      });
                    }
                  }}
                  className="px-3 py-1.5 rounded-xl bg-slate-900 dark:bg-slate-800 text-white text-xs font-medium cursor-pointer"
                >
                  {suiteCopy.common.add}
                </button>
              </div>
              <div className="space-y-1.5">
                {antiNuke.authorizedAdminIds.map((id) => (
                  <div
                    key={id}
                    className="flex items-center justify-between px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-white/[0.08] text-xs font-mono"
                  >
                    <span>{id}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setAntiNuke({
                          ...antiNuke,
                          authorizedAdminIds: antiNuke.authorizedAdminIds.filter((x) => x !== id),
                        })
                      }
                      className="text-red-500 hover:underline cursor-pointer"
                    >
                      {suiteCopy.common.delete}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </form>
      )}

      {section === 'risk-engine' && (
        <div className="space-y-6">
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
              {t.navItems['risk-engine']} — {guild?.name}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
              {isEs
                ? 'Pesos explicables de riesgo (0-100) y sonda diagnóstica en vivo con verificación de salvaguardas.'
                : 'Explainable 0-100 Risk Scoring weights and live diagnostic probe with safeguard verification.'}
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <form
              onSubmit={handleSaveAntiRaid}
              className="lg:col-span-5 p-5 rounded-2xl bg-white dark:bg-[#0F1422] border border-slate-200 dark:border-white/[0.08] space-y-4"
            >
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <Cpu className="w-4 h-4 text-[#5865F2]" />
                <span>{isEs ? 'Ponderación de Señales' : 'Signal Weights'}</span>
              </h2>
              {(
                [
                  {
                    key: 'accountAge',
                    label: isEs ? 'Peso Antigüedad de Cuenta' : 'Account Age Weight',
                  },
                  {
                    key: 'joinPattern',
                    label: isEs ? 'Peso Patrón de Ingresos' : 'Join Pattern Weight',
                  },
                  {
                    key: 'eventVolume',
                    label: isEs ? 'Peso Volumen de Ráfagas' : 'Burst Volume Weight',
                  },
                  {
                    key: 'repetitiveBehavior',
                    label: isEs
                      ? 'Peso Comportamiento Repetitivo'
                      : 'Repetitive Behavior Weight',
                  },
                  {
                    key: 'globalBanMatch',
                    label: isEs ? 'Peso Coincidencia Global Ban' : 'Global Ban Match Weight',
                  },
                ] as const
              ).map((w) => (
                <label key={w.key} className="block space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-600 dark:text-slate-400">{w.label}</span>
                    <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-white">
                      {config.riskWeights[w.key]}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={80}
                    value={config.riskWeights[w.key]}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        riskWeights: { ...config.riskWeights, [w.key]: Number(e.target.value) },
                      })
                    }
                    className="w-full accent-[#5865F2]"
                  />
                </label>
              ))}
              <button
                type="submit"
                disabled={saving}
                className="w-full py-2 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-semibold cursor-pointer"
              >
                {saving ? t.common.saving : t.common.saveChanges}
              </button>
            </form>

            <div className="lg:col-span-7 p-5 rounded-2xl bg-white dark:bg-[#0F1422] border border-slate-200 dark:border-white/[0.08] space-y-4">
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                {isEs
                  ? 'Sonda Diagnóstica de Raid (/antiraid probar)'
                  : 'Diagnostic Raid Probe (/antiraid probar)'}
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <label className="space-y-1">
                  <span className="text-slate-600 dark:text-slate-400">
                    {isEs ? 'Ingresos en Ventana' : 'Joins in Window'}
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={simJoins}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (Number.isFinite(val)) setSimJoins(val);
                    }}
                    className="w-full px-2.5 py-1.5 rounded-xl bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-white/[0.08] font-mono tabular-nums text-slate-900 dark:text-white"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-slate-600 dark:text-slate-400">
                    {isEs ? 'Antigüedad (días)' : 'Account Age (d)'}
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={365}
                    value={simAgeDays}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (Number.isFinite(val)) setSimAgeDays(val);
                    }}
                    className="w-full px-2.5 py-1.5 rounded-xl bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-white/[0.08] font-mono tabular-nums text-slate-900 dark:text-white"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-slate-600 dark:text-slate-400">
                    {isEs ? 'Nombres Similares' : 'Similar Handles'}
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={simSimilar}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (Number.isFinite(val)) setSimSimilar(val);
                    }}
                    className="w-full px-2.5 py-1.5 rounded-xl bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-white/[0.08] font-mono tabular-nums text-slate-900 dark:text-white"
                  />
                </label>
                <label className="flex items-center gap-2 pt-5 cursor-pointer text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={simGlobalBan}
                    onChange={(e) => setSimGlobalBan(e.target.checked)}
                    className="w-4 h-4 accent-[#5865F2]"
                  />
                  <span>{isEs ? 'En Global Ban' : 'Global Ban Match'}</span>
                </label>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleRunRiskTest(false)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer text-slate-800 dark:text-slate-200"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>
                    {isEs ? 'Evaluar Riesgo (Simulación)' : 'Evaluate Risk Score (Dry Run)'}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleRunRiskTest(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-semibold cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>
                    {isEs ? 'Ejecutar Sonda y Registrar' : 'Run Probe & Log Incident'}
                  </span>
                </button>
              </div>

              {simResult && (
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-white/[0.08] space-y-3 text-xs">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="font-mono tabular-nums font-bold text-sm text-slate-900 dark:text-white">
                      {isEs ? 'Puntuación:' : 'Score:'} {simResult.evaluation.score}/100 (
                      {simResult.evaluation.level})
                    </span>
                    <span className="font-mono font-semibold text-[#5865F2]">
                      {isEs ? 'Acción Recomendada:' : 'Recommended Action:'}{' '}
                      {simResult.evaluation.recommendedAction}
                    </span>
                  </div>
                  {simResult.evaluation.safeguardApplied && (
                    <p className="text-amber-600 dark:text-amber-400 font-mono">
                      {simResult.evaluation.safeguardApplied}
                    </p>
                  )}
                  <div className="divide-y divide-slate-200 dark:divide-slate-800">
                    {simResult.evaluation.signals.map((sig) => (
                      <div key={sig.signal} className="py-1.5 flex justify-between gap-2">
                        <span>
                          <strong>{sig.label}</strong> — {sig.evidence}
                        </span>
                        <span className="font-mono tabular-nums">+{sig.weightedPoints}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
