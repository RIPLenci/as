'use client';

import React, { useEffect } from 'react';
import Image from 'next/image';
import { motion } from 'motion/react';
import { ArrowRight, ShieldCheck, User as UserIcon } from 'lucide-react';
import type { LanguageCode, UserRecord } from '@/lib/aegis/types';
import { getDict } from '@/lib/aegis/i18n';
import { AegisLogoMark } from './BrandLogo';

interface WelcomeTransitionProps {
  user: UserRecord;
  language: LanguageCode;
  onComplete: () => void;
}

export function WelcomeTransition({ user, language, onComplete }: WelcomeTransitionProps) {
  const t = getDict(language);
  const isEs = language === 'es';

  useEffect(() => {
    const timer = setTimeout(onComplete, 1250);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div className="min-h-screen bg-[#F5F7FA] dark:bg-[#06080F] text-slate-900 dark:text-slate-100 flex items-center justify-center px-4 relative overflow-hidden">
      <div className="pointer-events-none fixed inset-0 aegis-grid-canvas opacity-70" aria-hidden="true" />

      <motion.div
        animate={{ opacity: [0.3, 0.55, 0.3], scale: [0.96, 1.03, 0.96] }}
        transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
        className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 w-[680px] h-[420px] rounded-full bg-radial from-[#5865F2]/22 via-sky-500/10 to-transparent blur-3xl"
        aria-hidden="true"
      />
      <motion.div
        animate={{ opacity: [0.16, 0.3, 0.16] }}
        transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut' }}
        className="pointer-events-none absolute -bottom-24 right-1/4 w-[420px] h-[300px] rounded-full bg-radial from-emerald-500/14 via-indigo-500/6 to-transparent blur-3xl"
        aria-hidden="true"
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 14, filter: 'blur(6px)' }}
        animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ duration: 0.48, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 max-w-md w-full bg-white/90 dark:bg-[#0B0F19]/90 border border-slate-200 dark:border-white/[0.12] rounded-3xl p-8 sm:p-10 text-center space-y-6 shadow-2xl backdrop-blur-2xl"
      >
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, delay: 0.06 }}
          className="flex items-center justify-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300"
        >
          <AegisLogoMark className="w-6 h-6 text-[#5865F2] dark:text-white" />
          <span className="font-display font-bold tracking-tight text-slate-900 dark:text-white">
            {t.brandName}
          </span>
        </motion.div>

        <div className="flex justify-center relative">
          <motion.div
            initial={{ scale: 0.84, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 220, damping: 20, delay: 0.12 }}
            className="relative p-1 rounded-full bg-gradient-to-tr from-[#5865F2] via-sky-400/75 to-emerald-400/75 shadow-lg shadow-indigo-500/25"
          >
            {user.avatarUrl ? (
              <Image
                src={user.avatarUrl}
                alt={user.username}
                width={80}
                height={80}
                referrerPolicy="no-referrer"
                className="w-20 h-20 rounded-full object-cover bg-slate-100 dark:bg-[#0B0F19]"
              />
            ) : (
              <div className="w-20 h-20 rounded-full bg-slate-100 dark:bg-[#0F1422] flex items-center justify-center">
                <UserIcon className="w-8 h-8 text-[#5865F2] dark:text-indigo-300" />
              </div>
            )}
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.18 }}
          className="space-y-2"
        >
          <div className="text-xs font-mono uppercase tracking-[0.14em] text-[#5865F2] dark:text-indigo-300 font-semibold">
            {isEs ? 'Sesión Verificada · Bienvenido de nuevo' : 'Session Verified · Welcome back'}
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white text-balance">
            {user.globalName || user.username}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300/85 leading-relaxed">
            {isEs
              ? 'Sincronizando servidores autorizados, políticas Anti-Raid y telemetría en tiempo real.'
              : 'Synchronizing authorized servers, Anti-Raid policies, and real-time telemetry.'}
          </p>
        </motion.div>

        <div className="space-y-3">
          <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
            <motion.div
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
              style={{ transformOrigin: 'left' }}
              className="h-full w-full bg-gradient-to-r from-[#5865F2] via-sky-400 to-emerald-400 rounded-full"
            />
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25, delay: 0.2 }}
            className="flex items-center justify-between gap-2 text-xs font-mono"
          >
            <span className="inline-flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>{t.login.preparingWorkspace}</span>
            </span>
            <button
              type="button"
              onClick={onComplete}
              className="inline-flex items-center gap-1 text-slate-700 dark:text-slate-300 hover:text-[#5865F2] dark:hover:text-white font-semibold cursor-pointer shrink-0 whitespace-nowrap"
            >
              <span>{isEs ? 'Entrar ahora' : 'Enter now'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}
