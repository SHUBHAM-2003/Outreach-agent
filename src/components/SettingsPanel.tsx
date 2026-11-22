import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, CheckCircle2, AlertCircle, Eye, EyeOff, Copy, Check } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall.ts';
import { apiFetch, ApiError } from '../lib/api.ts';
import { PWAInstallButton } from './PWAInstallButton.tsx';

interface SettingsResponse {
  zoho: {
    connected: boolean;
    alreadyConnected: boolean;
    source: 'zoho_config' | 'env' | 'none';
    accountId: string | null;
    fromAddress: string | null;
    clientConfigured: boolean;
    updatedAt: string | null;
  };
  storage: {
    connected: boolean;
    label: string;
    error?: string;
  };
  dailySendCap: number;
  integrations: {
    gemini: boolean;
  };
}

interface SettingsPanelProps {
  onOpenZohoSetup: () => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ onOpenZohoSetup }) => {
  const { isInstalled } = usePWAInstall();
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [revealingToken, setRevealingToken] = useState(false);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<SettingsResponse>('/api/settings');
      setSettings(data);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) {
        setError(err instanceof Error ? err.message : 'Failed to load settings.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  async function handleRevealToken() {
    if (revealedToken !== null) {
      setRevealedToken(null);
      setCopiedToken(false);
      return;
    }

    setRevealingToken(true);
    setTokenError(null);
    try {
      const data = await apiFetch<{ refresh_token: string }>('/api/settings/zoho-token', {
        method: 'POST',
      });
      setRevealedToken(data.refresh_token);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) {
        setTokenError(
          err instanceof Error ? err.message : 'Unable to reveal saved refresh token.'
        );
      }
    } finally {
      setRevealingToken(false);
    }
  }

  async function handleCopyToken() {
    if (!revealedToken) return;
    try {
      await navigator.clipboard.writeText(revealedToken);
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
    } catch {
      // Clipboard blocked in restricted context
    }
  }

  if (loading) {
    return (
      <div className="p-6 max-w-3xl space-y-4">
        <div className="h-28 bg-white border border-slate-200 rounded-lg animate-pulse" />
        <div className="h-28 bg-white border border-slate-200 rounded-lg animate-pulse" />
      </div>
    );
  }

  if (error || !settings) {
    return (
      <div className="p-6 max-w-3xl">
        <div className="p-4 bg-red-50 border border-red-200 rounded-md text-xs text-red-700">
          {error || 'Unable to load settings.'}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-3xl space-y-5 min-w-0">
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-slate-900">Workspace Settings</h2>
        <p className="text-xs text-slate-500 break-words">
          Manage Zoho Mail (.in) OAuth connection and review server integration readiness.
        </p>
      </div>

      {/* Zoho Mail Connection */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 sm:p-5 space-y-4 min-w-0 overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 min-w-0">
          <div className="space-y-1 min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-slate-900">Zoho Mail (India DC · .in)</h3>
            <div className="flex items-center gap-2 text-xs min-w-0">
              {settings.zoho.connected ? (
                <span className="inline-flex items-center gap-1.5 text-emerald-700 font-medium min-w-0">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span className="break-words [overflow-wrap:anywhere] min-w-0">
                    Connected as {settings.zoho.fromAddress}
                  </span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-amber-700 font-medium">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>Not connected</span>
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {settings.zoho.alreadyConnected && (
              <button
                type="button"
                disabled={revealingToken}
                onClick={() => void handleRevealToken()}
                className="min-h-[44px] sm:min-h-[38px] px-3.5 bg-white hover:bg-slate-50 disabled:opacity-50 border border-slate-300 text-slate-700 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {revealedToken !== null ? (
                  <>
                    <EyeOff className="w-3.5 h-3.5" />
                    <span>Hide refresh token</span>
                  </>
                ) : (
                  <>
                    <Eye className="w-3.5 h-3.5" />
                    <span>{revealingToken ? 'Revealing...' : 'Reveal refresh token'}</span>
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={onOpenZohoSetup}
              className="min-h-[44px] sm:min-h-[38px] px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-md inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>
                {settings.zoho.alreadyConnected || settings.zoho.connected
                  ? 'Reconnect'
                  : 'Connect Zoho'}
              </span>
            </button>
          </div>
        </div>

        {tokenError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-700">
            {tokenError}
          </div>
        )}

        {revealedToken !== null && (
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-md space-y-1.5 min-w-0">
            <div className="text-[11px] font-mono text-slate-500">
              Saved ZOHO_REFRESH_TOKEN (from Neon kv.zoho_config)
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 min-w-0">
              <code className="flex-1 min-w-0 px-2.5 py-1.5 bg-white border border-slate-200 rounded font-mono text-[11px] text-slate-900 break-all">
                {revealedToken}
              </code>
              <button
                type="button"
                onClick={() => void handleCopyToken()}
                className="h-8 px-2.5 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 text-xs font-medium rounded-md inline-flex items-center gap-1 shrink-0 self-start sm:self-auto cursor-pointer"
              >
                {copiedToken ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-700" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        <div className="border-t border-slate-200 pt-3 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs min-w-0">
          <div className="min-w-0">
            <div className="text-slate-500">Config Source</div>
            <div className="font-mono text-slate-900 mt-0.5 break-words [overflow-wrap:anywhere]">
              {settings.zoho.source === 'zoho_config'
                ? 'Neon Postgres (kv.zoho_config)'
                : settings.zoho.source === 'env'
                ? 'Environment Vars'
                : 'Unconfigured'}
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-slate-500">Account ID</div>
            <div className="font-mono tabular-nums text-slate-900 mt-0.5 break-all">
              {settings.zoho.accountId || '-'}
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-slate-500">Client Credentials</div>
            <div className="font-mono text-slate-900 mt-0.5 break-words [overflow-wrap:anywhere]">
              {settings.zoho.clientConfigured ? 'Configured (env)' : 'Missing ZOHO_CLIENT_ID/SECRET'}
            </div>
          </div>
        </div>
      </div>

      {/* Runtime Configuration Summary */}
      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-200">
        <div className="px-5 py-3 bg-slate-50 text-xs font-medium text-slate-600">
          Server Runtime & Limits
        </div>
        <div className="px-5 py-3 flex items-center justify-between text-xs">
          <span className="text-slate-600">Daily Outbound Cap (DAILY_SEND_CAP)</span>
          <span className="font-mono tabular-nums font-medium text-slate-900">
            {settings.dailySendCap} emails / day
          </span>
        </div>
        <div className="px-5 py-3 flex items-center justify-between gap-4 text-xs">
          <span className="text-slate-600 shrink-0">Persistence Storage</span>
          <span
            className={`font-mono font-medium text-right break-all ${
              settings.storage?.connected ? 'text-emerald-700' : 'text-red-700'
            }`}
          >
            {settings.storage?.connected
              ? 'Storage: Neon connected'
              : settings.storage?.error || settings.storage?.label || 'Storage connection error'}
          </span>
        </div>
        <div className="px-5 py-3 flex items-center justify-between text-xs">
          <span className="text-slate-600">Gemini Server API</span>
          <span
            className={`font-medium ${
              settings.integrations.gemini ? 'text-emerald-700' : 'text-red-700'
            }`}
          >
            {settings.integrations.gemini ? 'Ready' : 'Missing GEMINI_API_KEY'}
          </span>
        </div>
      </div>

      {/* Home Screen Shortcut / PWA Installation */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4 min-w-0">
        <div className="space-y-1 min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-900">Home Screen App Shortcut</h3>
          <p className="text-xs text-slate-500 break-words">
            {isInstalled
              ? 'Running as an installed standalone shortcut app.'
              : 'Install Outreach on your phone or desktop Home screen directly from Chrome.'}
          </p>
        </div>

        {isInstalled ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 shrink-0">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Installed</span>
          </span>
        ) : (
          <PWAInstallButton showGuideWhenUnavailable />
        )}
      </div>
    </div>
  );
};
