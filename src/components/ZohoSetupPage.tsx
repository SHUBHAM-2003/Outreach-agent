import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  Copy,
  Check,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { apiFetch, ApiError } from '../lib/api.ts';

interface ZohoSetupPageProps {
  onBackToSettings: () => void;
  onConnected: () => Promise<void>;
}

interface ZohoStatusResponse {
  alreadyConnected: boolean;
  connected: boolean;
  fromAddress: string | null;
  accountId: string | null;
  clientConfigured: boolean;
  updatedAt: string | null;
}

interface ConnectResponse {
  email: string;
  accountId: string;
  refresh_token: string;
  folderCount: number;
  message: string;
}

export const ZohoSetupPage: React.FC<ZohoSetupPageProps> = ({
  onBackToSettings,
  onConnected,
}) => {
  const [statusLoading, setStatusLoading] = useState(true);
  const [alreadyConnected, setAlreadyConnected] = useState(false);
  const [existingEmail, setExistingEmail] = useState<string | null>(null);
  const [existingAccountId, setExistingAccountId] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);

  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [connectResult, setConnectResult] = useState<ConnectResponse | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<'refresh_token' | 'accountId' | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const loadZohoStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const data = await apiFetch<ZohoStatusResponse>('/api/setup/zoho');
      setAlreadyConnected(Boolean(data.alreadyConnected));
      setExistingEmail(data.fromAddress);
      setExistingAccountId(data.accountId);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) {
        setErrorText(err instanceof Error ? err.message : 'Unable to check Zoho status.');
      }
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadZohoStatus();
  }, [loadZohoStatus]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || submitting) return;

    setSubmitting(true);
    setErrorText(null);
    setConnectResult(null);

    try {
      const res = await apiFetch<ConnectResponse>('/api/setup/zoho', {
        method: 'POST',
        body: JSON.stringify({ code: code.trim() }),
      });
      setConnectResult(res);
      setAlreadyConnected(true);
      setExistingEmail(res.email);
      setExistingAccountId(res.accountId);
      setReconnecting(false);
      setCode('');
      await onConnected();
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : 'Failed to connect Zoho Mail.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleStartReconnect() {
    setReconnecting(true);
    setConnectResult(null);
    setErrorText(null);
    setCode('');
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleRetry() {
    setErrorText(null);
    setCode('');
    inputRef.current?.focus();
  }

  async function handleCopy(field: 'refresh_token' | 'accountId', value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => {
        setCopiedField((cur) => (cur === field ? null : cur));
      }, 2000);
    } catch {
      // Clipboard blocked in restricted context
    }
  }

  const showAlreadyConnectedView =
    !statusLoading && alreadyConnected && !reconnecting && !connectResult;

  return (
    <div className="p-4 sm:p-6 max-w-xl mx-auto space-y-6 min-w-0">
      <div className="flex items-center justify-between gap-2 min-w-0">
        <button
          type="button"
          onClick={onBackToSettings}
          className="text-xs font-medium text-slate-600 hover:text-slate-900 inline-flex items-center gap-1.5 cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Settings</span>
        </button>
        <span className="font-mono text-xs text-slate-400 shrink-0">/setup/zoho</span>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-4 sm:p-6 space-y-5 min-w-0 overflow-hidden">
        <div className="space-y-1 min-w-0">
          <h2 className="text-lg font-semibold text-slate-900 tracking-tight">
            Connect Zoho Mail (.in)
          </h2>
          <p className="text-xs text-slate-600 leading-relaxed break-words [overflow-wrap:anywhere]">
            Paste a Self Client authorization code generated from the Zoho India API Console with{' '}
            <span className="font-mono text-slate-800 break-all">
              ZohoMail.accounts.READ,ZohoMail.messages.ALL,ZohoMail.folders.ALL
            </span>{' '}
            scopes.
          </p>
        </div>

        {statusLoading ? (
          <div className="h-24 bg-slate-100 rounded-md animate-pulse" />
        ) : showAlreadyConnectedView ? (
          <div className="p-4 rounded-md bg-emerald-50 border border-emerald-200 space-y-3 min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-4 min-w-0">
              <div className="flex items-start gap-2.5 text-emerald-900 min-w-0 flex-1">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-700" />
                <div className="space-y-1 text-xs min-w-0 flex-1">
                  <div className="font-semibold">Already connected</div>
                  {existingEmail && (
                    <div className="text-emerald-800 break-words [overflow-wrap:anywhere]">
                      Connected as <span className="font-mono font-medium">{existingEmail}</span>
                    </div>
                  )}
                  {existingAccountId && (
                    <div className="text-emerald-800 break-all">
                      Account ID: <span className="font-mono">{existingAccountId}</span>
                    </div>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={handleStartReconnect}
                className="h-9 px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Reconnect</span>
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="zoho-auth-code"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Zoho authorization code
              </label>
              <input
                ref={inputRef}
                id="zoho-auth-code"
                type="text"
                required
                autoFocus
                disabled={submitting}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="1000.xxxxxxxxxxxxxxxxxxxxxxxx.xxxxxxxxxxxxxxxxxxxxxxxx"
                className="w-full h-10 px-3 font-mono text-xs bg-white border border-slate-300 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 disabled:bg-slate-50"
              />
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="submit"
                disabled={submitting || !code.trim()}
                className="h-10 px-5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{submitting ? 'Connecting...' : 'Connect'}</span>
              </button>

              {reconnecting && !submitting && (
                <button
                  type="button"
                  onClick={() => {
                    setReconnecting(false);
                    setErrorText(null);
                  }}
                  className="h-10 px-4 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-xs font-medium rounded-md cursor-pointer"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        )}

        {connectResult && (
          <div className="p-4 rounded-md bg-emerald-50 border border-emerald-200 space-y-4 min-w-0">
            <div className="flex items-start gap-2.5 text-emerald-900 min-w-0">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-700" />
              <div className="space-y-0.5 text-xs min-w-0 flex-1">
                <div className="font-semibold break-words [overflow-wrap:anywhere]">
                  Connected as {connectResult.email}
                </div>
                <div className="text-emerald-800 break-words">
                  Saved to <span className="font-mono">Neon Postgres (zoho_config)</span>
                  {connectResult.folderCount > 0
                    ? ` · ${connectResult.folderCount} folders verified`
                    : ''}
                </div>
              </div>
            </div>

            <div className="bg-white border border-emerald-200 rounded-md p-3.5 space-y-3 min-w-0">
              <div className="text-[11px] font-medium text-slate-600">
                Shown once — copy these values if you also want to configure environment variables:
              </div>

              <div className="space-y-1 min-w-0">
                <div className="text-[11px] font-mono text-slate-500">ZOHO_REFRESH_TOKEN</div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 min-w-0">
                  <code className="flex-1 min-w-0 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded font-mono text-[11px] text-slate-900 break-all">
                    {connectResult.refresh_token}
                  </code>
                  <button
                    type="button"
                    onClick={() => void handleCopy('refresh_token', connectResult.refresh_token)}
                    className="h-8 px-2.5 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-xs font-medium rounded-md inline-flex items-center gap-1 shrink-0 self-start sm:self-auto cursor-pointer"
                  >
                    {copiedField === 'refresh_token' ? (
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

              <div className="space-y-1 min-w-0">
                <div className="text-[11px] font-mono text-slate-500">ZOHO_ACCOUNT_ID</div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 min-w-0">
                  <code className="flex-1 min-w-0 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded font-mono text-[11px] text-slate-900 break-all">
                    {connectResult.accountId}
                  </code>
                  <button
                    type="button"
                    onClick={() => void handleCopy('accountId', connectResult.accountId)}
                    className="h-8 px-2.5 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-xs font-medium rounded-md inline-flex items-center gap-1 shrink-0 self-start sm:self-auto cursor-pointer"
                  >
                    {copiedField === 'accountId' ? (
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
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onBackToSettings}
                className="h-8 px-3 bg-white hover:bg-emerald-100/60 border border-emerald-300 text-emerald-900 text-xs font-medium rounded-md cursor-pointer"
              >
                Return to Settings
              </button>
              <button
                type="button"
                onClick={handleStartReconnect}
                className="h-8 px-3 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-xs font-medium rounded-md cursor-pointer"
              >
                Reconnect
              </button>
            </div>
          </div>
        )}

        {errorText && (
          <div className="p-4 rounded-md bg-red-50 border border-red-200 space-y-3 min-w-0">
            <div className="flex items-start gap-2.5 text-red-900 min-w-0">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-700" />
              <div className="space-y-1 text-xs min-w-0 flex-1">
                <div className="font-semibold">Zoho connection error</div>
                <div className="font-mono text-red-800 leading-relaxed break-words [overflow-wrap:anywhere]">
                  {errorText}
                </div>
              </div>
            </div>
            <div>
              <button
                type="button"
                onClick={handleRetry}
                className="h-8 px-3 bg-white hover:bg-red-100/50 border border-red-300 text-red-800 text-xs font-medium rounded-md inline-flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Retry with a new code</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
