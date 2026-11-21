'use client';

import React, { useEffect, useState } from 'react';
import { CheckCircle2, Hash, Lock, Trash2, Unlock, UserCheck, UserX } from 'lucide-react';
import type {
  ChannelWhitelistRecord,
  GuildPlanRecord,
  LanguageCode,
  LockdownStateRecord,
  QuarantineEntryRecord,
  WhitelistEntryRecord,
  WhitelistRuleScope,
  WhitelistTargetType,
} from '@/lib/aegis/types';
import { getDict } from '@/lib/aegis/i18n';
import { getSuiteCopy } from '@/lib/aegis/dashboard-i18n';
import { aegisFetch } from '@/lib/aegis/client-auth';
import { getPlanDisplayName, normalizePlanTier } from '@/lib/aegis/premium';

interface OperationsViewsProps {
  section: 'quarantine' | 'lockdown' | 'whitelist';
  language: LanguageCode;
  activeGuildId: string;
  syncNonce?: number;
  onSyncCompleted: () => void;
}

const RULE_SCOPES: WhitelistRuleScope[] = [
  'JOIN_BURST',
  'ACCOUNT_AGE',
  'BOT_DETECTION',
  'ANTI_NUKE',
  'LOCKDOWN_BYPASS',
];

export function OperationsViews({
  section,
  language,
  activeGuildId,
  syncNonce = 0,
  onSyncCompleted,
}: OperationsViewsProps) {
  const isEs = language === 'es';
  const t = getDict(language);
  const suiteCopy = getSuiteCopy(language);

  // Quarantine state
  const [quarantines, setQuarantines] = useState<QuarantineEntryRecord[]>([]);
  const [qDiscordId, setQDiscordId] = useState('');
  const [qUsername, setQUsername] = useState('');
  const [qReason, setQReason] = useState('');
  const [qHours, setQHours] = useState(24);

  // Lockdown state
  const [lockdown, setLockdown] = useState<LockdownStateRecord | null>(null);
  const [lockReason, setLockReason] = useState('');
  const [lockMinutes, setLockMinutes] = useState(30);

  // Whitelist state
  const [whitelists, setWhitelists] = useState<WhitelistEntryRecord[]>([]);
  const [channelWhitelists, setChannelWhitelists] = useState<ChannelWhitelistRecord[]>([]);
  const [whitelistPlan, setWhitelistPlan] = useState<GuildPlanRecord | null>(null);
  const [wQuotas, setWQuotas] = useState({
    usersUsed: 0,
    usersLimit: 15,
    channelsUsed: 0,
    channelsLimit: 5,
  });
  const [wTargetId, setWTargetId] = useState('');
  const [wTargetName, setWTargetName] = useState('');
  const [wTargetType, setWTargetType] = useState<WhitelistTargetType>('USER');
  const [wReason, setWReason] = useState('');
  const [wRules, setWRules] = useState<WhitelistRuleScope[]>(['JOIN_BURST']);

  const [cChannelId, setCChannelId] = useState('');
  const [cChannelName, setCChannelName] = useState('');
  const [cReason, setCReason] = useState('');

  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setError(null);
    try {
      if (section === 'quarantine') {
        const res = await aegisFetch(`/api/quarantine?guildId=${activeGuildId}`);
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          setError(
            json?.message ||
              (isEs ? 'Error al cargar registros de cuarentena.' : 'Failed to load quarantine entries.')
          );
          return;
        }
        setQuarantines(json?.entries || []);
      } else if (section === 'lockdown') {
        const res = await aegisFetch(`/api/guilds/${activeGuildId}/lockdown`);
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          setError(
            json?.message ||
              (isEs ? 'Error al cargar estado de lockdown.' : 'Failed to load lockdown status.')
          );
          return;
        }
        setLockdown(json?.lockdown || null);
      } else if (section === 'whitelist') {
        const res = await aegisFetch(`/api/guilds/${activeGuildId}/whitelist`);
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          setError(
            json?.message ||
              (isEs ? 'Error al cargar entradas de whitelist.' : 'Failed to load whitelist entries.')
          );
          return;
        }
        setWhitelists(json?.entries || []);
        setChannelWhitelists(json?.channels || []);
        setWhitelistPlan(json?.plan || null);
        if (json?.quotas) setWQuotas(json.quotas);
      }
    } catch {
      setError(
        isEs
          ? 'Error de red al cargar operaciones del servidor.'
          : 'Network error while loading server operations data.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!activeGuildId) return;
    let cancelled = false;
    const url =
      section === 'quarantine'
        ? `/api/quarantine?guildId=${activeGuildId}`
        : section === 'lockdown'
        ? `/api/guilds/${activeGuildId}/lockdown`
        : `/api/guilds/${activeGuildId}/whitelist`;

    aegisFetch(url)
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setError(
            json?.message ||
              (isEs ? `Error al cargar datos de ${section}.` : `Failed to load ${section} data.`)
          );
          return;
        }
        setError(null);
        if (section === 'quarantine') setQuarantines(json?.entries || []);
        else if (section === 'lockdown') setLockdown(json?.lockdown || null);
        else {
          setWhitelists(json?.entries || []);
          setChannelWhitelists(json?.channels || []);
          setWhitelistPlan(json?.plan || null);
          if (json?.quotas) setWQuotas(json.quotas);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(
            isEs
              ? 'Error de red al cargar operaciones del servidor.'
              : 'Network error while loading server operations data.'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [section, activeGuildId, isEs, syncNonce]);

  const handleQuarantineAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFeedback(null);
    try {
      const res = await aegisFetch('/api/quarantine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guildId: activeGuildId,
          discordId: qDiscordId.trim(),
          username: qUsername.trim(),
          reason: qReason.trim(),
          durationHours: qHours,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(
          json?.issues?.[0]?.message ||
            json?.message ||
            (isEs ? 'Error de validación' : 'Validation error')
        );
        return;
      }
      setQDiscordId('');
      setQUsername('');
      setQReason('');
      setFeedback(
        isEs
          ? 'Miembro puesto en cuarentena y registrado en auditoría.'
          : 'Member quarantined and recorded in audit log.'
      );
      await loadData();
      onSyncCompleted();
    } catch {
      setError(
        isEs
          ? 'Error de red al crear entrada de cuarentena.'
          : 'Network error creating quarantine entry.'
      );
    }
  };

  const handleQuarantineAction = async (id: string, action: 'RELEASE' | 'EXTEND') => {
    setError(null);
    setFeedback(null);
    try {
      const res = await aegisFetch(`/api/quarantine/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, durationHours: action === 'EXTEND' ? 48 : undefined }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(
          json?.issues?.[0]?.message ||
            json?.message ||
            (isEs ? 'Error al actualizar cuarentena.' : 'Quarantine action failed.')
        );
        return;
      }
      setFeedback(
        action === 'RELEASE'
          ? isEs
            ? 'Miembro liberado de cuarentena.'
            : 'Member released from quarantine.'
          : isEs
          ? 'Duración extendida +48h.'
          : 'Duration extended +48h.'
      );
      await loadData();
      onSyncCompleted();
    } catch {
      setError(
        isEs
          ? 'Error de red al actualizar entrada de cuarentena.'
          : 'Network error while updating quarantine entry.'
      );
    }
  };

  const handleLockdown = async (action: 'ACTIVATE' | 'DEACTIVATE') => {
    setError(null);
    setFeedback(null);
    try {
      const res = await aegisFetch(`/api/guilds/${activeGuildId}/lockdown`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          mode: 'MANUAL',
          reason: lockReason.trim() || undefined,
          durationMinutes: lockMinutes,
          restrictions: lockdown?.restrictions,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(
          json?.message || (isEs ? 'Error en acción de lockdown.' : 'Lockdown action failed.')
        );
        return;
      }
      setLockdown(json.lockdown);
      setFeedback(
        action === 'ACTIVATE'
          ? isEs
            ? 'Lockdown de emergencia activado con instantánea previa de permisos.'
            : 'Emergency Lockdown activated with pre-lockdown permission snapshot.'
          : isEs
          ? 'Permisos originales de canales restaurados de forma segura.'
          : 'Original channel permissions restored safely.'
      );
      onSyncCompleted();
    } catch {
      setError(
        isEs
          ? 'Error de red al ejecutar acción de bloqueo.'
          : 'Network error executing lockdown action.'
      );
    }
  };

  const handleWhitelistAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFeedback(null);
    try {
      const res = await aegisFetch(`/api/guilds/${activeGuildId}/whitelist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetId: wTargetId.trim(),
          targetName: wTargetName.trim(),
          targetType: wTargetType,
          reason: wReason.trim(),
          excludedRules: wRules,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(
          json?.issues?.[0]?.message ||
            json?.message ||
            (isEs ? 'Error de validación' : 'Validation error')
        );
        return;
      }
      setWTargetId('');
      setWTargetName('');
      setWReason('');
      setFeedback(
        isEs
          ? 'Entrada de whitelist con alcance por regla creada.'
          : 'Rule-scoped whitelist entry created.'
      );
      await loadData();
      onSyncCompleted();
    } catch {
      setError(
        isEs
          ? 'Error de red al agregar a la whitelist.'
          : 'Network error adding whitelist entry.'
      );
    }
  };

  const handleWhitelistRevoke = async (id: string) => {
    setError(null);
    setFeedback(null);
    try {
      const res = await aegisFetch(
        `/api/guilds/${activeGuildId}/whitelist?id=${encodeURIComponent(id)}`,
        { method: 'DELETE' }
      );
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(
          json?.message ||
            (isEs ? 'No se pudo revocar la entrada de whitelist.' : 'Failed to revoke whitelist entry.')
        );
        return;
      }
      setFeedback(isEs ? 'Entrada de whitelist revocada.' : 'Whitelist entry revoked.');
      await loadData();
      onSyncCompleted();
    } catch {
      setError(
        isEs
          ? 'Error de red al revocar entrada de whitelist.'
          : 'Network error while revoking whitelist entry.'
      );
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

  return (
    <div className="space-y-6">
      {feedback && (
        <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-700 dark:text-red-300"
        >
          {error}
        </div>
      )}

      {section === 'quarantine' && (
        <div className="space-y-6">
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
              {t.navItems.quarantine}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
              {isEs
                ? 'Aísla cuentas sospechosas preservando sus roles originales y generando registros verificables de liberación.'
                : 'Isolate suspicious accounts with role-state preservation and verifiable release logs.'}
            </p>
          </div>

          <form
            onSubmit={handleQuarantineAdd}
            className="p-5 rounded-2xl bg-white dark:bg-[#0F1422] border border-slate-200 dark:border-white/[0.08] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end text-xs"
          >
            <label className="space-y-1">
              <span className="text-slate-600 dark:text-slate-400">Discord ID</span>
              <input
                type="text"
                required
                placeholder={isEs ? 'ID de 17-20 dígitos' : '17-20 digit ID'}
                value={qDiscordId}
                onChange={(e) => setQDiscordId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-white/[0.08] font-mono text-slate-900 dark:text-white"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-600 dark:text-slate-400">{t.common.user}</span>
              <input
                type="text"
                required
                placeholder={isEs ? 'usuario_sospechoso' : 'suspect_user'}
                value={qUsername}
                onChange={(e) => setQUsername(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-white/[0.08] text-slate-900 dark:text-white"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-600 dark:text-slate-400">{t.common.reason}</span>
              <input
                type="text"
                required
                placeholder={isEs ? 'Ráfaga de ingresos sospechosa' : 'Suspicious join cluster'}
                value={qReason}
                onChange={(e) => setQReason(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-white/[0.08] text-slate-900 dark:text-white"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-600 dark:text-slate-400">
                {isEs ? 'Duración (horas)' : 'Duration (hours)'}
              </span>
              <input
                type="number"
                min={1}
                max={720}
                value={qHours}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (Number.isFinite(val)) setQHours(val);
                }}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-white/[0.08] font-mono tabular-nums text-slate-900 dark:text-white"
              />
            </label>
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white font-semibold cursor-pointer"
            >
              <UserX className="w-3.5 h-3.5" />
              <span>{isEs ? 'Aislar Miembro' : 'Quarantine Member'}</span>
            </button>
          </form>

          <div className="rounded-2xl bg-white dark:bg-[#0F1422] border border-slate-200 dark:border-white/[0.08] overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/[0.08] text-[11px] font-mono uppercase text-slate-500">
                  <th className="py-3 px-4">{t.common.user}</th>
                  <th className="py-3 px-4">Discord ID</th>
                  <th className="py-3 px-4">{t.common.reason}</th>
                  <th className="py-3 px-4">{t.common.riskScore}</th>
                  <th className="py-3 px-4">{isEs ? 'Responsable' : 'Responsible'}</th>
                  <th className="py-3 px-4">{t.common.status}</th>
                  <th className="py-3 px-4">{t.common.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                {quarantines.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      {t.common.noData}
                    </td>
                  </tr>
                ) : (
                  quarantines.map((q) => (
                    <tr key={q.id}>
                      <td className="py-3 px-4 font-semibold text-slate-900 dark:text-white">
                        {q.username}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-500">{q.discordId}</td>
                      <td className="py-3 px-4 text-slate-700 dark:text-slate-300">{q.reason}</td>
                      <td className="py-3 px-4 font-mono tabular-nums">{q.riskScore}/100</td>
                      <td className="py-3 px-4 font-mono">{q.responsibleActor}</td>
                      <td className="py-3 px-4 font-mono font-semibold">{q.status}</td>
                      <td className="py-3 px-4 flex gap-2">
                        {q.status === 'ACTIVE' && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleQuarantineAction(q.id, 'RELEASE')}
                              className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-medium cursor-pointer"
                            >
                              {isEs ? 'Liberar' : 'Release'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleQuarantineAction(q.id, 'EXTEND')}
                              className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-white/[0.1] cursor-pointer"
                            >
                              +48h
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {section === 'lockdown' &&
        (loading ? (
          <div className="p-8 rounded-2xl bg-white dark:bg-[#0F1422] border border-slate-200 dark:border-white/[0.08] text-sm text-slate-500">
            {t.common.loading}
          </div>
        ) : !lockdown ? (
          <div className="p-8 rounded-2xl bg-white dark:bg-[#0F1422] border border-slate-200 dark:border-white/[0.08] text-sm text-slate-500">
            {t.common.noData}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
                  {t.navItems.lockdown}
                </h1>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
                  {isEs
                    ? 'Bloqueo de canales con respaldo por snapshot que restaura únicamente los permisos aplicados por AEGIS sin alterar cambios manuales del equipo.'
                    : 'Snapshot-backed channel lockdown restoring only AEGIS-managed overwrites while preserving manual admin edits.'}
                </p>
              </div>
              <div className="font-mono text-sm font-bold">
                {t.common.status}:{' '}
                <span className={lockdown.active ? 'text-red-500' : 'text-emerald-500'}>
                  {lockdown.active
                    ? isEs
                      ? 'LOCKDOWN ACTIVO'
                      : 'LOCKDOWN ACTIVE'
                    : isEs
                    ? 'EN ESPERA'
                    : 'STANDBY'}
                </span>
              </div>
            </div>

            <div className="p-6 rounded-2xl bg-white dark:bg-[#0F1422] border border-slate-200 dark:border-white/[0.08] space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <label className="space-y-1">
                  <span className="text-slate-600 dark:text-slate-400">
                    {isEs ? 'Motivo del Lockdown' : 'Lockdown Reason'}
                  </span>
                  <input
                    type="text"
                    value={lockReason}
                    onChange={(e) => setLockReason(e.target.value)}
                    placeholder={isEs ? 'Mitigación de raid activo' : 'Active raid mitigation'}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-white/[0.08] text-slate-900 dark:text-white"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-slate-600 dark:text-slate-400">
                    {isEs ? 'Auto-restauración (minutos)' : 'Auto-Restore Duration (minutes)'}
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={lockMinutes}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (Number.isFinite(val)) setLockMinutes(val);
                    }}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-white/[0.08] font-mono tabular-nums text-slate-900 dark:text-white"
                  />
                </label>
              </div>

              <div className="flex flex-wrap gap-3">
                {!lockdown.active ? (
                  <button
                    type="button"
                    onClick={() => handleLockdown('ACTIVATE')}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold cursor-pointer"
                  >
                    <Lock className="w-4 h-4" />
                    <span>
                      {isEs ? 'Activar Lockdown de Emergencia' : 'Activate Emergency Lockdown'}
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleLockdown('DEACTIVATE')}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
                  >
                    <Unlock className="w-4 h-4" />
                    <span>
                      {isEs ? 'Restaurar Snapshot y Finalizar' : 'Restore Snapshot & End Lockdown'}
                    </span>
                  </button>
                )}
              </div>

              {lockdown.snapshots.length > 0 && (
                <div className="space-y-2 pt-3 border-t border-slate-200 dark:border-white/[0.08]">
                  <h2 className="text-xs font-mono uppercase text-slate-500">
                    {isEs
                      ? 'Instantáneas de Permisos Previas al Lockdown'
                      : 'Saved Pre-Lockdown Permission Snapshots'}
                  </h2>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs font-mono">
                    {lockdown.snapshots.map((snap) => (
                      <div key={snap.channelId} className="py-2 flex justify-between gap-4">
                        <span>{snap.channelName}</span>
                        <span className="text-slate-500">
                          {isEs ? 'Flags AEGIS:' : 'AEGIS Flags:'}{' '}
                          {snap.aegisAppliedDenyFlags.join(', ')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}

      {section === 'whitelist' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
                <UserCheck className="w-6 h-6 text-[#5865F2]" />
                {suiteCopy.whitelistExtra.title}
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
                {getPlanDisplayName(normalizePlanTier(whitelistPlan?.tier), language).toUpperCase()}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-indigo-500/35 bg-white dark:bg-[#0B0F19]/90 p-5 space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                <UserCheck className="w-4 h-4 text-[#5865F2]" />
                <span>{suiteCopy.whitelistExtra.usersCardTitle}</span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                {suiteCopy.whitelistExtra.usersCardDesc}
              </p>
              <span className="inline-block px-2.5 py-0.5 rounded-md text-xs font-mono tabular-nums font-bold bg-[#5865F2]/15 text-[#5865F2] dark:text-indigo-300">
                {wQuotas.usersUsed} / {wQuotas.usersLimit}
              </span>
            </div>

            <div className="rounded-2xl border border-cyan-500/35 bg-white dark:bg-[#0B0F19]/90 p-5 space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                <Hash className="w-4 h-4 text-cyan-500" />
                <span>{suiteCopy.whitelistExtra.channelsCardTitle}</span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                {suiteCopy.whitelistExtra.channelsCardDesc}
              </p>
              <span className="inline-block px-2.5 py-0.5 rounded-md text-xs font-mono tabular-nums font-bold bg-cyan-500/15 text-cyan-700 dark:text-cyan-300">
                {wQuotas.channelsUsed} / {wQuotas.channelsLimit}
              </span>
            </div>
          </div>

          <form
            onSubmit={handleWhitelistAdd}
            className="p-5 rounded-2xl bg-white dark:bg-[#0B0F19]/90 border border-indigo-500/30 space-y-4 text-xs"
          >
            <div className="font-semibold text-sm text-slate-900 dark:text-white flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-[#5865F2]" />
              {suiteCopy.whitelistExtra.usersSection}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <label className="space-y-1">
                <span className="text-slate-600 dark:text-slate-400">
                  {isEs ? 'ID Objetivo de Discord' : 'Target Discord ID'}
                </span>
                <input
                  type="text"
                  required
                  value={wTargetId}
                  onChange={(e) => setWTargetId(e.target.value)}
                  placeholder={isEs ? 'ID de 17-20 dígitos' : '17-20 digit ID'}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/[0.08] font-mono text-slate-900 dark:text-white"
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-600 dark:text-slate-400">
                  {isEs ? 'Nombre o Etiqueta' : 'Name / Label'}
                </span>
                <input
                  type="text"
                  required
                  value={wTargetName}
                  onChange={(e) => setWTargetName(e.target.value)}
                  placeholder="VerifiedServiceBot"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/[0.08] text-slate-900 dark:text-white"
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-600 dark:text-slate-400">
                  {isEs ? 'Tipo de Entidad' : 'Entity Type'}
                </span>
                <select
                  value={wTargetType}
                  onChange={(e) => setWTargetType(e.target.value as WhitelistTargetType)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/[0.08] text-slate-900 dark:text-white"
                >
                  <option value="USER">{isEs ? 'Usuario' : 'User'}</option>
                  <option value="ROLE">{isEs ? 'Rol' : 'Role'}</option>
                  <option value="BOT">Bot</option>
                  <option value="EXCEPTION">
                    {isEs ? 'Excepción específica' : 'Specific Exception'}
                  </option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-slate-600 dark:text-slate-400">{t.common.reason}</span>
                <input
                  type="text"
                  required
                  value={wReason}
                  onChange={(e) => setWReason(e.target.value)}
                  placeholder={isEs ? 'Automatización autorizada' : 'Authorized automation'}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/[0.08] text-slate-900 dark:text-white"
                />
              </label>
            </div>

            <div className="space-y-2">
              <span className="text-slate-600 dark:text-slate-400 font-medium">
                {isEs ? 'Exclusiones de Reglas Permitidas:' : 'Allowed Rule Exclusions:'}
              </span>
              <div className="flex flex-wrap gap-2">
                {RULE_SCOPES.map((scope) => {
                  const active = wRules.includes(scope);
                  return (
                    <button
                      key={scope}
                      type="button"
                      onClick={() =>
                        setWRules((prev) =>
                          active ? prev.filter((r) => r !== scope) : [...prev, scope]
                        )
                      }
                      className={`px-2.5 py-1 rounded-lg font-mono text-xs border cursor-pointer ${
                        active
                          ? 'bg-[#5865F2] border-[#5865F2] text-white'
                          : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {scope}
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white font-semibold cursor-pointer"
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>{suiteCopy.whitelistExtra.addUserBtn.replace(/^\+\s*/, '')}</span>
            </button>
          </form>

          <div className="rounded-2xl bg-white dark:bg-[#0B0F19]/90 border border-indigo-500/25 overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/[0.08] text-[11px] font-mono uppercase text-slate-500">
                  <th className="py-3 px-4">{isEs ? 'Objetivo' : 'Target'}</th>
                  <th className="py-3 px-4">{isEs ? 'Tipo' : 'Type'}</th>
                  <th className="py-3 px-4">{isEs ? 'Reglas Excluidas' : 'Excluded Rules'}</th>
                  <th className="py-3 px-4">{isEs ? 'Autor' : 'Author'}</th>
                  <th className="py-3 px-4">{t.common.status}</th>
                  <th className="py-3 px-4 text-right">{t.common.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                {whitelists.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500">
                      {suiteCopy.whitelistExtra.emptyUsers}
                    </td>
                  </tr>
                ) : (
                  whitelists.map((w) => (
                    <tr key={w.id}>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900 dark:text-white">
                          {w.targetName}
                        </div>
                        <div className="font-mono text-[11px] text-slate-500">{w.targetId}</div>
                      </td>
                      <td className="py-3 px-4 font-mono">{w.targetType}</td>
                      <td className="py-3 px-4 font-mono">{w.excludedRules.join(', ')}</td>
                      <td className="py-3 px-4 font-mono">{w.authorName}</td>
                      <td className="py-3 px-4 font-mono font-semibold">{w.status}</td>
                      <td className="py-3 px-4 text-right">
                        {w.status === 'ACTIVE' && (
                          <button
                            type="button"
                            onClick={() => handleWhitelistRevoke(w.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-red-500/35 text-red-500 hover:bg-red-500/10 font-medium cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            {suiteCopy.whitelistExtra.removeBtn}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="rounded-2xl border border-cyan-500/35 bg-white dark:bg-[#0B0F19]/90 p-5 space-y-4 text-xs">
            <div className="font-semibold text-sm text-slate-900 dark:text-white flex items-center gap-2">
              <Hash className="w-4 h-4 text-cyan-500" />
              {suiteCopy.whitelistExtra.channelsSection}
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setError(null);
                setFeedback(null);
                try {
                  const res = await aegisFetch(`/api/guilds/${activeGuildId}/whitelist`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      kind: 'CHANNEL',
                      channelId: cChannelId.trim(),
                      channelName: cChannelName.trim(),
                      reason: cReason.trim(),
                    }),
                  });
                  const json = await res.json().catch(() => null);
                  if (!res.ok) {
                    setError(
                      json?.message ||
                        (isEs ? 'Error al agregar canal a whitelist.' : 'Error adding channel to whitelist.')
                    );
                    return;
                  }
                  setCChannelId('');
                  setCChannelName('');
                  setCReason('');
                  setFeedback(suiteCopy.common.saved);
                  await loadData();
                  onSyncCompleted();
                } catch {
                  setError(
                    isEs
                      ? 'Error de red al agregar canal a whitelist.'
                      : 'Network error adding channel to whitelist.'
                  );
                }
              }}
              className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"
            >
              <label className="space-y-1">
                <span className="text-slate-600 dark:text-slate-400">
                  {suiteCopy.whitelistExtra.channelIdLabel}
                </span>
                <input
                  type="text"
                  required
                  value={cChannelId}
                  onChange={(e) => setCChannelId(e.target.value)}
                  placeholder="123456789012345678"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/[0.08] font-mono text-slate-900 dark:text-white"
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-600 dark:text-slate-400">
                  {suiteCopy.whitelistExtra.channelNameLabel}
                </span>
                <input
                  type="text"
                  required
                  value={cChannelName}
                  onChange={(e) => setCChannelName(e.target.value)}
                  placeholder="#bot-commands"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/[0.08] text-slate-900 dark:text-white"
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-600 dark:text-slate-400">
                  {suiteCopy.whitelistExtra.reasonLabel}
                </span>
                <input
                  type="text"
                  required
                  value={cReason}
                  onChange={(e) => setCReason(e.target.value)}
                  placeholder={isEs ? 'Comandos de alto volumen' : 'High-volume bot commands'}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/[0.08] text-slate-900 dark:text-white"
                />
              </label>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold cursor-pointer h-[36px]"
              >
                {suiteCopy.whitelistExtra.addChannelBtn}
              </button>
            </form>

            {channelWhitelists.length === 0 ? (
              <div className="py-6 text-center text-slate-500 dark:text-slate-400">
                <Hash className="w-6 h-6 mx-auto mb-1 opacity-60" />
                <div>{suiteCopy.whitelistExtra.emptyChannels}</div>
              </div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-white/[0.06]">
                {channelWhitelists.map((ch) => (
                  <div key={ch.id} className="py-2.5 flex items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-white">
                        {ch.channelName}
                      </div>
                      <div className="font-mono text-[11px] text-slate-500">
                        {ch.channelId} · {ch.reason}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        setError(null);
                        setFeedback(null);
                        try {
                          const res = await aegisFetch(
                            `/api/guilds/${activeGuildId}/whitelist?kind=CHANNEL&id=${encodeURIComponent(
                              ch.id
                            )}`,
                            { method: 'DELETE' }
                          );
                          const json = await res.json().catch(() => null);
                          if (!res.ok) {
                            setError(
                              json?.message ||
                                (isEs
                                  ? 'No se pudo quitar el canal de whitelist.'
                                  : 'Failed to remove channel from whitelist.')
                            );
                            return;
                          }
                          setFeedback(isEs ? 'Canal eliminado de la whitelist.' : 'Channel removed from whitelist.');
                          await loadData();
                          onSyncCompleted();
                        } catch {
                          setError(
                            isEs
                              ? 'Error de red al quitar el canal de whitelist.'
                              : 'Network error removing channel from whitelist.'
                          );
                        }
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-red-500/35 text-red-500 hover:bg-red-500/10 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {suiteCopy.whitelistExtra.removeBtn}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
