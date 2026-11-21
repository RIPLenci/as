'use client';

import React, { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import {
  ArrowLeftRight,
  Bell,
  Check,
  Crown,
  Globe,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Search,
  Server,
  Sun,
  User as UserIcon,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type {
  GuildRecord,
  LanguageCode,
  NotificationRecord,
  ThemeMode,
  UserRecord,
} from '@/lib/aegis/types';
import { getDict } from '@/lib/aegis/i18n';
import { isSuperOwner } from '@/lib/aegis/rbac';

interface TopBarProps {
  user: UserRecord;
  guilds: GuildRecord[];
  activeGuildId: string;
  hasEnteredServer: boolean;
  onSelectGuild: (guildId: string) => void;
  onSwitchServer: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  language: LanguageCode;
  onLanguageChange: (lang: LanguageCode) => void;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  notifications: NotificationRecord[];
  onMarkAllRead: () => void;
  streamConnected: boolean;
  degradedMode: boolean;
  botStatus?: string;
  botPingMs?: number | null;
  onOpenMobileMenu: () => void;
  onLogout: () => void;
}

export function TopBar({
  user,
  guilds,
  activeGuildId,
  hasEnteredServer,
  onSelectGuild,
  onSwitchServer,
  searchQuery,
  onSearchChange,
  language,
  onLanguageChange,
  theme,
  onThemeChange,
  notifications,
  onMarkAllRead,
  streamConnected,
  degradedMode,
  botStatus = 'UNCONFIGURED',
  botPingMs = null,
  onOpenMobileMenu,
  onLogout,
}: TopBarProps) {
  const superOwner = isSuperOwner(user) || user.globalRole === 'OWNER';
  const t = getDict(language);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifContainerRef = useRef<HTMLDivElement | null>(null);
  const unreadCount = notifications.filter((n) => !n.read).length;

  const botStatusLabel =
    botStatus === 'ONLINE'
      ? language === 'es'
        ? 'Bot en Línea'
        : 'Bot Online'
      : botStatus === 'DEGRADED'
      ? language === 'es'
        ? 'Bot Degradado'
        : 'Bot Degraded'
      : botStatus === 'UNCONFIGURED'
      ? language === 'es'
        ? 'Bot Sin Token'
        : 'Bot Unconfigured'
      : language === 'es'
      ? 'Bot Desconectado'
      : 'Bot Offline';

  useEffect(() => {
    if (!notifOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (notifContainerRef.current && !notifContainerRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNotifOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [notifOpen]);

  return (
    <header className="sticky top-0 z-30 h-16 px-4 sm:px-6 bg-white/80 dark:bg-[#0B0F19]/80 backdrop-blur-xl border-b border-slate-200/80 dark:border-white/[0.07] flex items-center justify-between gap-3">
      {/* Left: Mobile menu + Server Selector + Global Search */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          aria-label={language === 'es' ? 'Abrir menú de navegación' : 'Open navigation menu'}
          className="lg:hidden p-2 rounded-xl border border-slate-200/90 dark:border-white/[0.09] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.06] cursor-pointer shrink-0"
        >
          <Menu className="w-4 h-4" />
        </button>

        {/* Server Selector (only active after entering a server) */}
        {hasEnteredServer ? (
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex items-center gap-2 min-w-0 max-w-[220px]">
              <Server className="w-4 h-4 text-[#5865F2] shrink-0 hidden sm:block" />
              <label htmlFor="aegis-guild-selector" className="sr-only">
                {t.header.selectServer}
              </label>
              <select
                id="aegis-guild-selector"
                value={activeGuildId}
                onChange={(e) => onSelectGuild(e.target.value)}
                disabled={guilds.length === 0}
                className="w-full px-2.5 py-1.5 text-xs sm:text-sm font-medium rounded-xl bg-slate-50/90 dark:bg-[#0F1422] border border-slate-200/90 dark:border-white/[0.09] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#5865F2] truncate cursor-pointer disabled:opacity-60"
              >
                {guilds.length === 0 ? (
                  <option value="">{language === 'es' ? 'Sin servidores vinculados' : 'No servers linked'}</option>
                ) : (
                  guilds.map((g) => (
                    <option key={g.guildId} value={g.guildId}>
                      {g.name}
                    </option>
                  ))
                )}
              </select>
            </div>
            <button
              type="button"
              onClick={onSwitchServer}
              title={t.navItems.servers}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-slate-200/90 dark:border-white/[0.09] bg-slate-50/90 dark:bg-[#0F1422] text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-[#5865F2]/50 hover:text-[#5865F2] transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <ArrowLeftRight className="w-3.5 h-3.5 text-[#5865F2]" />
              <span className="hidden sm:inline">{t.navItems.servers}</span>
            </button>
          </div>
        ) : (
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-50/90 dark:bg-[#0F1422] border border-slate-200/90 dark:border-white/[0.09] text-xs font-medium text-slate-700 dark:text-slate-200 shrink-0">
            <Server className="w-3.5 h-3.5 text-[#5865F2]" />
            <span>{language === 'es' ? 'Todos los servidores' : 'All Servers'}</span>
          </div>
        )}

        {/* Global Search */}
        <div className="hidden md:flex items-center relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t.header.searchPlaceholder}
            aria-label={t.header.searchPlaceholder}
            className="w-full pl-9 pr-3 py-1.5 text-xs sm:text-sm rounded-xl bg-slate-50/90 dark:bg-[#0F1422] border border-slate-200/90 dark:border-white/[0.09] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#5865F2]"
          />
        </div>
      </div>

      {/* Right: Bot Latency, Live Connection, Language, Theme, Notifications, Profile */}
      <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
        {/* Bot Cluster Ping Indicator */}
        <div
          className="hidden 2xl:flex items-center gap-1.5 px-2.5 py-1 rounded-xl border border-slate-200/90 dark:border-white/[0.08] bg-slate-50/90 dark:bg-[#0F1422] text-[11px] font-mono whitespace-nowrap"
          title={language === 'es' ? 'Estado y latencia del Bot' : 'Discord Bot status & latency'}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              botStatus === 'ONLINE'
                ? 'bg-emerald-500'
                : botStatus === 'OFFLINE'
                ? 'bg-red-500'
                : 'bg-amber-500'
            }`}
          />
          <span className="text-slate-700 dark:text-slate-200 font-semibold">
            {botStatusLabel}
          </span>
          {typeof botPingMs === 'number' && botPingMs > 0 && (
            <span className="text-emerald-600 dark:text-emerald-400 tabular-nums">{botPingMs} ms</span>
          )}
        </div>

        {/* Live Connection Indicator */}
        <div
          className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded-xl border border-slate-200/90 dark:border-white/[0.08] bg-slate-50/90 dark:bg-[#0F1422] text-xs font-mono whitespace-nowrap"
          title={
            streamConnected
              ? degradedMode
                ? t.header.connectionDegraded
                : t.header.connectionOnline
              : t.header.connectionOffline
          }
        >
          {streamConnected ? (
            <Wifi
              className={`w-3.5 h-3.5 ${
                degradedMode ? 'text-amber-500' : 'text-emerald-500'
              }`}
            />
          ) : (
            <WifiOff className="w-3.5 h-3.5 text-red-500" />
          )}
          <span className="text-slate-700 dark:text-slate-300">
            {streamConnected
              ? degradedMode
                ? t.header.connectionDegraded
                : t.header.connectionOnline
              : t.header.connectionOffline}
          </span>
        </div>

        {/* Language Selector */}
        <div className="flex items-center border border-slate-200 dark:border-white/[0.09] rounded-lg p-0.5 bg-slate-50 dark:bg-[#0F1422]">
          <Globe className="w-3.5 h-3.5 text-slate-400 mx-1.5 hidden sm:block" />
          <button
            type="button"
            onClick={() => onLanguageChange('es')}
            className={`px-2 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
              language === 'es'
                ? 'bg-[#5865F2] text-white'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            ES
          </button>
          <button
            type="button"
            onClick={() => onLanguageChange('en')}
            className={`px-2 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
              language === 'en'
                ? 'bg-[#5865F2] text-white'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            EN
          </button>
        </div>

        {/* Theme Switcher */}
        <div
          className="flex items-center border border-slate-200 dark:border-white/[0.09] rounded-lg p-0.5 bg-slate-50 dark:bg-[#0F1422]"
          role="group"
          aria-label={t.header.theme}
        >
          <button
            type="button"
            onClick={() => onThemeChange('dark')}
            aria-label={t.header.themeDark}
            title={t.header.themeDark}
            className={`p-1.5 rounded-md transition-colors cursor-pointer ${
              theme === 'dark'
                ? 'bg-[#5865F2] text-white'
                : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Moon className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onThemeChange('light')}
            aria-label={t.header.themeLight}
            title={t.header.themeLight}
            className={`p-1.5 rounded-md transition-colors cursor-pointer ${
              theme === 'light'
                ? 'bg-[#5865F2] text-white'
                : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Sun className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onThemeChange('system')}
            aria-label={t.header.themeSystem}
            title={t.header.themeSystem}
            className={`p-1.5 rounded-md transition-colors cursor-pointer ${
              theme === 'system'
                ? 'bg-[#5865F2] text-white'
                : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Monitor className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Notification Center */}
        <div className="relative" ref={notifContainerRef}>
          <button
            type="button"
            onClick={() => setNotifOpen((prev) => !prev)}
            aria-label={t.header.notifications}
            aria-expanded={notifOpen}
            className="relative p-2 rounded-lg border border-slate-200 dark:border-white/[0.09] bg-slate-50 dark:bg-[#0F1422] text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer"
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded bg-red-600 text-white text-[10px] font-mono font-semibold flex items-center justify-center">
                {unreadCount}
              </span>
            )}
          </button>

          {notifOpen && (
            <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-xl bg-white dark:bg-[#0F1422] border border-slate-200 dark:border-white/[0.1] shadow-2xl z-50 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-900 dark:text-white">
                  {t.header.notifications}
                </span>
                <button
                  type="button"
                  onClick={onMarkAllRead}
                  className="text-xs text-violet-600 dark:text-violet-400 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <Check className="w-3 h-3" />
                  <span>{t.header.markAllRead}</span>
                </button>
              </div>
              <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/70">
                {notifications.length === 0 ? (
                  <p className="p-4 text-xs text-slate-500">{t.header.noNotifications}</p>
                ) : (
                  notifications.slice(0, 12).map((n) => (
                    <div
                      key={n.id}
                      className={`p-3.5 space-y-1 ${
                        n.read ? 'opacity-70' : 'bg-violet-500/5'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {n.title}
                        </span>
                        <span className="text-[11px] font-mono text-slate-400 shrink-0">
                          {n.severity}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                        {n.message}
                      </p>
                      <div className="text-[11px] font-mono text-slate-400 flex items-center gap-2">
                        <span>{new Date(n.createdAt).toLocaleString()}</span>
                        {n.groupedCount > 1 && (
                          <span>
                            · {n.groupedCount} {language === 'es' ? 'eventos' : 'events'}
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* User Profile & Logout */}
        <div className="flex items-center gap-2 pl-2 border-l border-slate-200 dark:border-slate-800">
          {user.avatarUrl ? (
            <Image
              src={user.avatarUrl}
              alt={user.username}
              width={28}
              height={28}
              referrerPolicy="no-referrer"
              className="w-7 h-7 rounded-full object-cover border border-slate-300 dark:border-slate-700"
            />
          ) : (
            <div className="w-7 h-7 rounded-full bg-violet-600/20 flex items-center justify-center border border-violet-500/30">
              <UserIcon className="w-3.5 h-3.5 text-violet-400" />
            </div>
          )}
          <div className="hidden sm:block text-left leading-tight">
            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 max-w-[180px] truncate">
              {user.globalName || user.username}
            </div>
            {superOwner ? (
              <div className="inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded bg-amber-400 text-slate-950 text-[9px] font-mono font-bold tracking-wider uppercase">
                <Crown className="w-2.5 h-2.5" />
                <span>OWNER</span>
              </div>
            ) : (
              <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                {user.globalRole}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onLogout}
            aria-label={t.header.logout}
            title={t.header.logout}
            className="p-1.5 rounded-md text-slate-500 hover:text-red-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
