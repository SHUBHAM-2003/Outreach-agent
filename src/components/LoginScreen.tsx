import React, { useState } from 'react';
import { Lock, ArrowRight } from 'lucide-react';
import { apiFetch } from '../lib/api.ts';

interface LoginScreenProps {
  setupRequired: boolean;
  onAuthenticated: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  setupRequired,
  onAuthenticated,
}) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (setupRequired) {
      if (password.length < 8) {
        setError('Password must be at least 8 characters.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
    }

    setLoading(true);
    try {
      const endpoint = setupRequired ? '/api/auth/claim' : '/api/auth/login';
      await apiFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      onAuthenticated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-lg p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-9 h-9 rounded-md bg-slate-900 text-white flex items-center justify-center shrink-0">
            <Lock className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-900 tracking-tight">
              Agency Outreach Agent
            </h1>
            <p className="text-xs text-slate-500">
              {setupRequired
                ? 'First-run setup · Claim workspace password'
                : 'Operator sign-in required'}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="workspace-password"
              className="block text-xs font-medium text-slate-700 mb-1.5"
            >
              {setupRequired ? 'Create Workspace Password' : 'Workspace Password'}
            </label>
            <input
              id="workspace-password"
              type="password"
              autoFocus
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={setupRequired ? 'Minimum 8 characters' : 'Enter password'}
              className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
            />
          </div>

          {setupRequired && (
            <div>
              <label
                htmlFor="confirm-password"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Confirm Password
              </label>
              <input
                id="confirm-password"
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
                className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
              />
            </div>
          )}

          {error && (
            <div className="p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full h-10 px-4 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium rounded-md flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <span>
              {loading
                ? 'Verifying...'
                : setupRequired
                ? 'Set Password & Enter Workspace'
                : 'Sign In'}
            </span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <p className="mt-6 pt-4 border-t border-slate-200 text-xs text-slate-500 leading-relaxed">
          {setupRequired
            ? 'APP_PASSWORD is not currently set in environment secrets. Claiming a password here protects this workspace until APP_PASSWORD is configured.'
            : 'Protected with signed HttpOnly session cookies. Every Gemini and Zoho Mail call runs strictly on the server.'}
        </p>
      </div>
    </div>
  );
};
