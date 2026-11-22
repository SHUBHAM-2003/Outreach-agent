import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import {
  CATEGORY_BADGE_CLASS,
  CATEGORY_LABEL,
  classifyActionLogCategory,
  LOG_CATEGORIES,
  summarizeActionLogEntry,
} from '../../modules/outreach/classification.ts';
import type { ActionLog, LogCategory, PendingAction } from '../../modules/outreach/types.ts';
import { apiFetch, ApiError } from '../lib/api.ts';
import { ApprovalCard } from './ApprovalCard.tsx';

interface ActivityPanelProps {
  onApproveAction: (id: string) => Promise<void>;
  onRejectAction: (id: string) => Promise<void>;
  onRefreshDashboard: () => Promise<void>;
}

type ActivityFilter = 'all' | 'failed' | LogCategory;

const REVERSIBLE_ACTIONS = new Set([
  'update_lead',
  'approve_run_campaign',
  'update_memory',
]);

export const ActivityPanel: React.FC<ActivityPanelProps> = ({
  onApproveAction,
  onRejectAction,
  onRefreshDashboard,
}) => {
  const [pending, setPending] = useState<PendingAction[]>([]);
  const [logs, setLogs] = useState<ActionLog[]>([]);
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [expandedDetails, setExpandedDetails] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const loadActivity = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{
        pending_actions: PendingAction[];
        action_log: ActionLog[];
      }>('/api/actions');
      setPending(data.pending_actions ?? []);
      setLogs(data.action_log ?? []);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) {
        setNotice(err instanceof Error ? err.message : 'Failed to load activity log.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadActivity();
  }, [loadActivity]);

  async function handleUndo(logId: string) {
    setNotice(null);
    try {
      const res = await apiFetch<{ ok: boolean; message: string }>(
        `/api/actions/undo/${logId}`,
        { method: 'POST' }
      );
      setNotice(res.message);
      await Promise.all([loadActivity(), onRefreshDashboard()]);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Undo failed.');
    }
  }

  const openPending = pending.filter((p) => p.status === 'pending');

  const enrichedLogs = logs.map((entry) => {
    const category = classifyActionLogCategory(entry.action);
    const parsed = summarizeActionLogEntry(entry.action, entry.details ?? {});
    return {
      entry,
      category,
      failed: parsed.status === 'failed',
      summary: parsed.error || parsed.summary,
    };
  });

  const failedCount = enrichedLogs.filter((item) => item.failed).length;
  const categoryCounts: Record<LogCategory, number> = {
    outreach: 0,
    inbox: 0,
    leads: 0,
    campaigns: 0,
    system: 0,
  };
  for (const item of enrichedLogs) {
    categoryCounts[item.category] = (categoryCounts[item.category] ?? 0) + 1;
  }

  const visibleLogs = enrichedLogs.filter((item) => {
    if (filter === 'all') return true;
    if (filter === 'failed') return item.failed;
    return item.category === filter;
  });

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5 min-w-0">
      <div className="space-y-3 min-w-0">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900">Agent Activity & Error Log</h2>
          <p className="text-xs text-slate-500 break-words">
            All actions, sends, lead updates, and failures classified by area.
          </p>
        </div>

        {/* Classified Filter Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto max-w-full pb-1">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              filter === 'all'
                ? 'bg-slate-900 border-slate-900 text-white'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            All ({enrichedLogs.length})
          </button>
          {LOG_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setFilter(cat.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md border whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                filter === cat.id
                  ? 'bg-slate-900 border-slate-900 text-white'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {cat.label} ({categoryCounts[cat.id]})
            </button>
          ))}
          <button
            type="button"
            onClick={() => setFilter('failed')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              filter === 'failed'
                ? 'bg-red-700 border-red-700 text-white'
                : 'bg-red-50/70 border-red-200 text-red-700 hover:bg-red-100'
            }`}
          >
            Failures ({failedCount})
          </button>
        </div>
      </div>

      {notice && (
        <div className="p-3 bg-white border border-slate-200 rounded-md text-xs text-slate-700 break-words [overflow-wrap:anywhere]">
          {notice}
        </div>
      )}

      {openPending.length > 0 && (
        <div className="space-y-3 min-w-0">
          <h3 className="text-xs font-semibold text-slate-700">
            Pending Approvals ({openPending.length})
          </h3>
          <div className="space-y-3 min-w-0">
            {openPending.map((pa) => (
              <ApprovalCard
                key={pa.id}
                action={pa}
                onApprove={async (id) => {
                  await onApproveAction(id);
                  await loadActivity();
                }}
                onReject={async (id) => {
                  await onRejectAction(id);
                  await loadActivity();
                }}
              />
            ))}
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden min-w-0">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-slate-600 truncate">
            {filter === 'all'
              ? 'All Classified Actions'
              : filter === 'failed'
              ? 'Failed Actions'
              : `${CATEGORY_LABEL[filter]} Actions`}
          </span>
          <span className="text-xs font-mono tabular-nums text-slate-400 shrink-0">
            {visibleLogs.length} {visibleLogs.length === 1 ? 'entry' : 'entries'}
          </span>
        </div>

        {loading ? (
          <div className="p-6 space-y-2.5">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />
            ))}
          </div>
        ) : visibleLogs.length === 0 ? (
          <div className="p-10 text-center text-xs text-slate-500">
            {filter === 'failed'
              ? 'No failed agent actions recorded.'
              : 'No actions recorded in this category yet.'}
          </div>
        ) : (
          <div className="divide-y divide-slate-200 min-w-0">
            {visibleLogs.map(({ entry, category, failed, summary }) => {
              const canUndo = REVERSIBLE_ACTIONS.has(entry.action);
              const detailsOpen = Boolean(expandedDetails[entry.id]);
              return (
                <div
                  key={entry.id}
                  className="px-4 py-3.5 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 hover:bg-slate-50/70 min-w-0"
                >
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs min-w-0">
                      <span
                        className={`px-2 py-0.5 text-[11px] font-medium rounded border shrink-0 ${
                          CATEGORY_BADGE_CLASS[category]
                        }`}
                      >
                        {CATEGORY_LABEL[category]}
                      </span>
                      {failed ? (
                        <span className="inline-flex items-center gap-1 text-red-700 font-semibold shrink-0">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                          <span>Failed</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-medium shrink-0">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          <span>Done</span>
                        </span>
                      )}
                      <span className="font-mono font-medium text-slate-900 break-words [overflow-wrap:anywhere]">
                        {entry.action}
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-slate-400">
                        {new Date(entry.created_at).toLocaleString()}
                      </span>
                    </div>

                    <p
                      className={`text-xs leading-relaxed break-words [overflow-wrap:anywhere] ${
                        failed ? 'text-red-700' : 'text-slate-700'
                      }`}
                    >
                      {summary}
                    </p>

                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedDetails((prev) => ({
                            ...prev,
                            [entry.id]: !detailsOpen,
                          }))
                        }
                        className="text-[11px] font-medium text-slate-500 hover:text-slate-800 inline-flex items-center gap-1 cursor-pointer"
                      >
                        {detailsOpen ? (
                          <ChevronDown className="w-3 h-3" />
                        ) : (
                          <ChevronRight className="w-3 h-3" />
                        )}
                        <span>{detailsOpen ? 'Hide payload' : 'View payload'}</span>
                      </button>

                      {detailsOpen && (
                        <pre className="mt-2 p-2.5 bg-slate-50 border border-slate-200 rounded text-[11px] font-mono text-slate-600 max-w-full overflow-x-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                          {JSON.stringify(entry.details ?? {}, null, 2)}
                        </pre>
                      )}
                    </div>
                  </div>

                  {canUndo && (
                    <button
                      type="button"
                      onClick={() => void handleUndo(entry.id)}
                      className="min-h-[36px] sm:min-h-[32px] px-3 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer self-start"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Undo</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
