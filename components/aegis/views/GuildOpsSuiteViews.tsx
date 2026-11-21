'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  BadgeCheck,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  Crown,
  Download,
  Gem,
  HardDrive,
  Key,
  RotateCcw,
  ScrollText,
  Send,
  ShieldAlert,
  ShieldCheck,
  Ticket,
  Trash2,
  UserCog,
  XCircle,
} from 'lucide-react';
import type {
  GuildBackupRecord,
  GuildBackupSettingsRecord,
  GuildLogConfigRecord,
  GuildPlanRecord,
  GuildVerificationRecord,
  LanguageCode,
  PlanTier,
  SecondaryOwnerRecord,
} from '@/lib/aegis/types';
import { getSuiteCopy } from '@/lib/aegis/dashboard-i18n';
import { aegisFetch } from '@/lib/aegis/client-auth';
import {
  getPlanDisplayName,
  isPaidTier,
  normalizePlanTier,
  PLAN_CATALOG,
} from '@/lib/aegis/premium';

export type GuildOpsSuiteSection =
  | 'verification'
  | 'log-channel'
  | 'backups'
  | 'two-factor'
  | 'secondary-owner'
  | 'premium';

interface GuildOpsSuiteViewsProps {
  section: GuildOpsSuiteSection;
  language: LanguageCode;
  activeGuildId: string;
  syncNonce?: number;
  onNavigatePremium: () => void;
  onNavigateServers: () => void;
  onSyncCompleted: () => void;
}

interface DiscordChannelOption {
  id: string;
  name: string;
  type: number;
}

interface DiscordRoleOption {
  id: string;
  name: string;
}

export function GuildOpsSuiteViews({
  section,
  language,
  activeGuildId,
  syncNonce = 0,
  onNavigatePremium,
  onNavigateServers,
  onSyncCompleted,
}: GuildOpsSuiteViewsProps) {
  const c = getSuiteCopy(language);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [loading, setLoading] = useState(true);
  const loadedKeyRef = useRef<string>('');

  // Shared guild context
  const [plan, setPlan] = useState<GuildPlanRecord | null>(null);
  const [channels, setChannels] = useState<DiscordChannelOption[]>([]);
  const [roles, setRoles] = useState<DiscordRoleOption[]>([]);

  // Verification
  const [verification, setVerification] = useState<GuildVerificationRecord | null>(null);

  // Log Channel
  const [logConfig, setLogConfig] = useState<GuildLogConfigRecord | null>(null);
  const [manualLogId, setManualLogId] = useState('');
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [testingLog, setTestingLog] = useState(false);

  // Backups
  const [backups, setBackups] = useState<GuildBackupRecord[]>([]);
  const [backupSettings, setBackupSettings] = useState<GuildBackupSettingsRecord | null>(null);
  const [backupScheduleInfo, setBackupScheduleInfo] = useState<{
    shouldCreate: boolean;
    reason: string;
    intervalDays: number;
    maxBackups: number;
    nextScheduledAt: string | null;
  } | null>(null);
  const [backupName, setBackupName] = useState('');
  const [creatingBackup, setCreatingBackup] = useState(false);

  // 2FA
  const [twoFaState, setTwoFaState] = useState<{
    enabled: boolean;
    recoveryCodesRemaining: number;
    enabledAt: string | null;
  }>({ enabled: false, recoveryCodesRemaining: 0, enabledAt: null });
  const [pendingSetup, setPendingSetup] = useState<{
    secretBase32: string;
    otpauthUri: string;
  } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [verifyTokenInput, setVerifyTokenInput] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [copiedSecret, setCopiedSecret] = useState(false);

  // Secondary Owner
  const [secondaryOwner, setSecondaryOwner] = useState<SecondaryOwnerRecord | null>(null);
  const [canAssignSecondOwner, setCanAssignSecondOwner] = useState(false);
  const [secOwnerId, setSecOwnerId] = useState('');
  const [secOwnerName, setSecOwnerName] = useState('');
  const [secOwnerNote, setSecOwnerNote] = useState('');

  // Premium
  const [licenseKey, setLicenseKey] = useState('');
  const [redeemingCode, setRedeemingCode] = useState(false);
  const [premiumOverview, setPremiumOverview] = useState<{
    subscription: {
      tier: PlanTier;
      expiresAt: string | null;
      remainingMs: number;
      remainingHuman: string;
      maxServers: number;
      activatedGuildIds: string[];
    };
  } | null>(null);

  const loadPremiumBundle = async () => {
    const uRes = await aegisFetch('/api/premium');
    if (uRes.ok) {
      const uJson = await uRes.json().catch(() => null);
      if (uJson) {
        setPremiumOverview({
          subscription: uJson.subscription,
        });
      }
    }
  };

  useEffect(() => {
    let cancelled = false;
    const viewKey = `${section}:${activeGuildId}`;
    const isInitialLoad = loadedKeyRef.current !== viewKey;

    const load = async () => {
      if (isInitialLoad) {
        setFeedback(null);
        setLoadError(null);
        setLoading(true);
      }
      const isEs = language === 'es';
      try {
        if (section === 'two-factor') {
          const res = await aegisFetch('/api/auth/2fa');
          const json = await res.json().catch(() => null);
          if (!cancelled) {
            if (!res.ok || !json) {
              setLoadError(json?.message || (isEs ? 'No se pudo cargar la configuración 2FA.' : 'Failed to load 2FA settings.'));
              return;
            }
            setLoadError(null);
            setTwoFaState({
              enabled: Boolean(json.enabled),
              recoveryCodesRemaining: json.recoveryCodesRemaining ?? 0,
              enabledAt: json.enabledAt ?? null,
            });
          }
          return;
        }

        if (section === 'premium') {
          const uRes = await aegisFetch('/api/premium');
          const uJson = await uRes.json().catch(() => null);
          if (!cancelled) {
            if (!uRes.ok || !uJson) {
              setLoadError(uJson?.message || (isEs ? 'No se pudo cargar tu suscripción Premium.' : 'Failed to load Premium status.'));
              return;
            }
            setLoadError(null);
            setPremiumOverview({
              subscription: uJson.subscription,
            });
          }
          return;
        }

        if (!activeGuildId) return;

        if (section === 'verification') {
          const [vRes, cRes] = await Promise.all([
            aegisFetch(`/api/guilds/${activeGuildId}/verification`),
            aegisFetch(`/api/guilds/${activeGuildId}/channels`),
          ]);
          const vJson = await vRes.json().catch(() => null);
          const cJson = await cRes.json().catch(() => null);
          if (!cancelled) {
            if (!vRes.ok || !vJson?.verification) {
              setLoadError(vJson?.message || (isEs ? 'No se pudo cargar el sistema de verificación.' : 'Failed to load verification config.'));
              return;
            }
            setLoadError(null);
            setVerification(vJson.verification);
            setPlan(vJson.plan);
            if (cRes.ok && cJson) {
              setChannels(cJson.channels || []);
              setRoles(cJson.roles || []);
            }
          }
        } else if (section === 'log-channel') {
          const res = await aegisFetch(`/api/guilds/${activeGuildId}/channels`);
          const json = await res.json().catch(() => null);
          if (!cancelled) {
            if (!res.ok || !json?.logConfig) {
              setLoadError(json?.message || (isEs ? 'No se pudo cargar la configuración de canales.' : 'Failed to load log channel config.'));
              return;
            }
            setLoadError(null);
            setChannels(json.channels || []);
            setLogConfig(json.logConfig || null);
            if (isInitialLoad) {
              setManualLogId(json.logConfig?.channelId || '');
            }
          }
        } else if (section === 'backups') {
          const res = await aegisFetch(`/api/guilds/${activeGuildId}/backups`);
          const json = await res.json().catch(() => null);
          if (!cancelled) {
            if (!res.ok || !json) {
              setLoadError(json?.message || (isEs ? 'No se pudieron cargar las copias de seguridad.' : 'Failed to load backups.'));
              return;
            }
            setLoadError(null);
            setBackups(json.backups || []);
            setBackupSettings(json.settings || null);
            setPlan(json.plan || null);
            setBackupScheduleInfo(json.scheduleInfo || null);
          }
        } else if (section === 'secondary-owner') {
          const res = await aegisFetch(`/api/guilds/${activeGuildId}/secondary-owner`);
          const json = await res.json().catch(() => null);
          if (!cancelled) {
            if (!res.ok || !json) {
              setLoadError(json?.message || (isEs ? 'No se pudo cargar el Segundo Owner.' : 'Failed to load Secondary Owner.'));
              return;
            }
            setLoadError(null);
            setSecondaryOwner(json.secondaryOwner || null);
            setCanAssignSecondOwner(Boolean(json.canAssign));
          }
        }
      } catch {
        if (!cancelled) {
          setLoadError(
            isEs
              ? 'Error de red al cargar los datos del servidor.'
              : 'Network error loading server settings.'
          );
        }
      } finally {
        loadedKeyRef.current = viewKey;
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [section, activeGuildId, syncNonce, reloadNonce, language]);

  const requiresGuild = section !== 'two-factor' && section !== 'premium';

  if (requiresGuild && !activeGuildId) {
    return (
      <div className="rounded-3xl border border-slate-200 dark:border-white/[0.08] bg-white/80 dark:bg-[#0B0F19]/85 backdrop-blur-xl p-8 text-center">
        <ShieldCheck className="w-10 h-10 text-indigo-500 mx-auto mb-3" />
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

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-24 rounded-2xl bg-slate-200/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-white/[0.06]" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="h-56 rounded-2xl bg-slate-200/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-white/[0.06]" />
          <div className="h-56 rounded-2xl bg-slate-200/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-white/[0.06]" />
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div
        role="alert"
        className="rounded-3xl border border-red-500/35 bg-white/85 dark:bg-[#0B0F19]/90 p-8 text-center space-y-3"
      >
        <ShieldAlert className="w-9 h-9 text-red-500 mx-auto" />
        <p className="text-sm font-medium text-red-600 dark:text-red-300">{loadError}</p>
        <button
          type="button"
          onClick={() => {
            loadedKeyRef.current = '';
            setReloadNonce((n) => n + 1);
          }}
          className="px-4 py-2 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-semibold cursor-pointer"
        >
          {language === 'es' ? 'Reintentar' : 'Retry'}
        </button>
      </div>
    );
  }

  const renderFeedback = () =>
    feedback ? (
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        className={`rounded-xl px-4 py-2.5 text-xs font-medium flex items-center gap-2 border ${
          feedback.ok
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500'
            : 'bg-red-500/10 border-red-500/30 text-red-400'
        }`}
      >
        <CheckCircle2 className="w-4 h-4 shrink-0" />
        <span>{feedback.text}</span>
      </motion.div>
    ) : null;

  // ============================================================================
  // VERIFICATION VIEW
  // ============================================================================
  if (section === 'verification' && verification) {
    const v = c.verification;
    const isPremium = isPaidTier(normalizePlanTier(plan?.tier));
    const saveVerification = async (patch: Partial<GuildVerificationRecord>) => {
      setFeedback(null);
      try {
        const res = await aegisFetch(`/api/guilds/${activeGuildId}/verification`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          setFeedback({
            ok: false,
            text:
              json?.message ||
              (language === 'es'
                ? 'Error al actualizar la verificación.'
                : 'Error updating verification'),
          });
          return;
        }
        setVerification(json.verification);
        setFeedback({ ok: true, text: c.common.saved });
        onSyncCompleted();
      } catch {
        setFeedback({
          ok: false,
          text:
            language === 'es'
              ? 'Error de red al guardar la verificación.'
              : 'Network error saving verification.',
        });
      }
    };

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-display font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
              <BadgeCheck className="w-6 h-6 text-[#5865F2]" />
              {v.title}
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{v.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={() => saveVerification({ enabled: !verification.enabled })}
            className={`px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-colors ${
              verification.enabled
                ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30'
                : 'bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-slate-200'
            }`}
          >
            {v.statusLabel}: {verification.enabled ? c.common.enabled : c.common.disabled}
          </button>
        </div>

        {renderFeedback()}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white/85 dark:bg-[#0B0F19]/90 p-5 space-y-5">
            <div>
              <div className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-3">
                {v.modeLabel}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(['BUTTON', 'CAPTCHA', 'REACTION', 'STRICT_2FA'] as const).map((mode) => {
                  const locked = mode === 'STRICT_2FA' && !isPremium;
                  const active = verification.mode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() =>
                        locked ? onNavigatePremium() : saveVerification({ mode })
                      }
                      className={`text-left rounded-xl p-3.5 border transition-all cursor-pointer ${
                        active
                          ? 'border-[#5865F2] bg-[#5865F2]/10'
                          : 'border-slate-200 dark:border-white/[0.08] hover:border-indigo-400/50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-900 dark:text-white">
                          {v.modes[mode].title}
                        </span>
                        {mode === 'STRICT_2FA' && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500 text-slate-950">
                            {c.common.premium}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                        {v.modes[mode].desc}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="text-xs text-slate-600 dark:text-slate-300">
                {v.channelLabel}
                {channels.length > 0 ? (
                  <select
                    value={verification.channelId ?? ''}
                    onChange={(e) => {
                      const ch = channels.find((item) => item.id === e.target.value);
                      saveVerification({
                        channelId: e.target.value || null,
                        channelName: ch?.name ?? null,
                      });
                    }}
                    className="mt-1 w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-3 py-2 text-xs text-slate-900 dark:text-white"
                  >
                    <option value="">—</option>
                    {channels.map((ch) => (
                      <option key={ch.id} value={ch.id}>
                        {ch.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={verification.channelId ?? ''}
                    onChange={(e) =>
                      setVerification({ ...verification, channelId: e.target.value || null })
                    }
                    placeholder={language === 'es' ? 'ID del canal (17-20 dígitos)' : 'Channel ID (17-20 digits)'}
                    className="mt-1 w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-3 py-2 text-xs font-mono text-slate-900 dark:text-white"
                  />
                )}
              </label>

              <label className="text-xs text-slate-600 dark:text-slate-300">
                {v.roleLabel}
                {roles.length > 0 ? (
                  <select
                    value={verification.verifiedRoleId ?? ''}
                    onChange={(e) => {
                      const r = roles.find((item) => item.id === e.target.value);
                      saveVerification({
                        verifiedRoleId: e.target.value || null,
                        verifiedRoleName: r?.name ?? null,
                      });
                    }}
                    className="mt-1 w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-3 py-2 text-xs text-slate-900 dark:text-white"
                  >
                    <option value="">—</option>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        @{r.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={verification.verifiedRoleId ?? ''}
                    onChange={(e) =>
                      setVerification({ ...verification, verifiedRoleId: e.target.value || null })
                    }
                    placeholder={language === 'es' ? 'ID del rol (17-20 dígitos)' : 'Role ID (17-20 digits)'}
                    className="mt-1 w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-3 py-2 text-xs font-mono text-slate-900 dark:text-white"
                  />
                )}
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="text-xs text-slate-600 dark:text-slate-300">
                {v.panelTitleLabel}
                <input
                  type="text"
                  value={verification.panelTitle}
                  onChange={(e) => setVerification({ ...verification, panelTitle: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-3 py-2 text-xs text-slate-900 dark:text-white"
                />
              </label>
              <label className="text-xs text-slate-600 dark:text-slate-300">
                {v.autoKickMin}
                <input
                  type="number"
                  min={5}
                  max={10080}
                  disabled={!isPremium}
                  value={verification.kickUnverifiedAfterMinutes ?? ''}
                  onChange={(e) =>
                    setVerification({
                      ...verification,
                      kickUnverifiedAfterMinutes: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                  placeholder={isPremium ? '30' : 'Premium'}
                  className="mt-1 w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-3 py-2 text-xs font-mono text-slate-900 dark:text-white disabled:opacity-50"
                />
              </label>
            </div>

            <label className="block text-xs text-slate-600 dark:text-slate-300">
              {v.panelDescLabel}
              <textarea
                rows={2}
                value={verification.panelDescription}
                onChange={(e) =>
                  setVerification({ ...verification, panelDescription: e.target.value })
                }
                className="mt-1 w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-3 py-2 text-xs text-slate-900 dark:text-white"
              />
            </label>

            <div className="flex items-center justify-between pt-2">
              <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={verification.blockSuspiciousAccounts}
                  onChange={(e) =>
                    setVerification({ ...verification, blockSuspiciousAccounts: e.target.checked })
                  }
                />
                <span>{v.blockSuspicious}</span>
              </label>
              <button
                type="button"
                onClick={() =>
                  saveVerification({
                    channelId: verification.channelId,
                    verifiedRoleId: verification.verifiedRoleId,
                    panelTitle: verification.panelTitle,
                    panelDescription: verification.panelDescription,
                    blockSuspiciousAccounts: verification.blockSuspiciousAccounts,
                    kickUnverifiedAfterMinutes: verification.kickUnverifiedAfterMinutes,
                  })
                }
                className="px-4 py-2 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-semibold cursor-pointer"
              >
                {c.common.save}
              </button>
            </div>
          </div>

          {/* Discord Embed Live Preview */}
          <div className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white/85 dark:bg-[#0B0F19]/90 p-5 space-y-3">
            <div className="text-xs font-mono uppercase tracking-wider text-slate-400">
              {v.previewTitle}
            </div>
            <div className="rounded-xl bg-[#2B2D31] p-4 border-l-4 border-[#5865F2] text-white space-y-2 shadow-inner">
              <div className="text-sm font-bold">{verification.panelTitle}</div>
              <p className="text-xs text-slate-300 leading-relaxed">
                {verification.panelDescription}
              </p>
              <div className="pt-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#248046] text-white text-xs font-medium">
                  <BadgeCheck className="w-3.5 h-3.5" />
                  {verification.mode}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // LOG CHANNEL VIEW
  // ============================================================================
  if (section === 'log-channel' && logConfig) {
    const lc = c.logChannel;
    const saveLogs = async (patch: Partial<GuildLogConfigRecord>) => {
      setFeedback(null);
      try {
        const res = await aegisFetch(`/api/guilds/${activeGuildId}/channels`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          setFeedback({
            ok: false,
            text:
              json?.message ||
              (language === 'es'
                ? 'Error al actualizar el canal de registros.'
                : 'Error updating log channel'),
          });
          return;
        }
        setLogConfig(json.logConfig);
        setFeedback({ ok: true, text: c.common.saved });
        onSyncCompleted();
      } catch {
        setFeedback({
          ok: false,
          text:
            language === 'es'
              ? 'Error de red al guardar el canal de registros.'
              : 'Network error saving log channel.',
        });
      }
    };

    const sendTest = async () => {
      setTestingLog(true);
      setFeedback(null);
      try {
        const res = await aegisFetch(`/api/guilds/${activeGuildId}/channels`, { method: 'POST' });
        const json = await res.json().catch(() => null);
        if (json?.sent) {
          setFeedback({ ok: true, text: lc.testSentOk });
        } else {
          setFeedback({
            ok: false,
            text:
              json?.message ||
              (language === 'es'
                ? 'No se pudo enviar el mensaje de prueba.'
                : 'Could not dispatch test embed.'),
          });
        }
      } catch {
        setFeedback({
          ok: false,
          text:
            language === 'es'
              ? 'Error de red al enviar el mensaje de prueba.'
              : 'Network error sending test embed.',
        });
      } finally {
        setTestingLog(false);
      }
    };

    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-display font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
          <ScrollText className="w-6 h-6 text-[#5865F2]" />
          {lc.title}
        </h1>

        {renderFeedback()}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white/85 dark:bg-[#0B0F19]/90 p-5 space-y-5">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              {lc.configTitle}
            </h2>

            {channels.length > 0 ? (
              <label className="block text-xs text-slate-500 dark:text-slate-400 uppercase font-mono">
                {lc.availableChannels}
                <select
                  value={logConfig.channelId ?? ''}
                  onChange={(e) => {
                    const ch = channels.find((item) => item.id === e.target.value);
                    saveLogs({
                      channelId: e.target.value || null,
                      channelName: ch?.name ?? null,
                    });
                  }}
                  className="mt-2 w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-3 py-2.5 text-sm text-slate-900 dark:text-white font-sans normal-case"
                >
                  <option value="">—</option>
                  {channels.map((ch) => (
                    <option key={ch.id} value={ch.id}>
                      {ch.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="space-y-2">
                <div className="text-xs font-mono uppercase text-slate-400">
                  {lc.availableChannels}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={manualLogId}
                    onChange={(e) => setManualLogId(e.target.value)}
                    placeholder={lc.manualChannelPlaceholder}
                    className="flex-1 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-3 py-2 text-xs font-mono text-slate-900 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      saveLogs({ channelId: manualLogId.trim() || null, channelName: null })
                    }
                    className="px-4 py-2 rounded-xl bg-[#5865F2] text-white text-xs font-semibold cursor-pointer"
                  >
                    {c.common.save}
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-white/[0.06]">
              <div className="text-xs font-mono uppercase text-slate-400 mb-2">{lc.eventsTitle}</div>
              {(
                Object.keys(lc.eventLabels) as Array<keyof GuildLogConfigRecord['events']>
              ).map((evKey) => (
                <label
                  key={evKey}
                  className="flex items-center justify-between py-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer"
                >
                  <span>{lc.eventLabels[evKey]}</span>
                  <input
                    type="checkbox"
                    checked={logConfig.events[evKey]}
                    onChange={(e) =>
                      saveLogs({
                        events: { ...logConfig.events, [evKey]: e.target.checked },
                      })
                    }
                  />
                </label>
              ))}
            </div>

            <button
              type="button"
              disabled={testingLog || !logConfig.channelId}
              onClick={sendTest}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-indigo-500/40 text-indigo-500 dark:text-indigo-300 hover:bg-indigo-500/10 text-xs font-semibold disabled:opacity-50 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              {lc.sendTestBtn}
            </button>
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white/85 dark:bg-[#0B0F19]/90 p-5 space-y-4">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">{lc.faqTitle}</h2>
            <div className="space-y-4">
              {lc.faqs.map((faq, idx) => (
                <div key={idx} className="space-y-1">
                  <div className="text-xs font-semibold text-indigo-500 dark:text-indigo-300 underline">
                    {faq.q}
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    {faq.a}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // BACKUPS VIEW
  // ============================================================================
  if (section === 'backups') {
    const bk = c.backups;
    const isEs = language === 'es';
    const currentTier = normalizePlanTier(plan?.tier);
    const maxBackups = plan?.quotas.maxBackups ?? 1;
    const autoIntervalDays = plan?.quotas.autoBackupDays ?? 7;
    const limitReached = backups.length >= maxBackups;
    const currentSchedule =
      backupSettings?.autoBackupSchedule && backupSettings.autoBackupSchedule !== 'OFF'
        ? 'AUTO'
        : 'OFF';

    const reloadBackups = async () => {
      const res = await aegisFetch(`/api/guilds/${activeGuildId}/backups`);
      const json = await res.json().catch(() => null);
      if (res.ok && json) {
        setBackups(json.backups || []);
        setBackupSettings(json.settings || null);
        setPlan(json.plan || null);
        setBackupScheduleInfo(json.scheduleInfo || null);
      }
    };

    const handleCreate = async (e: React.FormEvent) => {
      e.preventDefault();
      if (backupName.trim().length < 2 || limitReached) return;
      setCreatingBackup(true);
      setFeedback(null);
      try {
        const res = await aegisFetch(`/api/guilds/${activeGuildId}/backups`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'CREATE', name: backupName.trim() }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          setFeedback({
            ok: false,
            text:
              json?.message ||
              (isEs ? 'No se pudo crear la copia de seguridad.' : 'Could not create backup'),
          });
          return;
        }
        setBackupName('');
        setFeedback({ ok: true, text: c.common.saved });
        await reloadBackups();
        onSyncCompleted();
      } catch {
        setFeedback({
          ok: false,
          text: isEs ? 'Error de red al crear la copia de seguridad.' : 'Network error creating backup.',
        });
      } finally {
        setCreatingBackup(false);
      }
    };

    const handleRestore = async (backupId: string) => {
      setFeedback(null);
      try {
        const res = await aegisFetch(`/api/guilds/${activeGuildId}/backups`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'RESTORE', backupId }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          setFeedback({
            ok: false,
            text: json?.message || (isEs ? 'No se pudo restaurar la copia.' : 'Could not restore backup.'),
          });
          return;
        }
        setFeedback({ ok: true, text: c.common.saved });
        onSyncCompleted();
      } catch {
        setFeedback({
          ok: false,
          text: isEs ? 'Error de red al restaurar la copia.' : 'Network error restoring backup.',
        });
      }
    };

    const handleDelete = async (backupId: string) => {
      setFeedback(null);
      try {
        const res = await aegisFetch(
          `/api/guilds/${activeGuildId}/backups?id=${encodeURIComponent(backupId)}`,
          { method: 'DELETE' }
        );
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          setFeedback({
            ok: false,
            text: json?.message || (isEs ? 'No se pudo eliminar la copia.' : 'Could not delete backup.'),
          });
          return;
        }
        setFeedback({
          ok: true,
          text: isEs ? 'Copia eliminada. Cuota liberada.' : 'Backup deleted.',
        });
        await reloadBackups();
        onSyncCompleted();
      } catch {
        setFeedback({
          ok: false,
          text: isEs ? 'Error de red al eliminar la copia.' : 'Network error deleting backup.',
        });
      }
    };

    const handleSchedule = async (schedule: 'OFF' | 'AUTO') => {
      setFeedback(null);
      try {
        const res = await aegisFetch(`/api/guilds/${activeGuildId}/backups`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'SET_SCHEDULE', schedule }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json) {
          setFeedback({
            ok: false,
            text: json?.message || (isEs ? 'Error al guardar programación automática.' : 'Schedule update failed.'),
          });
          return;
        }
        setBackupSettings(json.settings);
        setBackupScheduleInfo(json.scheduleInfo || null);
        setFeedback({ ok: true, text: c.common.saved });
      } catch {
        setFeedback({
          ok: false,
          text: isEs ? 'Error de red al actualizar la programación.' : 'Network error updating schedule.',
        });
      }
    };

    const downloadBackupJson = (b: GuildBackupRecord) => {
      const blob = new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${b.name.replace(/[^a-zA-Z0-9_-]/g, '_')}-${b.id}.json`;
      a.click();
      URL.revokeObjectURL(url);
    };

    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-display font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
              <HardDrive className="w-6 h-6 text-[#5865F2]" />
              {bk.title}
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{bk.subtitle}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-3 py-1.5 rounded-xl border border-indigo-500/30 bg-indigo-500/10 text-xs font-mono font-semibold text-indigo-600 dark:text-indigo-300">
              {getPlanDisplayName(currentTier, language)} ·{' '}
              {isEs ? `Auto cada ${autoIntervalDays}d` : `Auto every ${autoIntervalDays}d`}
            </span>
            <span
              className={`px-3 py-1.5 rounded-xl border text-xs font-mono font-semibold tabular-nums ${
                limitReached
                  ? 'border-amber-500/40 bg-amber-500/15 text-amber-600 dark:text-amber-300'
                  : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300'
              }`}
            >
              {backups.length}/{maxBackups} {isEs ? 'copias' : 'backups'}
            </span>
          </div>
        </div>

        {/* Cadence summary bar */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          {(['FREE', 'ORO', 'DIAMANTE'] as const).map((tier) => {
            const def = PLAN_CATALOG[tier];
            const activeTier = tier === currentTier;
            return (
              <div
                key={tier}
                className={`rounded-xl border px-4 py-3 flex items-center justify-between ${
                  activeTier
                    ? 'border-[#5865F2] bg-[#5865F2]/10 text-slate-900 dark:text-white'
                    : 'border-slate-200 dark:border-white/[0.08] bg-white/70 dark:bg-[#0B0F19]/80 text-slate-500 dark:text-slate-400'
                }`}
              >
                <div>
                  <div className="font-semibold text-slate-900 dark:text-white">
                    {isEs ? def.nameEs : def.nameEn}
                  </div>
                  <div className="text-[11px]">
                    {isEs
                      ? `Máx. ${def.quotas.maxBackups} ${def.quotas.maxBackups === 1 ? 'copia' : 'copias'} · cada ${def.quotas.autoBackupDays} ${def.quotas.autoBackupDays === 1 ? 'día' : 'días'}`
                      : `Max ${def.quotas.maxBackups} · every ${def.quotas.autoBackupDays}d`}
                  </div>
                </div>
                {activeTier && (
                  <span className="px-2 py-0.5 rounded-md bg-[#5865F2] text-white text-[10px] font-mono font-bold">
                    {isEs ? 'ACTUAL' : 'ACTIVE'}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {limitReached && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">
                {isEs
                  ? `Límite de copias alcanzado (${backups.length}/${maxBackups})`
                  : `Backup limit reached (${backups.length}/${maxBackups})`}
              </div>
              <p className="mt-0.5 opacity-90">
                {isEs
                  ? 'Se han pausado las copias automáticas y manuales en este servidor. Elimina al menos una copia existente o mejora tu plan para continuar.'
                  : 'Automatic and manual backups are paused on this server until you delete an existing snapshot or upgrade your plan.'}
              </p>
            </div>
          </div>
        )}

        {renderFeedback()}

        <div className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white/85 dark:bg-[#0B0F19]/90 p-5 flex flex-col lg:flex-row gap-4 justify-between items-stretch lg:items-center">
          <form onSubmit={handleCreate} className="flex flex-1 gap-2">
            <input
              type="text"
              required
              disabled={limitReached}
              value={backupName}
              onChange={(e) => setBackupName(e.target.value)}
              placeholder={bk.namePlaceholder}
              className="flex-1 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-3.5 py-2 text-xs text-slate-900 dark:text-white disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={creatingBackup || limitReached}
              className="px-4 py-2 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-semibold cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {bk.createBtn}
            </button>
          </form>

          <div className="flex items-center gap-2 text-xs flex-wrap">
            <HardDrive className="w-4 h-4 text-[#5865F2] shrink-0" />
            <span className="text-slate-600 dark:text-slate-300">{bk.autoScheduleLabel}:</span>
            <select
              value={currentSchedule}
              onChange={(e) => handleSchedule(e.target.value as 'OFF' | 'AUTO')}
              className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
            >
              <option value="AUTO">
                {isEs
                  ? `Automático (cada ${autoIntervalDays} ${autoIntervalDays === 1 ? 'día' : 'días'})`
                  : `Automatic (every ${autoIntervalDays}d)`}
              </option>
              <option value="OFF">{bk.scheduleOff}</option>
            </select>
            {backupScheduleInfo?.nextScheduledAt && currentSchedule === 'AUTO' && !limitReached && (
              <span className="text-[11px] font-mono text-slate-400">
                {isEs ? 'Próxima:' : 'Next:'}{' '}
                {new Date(backupScheduleInfo.nextScheduledAt).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>

        {backups.length === 0 ? (
          <div className="text-sm font-semibold text-slate-900 dark:text-white py-2">
            {bk.emptyTitle}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {backups.map((b) => (
              <div
                key={b.id}
                className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white/85 dark:bg-[#0B0F19]/90 p-5 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                      <span>{b.name}</span>
                      {b.automatic && (
                        <span className="px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-400 text-[10px] font-mono">
                          AUTO
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] font-mono text-slate-400">
                      {b.id} · {new Date(b.createdAt).toLocaleString()}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  <span>{b.stats.rolesCount} {isEs ? 'roles' : 'roles'}</span>
                  <span>·</span>
                  <span>{b.stats.channelsCount} {isEs ? 'canales' : 'channels'}</span>
                  <span>·</span>
                  <span>{b.stats.whitelistCount} whitelist</span>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => downloadBackupJson(b)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.05] cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {bk.downloadJson}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRestore(b.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500/15 text-indigo-500 dark:text-indigo-300 border border-indigo-500/30 text-xs font-medium cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    {bk.restoreBtn}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(b.id)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-red-500 hover:bg-red-500/10 cursor-pointer ml-auto"
                    aria-label={c.common.delete}
                    title={c.common.delete}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Interactive FAQ Accordion matching screenshot */}
        <div className="pt-4 space-y-4">
          <h2 className="text-xl font-display font-semibold text-center text-slate-900 dark:text-white">
            {bk.faqTitle}
          </h2>
          <div className="max-w-3xl mx-auto space-y-2.5">
            {bk.faqs.map((faq, idx) => {
              const isOpen = openFaq === idx;
              return (
                <div
                  key={idx}
                  className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white/85 dark:bg-[#0B0F19]/90 overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => setOpenFaq(isOpen ? null : idx)}
                    className="w-full px-4 py-3 flex items-center justify-between text-left text-xs sm:text-sm font-medium text-slate-800 dark:text-slate-200 cursor-pointer hover:bg-slate-50 dark:hover:bg-white/[0.03]"
                  >
                    <span>{faq.q}</span>
                    <ChevronRight
                      className={`w-4 h-4 text-slate-400 transition-transform ${
                        isOpen ? 'rotate-90' : ''
                      }`}
                    />
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="px-4 pb-3.5 text-xs text-slate-500 dark:text-slate-400 leading-relaxed"
                      >
                        {faq.a}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // 2FA VIEW (REAL RFC-6238 TOTP)
  // ============================================================================
  if (section === 'two-factor') {
    const tf = c.twoFactor;

    const handleInitSetup = async () => {
      setFeedback(null);
      try {
        const res = await aegisFetch('/api/auth/2fa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'INIT_SETUP' }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json) {
          setFeedback({
            ok: false,
            text: json?.message || (language === 'es' ? 'No se pudo iniciar la configuración 2FA.' : 'Could not initiate 2FA setup.'),
          });
          return;
        }
        setPendingSetup({ secretBase32: json.secretBase32, otpauthUri: json.otpauthUri });
      } catch {
        setFeedback({
          ok: false,
          text: language === 'es' ? 'Error de red al iniciar 2FA.' : 'Network error initiating 2FA.',
        });
      }
    };

    const handleConfirmEnable = async (e: React.FormEvent) => {
      e.preventDefault();
      setFeedback(null);
      try {
        const res = await aegisFetch('/api/auth/2fa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'CONFIRM_ENABLE', token: totpCode.trim() }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          setFeedback({
            ok: false,
            text:
              json?.message ||
              (language === 'es' ? 'Código de verificación inválido.' : 'Invalid verification code'),
          });
          return;
        }
        setTwoFaState({
          enabled: true,
          recoveryCodesRemaining: json.recoveryCodesRemaining ?? 8,
          enabledAt: json.enabledAt ?? new Date().toISOString(),
        });
        setRecoveryCodes(json.recoveryCodes || null);
        setPendingSetup(null);
        setTotpCode('');
        setFeedback({ ok: true, text: c.common.saved });
      } catch {
        setFeedback({
          ok: false,
          text: language === 'es' ? 'Error de red al confirmar 2FA.' : 'Network error enabling 2FA.',
        });
      }
    };

    const handleVerifyOrDisable = async (action: 'VERIFY_TOKEN' | 'DISABLE') => {
      setFeedback(null);
      try {
        const res = await aegisFetch('/api/auth/2fa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, token: verifyTokenInput.trim() }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          setFeedback({
            ok: false,
            text:
              json?.message ||
              (language === 'es' ? 'Error al validar el código.' : 'Verification failed'),
          });
          return;
        }
        if (action === 'DISABLE') {
          setTwoFaState({ enabled: false, recoveryCodesRemaining: 0, enabledAt: null });
          setRecoveryCodes(null);
        }
        setVerifyTokenInput('');
        setFeedback({ ok: true, text: c.common.saved });
      } catch {
        setFeedback({
          ok: false,
          text: language === 'es' ? 'Error de red al validar el código.' : 'Network error verifying 2FA token.',
        });
      }
    };

    return (
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-display font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
            <Key className="w-6 h-6 text-[#5865F2]" />
            {tf.title}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{tf.subtitle}</p>
        </div>

        {renderFeedback()}

        <div className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white/85 dark:bg-[#0B0F19]/90 p-6 space-y-5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <span
              className={`px-3 py-1 rounded-full text-xs font-mono font-bold border ${
                twoFaState.enabled
                  ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30'
                  : 'bg-amber-500/15 text-amber-500 border-amber-500/30'
              }`}
            >
              {twoFaState.enabled ? tf.statusActive : tf.statusInactive}
            </span>
            {twoFaState.enabled && (
              <span className="text-xs font-mono text-slate-400">
                {language === 'es' ? 'Códigos de recuperación:' : 'Recovery codes:'}{' '}
                {twoFaState.recoveryCodesRemaining}
              </span>
            )}
          </div>

          {!twoFaState.enabled && !pendingSetup && (
            <button
              type="button"
              onClick={handleInitSetup}
              className="px-5 py-2.5 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-semibold cursor-pointer"
            >
              {tf.startSetupBtn}
            </button>
          )}

          {pendingSetup && (
            <form onSubmit={handleConfirmEnable} className="space-y-4">
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  {tf.secretLabel}
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-xl bg-slate-100 dark:bg-black/40 border border-slate-200 dark:border-white/10 px-3 py-2 text-xs font-mono text-slate-900 dark:text-white select-all">
                    {pendingSetup.secretBase32}
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(pendingSetup.secretBase32);
                      setCopiedSecret(true);
                      setTimeout(() => setCopiedSecret(false), 1800);
                    }}
                    className="p-2 rounded-xl border border-slate-200 dark:border-white/10 text-slate-500 hover:text-white cursor-pointer"
                  >
                    {copiedSecret ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  {tf.otpUriLabel}
                </div>
                <code className="block break-all rounded-xl bg-slate-100 dark:bg-black/40 border border-slate-200 dark:border-white/10 px-3 py-2 text-[11px] font-mono text-slate-600 dark:text-slate-300">
                  {pendingSetup.otpauthUri}
                </code>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end">
                <label className="flex-1 text-xs text-slate-600 dark:text-slate-300">
                  {tf.enterCodeLabel}
                  <input
                    type="text"
                    required
                    maxLength={6}
                    pattern="\d{6}"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456"
                    className="mt-1 w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-3.5 py-2 text-sm font-mono tracking-widest text-slate-900 dark:text-white"
                  />
                </label>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
                >
                  {tf.confirmEnableBtn}
                </button>
              </div>
            </form>
          )}

          {recoveryCodes && (
            <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-4 space-y-2">
              <div className="text-xs font-semibold text-amber-500">{tf.recoveryTitle}</div>
              <p className="text-[11px] text-slate-600 dark:text-slate-300">{tf.recoveryDesc}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                {recoveryCodes.map((rc) => (
                  <code
                    key={rc}
                    className="rounded-lg bg-black/30 px-2.5 py-1.5 text-center text-xs font-mono text-white"
                  >
                    {rc}
                  </code>
                ))}
              </div>
            </div>
          )}

          {twoFaState.enabled && (
            <div className="pt-3 border-t border-slate-200 dark:border-white/[0.06] space-y-3">
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                {tf.verifyActionTitle}
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={verifyTokenInput}
                  onChange={(e) => setVerifyTokenInput(e.target.value)}
                  placeholder="123456 / ABCD-1234"
                  className="flex-1 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-3.5 py-2 text-xs font-mono text-slate-900 dark:text-white"
                />
                <button
                  type="button"
                  onClick={() => handleVerifyOrDisable('VERIFY_TOKEN')}
                  className="px-4 py-2 rounded-xl bg-[#5865F2] text-white text-xs font-semibold cursor-pointer"
                >
                  {tf.verifyBtn}
                </button>
                <button
                  type="button"
                  onClick={() => handleVerifyOrDisable('DISABLE')}
                  className="px-4 py-2 rounded-xl border border-red-500/40 text-red-500 hover:bg-red-500/10 text-xs font-semibold cursor-pointer"
                >
                  {tf.disableBtn}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ============================================================================
  // SECONDARY OWNER VIEW
  // ============================================================================
  if (section === 'secondary-owner') {
    const so = c.secondaryOwner;

    const handleAssign = async (e: React.FormEvent) => {
      e.preventDefault();
      setFeedback(null);
      try {
        const res = await aegisFetch(`/api/guilds/${activeGuildId}/secondary-owner`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            discordId: secOwnerId.trim(),
            username: secOwnerName.trim(),
            note: secOwnerNote.trim(),
          }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          setFeedback({
            ok: false,
            text:
              json?.message ||
              (language === 'es'
                ? 'Error al asignar Segundo Owner.'
                : 'Error assigning Secondary Owner'),
          });
          return;
        }
        setSecondaryOwner(json.secondaryOwner);
        setSecOwnerId('');
        setSecOwnerName('');
        setSecOwnerNote('');
        setFeedback({ ok: true, text: c.common.saved });
        onSyncCompleted();
      } catch {
        setFeedback({
          ok: false,
          text:
            language === 'es'
              ? 'Error de red al asignar Segundo Owner.'
              : 'Network error assigning Secondary Owner.',
        });
      }
    };

    const handleRevoke = async () => {
      setFeedback(null);
      try {
        const res = await aegisFetch(`/api/guilds/${activeGuildId}/secondary-owner`, {
          method: 'DELETE',
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          setFeedback({
            ok: false,
            text: json?.message || (language === 'es' ? 'No se pudo revocar el Segundo Owner.' : 'Failed to revoke Secondary Owner.'),
          });
          return;
        }
        setSecondaryOwner(null);
        setFeedback({ ok: true, text: c.common.saved });
        onSyncCompleted();
      } catch {
        setFeedback({
          ok: false,
          text:
            language === 'es'
              ? 'Error de red al revocar al Segundo Owner.'
              : 'Network error revoking Secondary Owner.',
        });
      }
    };

    return (
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-display font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
            <UserCog className="w-6 h-6 text-[#5865F2]" />
            {so.title}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{so.subtitle}</p>
        </div>

        {renderFeedback()}

        <div className="rounded-2xl border border-amber-500/35 bg-amber-500/10 p-4 space-y-1">
          <div className="text-xs font-semibold text-amber-500">{so.whyTitle}</div>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{so.whyDesc}</p>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white/85 dark:bg-[#0B0F19]/90 p-6 space-y-5">
          {secondaryOwner ? (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
              <div>
                <div className="text-[11px] font-mono uppercase text-emerald-500 font-semibold">
                  {so.currentTitle}
                </div>
                <div className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">
                  {secondaryOwner.username}
                </div>
                <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
                  {secondaryOwner.discordId}
                </div>
              </div>
              {canAssignSecondOwner && (
                <button
                  type="button"
                  onClick={handleRevoke}
                  className="px-3.5 py-2 rounded-xl border border-red-500/40 text-red-500 hover:bg-red-500/10 text-xs font-semibold cursor-pointer"
                >
                  {so.revokeBtn}
                </button>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 dark:border-white/10 p-4 text-xs text-slate-500 dark:text-slate-400">
              {so.noneTitle}
            </div>
          )}

          {canAssignSecondOwner ? (
            <form onSubmit={handleAssign} className="space-y-3 pt-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="text-xs text-slate-600 dark:text-slate-300">
                  {so.discordIdLabel}
                  <input
                    type="text"
                    required
                    value={secOwnerId}
                    onChange={(e) => setSecOwnerId(e.target.value)}
                    placeholder="123456789012345678"
                    className="mt-1 w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-3 py-2 text-xs font-mono text-slate-900 dark:text-white"
                  />
                </label>
                <label className="text-xs text-slate-600 dark:text-slate-300">
                  {so.usernameLabel}
                  <input
                    type="text"
                    required
                    value={secOwnerName}
                    onChange={(e) => setSecOwnerName(e.target.value)}
                    placeholder="backup_account"
                    className="mt-1 w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-3 py-2 text-xs text-slate-900 dark:text-white"
                  />
                </label>
              </div>
              <label className="block text-xs text-slate-600 dark:text-slate-300">
                {so.noteLabel}
                <input
                  type="text"
                  value={secOwnerNote}
                  onChange={(e) => setSecOwnerNote(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-3 py-2 text-xs text-slate-900 dark:text-white"
                />
              </label>
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-semibold cursor-pointer"
              >
                {so.assignBtn}
              </button>
            </form>
          ) : (
            <div className="text-xs text-amber-500 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4" />
              <span>{so.primaryOwnerOnly}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ============================================================================
  // PREMIUM VIEW (PLANES GRATUITO / ORO / DIAMANTE + CANJE DE CÓDIGOS)
  // ============================================================================
  if (section === 'premium') {
    const isEs = language === 'es';
    const pr = c.premium;
    const sub = premiumOverview?.subscription;
    const userTier: PlanTier = sub?.tier ?? 'FREE';
    const userHasPaid = isPaidTier(userTier) && (sub?.remainingMs ?? 0) > 0;

    const handleRedeemCode = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!licenseKey.trim() || redeemingCode) return;
      setRedeemingCode(true);
      setFeedback(null);
      try {
        const res = await aegisFetch('/api/premium/redeem', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: licenseKey.trim() }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          setFeedback({
            ok: false,
            text:
              json?.message ||
              (isEs ? 'No se pudo canjear el código ingresado.' : 'Failed to redeem code.'),
          });
          return;
        }
        setLicenseKey('');
        setFeedback({ ok: true, text: json?.message || c.common.saved });
        await loadPremiumBundle();
        onSyncCompleted();
      } catch {
        setFeedback({
          ok: false,
          text: isEs ? 'Error de red al canjear el código.' : 'Network error redeeming code.',
        });
      } finally {
        setRedeemingCode(false);
      }
    };

    const tiers: PlanTier[] = ['FREE', 'ORO', 'DIAMANTE'];

    return (
      <div className="space-y-6">
        {/* Active Membership Header Banner */}
        <div className="relative overflow-hidden rounded-3xl border border-amber-500/35 bg-gradient-to-br from-amber-500/12 via-white/95 to-indigo-500/10 dark:from-amber-500/12 dark:via-[#0B0F19] dark:to-indigo-500/15 p-6 sm:p-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
            <div className="lg:col-span-7 space-y-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-mono font-bold ${
                    userHasPaid
                      ? userTier === 'DIAMANTE'
                        ? 'bg-sky-400 text-slate-950'
                        : 'bg-amber-400 text-slate-950'
                      : 'bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-slate-200'
                  }`}
                >
                  {userTier === 'DIAMANTE' ? (
                    <Gem className="w-3.5 h-3.5" />
                  ) : (
                    <Crown className="w-3.5 h-3.5" />
                  )}
                  {getPlanDisplayName(userTier, language)}
                </span>
                <span className="px-3 py-1 rounded-full border border-slate-200 dark:border-white/10 text-[11px] font-mono text-slate-600 dark:text-slate-300 tabular-nums">
                  {isEs ? 'Tiempo restante:' : 'Remaining:'}{' '}
                  <strong>{sub?.remainingHuman ?? (isEs ? 'Sin tiempo activo' : 'Inactive')}</strong>
                </span>
                <span className="px-3 py-1 rounded-full border border-slate-200 dark:border-white/10 text-[11px] font-mono text-slate-600 dark:text-slate-300 tabular-nums">
                  {isEs ? 'Servidores activos:' : 'Server slots:'}{' '}
                  <strong>
                    {sub?.activatedGuildIds.length ?? 0}/{sub?.maxServers ?? 0}
                  </strong>
                </span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-display font-bold text-slate-900 dark:text-white">
                {pr.title}
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl">
                {pr.subtitle}
              </p>
            </div>

            {/* Redeem Code Form */}
            <form
              onSubmit={handleRedeemCode}
              className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-white/10 bg-white/85 dark:bg-black/35 p-4 space-y-3"
            >
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-white">
                <Ticket className="w-4 h-4 text-amber-500" />
                <span>{isEs ? 'Canjear Código Premium' : 'Redeem Premium Code'}</span>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  required
                  value={licenseKey}
                  onChange={(e) => setLicenseKey(e.target.value)}
                  placeholder={pr.licensePlaceholder}
                  className="flex-1 rounded-xl border border-slate-200 dark:border-white/15 bg-slate-50 dark:bg-[#0B0F19] px-3.5 py-2 text-xs font-mono uppercase text-slate-900 dark:text-white"
                />
                <button
                  type="submit"
                  disabled={redeemingCode}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 hover:brightness-105 text-slate-950 text-xs font-bold shadow-md cursor-pointer whitespace-nowrap disabled:opacity-50"
                >
                  <Crown className="w-3.5 h-3.5" />
                  {isEs ? 'Canjear' : 'Redeem'}
                </button>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {isEs
                  ? 'El tiempo canjeado se acumula automáticamente a tu suscripción actual.'
                  : 'Redeemed duration stacks automatically onto your active subscription.'}
              </p>
            </form>
          </div>
        </div>

        {renderFeedback()}

        {/* 3 Plan Cards (Gratuito 0 USD / Oro 5,99 USD / Diamante 9,99 USD) with Pros & Cons */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {tiers.map((tier) => {
            const def = PLAN_CATALOG[tier];
            const isCurrent = userTier === tier;
            const pros = isEs ? def.prosEs : def.prosEn;
            const cons = isEs ? def.consEs : def.consEn;

            const cardAccent =
              tier === 'DIAMANTE'
                ? 'border-sky-400/50 dark:border-sky-400/40 bg-gradient-to-b from-sky-500/10 via-white/95 to-white dark:from-sky-500/10 dark:via-[#0B0F19] dark:to-[#0B0F19]'
                : tier === 'ORO'
                ? 'border-amber-500/50 dark:border-amber-400/40 bg-gradient-to-b from-amber-500/10 via-white/95 to-white dark:from-amber-500/10 dark:via-[#0B0F19] dark:to-[#0B0F19]'
                : 'border-slate-200 dark:border-white/[0.08] bg-white/85 dark:bg-[#0B0F19]/90';

            return (
              <div
                key={tier}
                className={`rounded-2xl border p-6 flex flex-col justify-between gap-5 ${cardAccent}`}
              >
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        {tier === 'DIAMANTE' ? (
                          <Gem className="w-5 h-5 text-sky-400" />
                        ) : tier === 'ORO' ? (
                          <Crown className="w-5 h-5 text-amber-400" />
                        ) : (
                          <ShieldCheck className="w-5 h-5 text-[#5865F2]" />
                        )}
                        <h2 className="text-lg font-display font-bold text-slate-900 dark:text-white">
                          {isEs ? def.nameEs : def.nameEn}
                        </h2>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {isEs ? def.taglineEs : def.taglineEn}
                      </p>
                    </div>
                    {isCurrent && (
                      <span className="px-2.5 py-1 rounded-full bg-[#5865F2] text-white text-[10px] font-mono font-bold shrink-0">
                        {isEs ? 'TU PLAN' : 'CURRENT'}
                      </span>
                    )}
                  </div>

                  <div className="flex items-baseline gap-2 border-y border-slate-200 dark:border-white/[0.07] py-3">
                    <span className="text-3xl font-display font-bold text-slate-900 dark:text-white tabular-nums">
                      {def.priceUsdLabel}
                    </span>
                    {tier !== 'FREE' && (
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        / {isEs ? 'código o asignación' : 'code or grant'}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                    <div className="rounded-lg bg-slate-100/80 dark:bg-white/[0.04] px-3 py-2">
                      <div className="text-slate-400">{isEs ? 'Servidores' : 'Servers'}</div>
                      <div className="font-bold text-slate-900 dark:text-white tabular-nums">
                        {def.quotas.maxPremiumServers}{' '}
                        {def.quotas.maxPremiumServers === 1
                          ? isEs
                            ? 'servidor'
                            : 'server'
                          : isEs
                          ? 'servidores'
                          : 'servers'}
                      </div>
                    </div>
                    <div className="rounded-lg bg-slate-100/80 dark:bg-white/[0.04] px-3 py-2">
                      <div className="text-slate-400">{isEs ? 'Backups Auto' : 'Auto Backups'}</div>
                      <div className="font-bold text-slate-900 dark:text-white tabular-nums">
                        {def.quotas.maxBackups} · {def.quotas.autoBackupDays}d
                      </div>
                    </div>
                  </div>

                  {/* Ventajas */}
                  <div className="space-y-2">
                    <div className="text-[11px] font-mono uppercase tracking-wider text-emerald-600 dark:text-emerald-400 font-semibold">
                      {isEs ? 'Ventajas' : 'Advantages'}
                    </div>
                    <ul className="space-y-1.5">
                      {pros.map((item) => (
                        <li
                          key={item}
                          className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-200 leading-relaxed"
                        >
                          <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Desventajas */}
                  <div className="space-y-2 pt-1">
                    <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
                      {isEs ? 'Desventajas / Límites' : 'Limitations'}
                    </div>
                    <ul className="space-y-1.5">
                      {cons.map((item) => (
                        <li
                          key={item}
                          className="flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400 leading-relaxed"
                        >
                          <XCircle className="w-3.5 h-3.5 text-amber-500/80 shrink-0 mt-0.5" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-200 dark:border-white/[0.06] text-[11px] text-slate-500 dark:text-slate-400">
                  {tier === 'FREE'
                    ? isEs
                      ? 'Activo por defecto en todos tus servidores.'
                      : 'Active by default across your servers.'
                    : isEs
                    ? 'Activación exclusiva mediante código canjeable o asignación del Staff (/premium).'
                    : 'Activated exclusively via redemption code or Staff grant (/premium).'}
                </div>
              </div>
            );
          })}
        </div>

        {/* Plan Comparison Table */}
        <div className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white/85 dark:bg-[#0B0F19]/90 overflow-x-auto">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-white/[0.06] font-semibold text-sm text-slate-900 dark:text-white">
            {pr.compareTitle}
          </div>
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-white/[0.06] text-slate-400 font-mono uppercase">
                <th className="py-3 px-5">{isEs ? 'Característica' : 'Feature'}</th>
                <th className="py-3 px-5">{isEs ? 'Gratuito (0 USD)' : 'Free (0 USD)'}</th>
                <th className="py-3 px-5 text-amber-500">
                  {isEs ? 'Oro (5,99 USD) / Diamante (9,99 USD)' : 'Gold / Diamond'}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-white/[0.05]">
              {pr.features.map((f) => (
                <tr key={f.name}>
                  <td className="py-3 px-5 font-medium text-slate-800 dark:text-slate-200">{f.name}</td>
                  <td className="py-3 px-5 text-slate-500 dark:text-slate-400">{f.free}</td>
                  <td className="py-3 px-5 font-semibold text-amber-600 dark:text-amber-300">{f.pro}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return null;
}
