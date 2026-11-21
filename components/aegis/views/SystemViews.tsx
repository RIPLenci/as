'use client';

import React, { useEffect, useState } from 'react';
import { FileSearch, LogOut, Settings as SettingsIcon } from 'lucide-react';
import type {
  AuditLogRecord,
  LanguageCode,
  SystemHealthSnapshot,
  ThemeMode,
  UserRecord,
} from '@/lib/aegis/types';
import { getDict } from '@/lib/aegis/i18n';
import { aegisFetch } from '@/lib/aegis/client-auth';

interface SystemViewsProps {
  section: 'audit-logs' | 'settings';
  language: LanguageCode;
  theme: ThemeMode;
  user: UserRecord;
  systemHealth?: SystemHealthSnapshot | null;
  expectedCallbackUrl?: string;
  onLanguageChange: (lang: LanguageCode) => void;
  onThemeChange: (theme: ThemeMode) => void;
  onRefreshHealth?: () => void;
  onLogout: () => void;
}

export function SystemViews({
  section,
  language,
  theme,
  user,
  onLanguageChange,
  onThemeChange,
  onLogout,
}: SystemViewsProps) {
  const isEs = language === 'es';
  const t = getDict(language);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [auditSearch, setAuditSearch] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (section !== 'audit-logs') return;

    aegisFetch(`/api/audit-logs?q=${encodeURIComponent(auditSearch)}`)
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (cancelled) return;
        if (!r.ok) {
          setLoadError(
            j?.message ||
              (isEs ? 'Error al cargar registros de auditoría.' : 'Failed to load audit logs.')
          );
          return;
        }
        setLoadError(null);
        setAuditLogs(j?.logs || []);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError(
            isEs
              ? 'Error de red al cargar registros de auditoría.'
              : 'Network error while loading audit logs.'
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [section, auditSearch, isEs]);

  return (
    <div className="space-y-6">
      {loadError && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-700 dark:text-red-300"
        >
          {loadError}
        </div>
      )}

      {section === 'audit-logs' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
                {t.navItems['audit-logs']}
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
                {isEs
                  ? 'Registro de auditoría de seguridad inmutable. Nunca almacena credenciales, tokens ni secretos.'
                  : 'Immutable security audit ledger. Never stores credentials, tokens, or secrets.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <FileSearch className="w-4 h-4 text-slate-400" />
              <input
                type="search"
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                placeholder={
                  isEs ? 'Filtrar por actor, acción, entidad...' : 'Filter by actor, action, entity...'
                }
                className="px-3 py-1.5 text-xs rounded-xl bg-white dark:bg-[#0F1422] border border-slate-200 dark:border-white/[0.08] text-slate-900 dark:text-white"
              />
            </div>
          </div>

          <div className="rounded-2xl bg-white dark:bg-[#0F1422] border border-slate-200 dark:border-white/[0.08] overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/[0.08] text-[11px] font-mono uppercase text-slate-500">
                  <th className="py-3 px-4">{isEs ? 'ID Auditoría' : 'Audit ID'}</th>
                  <th className="py-3 px-4">{isEs ? 'Actor' : 'Actor'}</th>
                  <th className="py-3 px-4">{isEs ? 'Acción' : 'Action'}</th>
                  <th className="py-3 px-4">{isEs ? 'Entidad' : 'Entity'}</th>
                  <th className="py-3 px-4">{isEs ? 'Resultado' : 'Result'}</th>
                  <th className="py-3 px-4">{t.common.date}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                {auditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500">
                      {t.common.noData}
                    </td>
                  </tr>
                ) : (
                  auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
                      <td className="py-3 px-4 font-mono text-slate-500">{log.id}</td>
                      <td className="py-3 px-4 font-mono text-slate-800 dark:text-slate-200">
                        {log.actorName} ({log.actorId})
                      </td>
                      <td className="py-3 px-4 font-mono font-semibold text-slate-900 dark:text-white">
                        {log.action}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-700 dark:text-slate-300">
                        {log.entityType}:{log.entityId}
                      </td>
                      <td
                        className={`py-3 px-4 font-mono font-semibold ${
                          log.result === 'SUCCESS' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'
                        }`}
                      >
                        {log.result}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {section === 'settings' && (
        <div className="space-y-6 max-w-3xl">
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
              {t.navItems.settings}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
              {isEs
                ? 'Perfil de identidad de Discord, persistencia de idioma y tema, y controles de sesión activa.'
                : 'Discord identity profile, language & theme persistence, and active session controls.'}
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-white dark:bg-[#0F1422] border border-slate-200 dark:border-white/[0.08] space-y-5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-white/[0.08] pb-4">
              <div>
                <div className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  {user.globalName || user.username}
                </div>
                <div className="font-mono text-slate-500 mt-0.5">
                  Discord ID: {user.discordId} · {isEs ? 'Cuenta verificada' : 'Verified account'}
                </div>
              </div>
              <button
                type="button"
                onClick={onLogout}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>{t.header.logout}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <SettingsIcon className="w-3.5 h-3.5 text-[#5865F2]" />
                  <span>{t.header.language}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onLanguageChange('es')}
                    className={`px-4 py-2 rounded-xl border cursor-pointer font-medium ${
                      language === 'es'
                        ? 'bg-[#5865F2] border-[#5865F2] text-white'
                        : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    Español
                  </button>
                  <button
                    type="button"
                    onClick={() => onLanguageChange('en')}
                    className={`px-4 py-2 rounded-xl border cursor-pointer font-medium ${
                      language === 'en'
                        ? 'bg-[#5865F2] border-[#5865F2] text-white'
                        : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    English
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="font-semibold text-slate-900 dark:text-white">{t.header.theme}</div>
                <div className="flex gap-2">
                  {(
                    [
                      { id: 'dark', label: t.header.themeDark },
                      { id: 'light', label: t.header.themeLight },
                      { id: 'system', label: t.header.themeSystem },
                    ] as const
                  ).map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => onThemeChange(mode.id)}
                      className={`px-4 py-2 rounded-xl border cursor-pointer font-medium ${
                        theme === mode.id
                          ? 'bg-[#5865F2] border-[#5865F2] text-white'
                          : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
