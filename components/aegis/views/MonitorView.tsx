'use client';

import React, { useEffect, useState } from 'react';
import { Download, Pause, Play, Radio, Wifi, WifiOff } from 'lucide-react';
import type { LanguageCode, SecurityEventRecord } from '@/lib/aegis/types';
import { getDict } from '@/lib/aegis/i18n';
import { aegisFetch } from '@/lib/aegis/client-auth';

interface MonitorViewProps {
  language: LanguageCode;
  activeGuildId: string;
  streamConnected: boolean;
  lastHeartbeatAt: string | null;
  syncNonce?: number;
}

export function MonitorView({
  language,
  activeGuildId,
  streamConnected,
  lastHeartbeatAt,
  syncNonce = 0,
}: MonitorViewProps) {
  const isEs = language === 'es';
  const t = getDict(language);
  const [events, setEvents] = useState<SecurityEventRecord[]>([]);
  const [paused, setPaused] = useState(false);
  const [riskFilter, setRiskFilter] = useState('ALL');

  useEffect(() => {
    let cancelled = false;
    const fetchLatest = () => {
      if (!activeGuildId) {
        setEvents([]);
        return;
      }
      const qs = new URLSearchParams({ guildId: activeGuildId });
      if (riskFilter !== 'ALL') qs.set('risk', riskFilter);
      aegisFetch(`/api/realtime/events?${qs.toString()}`).then(async (res) => {
        if (!res.ok || cancelled) return;
        const json = await res.json();
        if (!cancelled && !paused) setEvents(json.events || []);
      });
    };

    fetchLatest();
    if (paused) {
      return () => {
        cancelled = true;
      };
    }
    const timer = setInterval(fetchLatest, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [paused, activeGuildId, riskFilter, syncNonce]);

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(events, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aegis-security-events-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            {t.navItems.monitor}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            {isEs
              ? 'Flujo de telemetría de operaciones de seguridad en tiempo real con deduplicación y verificación de latido.'
              : 'Live Security Operations telemetry stream with deduplication and heartbeat verification.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#0F1422] text-xs font-mono">
            {streamConnected ? (
              <Wifi className="w-3.5 h-3.5 text-emerald-500" />
            ) : (
              <WifiOff className="w-3.5 h-3.5 text-red-500" />
            )}
            <span className="text-slate-700 dark:text-slate-200">
              {streamConnected
                ? isEs
                  ? 'Stream SSE en Vivo'
                  : 'SSE Stream Live'
                : isEs
                ? 'Sin conexión — Reconectando'
                : 'Offline — Reconnecting'}
            </span>
            {lastHeartbeatAt && (
              <span className="text-slate-500 dark:text-slate-400 tabular-nums">
                · {new Date(lastHeartbeatAt).toLocaleTimeString()}
              </span>
            )}
          </div>

          <span className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#0F1422] text-slate-700 dark:text-slate-200 text-xs font-medium">
            {isEs ? 'Aislado: Servidor activo' : 'Isolated: Active Server'}
          </span>

          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-semibold cursor-pointer"
          >
            {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            <span>
              {paused
                ? isEs
                  ? 'Reanudar Feed'
                  : 'Resume Feed'
                : isEs
                ? 'Pausar Feed'
                : 'Pause Feed'}
            </span>
          </button>

          <button
            type="button"
            onClick={handleExport}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#0F1422] text-slate-700 dark:text-slate-200 text-xs font-medium cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{t.common.exportJson}</span>
          </button>
        </div>
      </div>

      {!streamConnected && (
        <div
          role="alert"
          className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-700 dark:text-red-300 flex items-center gap-2"
        >
          <WifiOff className="w-4 h-4 shrink-0" />
          <span>
            {isEs
              ? 'Stream en tiempo real desconectado. Se muestran únicamente los últimos eventos sincronizados; no se generan eventos sintéticos mientras esté sin conexión.'
              : 'Real-time stream disconnected. Displaying last synchronized events only; no synthetic events are generated while offline.'}
          </span>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {(['ALL', 'CRITICAL', 'HIGH', 'MODERATE', 'LOW'] as const).map((lvl) => (
          <button
            key={lvl}
            type="button"
            onClick={() => setRiskFilter(lvl)}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium cursor-pointer ${
              riskFilter === lvl
                ? 'bg-[#5865F2] text-white'
                : 'bg-white dark:bg-[#0F1422] border border-slate-200 dark:border-white/[0.08] text-slate-600 dark:text-slate-400'
            }`}
          >
            {lvl === 'ALL' ? t.common.all : lvl}
          </button>
        ))}
      </div>

      <div className="rounded-2xl bg-white dark:bg-[#0F1422] border border-slate-200 dark:border-white/[0.08] overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-200 dark:border-white/[0.08] text-[11px] font-mono uppercase tracking-wider text-slate-500">
              <th className="py-3 px-4">{t.common.date}</th>
              <th className="py-3 px-4">{isEs ? 'ID Servidor' : 'Guild ID'}</th>
              <th className="py-3 px-4">{isEs ? 'Tipo de Evento' : 'Event Type'}</th>
              <th className="py-3 px-4">{t.common.user}</th>
              <th className="py-3 px-4">{t.common.riskScore}</th>
              <th className="py-3 px-4">{isEs ? 'Acción' : 'Action'}</th>
              <th className="py-3 px-4">{t.common.status}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-white/[0.06] text-xs">
            {events.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-slate-500">
                  <div className="flex flex-col items-center gap-2">
                    <Radio className="w-5 h-5 text-slate-400" />
                    <span>{t.common.noData}</span>
                  </div>
                </td>
              </tr>
            ) : (
              events.map((ev) => (
                <tr key={ev.id} className="hover:bg-slate-50 dark:hover:bg-white/[0.02]">
                  <td className="py-3 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                    {new Date(ev.createdAt).toLocaleString()}
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-400">
                    {ev.guildId}
                  </td>
                  <td className="py-3 px-4 font-mono font-medium text-slate-900 dark:text-slate-100">
                    {ev.eventType}
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-700 dark:text-slate-300">
                    {ev.targetUsername} ({ev.targetDiscordId})
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums">
                    <span
                      className={
                        ev.riskLevel === 'CRITICAL'
                          ? 'text-red-500 font-semibold'
                          : ev.riskLevel === 'HIGH'
                          ? 'text-amber-500 font-semibold'
                          : 'text-slate-500'
                      }
                    >
                      {ev.riskScore}/100 ({ev.riskLevel})
                    </span>
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-300">
                    {ev.actionTaken}
                  </td>
                  <td className="py-3 px-4 font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                    {ev.status}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
