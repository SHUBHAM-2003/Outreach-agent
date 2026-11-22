import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Play, Pause, Send, X } from 'lucide-react';
import type { Campaign, PendingAction } from '../../modules/outreach/types.ts';
import { apiFetch, ApiError } from '../lib/api.ts';
import { ApprovalCard } from './ApprovalCard.tsx';

interface CampaignsPanelProps {
  onRefreshDashboard: () => Promise<void>;
  onApproveAction: (id: string) => Promise<void>;
  onRejectAction: (id: string) => Promise<void>;
}

export const CampaignsPanel: React.FC<CampaignsPanelProps> = ({
  onRefreshDashboard,
  onApproveAction,
  onRejectAction,
}) => {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [stats, setStats] = useState<
    Record<string, { queued: number; completed: number; stopped: number; failed: number }>
  >({});
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [stagedAction, setStagedAction] = useState<PendingAction | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [subject, setSubject] = useState('Quick idea for {{company}}');
  const [body, setBody] = useState(
    'Hi {{name}},\n\nI looked at {{website}} and spotted two quick wins that could lift trial conversions for {{company}}.\n\nOpen to a 10-minute teardown video this week?'
  );
  const [followupDays, setFollowupDays] = useState('3,7,14');
  const [dailyCap, setDailyCap] = useState('30');
  const [submitting, setSubmitting] = useState(false);

  const loadCampaigns = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{
        campaigns: Campaign[];
        stats: Record<
          string,
          { queued: number; completed: number; stopped: number; failed: number }
        >;
      }>('/api/campaigns');
      setCampaigns(data.campaigns ?? []);
      setStats(data.stats ?? {});
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) {
        setNotice(err instanceof Error ? err.message : 'Failed to load campaigns.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCampaigns();
  }, [loadCampaigns]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setNotice(null);
    try {
      const days = followupDays
        .split(',')
        .map((n) => Number(n.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
      await apiFetch('/api/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          name,
          brand,
          subject_template: subject,
          body_template: body,
          followup_days: days.length > 0 ? days : [3, 7, 14],
          daily_cap: Number(dailyCap) || 30,
        }),
      });
      setName('');
      setShowCreate(false);
      await loadCampaigns();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Failed to create campaign.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRunCampaign(campaignId: string) {
    setNotice(null);
    try {
      const res = await apiFetch<{
        executed?: boolean;
        queued_count?: number;
        sent_count?: number;
        failed_count?: number;
        requires_approval?: boolean;
        pending_action_id?: string;
        error?: string;
      }>(`/api/campaigns/${campaignId}/run`, {
        method: 'POST',
        body: JSON.stringify({ lead_filter: { status: 'new' } }),
      });
      if (res.error) {
        setNotice(res.error);
        return;
      }
      if (res.pending_action_id) {
        const actionsData = await apiFetch<{ pending_actions: PendingAction[] }>('/api/actions');
        const found = actionsData.pending_actions.find((a) => a.id === res.pending_action_id);
        if (found) setStagedAction(found);
        await onRefreshDashboard();
        return;
      }
      setNotice(
        `Campaign started · Queued ${res.queued_count ?? 0} lead(s) · Sent ${
          res.sent_count ?? 0
        } immediately${res.failed_count ? ` · ${res.failed_count} failed` : ''}`
      );
      await Promise.all([loadCampaigns(), onRefreshDashboard()]);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) {
        setNotice(err instanceof Error ? err.message : 'Failed to run campaign.');
      }
    }
  }

  async function handlePauseResume(c: Campaign) {
    setNotice(null);
    try {
      const endpoint =
        c.status === 'active'
          ? `/api/campaigns/${c.id}/pause`
          : `/api/campaigns/${c.id}/resume`;
      await apiFetch(endpoint, { method: 'POST' });
      await Promise.all([loadCampaigns(), onRefreshDashboard()]);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) {
        setNotice(err instanceof Error ? err.message : 'Failed to update campaign status.');
      }
    }
  }

  async function handleManualSendQueue() {
    setNotice(null);
    try {
      const res = await apiFetch<{
        status: string;
        sentCount: number;
        sentToday: number;
        dailyCap: number;
        details?: Array<{ message?: string }>;
      }>('/api/sending/run', { method: 'POST' });
      const msg = res.details?.[0]?.message;
      setNotice(
        `Sending run: ${res.status} · Sent ${res.sentCount} (${res.sentToday}/${res.dailyCap} today)${
          msg ? ` — ${msg}` : ''
        }`
      );
      await Promise.all([loadCampaigns(), onRefreshDashboard()]);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Sending run failed.');
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3 min-w-0">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-slate-900">Outreach Campaigns</h2>
          <p className="text-xs text-slate-500 break-words">
            Create email sequences and run them directly against matching leads.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void handleManualSendQueue()}
            className="min-h-[44px] sm:min-h-[36px] px-3.5 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-xs font-medium rounded-md inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Process Send Queue</span>
          </button>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="min-h-[44px] sm:min-h-[36px] px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-md inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Campaign</span>
          </button>
        </div>
      </div>

      {notice && (
        <div className="p-3 bg-white border border-slate-200 rounded-md text-xs text-slate-700 break-words [overflow-wrap:anywhere]">
          {notice}
        </div>
      )}

      {stagedAction && stagedAction.status === 'pending' && (
        <ApprovalCard
          action={stagedAction}
          onApprove={async (id) => {
            await onApproveAction(id);
            setStagedAction(null);
            await loadCampaigns();
          }}
          onReject={async (id) => {
            await onRejectAction(id);
            setStagedAction(null);
            await loadCampaigns();
          }}
        />
      )}

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-8 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 bg-slate-100 rounded animate-pulse" />
            ))}
          </div>
        ) : campaigns.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">No campaigns created yet</h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Create an outreach sequence with {'{{name}}'}, {'{{company}}'}, and {'{{website}}'}{' '}
              merge fields, then stage it for approval.
            </p>
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="h-9 px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-md inline-flex items-center gap-2 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create First Campaign</span>
            </button>
          </div>
        ) : (
          <>
            {/* Mobile Cards */}
            <div className="md:hidden divide-y divide-slate-200 min-w-0">
              {campaigns.map((c) => {
                const st = stats[c.id] ?? { queued: 0, completed: 0, stopped: 0, failed: 0 };
                return (
                  <div key={c.id} className="p-4 space-y-3 min-w-0">
                    <div className="flex items-start justify-between gap-3 min-w-0">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-slate-900 break-words [overflow-wrap:anywhere]">
                          {c.name}
                        </div>
                        <div className="text-xs text-slate-500 break-words [overflow-wrap:anywhere]">
                          {c.subject_template}
                        </div>
                      </div>
                      <span
                        className={`text-xs font-medium shrink-0 ${
                          c.status === 'active'
                            ? 'text-emerald-700'
                            : c.status === 'paused'
                            ? 'text-amber-700'
                            : 'text-slate-600'
                        }`}
                      >
                        {c.status}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 font-mono tabular-nums">
                      <span>{c.brand}</span>
                      <span>·</span>
                      <span>Cap {c.daily_cap}/d</span>
                      <span>·</span>
                      <span>
                        {st.queued} queued / {st.completed} done
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleRunCampaign(c.id)}
                        className="min-h-[44px] flex-1 px-3 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-md cursor-pointer"
                      >
                        Run & Send
                      </button>
                      {(c.status === 'active' || c.status === 'paused') && (
                        <button
                          type="button"
                          onClick={() => void handlePauseResume(c)}
                          className="min-h-[44px] px-3.5 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-xs font-medium rounded-md inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          {c.status === 'active' ? (
                            <>
                              <Pause className="w-3.5 h-3.5" />
                              <span>Pause</span>
                            </>
                          ) : (
                            <>
                              <Play className="w-3.5 h-3.5" />
                              <span>Resume</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                    <th className="py-2.5 px-4">Campaign</th>
                    <th className="py-2.5 px-4">Brand</th>
                    <th className="py-2.5 px-4">Follow-ups</th>
                    <th className="py-2.5 px-4 text-right">Daily Cap</th>
                    <th className="py-2.5 px-4 text-right">Queued / Done</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-sm">
                  {campaigns.map((c) => {
                    const st = stats[c.id] ?? { queued: 0, completed: 0, stopped: 0, failed: 0 };
                    return (
                      <tr key={c.id} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4 max-w-xs">
                          <div className="font-medium text-slate-900 break-words [overflow-wrap:anywhere]">
                            {c.name}
                          </div>
                          <div className="text-xs text-slate-500 break-words [overflow-wrap:anywhere]">
                            {c.subject_template}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-slate-700 whitespace-nowrap">{c.brand}</td>
                        <td className="py-3 px-4 font-mono text-xs text-slate-600 whitespace-nowrap">
                          Day {(c.followup_days ?? [3, 7, 14]).join(' / ')}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-xs tabular-nums text-slate-700">
                          {c.daily_cap}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-xs tabular-nums text-slate-700">
                          {st.queued} / {st.completed}
                        </td>
                        <td className="py-3 px-4 text-xs font-medium whitespace-nowrap">
                          <span
                            className={
                              c.status === 'active'
                                ? 'text-emerald-700'
                                : c.status === 'paused'
                                ? 'text-amber-700'
                                : 'text-slate-600'
                            }
                          >
                            {c.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void handleRunCampaign(c.id)}
                              className="h-8 px-3 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-md cursor-pointer"
                            >
                              Run & Send
                            </button>
                            {(c.status === 'active' || c.status === 'paused') && (
                              <button
                                type="button"
                                onClick={() => void handlePauseResume(c)}
                                className="h-8 px-2.5 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-xs font-medium rounded-md inline-flex items-center gap-1 cursor-pointer"
                              >
                                {c.status === 'active' ? (
                                  <>
                                    <Pause className="w-3 h-3" />
                                    <span>Pause</span>
                                  </>
                                ) : (
                                  <>
                                    <Play className="w-3 h-3" />
                                    <span>Resume</span>
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Create Campaign Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-white border border-slate-200 rounded-lg p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">Create Outreach Campaign</h3>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Campaign Name
                  </label>
                  <input
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Q4 SaaS Audit Sequence"
                    className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Brand</label>
                  <input
                    required
                    value={brand}
                    onChange={(e) => setBrand(e.target.value)}
                    placeholder="Your Agency Name"
                    className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-md"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Subject Template
                </label>
                <input
                  required
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-md"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Body Template (variables: {'{{name}}'}, {'{{company}}'}, {'{{website}}'})
                </label>
                <textarea
                  required
                  rows={5}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="w-full p-3 text-sm bg-white border border-slate-300 rounded-md"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Follow-up Days (comma-separated)
                  </label>
                  <input
                    value={followupDays}
                    onChange={(e) => setFollowupDays(e.target.value)}
                    className="w-full h-9 px-3 font-mono text-xs bg-white border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Daily Cap
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={dailyCap}
                    onChange={(e) => setDailyCap(e.target.value)}
                    className="w-full h-9 px-3 font-mono text-xs bg-white border border-slate-300 rounded-md"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="h-9 px-4 bg-white border border-slate-300 text-slate-700 text-xs font-medium rounded-md cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="h-9 px-4 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-medium rounded-md cursor-pointer"
                >
                  {submitting ? 'Creating...' : 'Create Campaign'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
