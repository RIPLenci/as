'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  Ban,
  CalendarClock,
  CheckCircle2,
  Clock,
  Crown,
  Eye,
  FileImage,
  Gem,
  Pencil,
  Plus,
  Search,
  ShieldAlert,
  Ticket,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import type {
  GlobalBanRecord,
  LanguageCode,
  PlanTier,
  PremiumCodeRecord,
  UserRecord,
} from '@/lib/aegis/types';
import { isSuperOwner } from '@/lib/aegis/rbac';
import { aegisFetch } from '@/lib/aegis/client-auth';
import {
  formatDurationPrecise,
  formatExactDateTime,
  getPlanDisplayName,
  normalizePlanTier,
} from '@/lib/aegis/premium';

interface AdminPanelViewProps {
  user: UserRecord;
  language: LanguageCode;
  syncNonce?: number;
  onSyncCompleted: () => void;
}

interface AdminSubscriptionRow {
  discordId: string;
  username: string;
  tier: PlanTier;
  reason?: string;
  grantedAt: string | null;
  expiresAt: string | null;
  activatedGuildIds: string[];
  source: string;
  updatedBy: string;
  updatedAt: string;
  active: boolean;
  remainingMs: number;
  remainingHuman: string;
  remainingPrecise: string;
  grantedAtExact: string;
  expiresAtExact: string;
  maxServers: number;
}

type AdminTab = 'premium' | 'globalban';
type PremiumMode = 'ADD' | 'VIEW' | 'EDIT' | 'REMOVE' | 'CODES';
type GlobalBanMode = 'ADD' | 'REMOVE' | 'LIST';

function AuthEvidencePreview({ url, alt }: { url: string; alt: string }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let created: string | null = null;

    aegisFetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load evidence');
        return res.blob();
      })
      .then((blob) => {
        if (!active) return;
        created = URL.createObjectURL(blob);
        setObjectUrl(created);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [url]);

  if (failed) {
    return (
      <div className="w-24 h-20 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-white/[0.04] flex items-center justify-center text-[10px] font-mono text-slate-400">
        Error
      </div>
    );
  }

  if (!objectUrl) {
    return (
      <div className="w-24 h-20 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-white/[0.04] animate-pulse" />
    );
  }

  return (
    <a
      href={objectUrl}
      download={alt}
      title={alt}
      className="block w-24 h-20 rounded-xl overflow-hidden border border-slate-200 dark:border-white/15 bg-black/20 shrink-0 hover:ring-2 hover:ring-[#5865F2] transition"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={objectUrl} alt={alt} className="w-full h-full object-cover" />
    </a>
  );
}

export function AdminPanelView({
  user,
  language,
  syncNonce = 0,
  onSyncCompleted,
}: AdminPanelViewProps) {
  const isEs = language === 'es';
  const [activeTab, setActiveTab] = useState<AdminTab>('premium');
  const [premiumMode, setPremiumMode] = useState<PremiumMode>('ADD');
  const [globalBanMode, setGlobalBanMode] = useState<GlobalBanMode>('ADD');

  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Admin Premium state
  const [subscriptions, setSubscriptions] = useState<AdminSubscriptionRow[]>([]);
  const [codes, setCodes] = useState<PremiumCodeRecord[]>([]);
  const [inspectedSub, setInspectedSub] = useState<AdminSubscriptionRow | null>(null);
  const [lookupSearchedId, setLookupSearchedId] = useState('');
  const [nowTick, setNowTick] = useState<number>(() => Date.now());

  // Premium Add
  const [addDiscordId, setAddDiscordId] = useState('');
  const [addUsername, setAddUsername] = useState('');
  const [addReason, setAddReason] = useState('');
  const [addDuration, setAddDuration] = useState('30d');
  const [addTier, setAddTier] = useState<'ORO' | 'DIAMANTE'>('ORO');

  // Premium View search
  const [viewDiscordId, setViewDiscordId] = useState('');

  // Premium Edit (add extra time)
  const [editDiscordId, setEditDiscordId] = useState('');
  const [editDuration, setEditDuration] = useState('30d');
  const [editTier, setEditTier] = useState<'' | 'ORO' | 'DIAMANTE'>('');
  const [editReason, setEditReason] = useState('');

  // Premium Remove
  const [removeDiscordId, setRemoveDiscordId] = useState('');

  // Premium Codes
  const [codeTier, setCodeTier] = useState<'ORO' | 'DIAMANTE'>('ORO');
  const [codeDuration, setCodeDuration] = useState('30d');
  const [codeMaxUses, setCodeMaxUses] = useState(1);
  const [codeCustom, setCodeCustom] = useState('');

  // Globalban state
  const [globalBans, setGlobalBans] = useState<GlobalBanRecord[]>([]);
  const [gbSearchQuery, setGbSearchQuery] = useState('');
  const [gbDiscordId, setGbDiscordId] = useState('');
  const [gbUsername, setGbUsername] = useState('');
  const [gbReason, setGbReason] = useState('');
  const [gbDurationKind, setGbDurationKind] = useState<'INDEFINITE' | 'PERMANENT'>('PERMANENT');
  const [gbSeverityLevel, setGbSeverityLevel] = useState<'BAJO' | 'MEDIO' | 'ALTO' | 'PELIGRO'>('ALTO');
  const [gbAppealable, setGbAppealable] = useState<'SI' | 'NO'>('SI');
  const [gbEvidenceText, setGbEvidenceText] = useState('');
  const [gbFiles, setGbFiles] = useState<Array<{ file: File; previewUrl: string }>>([]);
  const [gbRemoveId, setGbRemoveId] = useState('');

  // Keep a 1-second live clock while Owner is viewing Admin Panel so remaining time ticks down to exact seconds
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Cleanup preview object URLs on unmount
  useEffect(() => {
    return () => {
      gbFiles.forEach((f) => URL.revokeObjectURL(f.previewUrl));
    };
  }, [gbFiles]);

  const loadAdminData = useCallback(async (lookupId?: string) => {
    setLoading(true);
    try {
      const premUrl = lookupId
        ? `/api/admin/premium?discordId=${encodeURIComponent(lookupId)}`
        : '/api/admin/premium';
      const [pRes, gRes] = await Promise.all([
        aegisFetch(premUrl),
        aegisFetch('/api/admin/globalban'),
      ]);

      if (pRes.ok) {
        const pJson = await pRes.json().catch(() => null);
        if (pJson) {
          setSubscriptions(pJson.subscriptions || []);
          setCodes(pJson.codes || []);
          if (lookupId && pJson.lookup) {
            setLookupSearchedId(lookupId);
            setInspectedSub(pJson.lookup.subscription || null);
          }
        }
      }

      if (gRes.ok) {
        const gJson = await gRes.json().catch(() => null);
        if (gJson) {
          setGlobalBans(gJson.bans || []);
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isSuperOwner(user)) return;
    let cancelled = false;
    Promise.all([aegisFetch('/api/admin/premium'), aegisFetch('/api/admin/globalban')])
      .then(async ([pRes, gRes]) => {
        if (cancelled) return;
        if (pRes.ok) {
          const pJson = await pRes.json().catch(() => null);
          if (!cancelled && pJson) {
            setSubscriptions(pJson.subscriptions || []);
            setCodes(pJson.codes || []);
          }
        }
        if (gRes.ok) {
          const gJson = await gRes.json().catch(() => null);
          if (!cancelled && gJson) {
            setGlobalBans(gJson.bans || []);
          }
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, syncNonce]);

  if (!isSuperOwner(user)) {
    return (
      <div className="rounded-3xl border border-red-500/30 bg-white/85 dark:bg-[#0B0F19]/90 p-8 text-center space-y-2">
        <ShieldAlert className="w-10 h-10 text-red-500 mx-auto" />
        <h2 className="text-lg font-display font-bold text-slate-900 dark:text-white">
          {isEs ? 'Acceso Exclusivo de Owner' : 'Exclusive Owner Access'}
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {isEs
            ? 'Este panel administrativo está restringido únicamente al propietario autorizado del bot.'
            : 'This administrative panel is restricted exclusively to the authorized bot owner.'}
        </p>
      </div>
    );
  }

  const handlePremiumSubmit = async (
    payload: Record<string, unknown>,
    onSuccess?: (json: Record<string, unknown>) => void
  ) => {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await aegisFetch('/api/admin/premium', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setFeedback({
          ok: false,
          text: json?.message || (isEs ? 'Error en la gestión Premium.' : 'Premium error.'),
        });
        return;
      }
      setFeedback({ ok: true, text: json?.message || (isEs ? 'Operación completada.' : 'Completed.') });
      onSuccess?.(json);
      await loadAdminData(lookupSearchedId || undefined);
      onSyncCompleted();
    } finally {
      setBusy(false);
    }
  };

  const handleLookupSub = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = viewDiscordId.trim();
    if (!id) return;
    setFeedback(null);
    setBusy(true);
    try {
      const res = await aegisFetch(`/api/admin/premium?discordId=${encodeURIComponent(id)}`);
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setFeedback({
          ok: false,
          text: json?.message || (isEs ? 'No se pudo consultar el usuario.' : 'Lookup failed.'),
        });
        return;
      }
      setLookupSearchedId(id);
      setInspectedSub(json?.lookup?.subscription || null);
      if (!json?.lookup?.found) {
        setFeedback({
          ok: false,
          text: isEs
            ? `El ID ${id} no tiene ningún plan Premium registrado.`
            : `No Premium record found for ${id}.`,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSelectEvidenceFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const incoming = Array.from(e.target.files || []);
    if (incoming.length === 0) return;

    const remainingSlots = Math.max(0, 5 - gbFiles.length);
    if (incoming.length > remainingSlots) {
      setFeedback({
        ok: false,
        text: isEs
          ? 'Solo puedes cargar un máximo de 5 archivos de evidencia.'
          : 'Maximum 5 evidence files allowed.',
      });
    }

    const accepted = incoming.slice(0, remainingSlots).map((file) => ({
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setGbFiles((prev) => [...prev, ...accepted]);
    e.target.value = '';
  };

  const handleRemoveEvidenceFile = (idx: number) => {
    setGbFiles((prev) => {
      const copy = [...prev];
      const removed = copy.splice(idx, 1)[0];
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return copy;
    });
  };

  const handleCreateGlobalBan = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const form = new FormData();
      form.append('discordId', gbDiscordId.trim());
      if (gbUsername.trim()) form.append('username', gbUsername.trim());
      form.append('reason', gbReason.trim());
      form.append('durationKind', gbDurationKind);
      form.append('severityLevel', gbSeverityLevel);
      form.append('appealable', gbAppealable);
      if (gbEvidenceText.trim()) form.append('evidenceText', gbEvidenceText.trim());
      for (const item of gbFiles) {
        form.append('files', item.file);
      }

      const res = await aegisFetch('/api/admin/globalban', {
        method: 'POST',
        body: form,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setFeedback({
          ok: false,
          text: json?.message || (isEs ? 'No se pudo aplicar el Globalban.' : 'Globalban failed.'),
        });
        return;
      }

      setFeedback({ ok: true, text: json?.message || 'Globalban aplicado.' });
      setGbDiscordId('');
      setGbUsername('');
      setGbReason('');
      setGbEvidenceText('');
      gbFiles.forEach((f) => URL.revokeObjectURL(f.previewUrl));
      setGbFiles([]);
      await loadAdminData();
      onSyncCompleted();
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveGlobalBan = async (discordId: string) => {
    const clean = discordId.trim();
    if (!clean) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await aegisFetch(`/api/admin/globalban?discordId=${encodeURIComponent(clean)}`, {
        method: 'DELETE',
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setFeedback({
          ok: false,
          text: json?.message || (isEs ? 'No se pudo eliminar el Globalban.' : 'Delete failed.'),
        });
        return;
      }
      setFeedback({ ok: true, text: json?.message || 'Globalban eliminado.' });
      if (gbRemoveId.trim() === clean) setGbRemoveId('');
      await loadAdminData();
      onSyncCompleted();
    } finally {
      setBusy(false);
    }
  };

  const renderLiveRemaining = (sub: AdminSubscriptionRow) => {
    if (!sub.expiresAt) return isEs ? 'Inactivo' : 'Inactive';
    const ms = Math.max(0, new Date(sub.expiresAt).getTime() - nowTick);
    if (ms <= 0) return isEs ? 'Expirado (0 días, 0 horas, 0 minutos, 0 segundos)' : 'Expired';
    return formatDurationPrecise(ms, language);
  };

  const filteredGlobalBans = globalBans.filter((b) => {
    const needle = gbSearchQuery.trim().toLowerCase();
    if (!needle) return true;
    return `${b.id} ${b.discordId} ${b.username} ${b.reason} ${b.severityLabel ?? ''}`
      .toLowerCase()
      .includes(needle);
  });

  const severityBadgeClass = (label?: string, sev?: string) => {
    const key = (label || sev || '').toUpperCase();
    if (key === 'PELIGRO' || key === 'CRITICAL') {
      return 'bg-red-500/15 text-red-500 border-red-500/35';
    }
    if (key === 'ALTO' || key === 'HIGH') {
      return 'bg-orange-500/15 text-orange-500 border-orange-500/35';
    }
    if (key === 'MEDIO' || key === 'MODERATE') {
      return 'bg-amber-500/15 text-amber-500 border-amber-500/35';
    }
    return 'bg-emerald-500/15 text-emerald-500 border-emerald-500/35';
  };

  return (
    <div className="space-y-6">
      {/* Owner Exclusive Header */}
      <div className="relative overflow-hidden rounded-3xl border border-amber-500/40 bg-gradient-to-br from-amber-500/12 via-white/95 to-indigo-500/10 dark:from-amber-500/12 dark:via-[#0B0F19] dark:to-indigo-500/15 p-6 sm:p-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-400 text-slate-950 text-[11px] font-mono font-bold tracking-wider uppercase shadow-sm">
                <Crown className="w-3.5 h-3.5" />
                OWNER
              </span>
              <span className="px-2.5 py-1 rounded-full border border-slate-200 dark:border-white/10 text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                ID: {user.discordId}
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-display font-bold text-slate-900 dark:text-white">
              {isEs ? 'Panel Administrativo' : 'Administrative Panel'}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-300 max-w-2xl">
              {isEs
                ? 'Control central exclusivo del Owner para administración de suscripciones Premium (con precisión hasta el segundo) y sanciones Globalban con evidencia multimedia.'
                : 'Exclusive Owner control center for Premium subscription management and Globalban enforcement.'}
            </p>
          </div>

          {/* Main Section Switcher */}
          <div className="inline-flex p-1 rounded-2xl bg-slate-100/90 dark:bg-black/40 border border-slate-200 dark:border-white/10 self-start">
            <button
              type="button"
              onClick={() => {
                setActiveTab('premium');
                setFeedback(null);
              }}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'premium'
                  ? 'bg-[#5865F2] text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Crown className="w-3.5 h-3.5" />
              <span>{isEs ? 'Gestión Premium' : 'Premium Management'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('globalban');
                setFeedback(null);
              }}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'globalban'
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Ban className="w-3.5 h-3.5" />
              <span>{isEs ? 'Sistema Globalban' : 'Globalban System'}</span>
            </button>
          </div>
        </div>
      </div>

      {feedback && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          role="status"
          className={`rounded-2xl px-4 py-3 text-xs font-medium flex items-center gap-2 border ${
            feedback.ok
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
              : 'bg-red-500/10 border-red-500/30 text-red-500'
          }`}
        >
          {feedback.ok ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <XCircle className="w-4 h-4 shrink-0" />
          )}
          <span>{feedback.text}</span>
        </motion.div>
      )}

      {/* ===================================================================== */}
      {/* TAB 1: GESTIÓN PREMIUM (AÑADIR / VER / EDITAR / ELIMINAR / CÓDIGOS)   */}
      {/* ===================================================================== */}
      {activeTab === 'premium' && (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-2">
            {(
              [
                { id: 'ADD', label: isEs ? 'Añadir' : 'Add', icon: Plus },
                { id: 'VIEW', label: isEs ? 'Ver' : 'View', icon: Eye },
                { id: 'EDIT', label: isEs ? 'Editar' : 'Edit', icon: Pencil },
                { id: 'REMOVE', label: isEs ? 'Eliminar' : 'Remove', icon: Trash2 },
                { id: 'CODES', label: isEs ? 'Códigos Canjeables' : 'Codes', icon: Ticket },
              ] as const
            ).map((m) => {
              const Icon = m.icon;
              const active = premiumMode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setPremiumMode(m.id);
                    setFeedback(null);
                  }}
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                    active
                      ? 'border-[#5865F2] bg-[#5865F2]/15 text-[#5865F2] dark:text-white'
                      : 'border-slate-200 dark:border-white/10 bg-white/80 dark:bg-[#0B0F19]/90 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-white/20'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{m.label}</span>
                </button>
              );
            })}
          </div>

          {/* MODE: AÑADIR */}
          {premiumMode === 'ADD' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handlePremiumSubmit(
                  {
                    action: 'ADD',
                    discordId: addDiscordId.trim(),
                    username: addUsername.trim() || undefined,
                    reason: addReason.trim(),
                    duration: addDuration.trim(),
                    tier: addTier,
                  },
                  (json) => {
                    if (json.subscription) {
                      setInspectedSub(json.subscription as AdminSubscriptionRow);
                    }
                    setAddDiscordId('');
                    setAddUsername('');
                    setAddReason('');
                  }
                );
              }}
              className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white/90 dark:bg-[#0B0F19]/90 p-6 space-y-5"
            >
              <div>
                <h2 className="text-base font-display font-bold text-slate-900 dark:text-white">
                  {isEs ? 'Añadir Plan Premium a Usuario' : 'Grant Premium Plan'}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {isEs
                    ? 'Soporta unidades combinadas o simples: 1s (segundo), 1m (minuto), 1h (hora), 1d (día) y 1y (año).'
                    : 'Supports combined or single duration units: 1s, 1m, 1h, 1d, 1y.'}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <label className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
                  <span>{isEs ? 'ID de Discord *' : 'Discord ID *'}</span>
                  <input
                    type="text"
                    required
                    value={addDiscordId}
                    onChange={(e) => setAddDiscordId(e.target.value)}
                    placeholder="1052422681569525792"
                    className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-3 py-2 text-xs font-mono text-slate-900 dark:text-white"
                  />
                </label>

                <label className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
                  <span>{isEs ? 'Plan *' : 'Plan *'}</span>
                  <select
                    value={addTier}
                    onChange={(e) => setAddTier(e.target.value as 'ORO' | 'DIAMANTE')}
                    className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-3 py-2 text-xs text-slate-900 dark:text-white"
                  >
                    <option value="ORO">Plan Oro (1 servidor · 5,99 USD)</option>
                    <option value="DIAMANTE">Plan Diamante (5 servidores · 9,99 USD)</option>
                  </select>
                </label>

                <label className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
                  <span>{isEs ? 'Tiempo (1s, 1m, 1h, 1d, 1y) *' : 'Duration *'}</span>
                  <input
                    type="text"
                    required
                    value={addDuration}
                    onChange={(e) => setAddDuration(e.target.value)}
                    placeholder="30d / 1y"
                    className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-3 py-2 text-xs font-mono text-slate-900 dark:text-white"
                  />
                </label>

                <label className="text-xs text-slate-600 dark:text-slate-300 space-y-1 md:col-span-2">
                  <span>{isEs ? 'Razón de asignación *' : 'Reason *'}</span>
                  <input
                    type="text"
                    required
                    value={addReason}
                    onChange={(e) => setAddReason(e.target.value)}
                    placeholder={isEs ? 'Ej: Compra confirmada / Sorteo oficial / Partner' : 'Reason'}
                    className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-3 py-2 text-xs text-slate-900 dark:text-white"
                  />
                </label>

                <label className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
                  <span>{isEs ? 'Nombre de usuario (opcional)' : 'Username (optional)'}</span>
                  <input
                    type="text"
                    value={addUsername}
                    onChange={(e) => setAddUsername(e.target.value)}
                    placeholder="usuario_discord"
                    className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-3 py-2 text-xs text-slate-900 dark:text-white"
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  {(['30s', '15m', '1h', '1d', '7d', '30d', '1y'] as const).map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setAddDuration(preset)}
                      className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-white/10 font-mono text-slate-700 dark:text-slate-300 cursor-pointer hover:bg-[#5865F2]/20"
                    >
                      +{preset}
                    </button>
                  ))}
                </div>

                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" />
                  <span>{isEs ? 'Añadir Premium' : 'Add Premium'}</span>
                </button>
              </div>
            </form>
          )}

          {/* MODE: VER (CON DETALLE EXACTO DÍA, HORAS, MINUTOS Y SEGUNDOS) */}
          {premiumMode === 'VIEW' && (
            <div className="space-y-5">
              <form
                onSubmit={handleLookupSub}
                className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white/90 dark:bg-[#0B0F19]/90 p-5 flex flex-col sm:flex-row gap-3 items-stretch sm:items-end"
              >
                <label className="flex-1 text-xs text-slate-600 dark:text-slate-300 space-y-1">
                  <span>{isEs ? 'Consultar usuario por ID de Discord' : 'Inspect user by Discord ID'}</span>
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
                    <input
                      type="text"
                      required
                      value={viewDiscordId}
                      onChange={(e) => setViewDiscordId(e.target.value)}
                      placeholder="1052422681569525792"
                      className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 pl-9 pr-3 py-2 text-xs font-mono text-slate-900 dark:text-white"
                    />
                  </div>
                </label>
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  <Eye className="w-4 h-4" />
                  <span>{isEs ? 'Ver Detalle Exacto' : 'Inspect'}</span>
                </button>
              </form>

              {inspectedSub && (
                <div className="rounded-2xl border border-[#5865F2]/40 bg-white/95 dark:bg-[#0E1424] p-6 space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        {inspectedSub.tier === 'DIAMANTE' ? (
                          <Gem className="w-5 h-5 text-sky-400" />
                        ) : (
                          <Crown className="w-5 h-5 text-amber-400" />
                        )}
                        <h3 className="text-lg font-display font-bold text-slate-900 dark:text-white">
                          {inspectedSub.username}
                        </h3>
                        <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-white/10 text-[11px] font-mono text-slate-500 dark:text-slate-300">
                          {inspectedSub.discordId}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {getPlanDisplayName(normalizePlanTier(inspectedSub.tier), language)} ·{' '}
                        {inspectedSub.active
                          ? isEs
                            ? 'Suscripción Activa'
                            : 'Active'
                          : isEs
                          ? 'Inactivo / Expirado'
                          : 'Inactive'}
                      </p>
                    </div>

                    <div className="px-3.5 py-2 rounded-xl bg-amber-500/12 border border-amber-500/30 text-xs font-mono text-amber-600 dark:text-amber-300 tabular-nums">
                      <Clock className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
                      {renderLiveRemaining(inspectedSub)}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
                    <div className="rounded-xl bg-slate-50 dark:bg-black/30 border border-slate-200/80 dark:border-white/[0.06] p-3.5 space-y-1">
                      <div className="text-[11px] font-mono uppercase text-slate-400">
                        {isEs ? 'Cuándo se le activó' : 'Activated at'}
                      </div>
                      <div className="font-mono font-semibold text-slate-900 dark:text-white tabular-nums">
                        {inspectedSub.grantedAtExact}
                      </div>
                    </div>

                    <div className="rounded-xl bg-slate-50 dark:bg-black/30 border border-slate-200/80 dark:border-white/[0.06] p-3.5 space-y-1">
                      <div className="text-[11px] font-mono uppercase text-slate-400">
                        {isEs ? 'Cuándo va a vencer' : 'Expires at'}
                      </div>
                      <div className="font-mono font-semibold text-amber-600 dark:text-amber-300 tabular-nums">
                        {inspectedSub.expiresAtExact}
                      </div>
                    </div>

                    <div className="rounded-xl bg-slate-50 dark:bg-black/30 border border-slate-200/80 dark:border-white/[0.06] p-3.5 space-y-1">
                      <div className="text-[11px] font-mono uppercase text-slate-400">
                        {isEs ? 'Quién se lo activó' : 'Activated by'}
                      </div>
                      <div className="font-semibold text-slate-900 dark:text-white truncate">
                        {inspectedSub.updatedBy || inspectedSub.source}
                      </div>
                    </div>

                    <div className="rounded-xl bg-slate-50 dark:bg-black/30 border border-slate-200/80 dark:border-white/[0.06] p-3.5 space-y-1 md:col-span-2">
                      <div className="text-[11px] font-mono uppercase text-slate-400">
                        {isEs ? 'Razón registrada' : 'Reason'}
                      </div>
                      <div className="text-slate-800 dark:text-slate-200">
                        {inspectedSub.reason || (isEs ? 'Sin razón especificada' : 'No reason provided')}
                      </div>
                    </div>

                    <div className="rounded-xl bg-slate-50 dark:bg-black/30 border border-slate-200/80 dark:border-white/[0.06] p-3.5 space-y-1">
                      <div className="text-[11px] font-mono uppercase text-slate-400">
                        {isEs ? 'Servidores con Premium' : 'Assigned Servers'}
                      </div>
                      <div className="font-mono font-semibold text-slate-900 dark:text-white tabular-nums">
                        {inspectedSub.activatedGuildIds.length} / {inspectedSub.maxServers}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Subscriptions Quick Selector List */}
              <div className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white/90 dark:bg-[#0B0F19]/90 p-5 space-y-3">
                <div className="text-xs font-semibold text-slate-900 dark:text-white">
                  {isEs ? 'Todas las suscripciones registradas' : 'All registered subscriptions'} (
                  {subscriptions.length})
                </div>
                {loading ? (
                  <p className="text-xs text-slate-400">{isEs ? 'Cargando...' : 'Loading...'}</p>
                ) : subscriptions.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    {isEs ? 'No hay usuarios con suscripción registrada.' : 'No subscriptions yet.'}
                  </p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {subscriptions.map((s) => (
                      <button
                        key={s.discordId}
                        type="button"
                        onClick={() => {
                          setViewDiscordId(s.discordId);
                          setLookupSearchedId(s.discordId);
                          setInspectedSub(s);
                        }}
                        className="text-left rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-black/30 p-3.5 hover:border-[#5865F2] transition cursor-pointer space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                            {s.username} ({s.discordId})
                          </span>
                          <span
                            className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                              s.active
                                ? 'bg-emerald-500/15 text-emerald-500'
                                : 'bg-slate-200 dark:bg-white/10 text-slate-500'
                            }`}
                          >
                            {getPlanDisplayName(normalizePlanTier(s.tier), language)}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                          {renderLiveRemaining(s)}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* MODE: EDITAR (AÑADIR MÁS TIEMPO) */}
          {premiumMode === 'EDIT' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handlePremiumSubmit(
                  {
                    action: 'EDIT_ADD_TIME',
                    discordId: editDiscordId.trim(),
                    duration: editDuration.trim(),
                    tier: editTier || undefined,
                    reason: editReason.trim() || undefined,
                  },
                  (json) => {
                    if (json.subscription) {
                      setInspectedSub(json.subscription as AdminSubscriptionRow);
                    }
                  }
                );
              }}
              className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white/90 dark:bg-[#0B0F19]/90 p-6 space-y-5"
            >
              <div>
                <h2 className="text-base font-display font-bold text-slate-900 dark:text-white">
                  {isEs ? 'Editar Premium (Añadir más tiempo)' : 'Edit Premium (Extend Time)'}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {isEs
                    ? 'Suma tiempo adicional a un usuario existente (1s, 1m, 1h, 1d, 1y).'
                    : 'Add extra duration onto an existing subscription.'}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
                  <span>{isEs ? 'ID de Discord *' : 'Discord ID *'}</span>
                  <input
                    type="text"
                    required
                    value={editDiscordId}
                    onChange={(e) => setEditDiscordId(e.target.value)}
                    placeholder="1052422681569525792"
                    className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-3 py-2 text-xs font-mono text-slate-900 dark:text-white"
                  />
                </label>

                <label className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
                  <span>{isEs ? 'Tiempo a añadir (1s, 1m, 1h, 1d, 1y) *' : 'Time to add *'}</span>
                  <input
                    type="text"
                    required
                    value={editDuration}
                    onChange={(e) => setEditDuration(e.target.value)}
                    placeholder="7d / 1y"
                    className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-3 py-2 text-xs font-mono text-slate-900 dark:text-white"
                  />
                </label>

                <label className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
                  <span>{isEs ? 'Plan (opcional)' : 'Plan (optional)'}</span>
                  <select
                    value={editTier}
                    onChange={(e) => setEditTier(e.target.value as '' | 'ORO' | 'DIAMANTE')}
                    className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-3 py-2 text-xs text-slate-900 dark:text-white"
                  >
                    <option value="">{isEs ? 'Mantener plan actual' : 'Keep current tier'}</option>
                    <option value="ORO">Plan Oro (1 servidor)</option>
                    <option value="DIAMANTE">Plan Diamante (5 servidores)</option>
                  </select>
                </label>

                <label className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
                  <span>{isEs ? 'Nueva razón / nota (opcional)' : 'Updated reason (optional)'}</span>
                  <input
                    type="text"
                    value={editReason}
                    onChange={(e) => setEditReason(e.target.value)}
                    placeholder={isEs ? 'Renovación o compensación' : 'Renewal'}
                    className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-3 py-2 text-xs text-slate-900 dark:text-white"
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  {(['1m', '1h', '1d', '7d', '30d', '1y'] as const).map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setEditDuration(preset)}
                      className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-white/10 font-mono text-slate-700 dark:text-slate-300 cursor-pointer hover:bg-[#5865F2]/20"
                    >
                      +{preset}
                    </button>
                  ))}
                </div>

                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  <CalendarClock className="w-4 h-4" />
                  <span>{isEs ? 'Añadir Tiempo' : 'Add Time'}</span>
                </button>
              </div>
            </form>
          )}

          {/* MODE: ELIMINAR */}
          {premiumMode === 'REMOVE' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handlePremiumSubmit({
                  action: 'REMOVE',
                  discordId: removeDiscordId.trim(),
                }, () => {
                  setRemoveDiscordId('');
                });
              }}
              className="rounded-2xl border border-red-500/30 bg-white/90 dark:bg-[#0B0F19]/90 p-6 space-y-4"
            >
              <div>
                <h2 className="text-base font-display font-bold text-slate-900 dark:text-white">
                  {isEs ? 'Eliminar Plan Premium por ID' : 'Remove Premium Plan'}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {isEs
                    ? 'Revoca inmediatamente el plan Premium del usuario y devuelve todos sus servidores al Plan Gratuito.'
                    : 'Immediately revokes the user plan and downgrades assigned servers.'}
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end">
                <label className="flex-1 text-xs text-slate-600 dark:text-slate-300 space-y-1">
                  <span>{isEs ? 'ID de Discord a remover *' : 'Discord ID *'}</span>
                  <input
                    type="text"
                    required
                    value={removeDiscordId}
                    onChange={(e) => setRemoveDiscordId(e.target.value)}
                    placeholder="1052422681569525792"
                    className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-3 py-2 text-xs font-mono text-slate-900 dark:text-white"
                  />
                </label>

                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>{isEs ? 'Remover Plan Premium' : 'Remove Plan'}</span>
                </button>
              </div>
            </form>
          )}

          {/* MODE: CÓDIGOS CANJEABLES */}
          {premiumMode === 'CODES' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handlePremiumSubmit(
                    {
                      action: 'CREATE_CODE',
                      tier: codeTier,
                      duration: codeDuration.trim(),
                      maxUses: codeMaxUses,
                      customCode: codeCustom.trim() || undefined,
                    },
                    () => setCodeCustom('')
                  );
                }}
                className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white/90 dark:bg-[#0B0F19]/90 p-5 space-y-4"
              >
                <div className="text-sm font-semibold text-slate-900 dark:text-white">
                  {isEs ? 'Generar Código Canjeable' : 'Generate Redeemable Code'}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <select
                    value={codeTier}
                    onChange={(e) => setCodeTier(e.target.value as 'ORO' | 'DIAMANTE')}
                    className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-3 py-2 text-xs text-slate-900 dark:text-white"
                  >
                    <option value="ORO">Plan Oro (5,99 USD)</option>
                    <option value="DIAMANTE">Plan Diamante (9,99 USD)</option>
                  </select>
                  <input
                    type="text"
                    required
                    value={codeDuration}
                    onChange={(e) => setCodeDuration(e.target.value)}
                    placeholder="30d / 1y"
                    className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-3 py-2 text-xs font-mono text-slate-900 dark:text-white"
                  />
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={codeMaxUses}
                    onChange={(e) => setCodeMaxUses(Math.max(1, Number(e.target.value) || 1))}
                    className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-3 py-2 text-xs font-mono text-slate-900 dark:text-white"
                  />
                  <input
                    type="text"
                    value={codeCustom}
                    onChange={(e) => setCodeCustom(e.target.value)}
                    placeholder={isEs ? 'Código personalizado (opcional)' : 'Custom code (optional)'}
                    className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-3 py-2 text-xs font-mono uppercase text-slate-900 dark:text-white"
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  <Ticket className="w-4 h-4" />
                  <span>{isEs ? 'Crear Código Premium' : 'Create Code'}</span>
                </button>
              </form>

              <div className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white/90 dark:bg-[#0B0F19]/90 p-5 space-y-3">
                <div className="text-sm font-semibold text-slate-900 dark:text-white">
                  {isEs ? 'Códigos Generados' : 'Generated Codes'} ({codes.length})
                </div>
                <div className="max-h-64 overflow-y-auto space-y-2">
                  {codes.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      {isEs ? 'No hay códigos generados todavía.' : 'No codes generated yet.'}
                    </p>
                  ) : (
                    codes.map((cd) => (
                      <div
                        key={cd.code}
                        className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 dark:bg-black/30 px-3 py-2 border border-slate-200/80 dark:border-white/[0.06]"
                      >
                        <div className="min-w-0">
                          <div className="font-mono font-bold text-xs text-slate-900 dark:text-white">
                            {cd.code}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {getPlanDisplayName(cd.tier, language)} · {cd.durationLabel} ·{' '}
                            {cd.usedCount}/{cd.maxUses} {isEs ? 'usos' : 'uses'}
                            {cd.revoked ? ' · REVOCADO' : ''}
                          </div>
                        </div>
                        {!cd.revoked && (
                          <button
                            type="button"
                            onClick={() =>
                              void handlePremiumSubmit({ action: 'REVOKE_CODE', code: cd.code })
                            }
                            className="text-red-500 hover:underline text-[11px] font-semibold cursor-pointer shrink-0"
                          >
                            {isEs ? 'Revocar' : 'Revoke'}
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 2: SISTEMA GLOBALBAN (AÑADIR CON FOTOS / ELIMINAR / HISTORIAL)    */}
      {/* ===================================================================== */}
      {activeTab === 'globalban' && (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-2">
            {(
              [
                { id: 'ADD', label: isEs ? 'Añadir Globalban' : 'Add Globalban', icon: Ban },
                { id: 'REMOVE', label: isEs ? 'Eliminar Globalban' : 'Remove Globalban', icon: Trash2 },
                {
                  id: 'LIST',
                  label: `${isEs ? 'Lista Globalban' : 'Globalban List'} (${globalBans.filter((b) => b.status === 'ACTIVE').length})`,
                  icon: ShieldAlert,
                },
              ] as const
            ).map((m) => {
              const Icon = m.icon;
              const active = globalBanMode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setGlobalBanMode(m.id);
                    setFeedback(null);
                  }}
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                    active
                      ? 'border-red-500 bg-red-500/15 text-red-500 dark:text-red-300'
                      : 'border-slate-200 dark:border-white/10 bg-white/80 dark:bg-[#0B0F19]/90 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-white/20'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{m.label}</span>
                </button>
              );
            })}
          </div>

          {globalBanMode === 'ADD' && (
            <form
              onSubmit={handleCreateGlobalBan}
              className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white/90 dark:bg-[#0B0F19]/90 p-6 space-y-5"
            >
              <div>
                <h2 className="text-base font-display font-bold text-slate-900 dark:text-white">
                  {isEs ? 'Añadir Usuario a Globalban' : 'Add User to Globalban'}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {isEs
                    ? 'Cuando este usuario entre a cualquier servidor protegido, el bot enviará un mensaje privado (MD) con toda la sanción y las fotos de evidencia al usuario, lo baneará inmediatamente y notificará por MD al dueño del servidor.'
                    : 'On joining any protected guild, the bot DMs full details + evidence photos to the user, bans them immediately, and notifies the server owner by DM.'}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <label className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
                  <span>{isEs ? 'ID de Discord *' : 'Discord ID *'}</span>
                  <input
                    type="text"
                    required
                    value={gbDiscordId}
                    onChange={(e) => setGbDiscordId(e.target.value)}
                    placeholder="123456789012345678"
                    className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-3 py-2 text-xs font-mono text-slate-900 dark:text-white"
                  />
                </label>

                <label className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
                  <span>{isEs ? 'Tiempo *' : 'Duration *'}</span>
                  <select
                    value={gbDurationKind}
                    onChange={(e) => setGbDurationKind(e.target.value as 'INDEFINITE' | 'PERMANENT')}
                    className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-3 py-2 text-xs text-slate-900 dark:text-white"
                  >
                    <option value="INDEFINITE">Indefinido</option>
                    <option value="PERMANENT">Permanente</option>
                  </select>
                </label>

                <label className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
                  <span>{isEs ? 'Gravedad *' : 'Severity *'}</span>
                  <select
                    value={gbSeverityLevel}
                    onChange={(e) =>
                      setGbSeverityLevel(e.target.value as 'BAJO' | 'MEDIO' | 'ALTO' | 'PELIGRO')
                    }
                    className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-3 py-2 text-xs text-slate-900 dark:text-white"
                  >
                    <option value="BAJO">Bajo</option>
                    <option value="MEDIO">Medio</option>
                    <option value="ALTO">Alto</option>
                    <option value="PELIGRO">Peligro</option>
                  </select>
                </label>

                <label className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
                  <span>{isEs ? 'Apelable *' : 'Appealable *'}</span>
                  <select
                    value={gbAppealable}
                    onChange={(e) => setGbAppealable(e.target.value as 'SI' | 'NO')}
                    className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-3 py-2 text-xs text-slate-900 dark:text-white"
                  >
                    <option value="SI">Sí</option>
                    <option value="NO">No</option>
                  </select>
                </label>

                <label className="text-xs text-slate-600 dark:text-slate-300 space-y-1 md:col-span-2">
                  <span>{isEs ? 'Motivo del Globalban *' : 'Reason *'}</span>
                  <input
                    type="text"
                    required
                    value={gbReason}
                    onChange={(e) => setGbReason(e.target.value)}
                    placeholder={isEs ? 'Ej: Ataque raid coordinado con bots y nuking' : 'Reason'}
                    className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-3 py-2 text-xs text-slate-900 dark:text-white"
                  />
                </label>

                <label className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
                  <span>{isEs ? 'Usuario (opcional)' : 'Username (optional)'}</span>
                  <input
                    type="text"
                    value={gbUsername}
                    onChange={(e) => setGbUsername(e.target.value)}
                    placeholder="raider_user"
                    className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-3 py-2 text-xs text-slate-900 dark:text-white"
                  />
                </label>

                <label className="text-xs text-slate-600 dark:text-slate-300 space-y-1 md:col-span-2">
                  <span>{isEs ? 'Nota adicional de evidencia (opcional)' : 'Evidence note (optional)'}</span>
                  <input
                    type="text"
                    value={gbEvidenceText}
                    onChange={(e) => setGbEvidenceText(e.target.value)}
                    placeholder={isEs ? 'Contexto o enlaces adicionales de respaldo' : 'Optional note'}
                    className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-3 py-2 text-xs text-slate-900 dark:text-white"
                  />
                </label>
              </div>

              {/* Evidence Upload (up to 5 photos) */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <FileImage className="w-4 h-4 text-[#5865F2]" />
                    {isEs ? 'Evidencia fotográfica (máximo 5 archivos)' : 'Photo evidence (max 5 files)'}
                  </span>
                  <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                    {gbFiles.length} / 5 {isEs ? 'fotos' : 'photos'}
                  </span>
                </div>

                <label className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 dark:border-white/15 bg-slate-50/70 dark:bg-black/25 p-5 cursor-pointer hover:border-[#5865F2] transition">
                  <Upload className="w-5 h-5 text-[#5865F2]" />
                  <span className="text-xs text-slate-600 dark:text-slate-300 font-medium">
                    {gbFiles.length >= 5
                      ? isEs
                        ? 'Límite máximo de 5 fotos alcanzado'
                        : 'Maximum 5 photos reached'
                      : isEs
                      ? 'Haz clic para cargar imágenes (PNG, JPG, WEBP, GIF — máx. 8 MB c/u)'
                      : 'Click to upload photos (PNG, JPG, WEBP, GIF)'}
                  </span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    multiple
                    disabled={gbFiles.length >= 5}
                    onChange={handleSelectEvidenceFiles}
                    className="sr-only"
                  />
                </label>

                {gbFiles.length > 0 && (
                  <div className="flex flex-wrap gap-3">
                    {gbFiles.map((item, idx) => (
                      <div
                        key={`${item.file.name}-${idx}`}
                        className="relative w-24 h-24 rounded-xl overflow-hidden border border-slate-200 dark:border-white/15 bg-black/20"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={item.previewUrl}
                          alt={item.file.name}
                          className="w-full h-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveEvidenceFile(idx)}
                          aria-label={`${isEs ? 'Quitar foto' : 'Remove photo'} ${item.file.name}`}
                          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/75 text-white flex items-center justify-center cursor-pointer hover:bg-red-600"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  <Ban className="w-4 h-4" />
                  <span>{isEs ? 'Aplicar Globalban' : 'Apply Globalban'}</span>
                </button>
              </div>
            </form>
          )}

          {globalBanMode === 'REMOVE' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleRemoveGlobalBan(gbRemoveId);
              }}
              className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white/90 dark:bg-[#0B0F19]/90 p-6 space-y-4"
            >
              <div>
                <h2 className="text-base font-display font-bold text-slate-900 dark:text-white">
                  {isEs ? 'Eliminar Globalban por ID' : 'Remove Globalban by ID'}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {isEs
                    ? 'Ingresa únicamente el Discord ID para levantar el Globalban activo de inmediato.'
                    : 'Enter the Discord ID only to revoke the active Globalban.'}
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end">
                <label className="flex-1 text-xs text-slate-600 dark:text-slate-300 space-y-1">
                  <span>{isEs ? 'ID de Discord *' : 'Discord ID *'}</span>
                  <input
                    type="text"
                    required
                    value={gbRemoveId}
                    onChange={(e) => setGbRemoveId(e.target.value)}
                    placeholder="123456789012345678"
                    className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 px-3 py-2 text-xs font-mono text-slate-900 dark:text-white"
                  />
                </label>

                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-red-600 dark:hover:bg-red-500 dark:hover:text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>{isEs ? 'Eliminar Globalban' : 'Delete Globalban'}</span>
                </button>
              </div>
            </form>
          )}

          {globalBanMode === 'LIST' && (
            <div className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white/90 dark:bg-[#0B0F19]/90 p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="text-sm font-semibold text-slate-900 dark:text-white">
                  {isEs ? 'Historial de Globalban' : 'Globalban History'} ({filteredGlobalBans.length})
                </div>
                <div className="relative w-full sm:w-72">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
                  <input
                    type="search"
                    value={gbSearchQuery}
                    onChange={(e) => setGbSearchQuery(e.target.value)}
                    placeholder={isEs ? 'Buscar ID, usuario o motivo...' : 'Search ID, reason...'}
                    className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 pl-9 pr-3 py-2 text-xs text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              {filteredGlobalBans.length === 0 ? (
                <p className="text-xs text-slate-500 py-4 text-center">
                  {isEs ? 'No hay registros Globalban que coincidan.' : 'No Globalban records found.'}
                </p>
              ) : (
                <div className="space-y-3">
                  {filteredGlobalBans.map((ban) => (
                    <div
                      key={ban.id}
                      className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-black/30 p-4 space-y-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs font-bold text-slate-900 dark:text-white">
                              {ban.id}
                            </span>
                            <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                              {ban.username}
                            </span>
                            <span className="font-mono text-[11px] text-slate-400">
                              ({ban.discordId})
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded border text-[10px] font-mono font-bold ${severityBadgeClass(
                                ban.severityLabel,
                                ban.severity
                              )}`}
                            >
                              {ban.severityLabel || ban.severity}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-slate-200/80 dark:bg-white/10 text-[10px] font-mono text-slate-700 dark:text-slate-200">
                              {ban.durationKind === 'INDEFINITE' ? 'Indefinido' : 'Permanente'}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-slate-200/80 dark:bg-white/10 text-[10px] font-mono text-slate-700 dark:text-slate-200">
                              {isEs ? 'Apelable:' : 'Appealable:'}{' '}
                              {ban.appealable === false ? 'No' : 'Sí'}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                                ban.status === 'ACTIVE'
                                  ? 'bg-red-600 text-white'
                                  : 'bg-slate-500/20 text-slate-400'
                              }`}
                            >
                              {ban.status === 'ACTIVE' ? 'ACTIVO' : ban.status}
                            </span>
                          </div>
                          <p className="text-xs text-slate-700 dark:text-slate-200">{ban.reason}</p>
                          <div className="text-[11px] font-mono text-slate-400">
                            {formatExactDateTime(ban.createdAt, language)} · {ban.moderatorName}
                          </div>
                        </div>

                        {ban.status === 'ACTIVE' && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleRemoveGlobalBan(ban.discordId)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/40 text-red-500 hover:bg-red-500/10 text-xs font-semibold cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>{isEs ? 'Eliminar' : 'Remove'}</span>
                          </button>
                        )}
                      </div>

                      {ban.evidenceFiles && ban.evidenceFiles.length > 0 && (
                        <div className="flex flex-wrap gap-2.5 pt-2 border-t border-slate-200/70 dark:border-white/[0.06]">
                          {ban.evidenceFiles.map((file) => (
                            <AuthEvidencePreview
                              key={file.id}
                              url={file.url}
                              alt={file.filename}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
