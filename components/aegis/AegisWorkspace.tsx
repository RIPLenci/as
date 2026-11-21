'use client';

import React, { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import type {
  GuildRecord,
  LanguageCode,
  NotificationRecord,
  SystemHealthSnapshot,
  ThemeMode,
  UserRecord,
} from '@/lib/aegis/types';
import type { NavSectionId } from '@/lib/aegis/i18n';
import { isSuperOwner } from '@/lib/aegis/rbac';
import {
  aegisFetch,
  exchangeOAuthCodeForSession,
  getStoredSessionToken,
  installAegisApiFetchBridge,
  setStoredSessionToken,
} from '@/lib/aegis/client-auth';
import { LoginScreen } from './LoginScreen';

const ViewLoadingFallback = () => (
  <div className="space-y-4 py-4" aria-busy="true">
    <div className="h-32 rounded-3xl bg-slate-200/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-white/[0.06]" />
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      <div className="h-44 rounded-2xl bg-slate-200/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-white/[0.06]" />
      <div className="h-44 rounded-2xl bg-slate-200/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-white/[0.06]" />
      <div className="h-44 rounded-2xl bg-slate-200/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-white/[0.06]" />
    </div>
  </div>
);

const WelcomeTransition = dynamic(
  () => import('./WelcomeTransition').then((m) => m.WelcomeTransition),
  { ssr: false }
);
const Sidebar = dynamic(() => import('./Sidebar').then((m) => m.Sidebar));
const TopBar = dynamic(() => import('./TopBar').then((m) => m.TopBar));
const OverviewView = dynamic(
  () => import('./views/OverviewView').then((m) => m.OverviewView),
  { loading: ViewLoadingFallback }
);
const ServersView = dynamic(
  () => import('./views/ServersView').then((m) => m.ServersView),
  { loading: ViewLoadingFallback }
);
const MonitorView = dynamic(
  () => import('./views/MonitorView').then((m) => m.MonitorView),
  { loading: ViewLoadingFallback }
);
const IncidentsView = dynamic(
  () => import('./views/IncidentsView').then((m) => m.IncidentsView),
  { loading: ViewLoadingFallback }
);
const AntiRaidViews = dynamic(
  () => import('./views/AntiRaidViews').then((m) => m.AntiRaidViews),
  { loading: ViewLoadingFallback }
);
const OperationsViews = dynamic(
  () => import('./views/OperationsViews').then((m) => m.OperationsViews),
  { loading: ViewLoadingFallback }
);
const SystemViews = dynamic(
  () => import('./views/SystemViews').then((m) => m.SystemViews),
  { loading: ViewLoadingFallback }
);
const AdditionalSecurityView = dynamic(
  () => import('./views/AdditionalSecurityView').then((m) => m.AdditionalSecurityView),
  { loading: ViewLoadingFallback }
);
const BotPermissionsView = dynamic(
  () => import('./views/BotPermissionsView').then((m) => m.BotPermissionsView),
  { loading: ViewLoadingFallback }
);
const GuildOpsSuiteViews = dynamic(
  () => import('./views/GuildOpsSuiteViews').then((m) => m.GuildOpsSuiteViews),
  { loading: ViewLoadingFallback }
);
const AdminPanelView = dynamic(
  () => import('./views/AdminPanelView').then((m) => m.AdminPanelView),
  { loading: ViewLoadingFallback }
);

interface SessionResponse {
  authenticated: boolean;
  user: UserRecord | null;
  oauthConfigured: boolean;
  expectedCallbackUrl: string;
  systemHealth: SystemHealthSnapshot;
}

interface AegisWorkspaceProps {
  initialUser?: UserRecord | null;
  initialOauthConfigured?: boolean;
  initialExpectedCallbackUrl?: string;
  initialSystemHealth?: SystemHealthSnapshot | null;
}

export function AegisWorkspace({
  initialUser = null,
  initialOauthConfigured = false,
  initialExpectedCallbackUrl = '/api/auth/callback',
  initialSystemHealth = null,
}: AegisWorkspaceProps) {
  const [user, setUser] = useState<UserRecord | null>(initialUser);
  const [showWelcome, setShowWelcome] = useState(false);
  const [oauthConfigured, setOauthConfigured] = useState(initialOauthConfigured);
  const [expectedCallbackUrl, setExpectedCallbackUrl] = useState(initialExpectedCallbackUrl);
  const [systemHealth, setSystemHealth] = useState<SystemHealthSnapshot | null>(
    initialSystemHealth
  );
  const [apiLatencyMs, setApiLatencyMs] = useState<number | null>(null);

  const [guilds, setGuilds] = useState<GuildRecord[]>([]);
  const [activeGuildId, setActiveGuildId] = useState<string>('');
  const [enteredGuildId, setEnteredGuildId] = useState<string>('');
  const [activeSection, setActiveSection] = useState<NavSectionId>('overview');
  const [inspectIncidentId, setInspectIncidentId] = useState<string | null>(null);

  const [language, setLanguage] = useState<LanguageCode>(initialUser?.language || 'es');
  const [theme, setTheme] = useState<ThemeMode>(initialUser?.theme || 'dark');
  const [isDark, setIsDark] = useState(true);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [streamConnected, setStreamConnected] = useState(false);
  const [lastHeartbeatAt, setLastHeartbeatAt] = useState<string | null>(null);
  const [syncNonce, setSyncNonce] = useState(0);

  // Install same-origin /api/* bearer fallback interceptor if cookie jar is blocked inside iframe
  useEffect(() => {
    try {
      window.sessionStorage.removeItem('aegis_chunk_reload_attempted');
    } catch {
      // ignore
    }
    return installAegisApiFetchBridge();
  }, []);

  // Resolve and apply Light / Dark / System theme to document.documentElement
  useEffect(() => {
    const applyTheme = () => {
      const prefersDark =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches;
      const resolvedDark = theme === 'dark' || (theme === 'system' && prefersDark);
      setIsDark(resolvedDark);
      if (typeof document !== 'undefined') {
        document.documentElement.classList.toggle('dark', resolvedDark);
      }
    };

    applyTheme();
    if (theme === 'system' && typeof window !== 'undefined') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', applyTheme);
      return () => mq.removeEventListener('change', applyTheme);
    }
  }, [theme]);

  // Sync <html lang>
  useEffect(() => {
    if (typeof document !== 'undefined') {
      try {
        document.documentElement.lang = language;
      } catch {
        // Ignore readonly DOM property in restricted environments
      }
    }
  }, [language]);

  const loadWorkspaceData = useCallback(async () => {
    try {
      const originParam =
        typeof window !== 'undefined' ? `?origin=${encodeURIComponent(window.location.origin)}` : '';
      const [srvRes, notifRes, sessionRes] = await Promise.all([
        aegisFetch('/api/auth/servers'),
        aegisFetch('/api/notifications'),
        aegisFetch(`/api/auth/session${originParam}`),
      ]);

      if (srvRes.status === 401 || notifRes.status === 401) {
        setStoredSessionToken(null);
        setUser(null);
        setGuilds([]);
        setNotifications([]);
        return;
      }

      if (srvRes.ok) {
        const srvJson = await srvRes.json().catch(() => null);
        const list = (srvJson?.servers || []) as GuildRecord[];
        setGuilds(list);
        const manageable = list.filter((g) => g.userIsOwner || g.userIsSecondaryOwner);
        setActiveGuildId((prev) => {
          if (prev && manageable.some((g) => g.guildId === prev)) return prev;
          const connected = manageable.find((g) => g.botStatus === 'BOT_CONNECTED');
          return connected?.guildId ?? manageable[0]?.guildId ?? '';
        });
      }

      if (notifRes.ok) {
        const notifJson = await notifRes.json().catch(() => null);
        if (notifJson) setNotifications(notifJson.notifications || []);
      }

      if (sessionRes.ok) {
        const sJson = (await sessionRes.json().catch(() => null)) as SessionResponse | null;
        if (sJson) {
          setSystemHealth(sJson.systemHealth);
          setOauthConfigured(sJson.oauthConfigured);
          setExpectedCallbackUrl(sJson.expectedCallbackUrl);
        }
      }
    } catch {
      // Keep current workspace state intact if a background refresh fails
    }
  }, []);

  const hydrateSession = useCallback(
    async (withWelcome: boolean) => {
      const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
      try {
        // Recover single-use OAuth exchange code if opened in full-tab redirect fallback
        if (typeof window !== 'undefined') {
          const params = new URLSearchParams(window.location.search);
          const exchangeCode = params.get('oauth_exchange');
          if (exchangeCode) {
            await exchangeOAuthCodeForSession(exchangeCode);
            params.delete('oauth_exchange');
            const nextQuery = params.toString();
            const cleanUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${
              window.location.hash
            }`;
            window.history.replaceState({}, '', cleanUrl);
          }
        }

        const originParam =
          typeof window !== 'undefined'
            ? `?origin=${encodeURIComponent(window.location.origin)}`
            : '';
        const res = await aegisFetch(`/api/auth/session${originParam}`);
        const elapsed = Math.max(
          1,
          Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started)
        );
        setApiLatencyMs(elapsed);

        if (!res.ok) return;
        const data = (await res.json()) as SessionResponse;
        setOauthConfigured(data.oauthConfigured);
        setExpectedCallbackUrl(data.expectedCallbackUrl);
        setSystemHealth(data.systemHealth);

        if (data.authenticated && data.user) {
          setUser(data.user);
          setLanguage(data.user.language || 'es');
          setTheme(data.user.theme || 'dark');
          if (withWelcome) setShowWelcome(true);
          await loadWorkspaceData();

          if (typeof window !== 'undefined') {
            const sp = new URLSearchParams(window.location.search);
            const targetSec = sp.get('section') as NavSectionId | null;
            const validSections: ReadonlySet<string> = new Set([
              'overview',
              'servers',
              'admin-panel',
              'monitor',
              'incidents',
              'protection-overview',
              'join-protection',
              'anti-nuke',
              'risk-engine',
              'additional-security',
              'bot-permissions',
              'verification',
              'log-channel',
              'backups',
              'two-factor',
              'secondary-owner',
              'premium',
              'quarantine',
              'lockdown',
              'whitelist',
              'audit-logs',
              'settings',
            ]);
            if (targetSec && validSections.has(targetSec)) {
              if (targetSec !== 'admin-panel' || isSuperOwner(data.user)) {
                if (targetSec === 'servers') {
                  setEnteredGuildId('');
                  setActiveSection('overview');
                } else {
                  setActiveSection(targetSec);
                }
              }
              sp.delete('section');
              const remaining = sp.toString();
              window.history.replaceState(
                {},
                '',
                `${window.location.pathname}${remaining ? `?${remaining}` : ''}${window.location.hash}`
              );
            }
          }
          return;
        }

        setUser(null);
        setGuilds([]);
        setActiveGuildId('');
        setNotifications([]);
      } catch {
        // Keep current auth state cleanly if transient refresh fails
      }
    },
    [loadWorkspaceData]
  );

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (active) void hydrateSession(false);
    });
    return () => {
      active = false;
    };
  }, [hydrateSession]);

  // Real-time SSE connection for live telemetry & cross-tab updates
  useEffect(() => {
    if (!user) {
      return;
    }

    const fallbackToken = getStoredSessionToken();
    const streamUrl = fallbackToken
      ? `/api/realtime/stream?token=${encodeURIComponent(fallbackToken)}`
      : '/api/realtime/stream';
    const es = new EventSource(streamUrl);

    es.addEventListener('connected', (ev) => {
      setStreamConnected(true);
      try {
        const parsed = JSON.parse((ev as MessageEvent).data) as { timestamp?: string };
        if (parsed.timestamp) setLastHeartbeatAt(parsed.timestamp);
      } catch {
        setLastHeartbeatAt(new Date().toISOString());
      }
    });

    es.addEventListener('heartbeat', (ev) => {
      setStreamConnected(true);
      try {
        const parsed = JSON.parse((ev as MessageEvent).data) as { timestamp?: string };
        if (parsed.timestamp) setLastHeartbeatAt(parsed.timestamp);
      } catch {
        setLastHeartbeatAt(new Date().toISOString());
      }
    });

    es.addEventListener('aegis_update', () => {
      setStreamConnected(true);
      loadWorkspaceData();
      setSyncNonce((n) => n + 1);
    });

    es.onerror = () => {
      setStreamConnected(false);
    };

    return () => {
      es.close();
      setStreamConnected(false);
    };
  }, [user, loadWorkspaceData]);

  const handleLanguageChange = async (nextLang: LanguageCode) => {
    setLanguage(nextLang);
    if (user) {
      try {
        await aegisFetch('/api/preferences', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ language: nextLang }),
        });
      } catch {
        // Local language selection still applies immediately
      }
    }
  };

  const handleThemeChange = async (nextTheme: ThemeMode) => {
    setTheme(nextTheme);
    if (user) {
      try {
        await aegisFetch('/api/preferences', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ theme: nextTheme }),
        });
      } catch {
        // Local theme selection still applies immediately
      }
    }
  };

  const handleMarkAllRead = async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      await aegisFetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markAllRead: true }),
      });
    } catch {
      // Ignore transient failure marking notifications read
    }
  };

  const handleLogout = async () => {
    try {
      await aegisFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Clear client session state even if network request fails
    } finally {
      setStoredSessionToken(null);
      setUser(null);
      setShowWelcome(false);
      setGuilds([]);
      setActiveGuildId('');
      setEnteredGuildId('');
      setActiveSection('overview');
      setInspectIncidentId(null);
      setSearchQuery('');
      setNotifications([]);
      setLastHeartbeatAt(null);
      setApiLatencyMs(null);
    }
  };

  const handleSyncCompleted = useCallback(() => {
    loadWorkspaceData();
    setSyncNonce((n) => n + 1);
  }, [loadWorkspaceData]);

  return (
    <MotionConfig reducedMotion="user">
      {!user ? (
        <LoginScreen
          language={language}
          onLanguageChange={handleLanguageChange}
          oauthConfigured={oauthConfigured}
          expectedCallbackUrl={expectedCallbackUrl}
          systemHealth={systemHealth}
          apiLatencyMs={apiLatencyMs}
          onAuthenticated={() => hydrateSession(true)}
        />
      ) : showWelcome ? (
        <WelcomeTransition
          user={user}
          language={language}
          onComplete={() => setShowWelcome(false)}
        />
      ) : (
        <div className="min-h-screen flex bg-[#F5F7FA] dark:bg-[#060911] text-slate-900 dark:text-slate-100">
          <Sidebar
            user={user}
            activeSection={activeSection}
            onSelect={(id) => {
              if (id === 'admin-panel' && !isSuperOwner(user)) return;
              if (id !== 'incidents') setInspectIncidentId(null);
              if (id === 'servers') {
                setEnteredGuildId('');
                setActiveSection('overview');
                return;
              }
              setActiveSection(id);
            }}
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
            mobileOpen={mobileMenuOpen}
            onCloseMobile={() => setMobileMenuOpen(false)}
            language={language}
            hasEnteredServer={Boolean(enteredGuildId)}
          />

          <div className="flex-1 min-w-0 flex flex-col">
            <TopBar
              user={user}
              guilds={guilds.filter((g) => g.userIsOwner || g.userIsSecondaryOwner)}
              activeGuildId={activeGuildId}
              hasEnteredServer={Boolean(enteredGuildId)}
              onSelectGuild={(gid) => {
                setActiveGuildId(gid);
                setEnteredGuildId(gid);
              }}
              onSwitchServer={() => {
                setEnteredGuildId('');
                setActiveSection('overview');
              }}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              language={language}
              onLanguageChange={handleLanguageChange}
              theme={theme}
              onThemeChange={handleThemeChange}
              notifications={notifications}
              onMarkAllRead={handleMarkAllRead}
              streamConnected={streamConnected}
              degradedMode={systemHealth?.degradedMode ?? true}
              botStatus={systemHealth?.bot}
              botPingMs={systemHealth?.botIdentity?.pingMs}
              onOpenMobileMenu={() => setMobileMenuOpen(true)}
              onLogout={handleLogout}
            />

            <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1600px] w-full mx-auto">
              <AnimatePresence mode="wait">
                <motion.div
                  key={`${activeSection}-${enteredGuildId || 'all'}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                >
                  {activeSection === 'overview' && enteredGuildId && (
                    <OverviewView
                      user={user}
                      language={language}
                      isDark={isDark}
                      activeGuildId={activeGuildId}
                      searchQuery={searchQuery}
                      syncNonce={syncNonce}
                      onInspectIncident={(incId) => {
                        setInspectIncidentId(incId);
                        setActiveSection('incidents');
                      }}
                      onNavigateSection={(sec) => setActiveSection(sec)}
                    />
                  )}

                  {((activeSection === 'overview' && !enteredGuildId) ||
                    activeSection === 'servers') && (
                    <ServersView
                      user={user}
                      language={language}
                      activeGuildId={activeGuildId}
                      hasEnteredServer={Boolean(enteredGuildId)}
                      searchQuery={searchQuery}
                      syncNonce={syncNonce}
                      onSelectGuild={(gid) => {
                        setActiveGuildId(gid);
                        setEnteredGuildId(gid);
                        setActiveSection('overview');
                      }}
                      onOpenOverview={(gid) => {
                        if (gid) {
                          setActiveGuildId(gid);
                          setEnteredGuildId(gid);
                        }
                        setActiveSection('overview');
                      }}
                      onNavigatePremium={() => setActiveSection('premium')}
                      onServersUpdated={handleSyncCompleted}
                    />
                  )}

                  {activeSection === 'admin-panel' && isSuperOwner(user) && (
                    <AdminPanelView
                      user={user}
                      language={language}
                      syncNonce={syncNonce}
                      onSyncCompleted={handleSyncCompleted}
                    />
                  )}

                  {activeSection === 'monitor' && (
                    <MonitorView
                      language={language}
                      activeGuildId={activeGuildId}
                      streamConnected={streamConnected}
                      lastHeartbeatAt={lastHeartbeatAt}
                      syncNonce={syncNonce}
                    />
                  )}

                  {activeSection === 'incidents' && (
                    <IncidentsView
                      language={language}
                      activeGuildId={activeGuildId}
                      searchQuery={searchQuery}
                      initialIncidentId={inspectIncidentId}
                      syncNonce={syncNonce}
                    />
                  )}

                  {(activeSection === 'protection-overview' ||
                    activeSection === 'join-protection' ||
                    activeSection === 'anti-nuke' ||
                    activeSection === 'risk-engine') && (
                    <AntiRaidViews
                      section={activeSection}
                      language={language}
                      activeGuildId={activeGuildId}
                      syncNonce={syncNonce}
                      onSyncCompleted={handleSyncCompleted}
                      onNavigatePremium={() => setActiveSection('premium')}
                    />
                  )}

                  {activeSection === 'additional-security' && (
                    <AdditionalSecurityView
                      language={language}
                      activeGuildId={activeGuildId}
                      syncNonce={syncNonce}
                      onNavigatePremium={() => setActiveSection('premium')}
                      onNavigateServers={() => setActiveSection('servers')}
                      onSyncCompleted={handleSyncCompleted}
                    />
                  )}

                  {activeSection === 'bot-permissions' && (
                    <BotPermissionsView
                      language={language}
                      activeGuildId={activeGuildId}
                      syncNonce={syncNonce}
                      onNavigatePremium={() => setActiveSection('premium')}
                      onNavigateServers={() => setActiveSection('servers')}
                      onSyncCompleted={handleSyncCompleted}
                    />
                  )}

                  {(activeSection === 'verification' ||
                    activeSection === 'log-channel' ||
                    activeSection === 'backups' ||
                    activeSection === 'two-factor' ||
                    activeSection === 'secondary-owner' ||
                    activeSection === 'premium') && (
                    <GuildOpsSuiteViews
                      section={activeSection}
                      language={language}
                      activeGuildId={activeGuildId}
                      syncNonce={syncNonce}
                      onNavigatePremium={() => setActiveSection('premium')}
                      onNavigateServers={() => setActiveSection('servers')}
                      onSyncCompleted={handleSyncCompleted}
                    />
                  )}

                  {(activeSection === 'quarantine' ||
                    activeSection === 'lockdown' ||
                    activeSection === 'whitelist') && (
                    <OperationsViews
                      section={activeSection}
                      language={language}
                      activeGuildId={activeGuildId}
                      syncNonce={syncNonce}
                      onSyncCompleted={handleSyncCompleted}
                    />
                  )}

                  {(activeSection === 'audit-logs' || activeSection === 'settings') && (
                    <SystemViews
                      section={activeSection}
                      language={language}
                      theme={theme}
                      user={user}
                      systemHealth={systemHealth}
                      expectedCallbackUrl={expectedCallbackUrl}
                      onLanguageChange={handleLanguageChange}
                      onThemeChange={handleThemeChange}
                      onRefreshHealth={loadWorkspaceData}
                      onLogout={handleLogout}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </main>
          </div>
        </div>
      )}
    </MotionConfig>
  );
}
