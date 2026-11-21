'use client';

import React, { useEffect, useState } from 'react';
import { MessageSquarePlus, ShieldAlert, X } from 'lucide-react';
import type {
  IncidentStatus,
  LanguageCode,
  SecurityIncidentRecord,
} from '@/lib/aegis/types';
import { getDict } from '@/lib/aegis/i18n';
import { aegisFetch } from '@/lib/aegis/client-auth';

interface IncidentsViewProps {
  language: LanguageCode;
  activeGuildId: string;
  searchQuery: string;
  initialIncidentId?: string | null;
  syncNonce?: number;
}

const STATUSES: IncidentStatus[] = [
  'OPEN',
  'INVESTIGATING',
  'MITIGATED',
  'RESOLVED',
  'FALSE_POSITIVE',
];

export function IncidentsView({
  language,
  activeGuildId,
  searchQuery,
  initialIncidentId,
  syncNonce = 0,
}: IncidentsViewProps) {
  const t = getDict(language);
  const copy =
    language === 'es'
      ? {
          subtitle:
            'Triaje de incidentes, registros explicables del Risk Engine, investigador asignado y evidencia inmutable.',
          activeServer: 'Servidor activo',
          allServers: 'Todos los servidores',
          threatCol: 'Tipo / Amenaza',
          affectedCol: 'Usuario afectado',
          investigatorCol: 'Investigador',
          unassigned: 'Sin asignar',
          inspectBtn: 'Inspeccionar',
          allLabel: 'TODOS',
          statusLabels: {
            OPEN: 'ABIERTO',
            INVESTIGATING: 'EN REVISIÓN',
            MITIGATED: 'MITIGADO',
            RESOLVED: 'RESUELTO',
            FALSE_POSITIVE: 'FALSO POSITIVO',
          } as Record<IncidentStatus, string>,
          dossierScore: 'Puntuación de riesgo',
          dossierUser: 'Usuario afectado',
          dossierAction: 'Acción aplicada',
          dossierStatus: 'Estado',
          evidenceTitle: 'Resumen de evidencia inmutable',
          signalsTitle: 'Señales del Risk Engine',
          updateStatusTitle: 'Actualizar estado de investigación',
          notesTitle: 'Notas de investigación',
          notePlaceholder: 'Añadir nota de investigación...',
          addNoteBtn: 'Añadir nota',
          closeAria: 'Cerrar expediente de incidente',
        }
      : {
          subtitle:
            'Incident triage, explainable Risk Engine signal logs, investigator assignment, and immutable evidence history.',
          activeServer: 'Active Server',
          allServers: 'All Servers',
          threatCol: 'Threat',
          affectedCol: 'Affected',
          investigatorCol: 'Investigator',
          unassigned: 'Unassigned',
          inspectBtn: 'Inspect',
          allLabel: 'ALL',
          statusLabels: {
            OPEN: 'OPEN',
            INVESTIGATING: 'INVESTIGATING',
            MITIGATED: 'MITIGATED',
            RESOLVED: 'RESOLVED',
            FALSE_POSITIVE: 'FALSE POSITIVE',
          } as Record<IncidentStatus, string>,
          dossierScore: 'Risk Score',
          dossierUser: 'Affected User',
          dossierAction: 'Applied Action',
          dossierStatus: 'Status',
          evidenceTitle: 'Immutable Evidence Summary',
          signalsTitle: 'Risk Engine Signal Breakdown',
          updateStatusTitle: 'Update Investigation Status',
          notesTitle: 'Investigation Notes',
          notePlaceholder: 'Add investigation note...',
          addNoteBtn: 'Add Note',
          closeAria: 'Close incident dossier',
        };

  const [incidents, setIncidents] = useState<SecurityIncidentRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [selected, setSelected] = useState<SecurityIncidentRecord | null>(null);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadIncidents = async () => {
    if (!activeGuildId) {
      setIncidents([]);
      setLoading(false);
      return;
    }
    setError(null);
    const qs = new URLSearchParams({ pageSize: '50', guildId: activeGuildId });
    if (statusFilter !== 'ALL') qs.set('status', statusFilter);
    if (searchQuery.trim()) qs.set('q', searchQuery.trim());
    try {
      const res = await aegisFetch(`/api/incidents?${qs.toString()}`);
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(
          json?.message ||
            (language === 'es'
              ? 'Error al cargar registros de seguridad.'
              : 'Failed to load security incidents.')
        );
        return;
      }
      const list = (json?.incidents || []) as SecurityIncidentRecord[];
      setIncidents(list);
      if (initialIncidentId) {
        const match = list.find((i) => i.id === initialIncidentId);
        if (match) setSelected(match);
      }
    } catch {
      setError(
        language === 'es'
          ? 'Error de red al cargar registros de seguridad.'
          : 'Network error while loading security incidents.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    if (!activeGuildId) {
      Promise.resolve().then(() => {
        if (!cancelled) {
          setIncidents([]);
          setLoading(false);
        }
      });
      return () => {
        cancelled = true;
      };
    }
    const qs = new URLSearchParams({ pageSize: '50', guildId: activeGuildId });
    if (statusFilter !== 'ALL') qs.set('status', statusFilter);
    if (searchQuery.trim()) qs.set('q', searchQuery.trim());

    aegisFetch(`/api/incidents?${qs.toString()}`)
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setError(
            json?.message ||
              (language === 'es'
                ? 'Error al cargar registros de seguridad.'
                : 'Failed to load security incidents.')
          );
          return;
        }
        setError(null);
        const list = (json?.incidents || []) as SecurityIncidentRecord[];
        setIncidents(list);
        if (initialIncidentId) {
          const match = list.find((i) => i.id === initialIncidentId);
          if (match) setSelected(match);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(
            language === 'es'
              ? 'Error de red al cargar registros de seguridad.'
              : 'Network error while loading security incidents.'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [statusFilter, searchQuery, activeGuildId, initialIncidentId, language, syncNonce]);

  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selected]);

  const handleUpdateIncident = async (
    incidentId: string,
    payload: { status?: IncidentStatus; assignedTo?: string | null; comment?: string }
  ) => {
    setSaving(true);
    setError(null);
    try {
      const res = await aegisFetch(`/api/incidents/${incidentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(
          json?.issues?.[0]?.message ||
            json?.message ||
            (language === 'es'
              ? 'No se pudo actualizar el incidente.'
              : 'Failed to update incident.')
        );
        return;
      }
      if (json?.incident) setSelected(json.incident);
      setComment('');
      await loadIncidents();
    } catch {
      setError(
        language === 'es'
          ? 'Error de red al actualizar el incidente.'
          : 'Network error while updating incident.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            {t.navItems.incidents}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">{copy.subtitle}</p>
        </div>
        {activeGuildId && (
          <span className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#0F1422] text-xs font-medium text-slate-600 dark:text-slate-300">
            {copy.activeServer}
          </span>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="p-3.5 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-600 dark:text-red-300"
        >
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {(['ALL', ...STATUSES] as const).map((st) => (
          <button
            key={st}
            type="button"
            onClick={() => setStatusFilter(st)}
            className={`px-3 py-1.5 rounded text-xs font-medium cursor-pointer ${
              statusFilter === st
                ? 'bg-[#5865F2] text-white'
                : 'bg-white dark:bg-[#0F1422] border border-slate-200 dark:border-white/[0.08] text-slate-600 dark:text-slate-400'
            }`}
          >
            {st === 'ALL' ? copy.allLabel : copy.statusLabels[st]}
          </button>
        ))}
      </div>

      <div className="rounded-xl bg-white dark:bg-[#0F1422] border border-slate-200 dark:border-white/[0.08] overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-200 dark:border-white/[0.08] text-[11px] font-mono uppercase tracking-wider text-slate-500">
              <th className="py-3 px-4">ID</th>
              <th className="py-3 px-4">{t.common.server}</th>
              <th className="py-3 px-4">{copy.threatCol}</th>
              <th className="py-3 px-4">{t.common.riskScore}</th>
              <th className="py-3 px-4">{copy.affectedCol}</th>
              <th className="py-3 px-4">{copy.investigatorCol}</th>
              <th className="py-3 px-4">{t.common.status}</th>
              <th className="py-3 px-4">{t.common.actions}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-white/[0.06] text-xs">
            {loading ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-slate-500">
                  {t.common.loading}
                </td>
              </tr>
            ) : incidents.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-slate-500">
                  {t.common.noData}
                </td>
              </tr>
            ) : (
              incidents.map((inc) => (
                <tr key={inc.id} className="hover:bg-slate-50 dark:hover:bg-white/[0.02]">
                  <td className="py-3 px-4 font-mono font-semibold text-[#5865F2] dark:text-[#818CF8]">
                    {inc.id}
                  </td>
                  <td className="py-3 px-4 text-slate-700 dark:text-slate-300">{inc.guildName}</td>
                  <td className="py-3 px-4 font-mono">{inc.threatType}</td>
                  <td className="py-3 px-4 font-mono tabular-nums">
                    {inc.riskScore}/100 ({inc.riskLevel})
                  </td>
                  <td className="py-3 px-4 font-mono">{inc.affectedUsername}</td>
                  <td className="py-3 px-4 font-mono text-slate-500">
                    {inc.assignedTo || copy.unassigned}
                  </td>
                  <td className="py-3 px-4 font-mono font-semibold">
                    {copy.statusLabels[inc.status] ?? inc.status}
                  </td>
                  <td className="py-3 px-4">
                    <button
                      type="button"
                      onClick={() => setSelected(inc)}
                      className="px-2.5 py-1 rounded bg-slate-100 dark:bg-white/[0.06] hover:bg-[#5865F2] hover:text-white text-xs font-medium transition-colors cursor-pointer"
                    >
                      {copy.inspectBtn}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Incident Dossier Drawer/Modal */}
      {selected && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Incident ${selected.id}`}
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelected(null);
          }}
        >
          <div className="max-w-2xl w-full max-h-[90vh] overflow-y-auto rounded-xl bg-white dark:bg-[#0F1422] border border-slate-200 dark:border-white/[0.08] p-6 space-y-5">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 dark:border-white/[0.08] pb-4">
              <div>
                <div className="flex items-center gap-2 text-xs font-mono text-[#5865F2]">
                  <ShieldAlert className="w-4 h-4" />
                  <span>{selected.id}</span>
                </div>
                <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white mt-1">
                  {selected.threatType} — {selected.guildName}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label={copy.closeAria}
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-white/[0.08]">
                <div className="text-slate-500">{copy.dossierScore}</div>
                <div className="font-mono font-bold text-sm mt-0.5">{selected.riskScore}/100</div>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-white/[0.08]">
                <div className="text-slate-500">{copy.dossierUser}</div>
                <div className="font-mono font-semibold truncate mt-0.5">
                  {selected.affectedUsername}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-white/[0.08]">
                <div className="text-slate-500">{copy.dossierAction}</div>
                <div className="font-mono font-semibold mt-0.5">{selected.appliedAction}</div>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-white/[0.08]">
                <div className="text-slate-500">{copy.dossierStatus}</div>
                <div className="font-mono font-semibold mt-0.5">
                  {copy.statusLabels[selected.status] ?? selected.status}
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <h3 className="text-xs font-mono uppercase text-slate-500">{copy.evidenceTitle}</h3>
              <p className="text-xs text-slate-700 dark:text-slate-300 p-3 rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-white/[0.08] leading-relaxed">
                {selected.evidenceSummary}
              </p>
            </div>

            {selected.signals.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-mono uppercase text-slate-500">{copy.signalsTitle}</h3>
                <div className="divide-y divide-slate-100 dark:divide-white/[0.06] border border-slate-200 dark:border-white/[0.08] rounded-lg">
                  {selected.signals.map((sig) => (
                    <div
                      key={sig.signal}
                      className="px-3 py-2 flex items-center justify-between text-xs gap-2"
                    >
                      <div>
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {sig.label}
                        </span>
                        <span className="text-slate-500 ml-2">{sig.evidence}</span>
                      </div>
                      <span className="font-mono tabular-nums text-[#5865F2] shrink-0">
                        +{sig.weightedPoints} pts
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <h3 className="text-xs font-mono uppercase text-slate-500">
                {copy.updateStatusTitle}
              </h3>
              <div className="flex flex-wrap gap-2">
                {STATUSES.map((st) => (
                  <button
                    key={st}
                    type="button"
                    disabled={saving}
                    onClick={() => handleUpdateIncident(selected.id, { status: st })}
                    className={`px-3 py-1.5 rounded text-xs font-medium cursor-pointer ${
                      selected.status === st
                        ? 'bg-[#5865F2] text-white'
                        : 'border border-slate-200 dark:border-white/[0.1] text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {copy.statusLabels[st]}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-mono uppercase text-slate-500">
                {copy.notesTitle} ({selected.comments.length})
              </h3>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {selected.comments.map((c) => (
                  <div
                    key={c.id}
                    className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-white/[0.08] text-xs"
                  >
                    <div className="flex justify-between font-mono text-[11px] text-slate-500">
                      <span>{c.authorName}</span>
                      <span>{new Date(c.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="mt-1 text-slate-800 dark:text-slate-200">{c.content}</p>
                  </div>
                ))}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (comment.trim().length >= 2) {
                    handleUpdateIncident(selected.id, { comment: comment.trim() });
                  }
                }}
                className="flex gap-2"
              >
                <input
                  type="text"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder={copy.notePlaceholder}
                  className="flex-1 px-3 py-2 text-xs rounded-md bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-white/[0.08]"
                />
                <button
                  type="submit"
                  disabled={saving || comment.trim().length < 2}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-[#5865F2] hover:bg-[#4752C4] disabled:opacity-50 text-white text-xs font-semibold cursor-pointer"
                >
                  <MessageSquarePlus className="w-3.5 h-3.5" />
                  <span>{copy.addNoteBtn}</span>
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
