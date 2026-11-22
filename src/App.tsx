import React, { useCallback, useEffect, useState } from 'react';
import {
  LayoutDashboard,
  MessageSquare,
  Users,
  Send,
  Inbox,
  History,
  Database,
  Settings,
  LogOut,
  MoreHorizontal,
  X,
  MailCheck,
} from 'lucide-react';
import type {
  DailyActivityPoint,
  DashboardLogEntry,
  DashboardMetrics,
  PendingAction,
} from '../modules/outreach/types.ts';
import { apiFetch, ApiError, setUnauthorizedHandler } from './lib/api.ts';
import { ActivityPanel } from './components/ActivityPanel.tsx';
import { CampaignsPanel } from './components/CampaignsPanel.tsx';
import { ChatPanel, type ChatMessageItem } from './components/ChatPanel.tsx';
import { DashboardHome } from './components/DashboardHome.tsx';
import { InboxPanel } from './components/InboxPanel.tsx';
import { LeadsPanel } from './components/LeadsPanel.tsx';
import { LoginScreen } from './components/LoginScreen.tsx';
import { MemoryPanel } from './components/MemoryPanel.tsx';
import { SettingsPanel } from './components/SettingsPanel.tsx';
import { ZohoSetupPage } from './components/ZohoSetupPage.tsx';

type TabId =
  | 'home'
  | 'chat'
  | 'leads'
  | 'campaigns'
  | 'inbox'
  | 'activity'
  | 'memory'
  | 'settings'
  | 'setup_zoho';

interface AuthStatusResponse {
  authenticated: boolean;
  setupRequired: boolean;
  envConfigured: boolean;
  integrations: {
    gemini: boolean;
    zoho: boolean;
  };
}

interface DashboardResponse {
  metrics: DashboardMetrics;
  lead_counts?: Record<string, number>;
  daily_activity?: DailyActivityPoint[];
  recent_logs?: DashboardLogEntry[];
  pending_approvals: PendingAction[];
  zohoEmail?: string | null;
  integrations?: {
    gemini: boolean;
    zoho: boolean;
  };
}

const ROUTE_BY_TAB: Record<TabId, string> = {
  home: '/',
  chat: '/chat',
  leads: '/leads',
  campaigns: '/campaigns',
  inbox: '/inbox',
  activity: '/logs',
  memory: '/memory',
  settings: '/settings',
  setup_zoho: '/setup/zoho',
};

function resolveTabFromPath(pathname: string): TabId {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  switch (normalized) {
    case '/chat':
      return 'chat';
    case '/leads':
      return 'leads';
    case '/campaigns':
      return 'campaigns';
    case '/inbox':
      return 'inbox';
    case '/logs':
    case '/activity':
      return 'activity';
    case '/memory':
      return 'memory';
    case '/settings':
      return 'settings';
    case '/setup/zoho':
      return 'setup_zoho';
    default:
      return 'home';
  }
}

const NAV_TABS: Array<{
  id: Exclude<TabId, 'setup_zoho'>;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'home', label: 'Dashboard', shortLabel: 'Home', icon: LayoutDashboard },
  { id: 'chat', label: 'Agent Chat', shortLabel: 'Chat', icon: MessageSquare },
  { id: 'leads', label: 'Leads', shortLabel: 'Leads', icon: Users },
  { id: 'campaigns', label: 'Campaigns', shortLabel: 'Campaigns', icon: Send },
  { id: 'inbox', label: 'Inbox', shortLabel: 'Inbox', icon: Inbox },
  { id: 'activity', label: 'Agent Logs', shortLabel: 'Logs', icon: History },
  { id: 'memory', label: 'Memory', shortLabel: 'Memory', icon: Database },
  { id: 'settings', label: 'Settings', shortLabel: 'Settings', icon: Settings },
];

const MOBILE_PRIMARY_TABS: Array<Exclude<TabId, 'setup_zoho'>> = ['home', 'chat', 'leads', 'inbox'];

export default function App() {
  const [authState, setAuthState] = useState<AuthStatusResponse | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>(() =>
    resolveTabFromPath(window.location.pathname)
  );
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);

  const [metrics, setMetrics] = useState<DashboardMetrics>({
    sentToday: 0,
    dailyCap: 30,
    totalSent: 0,
    replies: 0,
    interested: 0,
    bounces: 0,
    queued: 0,
    pendingApprovals: 0,
    totalLeads: 0,
    activeCampaigns: 0,
  });
  const [leadCounts, setLeadCounts] = useState<Record<string, number>>({});
  const [dailyActivity, setDailyActivity] = useState<DailyActivityPoint[]>([]);
  const [recentLogs, setRecentLogs] = useState<DashboardLogEntry[]>([]);
  const [zohoEmail, setZohoEmail] = useState<string | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [pendingMap, setPendingMap] = useState<Record<string, PendingAction>>({});
  const [chatId, setChatId] = useState<string>(() =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `chat_${Date.now()}`
  );
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [draftPrompt, setDraftPrompt] = useState<string | undefined>(undefined);

  const checkAuth = useCallback(async () => {
    setAuthLoading(true);
    try {
      const data = await apiFetch<AuthStatusResponse>('/api/auth/status');
      setAuthState(data);
    } catch {
      setAuthState({
        authenticated: false,
        setupRequired: false,
        envConfigured: true,
        integrations: { gemini: false, zoho: false },
      });
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const refreshDashboard = useCallback(async () => {
    setDashboardLoading(true);
    try {
      const data = await apiFetch<DashboardResponse>('/api/dashboard');
      setMetrics(data.metrics);
      setLeadCounts(data.lead_counts ?? {});
      setDailyActivity(data.daily_activity ?? []);
      setRecentLogs(data.recent_logs ?? []);
      setZohoEmail(data.zohoEmail ?? null);
      const map: Record<string, PendingAction> = {};
      for (const pa of data.pending_approvals ?? []) {
        map[pa.id] = pa;
      }
      setPendingMap((prev) => ({ ...prev, ...map }));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setAuthState((prev) => (prev ? { ...prev, authenticated: false } : prev));
      }
    } finally {
      setDashboardLoading(false);
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setAuthState((prev) => (prev ? { ...prev, authenticated: false } : prev));
      void checkAuth();
    });
    return () => setUnauthorizedHandler(null);
  }, [checkAuth]);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    const onPopState = () => {
      setActiveTab(resolveTabFromPath(window.location.pathname));
      setMoreSheetOpen(false);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  function navigateToTab(tab: TabId) {
    setActiveTab(tab);
    setMoreSheetOpen(false);
    const targetPath = ROUTE_BY_TAB[tab] ?? '/';
    if (window.location.pathname !== targetPath) {
      window.history.pushState({}, '', targetPath);
    }
  }

  useEffect(() => {
    if (authState?.authenticated) {
      void refreshDashboard();
    }
  }, [authState?.authenticated, refreshDashboard]);

  async function handleApproveAction(id: string) {
    const res = await apiFetch<{ ok: boolean; action?: PendingAction; result?: unknown }>(
      `/api/actions/${id}/approve`,
      { method: 'POST' }
    );
    if (res.action) {
      setPendingMap((prev) => ({ ...prev, [id]: res.action! }));
    }
    await refreshDashboard();
  }

  async function handleRejectAction(id: string) {
    const res = await apiFetch<{ ok: boolean; action?: PendingAction }>(
      `/api/actions/${id}/reject`,
      { method: 'POST' }
    );
    if (res.action) {
      setPendingMap((prev) => ({ ...prev, [id]: res.action! }));
    }
    await refreshDashboard();
  }

  function handleNewChat() {
    const nextId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `chat_${Date.now()}`;
    setChatId(nextId);
    setMessages([]);
  }

  function handleSelectChatSession(id: string, loadedMessages: ChatMessageItem[]) {
    setChatId(id);
    setMessages(loadedMessages);
  }

  async function handleLogout() {
    setMoreSheetOpen(false);
    await apiFetch('/api/auth/logout', { method: 'POST' });
    handleNewChat();
    await checkAuth();
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-xs text-slate-500">
        Verifying session...
      </div>
    );
  }

  if (!authState?.authenticated) {
    return (
      <LoginScreen
        setupRequired={Boolean(authState?.setupRequired)}
        onAuthenticated={() => {
          void checkAuth();
        }}
      />
    );
  }

  const currentTabLabel =
    activeTab === 'setup_zoho'
      ? 'Connect Zoho'
      : NAV_TABS.find((t) => t.id === activeTab)?.label ?? 'Dashboard';

  const isMoreActive = ['campaigns', 'activity', 'memory', 'settings', 'setup_zoho'].includes(
    activeTab
  );

  return (
    <div className="h-[100dvh] w-full max-w-full bg-slate-50 text-slate-900 flex overflow-hidden">
      {/* Sidebar (Desktop md+) */}
      <aside className="hidden md:flex md:w-60 shrink-0 bg-white border-r border-slate-200 flex-col justify-between">
        <div>
          <button
            type="button"
            onClick={() => navigateToTab('home')}
            className="w-full h-14 px-5 border-b border-slate-200 flex items-center justify-between text-left cursor-pointer hover:bg-slate-50/60"
          >
            <span className="text-sm font-semibold tracking-tight text-slate-900 whitespace-nowrap">
              Outreach Desk
            </span>
          </button>

          <nav className="p-3 space-y-1">
            {NAV_TABS.map((tab) => {
              const Icon = tab.icon;
              const active =
                activeTab === tab.id || (tab.id === 'settings' && activeTab === 'setup_zoho');
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => navigateToTab(tab.id)}
                  className={`w-full h-9 px-3 rounded-md flex items-center justify-between text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <span className="inline-flex items-center gap-2.5">
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{tab.label}</span>
                  </span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-3 border-t border-slate-200 space-y-2">
          <div className="px-3 text-[11px] text-slate-500 flex items-center justify-between">
            <span>Sent Today</span>
            <span className="font-mono tabular-nums text-slate-800">
              {metrics.sentToday} / {metrics.dailyCap}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void handleLogout()}
            className="w-full h-9 px-3 rounded-md text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 flex items-center gap-2.5 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 max-w-full overflow-hidden">
        {/* Top Bar (Compact 56px mobile & desktop) */}
        <header className="h-14 shrink-0 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => navigateToTab('home')}
              className="md:hidden text-sm font-semibold tracking-tight text-slate-900 cursor-pointer shrink-0"
            >
              Outreach Desk
            </button>
            <span className="md:hidden text-slate-300">/</span>
            <div className="text-sm font-medium text-slate-900 truncate whitespace-nowrap">
              <span className="hidden md:inline text-slate-400">Workspace</span>
              <span className="hidden md:inline mx-2 text-slate-300">/</span>
              <span>{currentTabLabel}</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {activeTab !== 'chat' && (
              <button
                type="button"
                onClick={() => navigateToTab('chat')}
                className="min-h-[36px] px-3 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Agent Chat</span>
                <span className="sm:hidden">Chat</span>
              </button>
            )}
          </div>
        </header>

        {/* Active Page View (with bottom padding on mobile for fixed bottom nav) */}
        <main className="flex-1 min-w-0 min-h-0 overflow-y-auto overflow-x-hidden pb-20 md:pb-0">
          {activeTab === 'home' && (
            <DashboardHome
              metrics={metrics}
              leadCounts={leadCounts}
              dailyActivity={dailyActivity}
              recentLogs={recentLogs}
              zohoConnected={Boolean(authState.integrations.zoho)}
              zohoEmail={zohoEmail}
              loading={dashboardLoading}
              onRefresh={refreshDashboard}
              onOpenChat={() => navigateToTab('chat')}
              onOpenLeads={() => navigateToTab('leads')}
              onOpenInbox={() => navigateToTab('inbox')}
              onOpenLogs={() => navigateToTab('activity')}
              onOpenZohoSetup={() => navigateToTab('setup_zoho')}
            />
          )}
          {activeTab === 'chat' && (
            <ChatPanel
              chatId={chatId}
              messages={messages}
              setMessages={setMessages}
              onNewChat={handleNewChat}
              onSelectChat={handleSelectChatSession}
              draftPrompt={draftPrompt}
              onClearDraftPrompt={() => setDraftPrompt(undefined)}
              onApproveAction={handleApproveAction}
              onRejectAction={handleRejectAction}
              onRefreshDashboard={refreshDashboard}
              pendingMap={pendingMap}
            />
          )}
          {activeTab === 'leads' && (
            <LeadsPanel onRefreshDashboard={refreshDashboard} />
          )}
          {activeTab === 'campaigns' && (
            <CampaignsPanel
              onRefreshDashboard={refreshDashboard}
              onApproveAction={handleApproveAction}
              onRejectAction={handleRejectAction}
            />
          )}
          {activeTab === 'inbox' && (
            <InboxPanel
              onRefreshDashboard={refreshDashboard}
              onAskAgentDraft={(prompt) => {
                setDraftPrompt(prompt);
                navigateToTab('chat');
              }}
              onOpenZohoSetup={() => navigateToTab('setup_zoho')}
            />
          )}
          {activeTab === 'activity' && (
            <ActivityPanel
              onApproveAction={handleApproveAction}
              onRejectAction={handleRejectAction}
              onRefreshDashboard={refreshDashboard}
            />
          )}
          {activeTab === 'memory' && <MemoryPanel />}
          {activeTab === 'settings' && (
            <SettingsPanel onOpenZohoSetup={() => navigateToTab('setup_zoho')} />
          )}
          {activeTab === 'setup_zoho' && (
            <ZohoSetupPage
              onBackToSettings={() => navigateToTab('settings')}
              onConnected={async () => {
                await Promise.all([checkAuth(), refreshDashboard()]);
              }}
            />
          )}
        </main>
      </div>

      {/* Mobile Fixed Bottom Navigation Bar (<md) */}
      <nav
        aria-label="Mobile Navigation"
        className="md:hidden fixed bottom-0 inset-x-0 z-40 h-16 bg-white border-t border-slate-200 grid grid-cols-5"
      >
        {MOBILE_PRIMARY_TABS.map((tabId) => {
          const tab = NAV_TABS.find((t) => t.id === tabId)!;
          const Icon = tab.icon;
          const active = activeTab === tabId;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => navigateToTab(tab.id)}
              className={`min-h-[44px] flex flex-col items-center justify-center gap-1 text-[11px] font-medium cursor-pointer transition-colors ${
                active ? 'text-slate-900' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Icon className={`w-5 h-5 ${active ? 'stroke-[2.25]' : 'stroke-[1.75]'}`} />
              <span>{tab.shortLabel}</span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setMoreSheetOpen((prev) => !prev)}
          className={`min-h-[44px] flex flex-col items-center justify-center gap-1 text-[11px] font-medium cursor-pointer transition-colors ${
            isMoreActive || moreSheetOpen ? 'text-slate-900' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <MoreHorizontal className="w-5 h-5" />
          <span>More</span>
        </button>
      </nav>

      {/* Mobile "More" Dedicated Pages Sheet */}
      {moreSheetOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end">
          <div
            className="flex-1 bg-slate-900/40"
            onClick={() => setMoreSheetOpen(false)}
          />
          <div className="bg-white border-t border-slate-200 rounded-t-xl p-4 pb-6 space-y-3 shadow-lg">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <span className="text-sm font-semibold text-slate-900">Pages & Tools</span>
              <button
                type="button"
                onClick={() => setMoreSheetOpen(false)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-500 cursor-pointer"
                aria-label="Close menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {(['campaigns', 'activity', 'memory', 'settings'] as const).map((tabId) => {
                const tab = NAV_TABS.find((t) => t.id === tabId)!;
                const Icon = tab.icon;
                const active = activeTab === tabId;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => navigateToTab(tab.id)}
                    className={`min-h-[48px] px-3.5 rounded-lg border text-xs font-medium flex items-center gap-2.5 cursor-pointer ${
                      active
                        ? 'bg-slate-900 border-slate-900 text-white'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => navigateToTab('setup_zoho')}
                className={`min-h-[48px] px-3.5 rounded-lg border text-xs font-medium flex items-center gap-2.5 cursor-pointer ${
                  activeTab === 'setup_zoho'
                    ? 'bg-slate-900 border-slate-900 text-white'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <MailCheck className="w-4 h-4 shrink-0" />
                <span>Connect Zoho</span>
              </button>

              <button
                type="button"
                onClick={() => void handleLogout()}
                className="min-h-[48px] px-3.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-red-700 flex items-center gap-2.5 cursor-pointer"
              >
                <LogOut className="w-4 h-4 shrink-0" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
