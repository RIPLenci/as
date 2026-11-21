'use client';

import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Activity,
  AlertOctagon,
  ArrowLeftRight,
  BadgeCheck,
  CheckCircle2,
  Cpu,
  Crown,
  FileSearch,
  HardDrive,
  Key,
  KeyRound,
  LayoutDashboard,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Settings,
  ShieldAlert,
  ShieldCheck,
  ShieldPlus,
  UserCheck,
  UserCog,
  UserPlus,
  UserX,
  X,
} from 'lucide-react';
import type { LanguageCode, UserRecord } from '@/lib/aegis/types';
import { getDict, type NavSectionId } from '@/lib/aegis/i18n';
import { isSuperOwner } from '@/lib/aegis/rbac';
import { AegisLogoMark } from './BrandLogo';

interface SidebarProps {
  user: UserRecord;
  activeSection: NavSectionId;
  onSelect: (id: NavSectionId) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  language: LanguageCode;
  hasEnteredServer: boolean;
}

interface NavGroup {
  categoryKey: 'general' | 'antiRaid' | 'system';
  items: Array<{
    id: NavSectionId;
    icon: React.ComponentType<{ className?: string }>;
  }>;
}

const NAV_GROUPS: NavGroup[] = [
  {
    categoryKey: 'general',
    items: [
      { id: 'overview', icon: LayoutDashboard },
      { id: 'premium', icon: Crown },
      { id: 'servers', icon: ArrowLeftRight },
      { id: 'incidents', icon: AlertOctagon },
      { id: 'monitor', icon: Activity },
    ],
  },
  {
    categoryKey: 'antiRaid',
    items: [
      { id: 'protection-overview', icon: ShieldCheck },
      { id: 'additional-security', icon: ShieldPlus },
      { id: 'bot-permissions', icon: KeyRound },
      { id: 'whitelist', icon: UserCheck },
      { id: 'verification', icon: BadgeCheck },
      { id: 'log-channel', icon: ScrollText },
      { id: 'backups', icon: HardDrive },
      { id: 'two-factor', icon: Key },
      { id: 'secondary-owner', icon: UserCog },
      { id: 'join-protection', icon: UserPlus },
      { id: 'anti-nuke', icon: ShieldAlert },
      { id: 'risk-engine', icon: Cpu },
      { id: 'quarantine', icon: UserX },
      { id: 'lockdown', icon: Lock },
    ],
  },
  {
    categoryKey: 'system',
    items: [
      { id: 'admin-panel', icon: ShieldAlert },
      { id: 'audit-logs', icon: FileSearch },
      { id: 'settings', icon: Settings },
    ],
  },
];

export function Sidebar({
  user,
  activeSection,
  onSelect,
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onCloseMobile,
  language,
  hasEnteredServer,
}: SidebarProps) {
  const t = getDict(language);
  const superOwner = isSuperOwner(user);

  const renderNavContent = (isMobile: boolean) => (
    <div className="flex flex-col h-full bg-white/95 dark:bg-[#0B0F19]/95 backdrop-blur-xl border-r border-slate-200/80 dark:border-white/[0.07] select-none">
      {/* Brand header */}
      <div className="h-16 px-4 flex items-center justify-between border-b border-slate-200/80 dark:border-white/[0.07] shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#5865F2] to-indigo-600 flex items-center justify-center shadow-sm shadow-indigo-500/25 shrink-0">
            <AegisLogoMark className="w-4.5 h-4.5 text-white" />
          </div>
          {(!collapsed || isMobile) && (
            <div className="min-w-0">
              <div className="font-display font-bold text-sm tracking-tight text-slate-900 dark:text-white whitespace-nowrap truncate">
                {t.brandName}
              </div>
              <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500 truncate">
                Enterprise v4.2
              </div>
            </div>
          )}
        </div>
        {isMobile ? (
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label={language === 'es' ? 'Cerrar menú' : 'Close navigation menu'}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
          >
            {collapsed ? (
              <PanelLeftOpen className="w-4 h-4" />
            ) : (
              <PanelLeftClose className="w-4 h-4" />
            )}
          </button>
        )}
      </div>

      {/* Navigation groups */}
      <nav aria-label="AEGIS Security Navigation" className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {NAV_GROUPS.map((group) => {
          if (group.categoryKey === 'antiRaid' && !hasEnteredServer) {
            return null;
          }

          const visibleItems = group.items.filter((item) => {
            if (item.id === 'admin-panel') return superOwner;
            if (
              !hasEnteredServer &&
              (item.id === 'servers' ||
                item.id === 'incidents' ||
                item.id === 'monitor' ||
                item.id === 'audit-logs')
            ) {
              return false;
            }
            return true;
          });

          if (visibleItems.length === 0) return null;

          return (
            <div key={group.categoryKey} className="space-y-1">
            {(!collapsed || isMobile) && (
              <div className="px-2.5 pb-1 text-[10px] font-mono font-semibold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500">
                {t.navCategories[group.categoryKey]}
              </div>
            )}
            <ul className="space-y-0.5">
              {visibleItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeSection === item.id;
                const isPremiumItem = item.id === 'premium';
                const isAdminItem = item.id === 'admin-panel';
                const label = t.navItems[item.id];
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(item.id);
                        if (isMobile) onCloseMobile();
                      }}
                      title={collapsed && !isMobile ? label : undefined}
                      aria-current={isActive ? 'page' : undefined}
                      className={`relative w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-[13px] font-medium transition-all cursor-pointer whitespace-nowrap border ${
                        isPremiumItem
                          ? isActive
                            ? 'border-amber-400/70 bg-gradient-to-r from-amber-500/20 to-yellow-500/10 text-amber-600 dark:text-amber-300 shadow-sm shadow-amber-500/10'
                            : 'border-amber-500/35 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent text-amber-700 dark:text-amber-300 hover:border-amber-400/60 hover:from-amber-500/20'
                          : isAdminItem
                          ? isActive
                            ? 'border-red-500/60 bg-gradient-to-r from-red-500/20 to-amber-500/10 text-red-500 dark:text-red-300 shadow-sm'
                            : 'border-red-500/30 bg-red-500/5 text-red-600 dark:text-red-300 hover:border-red-500/50 hover:bg-red-500/15'
                          : isActive
                          ? 'border-[#5865F2]/30 text-indigo-700 dark:text-white'
                          : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100/80 dark:hover:bg-white/[0.04]'
                      }`}
                    >
                      {isActive && !isPremiumItem && !isAdminItem && (
                        <motion.span
                          layoutId={isMobile ? 'aegis-nav-mobile' : 'aegis-nav-desktop'}
                          transition={{ type: 'spring', stiffness: 360, damping: 32 }}
                          className="absolute inset-0 rounded-xl bg-indigo-50/90 dark:bg-[#5865F2]/20"
                          aria-hidden="true"
                        />
                      )}
                      <Icon
                        className={`w-4 h-4 shrink-0 relative z-10 ${
                          isPremiumItem
                            ? 'text-amber-500 dark:text-amber-400'
                            : isAdminItem
                            ? 'text-red-500 dark:text-red-400'
                            : isActive
                            ? 'text-[#5865F2] dark:text-indigo-300'
                            : 'text-slate-400 dark:text-slate-500'
                        }`}
                      />
                      {(!collapsed || isMobile) && (
                        <span className="truncate relative z-10">{label}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      </nav>

      {/* Bottom shield verification line */}
      {(!collapsed || isMobile) && (
        <div className="px-4 py-3 border-t border-slate-200/80 dark:border-white/[0.07] flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          <span className="truncate font-mono">
            {language === 'es' ? 'Zero-Trust RBAC Activo' : 'Zero-Trust RBAC Active'}
          </span>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className={`hidden lg:block shrink-0 transition-all duration-200 ${
          collapsed ? 'w-[72px]' : 'w-[258px]'
        }`}
      >
        <div className="sticky top-0 h-screen">{renderNavContent(false)}</div>
      </aside>

      {/* Mobile Drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden flex">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-xs"
              onClick={onCloseMobile}
              aria-hidden="true"
            />
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              className="relative w-72 max-w-[85vw] h-full z-10"
            >
              {renderNavContent(true)}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
