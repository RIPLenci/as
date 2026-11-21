'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowDown,
  Bot,
  Cpu,
  Database,
  ExternalLink,
  Globe,
  KeyRound,
  Lock,
  Network,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Zap,
} from 'lucide-react';
import type { LanguageCode, SystemHealthSnapshot } from '@/lib/aegis/types';
import { getDict } from '@/lib/aegis/i18n';
import { aegisFetch, exchangeOAuthCodeForSession } from '@/lib/aegis/client-auth';
import { AegisLogoMark, DiscordBrandMark } from './BrandLogo';
import { HeroArchitectureVisual } from './HeroArchitectureVisual';
import { InteractiveSpotlightCard, RevealBlock } from './MotionPrimitives';

interface LoginScreenProps {
  language: LanguageCode;
  onLanguageChange: (lang: LanguageCode) => void;
  oauthConfigured: boolean;
  expectedCallbackUrl: string;
  systemHealth: SystemHealthSnapshot | null;
  apiLatencyMs: number | null;
  onAuthenticated: () => void;
}

type ArchitectureTab = 'risk' | 'antinuke' | 'lockdown' | 'bot';

export function LoginScreen({
  language,
  onLanguageChange,
  oauthConfigured,
  expectedCallbackUrl,
  systemHealth,
  apiLatencyMs,
  onAuthenticated,
}: LoginScreenProps) {
  const t = getDict(language);
  const isEs = language === 'es';
  const [loadingOAuth, setLoadingOAuth] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [blockedPopupUrl, setBlockedPopupUrl] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ArchitectureTab>('risk');
  const popupRef = useRef<Window | null>(null);
  const authCompletedRef = useRef(false);

  const finalizeSuccess = useCallback(
    async (exchangeCode?: string | null) => {
      if (authCompletedRef.current) return;
      authCompletedRef.current = true;
      setBlockedPopupUrl(null);
      setErrorMsg(null);
      if (exchangeCode) {
        const res = await exchangeOAuthCodeForSession(exchangeCode);
        if (!res.ok) {
          authCompletedRef.current = false;
          setLoadingOAuth(false);
          setErrorMsg(
            res.message ||
              (isEs
                ? 'No se pudo completar el intercambio de sesión OAuth2.'
                : 'Could not complete OAuth2 session exchange.')
          );
          return;
        }
      }
      setLoadingOAuth(false);
      onAuthenticated();
    },
    [onAuthenticated, isEs]
  );

  useEffect(() => {
    const handlePayload = (data: {
      type?: string;
      message?: string;
      exchangeCode?: string | null;
    }) => {
      if (!data || typeof data !== 'object') return;
      if (data.type === 'OAUTH_AUTH_SUCCESS') {
        void finalizeSuccess(data.exchangeCode);
      } else if (data.type === 'OAUTH_AUTH_ERROR') {
        authCompletedRef.current = false;
        setLoadingOAuth(false);
        setErrorMsg(
          data.message ||
            (isEs
              ? 'Error durante la verificación OAuth2 con Discord.'
              : 'Discord OAuth2 verification failed.')
        );
      }
    };

    const onWindowMessage = (event: MessageEvent) => {
      const origin = event.origin || '';
      const isSameOrigin = typeof window !== 'undefined' && origin === window.location.origin;
      if (
        !isSameOrigin &&
        !origin.endsWith('.run.app') &&
        !origin.endsWith('.ai.studio') &&
        !origin.includes('localhost') &&
        !origin.includes('127.0.0.1')
      ) {
        return;
      }
      handlePayload(event.data || {});
    };

    window.addEventListener('message', onWindowMessage);

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        channel = new BroadcastChannel('aegis_oauth_channel');
        channel.onmessage = (ev) => handlePayload(ev.data || {});
      } catch {
        channel = null;
      }
    }

    return () => {
      window.removeEventListener('message', onWindowMessage);
      if (channel) channel.close();
    };
  }, [finalizeSuccess, isEs]);

  // Monitor popup lifecycle so manually closing the popup resets loading state cleanly
  useEffect(() => {
    if (!loadingOAuth) return;
    const timer = setInterval(() => {
      const popup = popupRef.current;
      if (popup && popup.closed && !authCompletedRef.current) {
        setTimeout(() => {
          if (!authCompletedRef.current) {
            setLoadingOAuth(false);
            popupRef.current = null;
          }
        }, 700);
        clearInterval(timer);
      }
    }, 350);
    return () => clearInterval(timer);
  }, [loadingOAuth]);

  const handleDiscordLogin = async () => {
    setErrorMsg(null);
    setBlockedPopupUrl(null);
    authCompletedRef.current = false;
    setLoadingOAuth(true);

    // Open blank popup synchronously inside the user click gesture so Safari/Firefox/Chrome
    // popup blockers do not block window.open after an async fetch round-trip.
    const popup = window.open(
      'about:blank',
      'aegis_discord_oauth',
      'width=540,height=740,menubar=no,toolbar=no,location=yes'
    );
    popupRef.current = popup;

    if (popup) {
      try {
        popup.document.write(`<!DOCTYPE html><html><head><title>AEGIS SECURITY — Discord OAuth2</title><style>body{margin:0;background:#07090F;color:#E2E8F0;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh}div{text-align:center;font-size:13px;color:#94A3B8}strong{display:block;color:#fff;font-size:15px;margin-bottom:6px}</style></head><body><div><strong>AEGIS SECURITY</strong>${
          isEs ? 'Conectando con Discord OAuth2...' : 'Connecting to Discord OAuth2...'
        }</div></body></html>`);
        popup.document.close();
      } catch {
        // Cross-origin guard if window reused
      }
    }

    try {
      const originParam = encodeURIComponent(window.location.origin);
      const res = await aegisFetch(`/api/auth/discord?origin=${originParam}`, {
        method: 'POST',
      });
      const data = (await res.json()) as {
        url?: string;
        message?: string;
        expectedCallbackUrl?: string;
      };

      if (!res.ok || !data.url) {
        if (popup && !popup.closed) popup.close();
        popupRef.current = null;
        setLoadingOAuth(false);
        const cb = data.expectedCallbackUrl || expectedCallbackUrl;
        setErrorMsg(
          data.message ||
            (isEs
              ? `Configura DISCORD_CLIENT_ID y DISCORD_CLIENT_SECRET en el entorno. Callback URI esperada: ${cb}`
              : `Discord OAuth2 requires DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET. Expected Callback URI: ${cb}`)
        );
        return;
      }

      if (popup && !popup.closed) {
        try {
          popup.location.href = data.url;
        } catch {
          setLoadingOAuth(false);
          setBlockedPopupUrl(data.url);
          setErrorMsg(
            isEs
              ? 'El navegador restringió la redirección de la ventana emergente. Usa el enlace directo inferior.'
              : 'Browser restricted popup navigation. Use the direct link below to continue with Discord.'
          );
        }
      } else {
        setLoadingOAuth(false);
        setBlockedPopupUrl(data.url);
        setErrorMsg(
          isEs
            ? 'El navegador bloqueó la ventana emergente de Discord. Usa el enlace directo inferior o habilita las ventanas emergentes.'
            : 'Browser blocked the Discord popup window. Use the direct link below or allow popups for this site.'
        );
      }
    } catch {
      if (popup && !popup.closed) popup.close();
      popupRef.current = null;
      setLoadingOAuth(false);
      setErrorMsg(
        isEs
          ? 'Error de red comunicándose con /api/auth/discord.'
          : 'Network error communicating with authentication endpoint.'
      );
    }
  };

  const architectureTabs: Array<{
    id: ArchitectureTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'risk', label: isEs ? 'Motor Risk 0–100' : 'Risk Engine 0–100', icon: Cpu },
    { id: 'antinuke', label: isEs ? 'Guardia Anti-Nuke' : 'Anti-Nuke Audit Guard', icon: ShieldAlert },
    { id: 'lockdown', label: isEs ? 'Lockdown Snapshot' : 'Snapshot Lockdown', icon: Lock },
    { id: 'bot', label: 'Components V2 Bot', icon: Bot },
  ];

  const slashCommands = [
    {
      cmd: '/antiraid activar',
      desc: isEs
        ? 'Activa escudo Anti-Raid instantáneo en memoria L1 y sincroniza vía Redis.'
        : 'Enables live L1 memory Anti-Raid shield with Redis sync.',
    },
    {
      cmd: '/antiraid modo',
      desc: isEs
        ? 'Cambia entre Normal, Estricto y Emergencia sin reiniciar.'
        : 'Switches Normal, Strict, and Emergency postures live.',
    },
    {
      cmd: '/antiraid probar',
      desc: isEs
        ? 'Evalúa umbrales y señales explicables bajo demanda.'
        : 'Evaluates Risk Engine thresholds and signal breakdown.',
    },
    {
      cmd: '/antinuke estado',
      desc: isEs
        ? 'Inspecciona contadores de auditoría e IDs autorizados.'
        : 'Inspects audit-log limits and authorized admin IDs.',
    },
    {
      cmd: '/bloqueo activar',
      desc: isEs
        ? 'Congela permisos tras guardar instantánea reversible.'
        : 'Captures permission snapshot before locking channels.',
    },
    {
      cmd: '/premium ver',
      desc: isEs
        ? 'Consulta tu plan (Gratuito, Oro o Diamante), tiempo acumulado y servidores activos.'
        : 'Inspect your plan tier (Free, Gold, or Diamond), duration, and server slots.',
    },
  ];

  return (
    <div className="min-h-screen bg-[#07090F] text-slate-100 flex flex-col relative overflow-x-hidden">
      {/* Subtle architectural grid background */}
      <div
        className="pointer-events-none fixed inset-0 aegis-grid-canvas opacity-80"
        aria-hidden="true"
      />
      {/* Ambient top radial light */}
      <motion.div
        animate={{ opacity: [0.65, 0.95, 0.65], scale: [0.98, 1.03, 0.98] }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        className="pointer-events-none fixed -top-40 left-1/2 -translate-x-1/2 w-[960px] h-[460px] rounded-full bg-radial from-[#5865F2]/20 via-indigo-700/10 to-transparent blur-3xl"
        aria-hidden="true"
      />

      {/* 3-Zone Sticky Navigation Header */}
      <header className="sticky top-0 z-40 h-16 border-b border-white/[0.08] bg-[#07090F]/85 backdrop-blur-md">
        <div className="max-w-7xl mx-auto h-full px-3 sm:px-8 flex items-center justify-between gap-2 sm:gap-6">
          <a href="#" className="flex items-center gap-2 sm:gap-3 shrink-0">
            <AegisLogoMark className="w-7 h-7 sm:w-8 sm:h-8 text-white shrink-0" />
            <span className="font-display font-bold tracking-tight text-sm sm:text-base text-white whitespace-nowrap">
              {t.brandName}
            </span>
          </a>

          <nav
            aria-label={isEs ? 'Navegación principal' : 'Primary navigation'}
            className="hidden md:flex items-center gap-7 text-xs font-medium text-slate-300"
          >
            <a href="#consola" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              {isEs ? 'Consola' : 'Console'}
            </a>
            <a href="#capacidades" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              {isEs ? 'Arquitectura' : 'Architecture'}
            </a>
            <a href="#comandos" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              {isEs ? 'Comandos Bot' : 'Bot Commands'}
            </a>
          </nav>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <div className="flex items-center bg-[#0D111A] border border-white/[0.09] rounded-lg p-0.5">
              <Globe className="w-3.5 h-3.5 text-slate-400 ml-1.5 mr-1 hidden sm:block" aria-hidden="true" />
              <button
                type="button"
                onClick={() => onLanguageChange('es')}
                className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer ${
                  language === 'es' ? 'bg-[#5865F2] text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                ES
              </button>
              <button
                type="button"
                onClick={() => onLanguageChange('en')}
                className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer ${
                  language === 'en' ? 'bg-[#5865F2] text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                EN
              </button>
            </div>

            <motion.button
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleDiscordLogin}
              disabled={loadingOAuth}
              className="inline-flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg bg-[#5865F2] hover:bg-[#4752C4] disabled:opacity-60 text-white font-semibold text-xs transition-colors cursor-pointer whitespace-nowrap shrink-0 shadow-[0_0_24px_rgba(88,101,242,0.35)]"
            >
              <DiscordBrandMark className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline">
                {loadingOAuth ? t.common.loading : t.login.continueDiscord}
              </span>
              <span className="sm:hidden">
                {loadingOAuth ? '...' : isEs ? 'Discord' : 'Sign In'}
              </span>
            </motion.button>
          </div>
        </div>
      </header>

      <main className="relative z-10 flex-1">
        {/* HERO SECTION */}
        <section className="max-w-7xl mx-auto px-4 sm:px-8 pt-10 pb-16 lg:pt-18 lg:pb-22">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
              className="lg:col-span-6 space-y-6"
            >
              {/* Crisp rectangular technical callout frame */}
              <motion.div
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.35, delay: 0.06, ease: [0.16, 1, 0.3, 1] }}
                className="inline-flex items-center gap-2.5 px-3.5 py-1.5 border border-indigo-400/25 bg-[#0D111A]/90 rounded-md text-xs font-mono text-indigo-300"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span>Authorization Code + PKCE · Zero-Trust Discord Operations</span>
              </motion.div>

              <h1 className="font-display text-4xl sm:text-5xl lg:text-[54px] font-bold tracking-tight text-white leading-[1.06] text-balance">
                {isEs
                  ? 'Protección Anti-Raid y Defensa Avanzada para Discord.'
                  : 'Anti-Raid & Advanced Defense for Discord.'}
              </h1>

              <p className="text-base sm:text-lg text-slate-300/90 leading-relaxed max-w-xl">
                {t.login.description}
              </p>

              {/* Action Group */}
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleDiscordLogin}
                  disabled={loadingOAuth}
                  className="inline-flex items-center justify-center gap-3 px-6 py-3.5 rounded-lg bg-[#5865F2] hover:bg-[#4752C4] disabled:opacity-60 text-white font-semibold text-sm transition-colors cursor-pointer shadow-[0_10px_30px_rgba(88,101,242,0.35)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
                >
                  <DiscordBrandMark className="w-5 h-5" />
                  <span className="whitespace-nowrap">
                    {loadingOAuth ? t.common.loading : t.login.continueDiscord}
                  </span>
                </motion.button>

                <motion.a
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.98 }}
                  href="#consola"
                  className="inline-flex items-center gap-2 px-5 py-3.5 rounded-lg border border-white/[0.12] bg-[#0D111A]/80 hover:bg-[#141B2D] text-slate-200 font-medium text-sm transition-colors whitespace-nowrap"
                >
                  <span>{isEs ? 'Explorar Arquitectura' : 'Inspect Architecture'}</span>
                  <ArrowDown className="w-4 h-4 text-slate-400" />
                </motion.a>
              </div>

              <AnimatePresence>
                {errorMsg && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.2 }}
                    role="alert"
                    className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/35 text-amber-200 text-xs space-y-2.5"
                  >
                    <div className="flex items-center gap-2 font-semibold text-amber-300">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>
                        {isEs
                          ? 'Diagnóstico de Verificación Discord OAuth2'
                          : 'Discord OAuth2 Verification Notice'}
                      </span>
                    </div>
                    <p className="leading-relaxed text-amber-100/90 break-words">{errorMsg}</p>
                    {blockedPopupUrl && (
                      <a
                        href={blockedPopupUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#5865F2] hover:bg-[#4752C4] text-white font-semibold"
                      >
                        <span>
                          {isEs ? 'Abrir Discord OAuth2 en nueva pestaña' : 'Open Discord OAuth2 in new tab'}
                        </span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Real OAuth2 & Security Architecture Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <div className="p-4 rounded-xl bg-[#0D111A]/85 border border-white/[0.08] space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-semibold text-white">
                    <KeyRound className="w-4 h-4 text-indigo-400 shrink-0" />
                    <span>{t.login.linkingNoteTitle}</span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">{t.login.linkingNote}</p>
                </div>
                <div className="p-4 rounded-xl bg-[#0D111A]/85 border border-white/[0.08] space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-semibold text-white">
                    <Lock className="w-4 h-4 text-indigo-400 shrink-0" />
                    <span>{t.login.securityNoticeTitle}</span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">{t.login.securityNotice}</p>
                </div>
              </div>

              {/* Real Client-Measured & Server Health Metadata Strip */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-1 text-[11px] font-mono text-slate-400 tabular-nums">
                <span>
                  API:{' '}
                  <strong className="text-emerald-400">
                    {systemHealth?.api ?? 'CHECKING'}
                  </strong>
                  {apiLatencyMs !== null ? ` (${apiLatencyMs} ms)` : ''}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  OAuth2:{' '}
                  <strong className={oauthConfigured ? 'text-emerald-400' : 'text-amber-400'}>
                    {oauthConfigured ? 'CONFIGURED' : 'UNCONFIGURED'}
                  </strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Bot:{' '}
                  <strong
                    className={
                      systemHealth?.bot === 'ONLINE' ? 'text-emerald-400' : 'text-slate-300'
                    }
                  >
                    {systemHealth?.bot ?? 'CHECKING'}
                  </strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Store:{' '}
                  <strong className="text-slate-200">
                    {systemHealth?.mongodb === 'CONNECTED' ? 'MongoDB L3' : 'Local L1'}
                  </strong>
                </span>
              </div>
            </motion.div>

            {/* Right Column: Interactive Animated Discord Node Composition */}
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.48, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
              className="lg:col-span-6"
            >
              <HeroArchitectureVisual
                language={language}
                systemHealth={systemHealth}
                oauthConfigured={oauthConfigured}
                apiLatencyMs={apiLatencyMs}
              />
            </motion.div>
          </div>
        </section>

        {/* SECTION 2: INTERACTIVE CONSOLE ARCHITECTURE FRAME */}
        <section id="consola" className="max-w-7xl mx-auto px-4 sm:px-8 pb-20">
          <RevealBlock>
            <div className="rounded-2xl border border-white/[0.1] bg-[#0B0F1A] shadow-[0_30px_80px_rgba(0,0,0,0.65)] overflow-hidden">
              {/* Console Window Header */}
              <div className="px-4 sm:px-6 py-3.5 border-b border-white/[0.08] bg-[#0D121E] flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <AegisLogoMark className="w-5 h-5 text-indigo-400" />
                  <span className="font-mono text-xs font-semibold text-slate-200">
                    AEGIS SECURITY ENGINE · MODULE ARCHITECTURE
                  </span>
                </div>
                <div
                  className="flex flex-wrap items-center gap-1.5"
                  role="tablist"
                  aria-label="Security architecture modules"
                >
                  {architectureTabs.map((tab) => {
                    const Icon = tab.icon;
                    const active = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => setActiveTab(tab.id)}
                        className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                          active ? 'text-white' : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {active && (
                          <motion.span
                            layoutId="aegis-console-tab-bg"
                            transition={{ type: 'spring', stiffness: 360, damping: 28 }}
                            className="absolute inset-0 rounded-lg bg-[#5865F2]"
                            aria-hidden="true"
                          />
                        )}
                        <Icon className="w-3.5 h-3.5 shrink-0 relative z-10" />
                        <span className="relative z-10">{tab.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Interactive Module Body (Pure Real Specification — Zero Fabricated Metrics) */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="p-6 sm:p-8 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start"
                >
                  <div className="lg:col-span-5 space-y-4">
                    {activeTab === 'risk' && (
                      <>
                        <div className="font-mono text-xs text-indigo-400">
                          01 · EXPLAINABLE SCORING ENGINE
                        </div>
                        <h2 className="font-display text-2xl font-bold text-white">
                          {isEs ? 'Evaluación Multi-Señal de 0 a 100' : 'Multi-Signal 0–100 Risk Scoring'}
                        </h2>
                        <p className="text-sm text-slate-400 leading-relaxed">
                          {isEs
                            ? 'Cada ingreso al servidor es evaluado por 5 vectores ponderados. Si una cuenta nueva ingresa sin ráfaga ni señales coordinadas, el safeguard incorporado impide expulsiones o bloqueos automáticos.'
                            : 'Every guild join is evaluated across 5 weighted vectors. When a newly created account joins without a concurrent burst or coordinated pattern, built-in safeguards block destructive auto-actions.'}
                        </p>
                      </>
                    )}
                    {activeTab === 'antinuke' && (
                      <>
                        <div className="font-mono text-xs text-indigo-400">
                          02 · DISCORD AUDIT LOG ENFORCEMENT
                        </div>
                        <h2 className="font-display text-2xl font-bold text-white">
                          {isEs ? 'Defensa Anti-Nuke por Auditoría' : 'Audit-Verified Anti-Nuke Shield'}
                        </h2>
                        <p className="text-sm text-slate-400 leading-relaxed">
                          {isEs
                            ? 'Correlaciona eliminaciones masivas de canales, alteración de roles, webhooks maliciosos y baneos masivos verificando el ejecutor real en el Registro de Auditoría de Discord antes de intervenir.'
                            : 'Correlates bulk channel deletions, role mutations, webhook abuse, and mass bans directly against Discord GuildAuditLog before stripping dangerous permissions or locking down.'}
                        </p>
                      </>
                    )}
                    {activeTab === 'lockdown' && (
                      <>
                        <div className="font-mono text-xs text-indigo-400">
                          03 · REVERSIBLE PERMISSION SNAPSHOTS
                        </div>
                        <h2 className="font-display text-2xl font-bold text-white">
                          {isEs ? 'Lockdown con Restauración Precisa' : 'Snapshot-Backed Channel Lockdown'}
                        </h2>
                        <p className="text-sm text-slate-400 leading-relaxed">
                          {isEs
                            ? 'Antes de restringir canales durante un ataque, AEGIS guarda los sobrescritos originales por canal. Al desactivar, revierte únicamente lo aplicado por AEGIS respetando cambios manuales del equipo.'
                            : 'Prior to locking channels during an attack, AEGIS snapshots original per-channel overwrites. Restoring reverts only AEGIS-managed deny flags and preserves manual staff edits.'}
                        </p>
                      </>
                    )}
                    {activeTab === 'bot' && (
                      <>
                        <div className="font-mono text-xs text-indigo-400">
                          04 · DISCORD.JS V14 COMPONENTS V2
                        </div>
                        <h2 className="font-display text-2xl font-bold text-white">
                          {isEs
                            ? 'Bot y Dashboard Sincronizados en Tiempo Real'
                            : 'Synchronized Bot & Real-Time Console'}
                        </h2>
                        <p className="text-sm text-slate-400 leading-relaxed">
                          {isEs
                            ? 'Ejecuta cambios desde la consola web o directamente en Discord con comandos slash y paneles interactivos Components V2 invalidando la caché L1 al instante vía Redis Pub/Sub.'
                            : 'Apply policy updates from the web console or Discord slash commands built on Components V2, invalidating L1 caches across shards in real time via Redis Pub/Sub.'}
                        </p>
                      </>
                    )}

                    <div className="pt-2">
                      <motion.button
                        type="button"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={handleDiscordLogin}
                        disabled={loadingOAuth}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-semibold cursor-pointer"
                      >
                        <DiscordBrandMark className="w-4 h-4" />
                        <span>{isEs ? 'Autenticarse para Administrar' : 'Sign In to Configure'}</span>
                      </motion.button>
                    </div>
                  </div>

                  {/* Right architectural blueprint schema inside the console frame */}
                  <div className="lg:col-span-7 rounded-xl bg-[#07090F] border border-white/[0.08] p-5 space-y-4">
                    {activeTab === 'risk' && (
                      <div className="space-y-3 font-mono text-xs">
                        <div className="flex items-center justify-between text-slate-400 pb-2 border-b border-white/[0.07]">
                          <span>{isEs ? 'VECTOR DE SEÑAL' : 'SIGNAL VECTOR'}</span>
                          <span>{isEs ? 'PESO EN EL MOTOR' : 'DEFAULT ENGINE WEIGHT'}</span>
                        </div>
                        {[
                          {
                            name: isEs
                              ? 'Volumen de eventos / Ráfaga en ventana deslizante'
                              : 'Event Volume / Sliding Window Burst',
                            weight: 30,
                          },
                          {
                            name: isEs
                              ? 'Similitud de patrones en ingresos'
                              : 'Join Pattern Similarity Cluster',
                            weight: 25,
                          },
                          {
                            name: isEs
                              ? 'Coincidencia de cuentas maliciosas verificadas'
                              : 'Verified Threat History Match',
                            weight: 30,
                          },
                          {
                            name: isEs
                              ? 'Heurística de antigüedad de cuenta (protegida)'
                              : 'Account Age Heuristic (Safeguarded)',
                            weight: 15,
                          },
                          {
                            name: isEs
                              ? 'Ciclos repetitivos de entrada y salida'
                              : 'Repetitive Leave / Rejoin Cycling',
                            weight: 15,
                          },
                        ].map((row, idx) => (
                          <div
                            key={row.name}
                            className="py-2 border-b border-white/[0.05] last:border-b-0 space-y-1.5"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-slate-200">{row.name}</span>
                              <span className="text-indigo-400 tabular-nums shrink-0">
                                {isEs ? `Peso · ${row.weight}` : `Weight · ${row.weight}`}
                              </span>
                            </div>
                            <div className="h-1 w-full rounded bg-white/[0.06] overflow-hidden">
                              <motion.div
                                initial={{ scaleX: 0 }}
                                animate={{ scaleX: row.weight / 30 }}
                                transition={{
                                  duration: 0.45,
                                  delay: idx * 0.05,
                                  ease: [0.16, 1, 0.3, 1],
                                }}
                                style={{ transformOrigin: 'left' }}
                                className="h-full bg-gradient-to-r from-[#5865F2] to-indigo-400"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {activeTab === 'antinuke' && (
                      <div className="space-y-3 font-mono text-xs">
                        <div className="flex items-center justify-between text-slate-400 pb-2 border-b border-white/[0.07]">
                          <span>{isEs ? 'EVENTO AUDITADO' : 'AUDIT MONITORED EVENT'}</span>
                          <span>{isEs ? 'CONTENCIÓN AUTOMÁTICA' : 'AUTOMATED CONTAINMENT'}</span>
                        </div>
                        {[
                          {
                            ev: isEs ? 'Auditoría: Eliminación de canales' : 'GuildAuditLog: ChannelDelete',
                            act: isEs ? 'Remover roles peligrosos + Lockdown' : 'Strip Dangerous Roles + Lockdown',
                          },
                          {
                            ev: isEs ? 'Auditoría: Cambio de rol (Admin)' : 'GuildAuditLog: RoleUpdate (Admin)',
                            act: isEs ? 'Revocar permisos escalados' : 'Revoke Escalated Permission Bits',
                          },
                          {
                            ev: isEs ? 'Auditoría: Creación de Webhook' : 'GuildAuditLog: WebhookCreate',
                            act: isEs ? 'Eliminar hooks no autorizados + Alerta' : 'Delete Unauthorized Hooks + Alert',
                          },
                          {
                            ev: isEs ? 'Auditoría: Baneos masivos' : 'GuildAuditLog: MemberBanAdd',
                            act: isEs ? 'Cuarentena al ejecutor comprometido' : 'Quarantine Compromised Executor',
                          },
                        ].map((row) => (
                          <div
                            key={row.ev}
                            className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 py-2 border-b border-white/[0.05] last:border-b-0"
                          >
                            <span className="text-slate-200">{row.ev}</span>
                            <span className="text-indigo-400">{row.act}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {activeTab === 'lockdown' && (
                      <div className="space-y-3 font-mono text-xs">
                        <div className="flex items-center justify-between text-slate-400 pb-2 border-b border-white/[0.07]">
                          <span>{isEs ? 'FASE DE EJECUCIÓN' : 'EXECUTION PHASE'}</span>
                          <span>{isEs ? 'GARANTÍA DE RESTAURACIÓN' : 'OVERWRITE GUARANTEE'}</span>
                        </div>
                        {[
                          {
                            phase: isEs ? '1. Instantánea Pre-Lockdown' : '1. Snapshot Pre-Lockdown',
                            detail: isEs
                              ? 'Lee los permisos actuales de @everyone vía Discord REST'
                              : 'Reads live @everyone channel permission_overwrites via Discord REST',
                          },
                          {
                            phase: isEs ? '2. Restricciones Selectivas' : '2. Apply Selective Deny Flags',
                            detail: 'SEND_MESSAGES, ADD_REACTIONS, THREADS, CONNECT',
                          },
                          {
                            phase: isEs ? '3. Respeto a Cambios Manuales' : '3. Track External Staff Edits',
                            detail: isEs
                              ? 'Conserva los ajustes manuales realizados por el equipo durante el incidente'
                              : 'Preserves manual overrides made during incident',
                          },
                          {
                            phase: isEs ? '4. Restauración No Destructiva' : '4. Non-Destructive Restore',
                            detail: isEs
                              ? 'Revierte únicamente las restricciones aplicadas por AEGIS'
                              : 'Removes only AEGIS-applied lockdown restrictions',
                          },
                        ].map((row) => (
                          <div
                            key={row.phase}
                            className="py-2 border-b border-white/[0.05] last:border-b-0 space-y-0.5"
                          >
                            <div className="text-slate-200 font-semibold">{row.phase}</div>
                            <div className="text-slate-400">{row.detail}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {activeTab === 'bot' && (
                      <div className="space-y-3 font-mono text-xs">
                        <div className="flex items-center justify-between text-slate-400 pb-2 border-b border-white/[0.07]">
                          <span>{isEs ? 'INTENTS DEL GATEWAY' : 'PRIVILEGED & STANDARD INTENTS'}</span>
                          <span>{isEs ? 'ALCANCE DE PRIVACIDAD' : 'PRIVACY SCOPE'}</span>
                        </div>
                        {[
                          {
                            intent: 'GatewayIntentBits.Guilds',
                            scope: isEs ? 'Requerido · Estado del servidor' : 'Required · Server state',
                          },
                          {
                            intent: 'GatewayIntentBits.GuildMembers',
                            scope: isEs ? 'Privilegiado · Análisis de ingresos' : 'Privileged · Join Analysis',
                          },
                          {
                            intent: 'GatewayIntentBits.GuildModeration',
                            scope: isEs ? 'Auditoría y sincronización' : 'Audit Logs & Ban Sync',
                          },
                          {
                            intent: 'GatewayIntentBits.GuildWebhooks',
                            scope: isEs ? 'Guardia Anti-Nuke de Webhooks' : 'Anti-Nuke Hook Guard',
                          },
                          {
                            intent: 'MessageContent Intent',
                            scope: isEs ? 'Aislado · Solo filtros configurados' : 'Scoped · Configured filters only',
                          },
                        ].map((row) => (
                          <div
                            key={row.intent}
                            className="flex items-center justify-between py-2 border-b border-white/[0.05] last:border-b-0"
                          >
                            <span className="text-slate-200">{row.intent}</span>
                            <span className="text-emerald-400">{row.scope}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
          </RevealBlock>
        </section>

        {/* SECTION 3: ASYMMETRIC BENTO ARCHITECTURE CAPABILITIES */}
        <section id="capacidades" className="max-w-7xl mx-auto px-4 sm:px-8 pb-20 space-y-8">
          <RevealBlock>
            <div className="max-w-2xl space-y-2">
              <div className="font-mono text-xs text-indigo-400">
                {isEs ? 'ARQUITECTURA DE DEFENSA EN CAPAS' : 'LAYERED SECURITY ARCHITECTURE'}
              </div>
              <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-white text-balance">
                {isEs
                  ? 'Diseñado para responder sin bloquear comunidades legítimas.'
                  : 'Engineered to isolate raids without disrupting legitimate members.'}
              </h2>
            </div>
          </RevealBlock>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <InteractiveSpotlightCard
              delay={0.03}
              className="lg:col-span-7 p-6 rounded-2xl bg-[#0D111A] border border-white/[0.08] hover:border-indigo-500/40"
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-xl bg-[#13192B] border border-white/[0.08] flex items-center justify-center">
                    <Zap className="w-5 h-5 text-indigo-400" />
                  </div>
                  <span className="font-mono text-xs text-slate-500">01</span>
                </div>
                <h3 className="font-display text-xl font-semibold text-white">
                  {isEs ? 'Caché Híbrida L1/L2/L3 y Ventana Deslizante' : 'Hybrid L1 / L2 / L3 Cache & Sliding Windows'}
                </h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  {isEs
                    ? 'Las evaluaciones en caliente consultan caché acotada L1 en memoria, contadores atómicos en Redis L2 y persistencia en MongoDB Atlas L3, con modo degradado seguro si Redis no está disponible.'
                    : 'Hot-path evaluations hit bounded in-memory L1 caches, Redis L2 sliding-window counters, and MongoDB Atlas L3 persistence—with safe local fallback if Redis disconnects.'}
                </p>
              </div>
            </InteractiveSpotlightCard>

            <InteractiveSpotlightCard
              delay={0.07}
              className="lg:col-span-5 p-6 rounded-2xl bg-[#0D111A] border border-white/[0.08] hover:border-indigo-500/40"
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-xl bg-[#13192B] border border-white/[0.08] flex items-center justify-center">
                    <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  </div>
                  <span className="font-mono text-xs text-slate-500">02</span>
                </div>
                <h3 className="font-display text-xl font-semibold text-white">
                  {isEs ? 'RBAC Zero-Trust y Anti-IDOR' : 'Zero-Trust RBAC & Anti-IDOR'}
                </h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  {isEs
                    ? 'Cada mutación valida la membresía y permisos reales de Discord en el backend antes de ejecutar cambios sobre servidores, cuarentenas o sanciones.'
                    : 'Every API mutation verifies server-side guild authorization and Discord ManageGuild/Owner roles before touching configs, quarantines, or lockdowns.'}
                </p>
              </div>
            </InteractiveSpotlightCard>

            <InteractiveSpotlightCard
              delay={0.11}
              className="lg:col-span-5 p-6 rounded-2xl bg-[#0D111A] border border-white/[0.08] hover:border-indigo-500/40"
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-xl bg-[#13192B] border border-white/[0.08] flex items-center justify-center">
                    <Network className="w-5 h-5 text-indigo-400" />
                  </div>
                  <span className="font-mono text-xs text-slate-500">03</span>
                </div>
                <h3 className="font-display text-xl font-semibold text-white">
                  {isEs ? 'Aislamiento Total por Servidor' : 'Strict Per-Server Isolation'}
                </h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  {isEs
                    ? 'Cada comunidad conserva reglas, copias de seguridad, listas blancas, permisos del bot y cuotas totalmente aisladas sin afectar otros servidores.'
                    : 'Every community maintains independent policies, backups, whitelists, internal permissions, and plan quotas with strict isolation.'}
                </p>
              </div>
            </InteractiveSpotlightCard>

            <InteractiveSpotlightCard
              delay={0.15}
              className="lg:col-span-7 p-6 rounded-2xl bg-[#0D111A] border border-white/[0.08] hover:border-indigo-500/40"
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-xl bg-[#13192B] border border-white/[0.08] flex items-center justify-center">
                    <Database className="w-5 h-5 text-blue-400" />
                  </div>
                  <span className="font-mono text-xs text-slate-500">04</span>
                </div>
                <h3 className="font-display text-xl font-semibold text-white">
                  {isEs ? 'Auditoría Inmutable y Streaming SSE' : 'Immutable Audit Ledger & SSE Telemetry'}
                </h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  {isEs
                    ? 'Cada incidente, apelación, liberación de cuarentena y ajuste de política queda firmado en el historial de auditoría y transmitido en vivo vía Server-Sent Events.'
                    : 'Every incident triage update, appeal decision, quarantine release, and policy change writes an immutable audit entry broadcast in real time over SSE.'}
                </p>
              </div>
            </InteractiveSpotlightCard>
          </div>
        </section>

        {/* SECTION 4: SLASH COMMANDS */}
        <section id="comandos" className="max-w-7xl mx-auto px-4 sm:px-8 pb-20">
          <RevealBlock delay={0.04}>
            <div className="h-full p-6 sm:p-8 rounded-2xl bg-[#0D111A] border border-white/[0.08] space-y-5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-[#13192B] border border-white/[0.08] flex items-center justify-center">
                  <Terminal className="w-4 h-4 text-indigo-400" />
                </div>
                <div>
                  <h2 className="font-display text-lg font-bold text-white">
                    {isEs
                      ? 'Comandos Slash en Discord (Components V2)'
                      : 'Discord Slash Commands (Components V2)'}
                  </h2>
                  <p className="text-xs text-slate-400">
                    {isEs
                      ? 'Operación directa en Discord sin dependencias locales.'
                      : 'Direct Discord command execution synchronized with web policies.'}
                  </p>
                </div>
              </div>

              <div className="divide-y divide-white/[0.06]">
                {slashCommands.map((item) => (
                  <div
                    key={item.cmd}
                    className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs hover:bg-white/[0.02] px-2 -mx-2 rounded-lg transition-colors"
                  >
                    <code className="font-mono font-semibold text-indigo-300 bg-[#07090F] px-2.5 py-1 rounded border border-white/[0.08] w-fit">
                      {item.cmd}
                    </code>
                    <span className="text-slate-400">{item.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </RevealBlock>
        </section>
      </main>

      {/* Quiet Footer */}
      <footer className="relative z-10 border-t border-white/[0.08] bg-[#07090F]/90">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <div className="flex items-center gap-2.5 text-slate-300 font-medium">
            <AegisLogoMark className="w-5 h-5 text-indigo-400" />
            <span>
              {isEs
                ? 'AEGIS SECURITY — Seguridad Anti-Raid y Protección por Servidor'
                : 'AEGIS SECURITY — Discord Anti-Raid & Per-Server Defense'}
            </span>
          </div>
          <span className="font-mono text-slate-500">
            Authorization Code + PKCE · Zero-Trust Session
          </span>
        </div>
      </footer>
    </div>
  );
}
