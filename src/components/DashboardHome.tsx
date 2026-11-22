import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Inbox,
  MessageSquare,
  RefreshCw,
  Send,
} from 'lucide-react';
import {
  CATEGORY_BADGE_CLASS,
  CATEGORY_LABEL,
  classifyActionLogCategory,
  LOG_CATEGORIES,
} from '../../modules/outreach/classification.ts';
import type {
  DailyActivityPoint,
  DashboardLogEntry,
  DashboardMetrics,
  LogCategory,
} from '../../modules/outreach/types.ts';

interface DashboardHomeProps {
  metrics: DashboardMetrics;
  leadCounts: Record<string, number>;
  dailyActivity: DailyActivityPoint[];
  recentLogs: DashboardLogEntry[];
  zohoConnected: boolean;
  zohoEmail?: string | null;
  loading: boolean;
  onRefresh: () => Promise<void>;
  onOpenChat: () => void;
  onOpenLeads: () => void;
  onOpenInbox: () => void;
  onOpenLogs: () => void;
  onOpenZohoSetup: () => void;
}

type LogFilterKey = 'all' | 'failed' | LogCategory;

const PIPELINE_STAGES: Array<{ key: string; label: string; barColor: string; textColor: string }> = [
  { key: 'new', label: 'New', barColor: 'bg-slate-400', textColor: 'text-slate-700' },
  { key: 'queued', label: 'Queued', barColor: 'bg-blue-600', textColor: 'text-blue-700' },
  { key: 'sent', label: 'Sent', barColor: 'bg-slate-800', textColor: 'text-slate-900' },
  { key: 'replied', label: 'Replied', barColor: 'bg-amber-500', textColor: 'text-amber-700' },
  { key: 'interested', label: 'Interested', barColor: 'bg-emerald-600', textColor: 'text-emerald-700' },
  { key: 'not_interested', label: 'Not Interested', barColor: 'bg-slate-300', textColor: 'text-slate-500' },
  { key: 'bounced', label: 'Bounced', barColor: 'bg-red-500', textColor: 'text-red-700' },
  { key: 'unsubscribed', label: 'Unsubscribed', barColor: 'bg-red-300', textColor: 'text-red-700' },
];

export const DashboardHome: React.FC<DashboardHomeProps> = ({
  metrics,
  leadCounts,
  dailyActivity,
  recentLogs,
  zohoConnected,
  zohoEmail,
  loading,
  onRefresh,
  onOpenChat,
  onOpenLeads,
  onOpenInbox,
  onOpenLogs,
  onOpenZohoSetup,
}) => {
  const [logFilter, setLogFilter] = useState<LogFilterKey>('all');
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  const dailyPct =
    metrics.dailyCap > 0 ? Math.min(100, Math.round((metrics.sentToday / metrics.dailyCap) * 100)) : 0;
  const ringRadius = 18;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringDashOffset = ringCircumference * (1 - dailyPct / 100);

  const totalLeads =
    metrics.totalLeads ?? Object.values(leadCounts).reduce((acc, val) => acc + (val || 0), 0);
  const replyRate =
    metrics.totalSent > 0 ? Math.round((metrics.replies / metrics.totalSent) * 100) : 0;
  const failedLogsCount = recentLogs.filter((l) => l.status === 'failed').length;

  const categoryCounts: Record<LogCategory, number> = {
    outreach: 0,
    inbox: 0,
    leads: 0,
    campaigns: 0,
    system: 0,
  };
  for (const entry of recentLogs) {
    const cat = entry.category ?? classifyActionLogCategory(entry.action);
    categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;
  }

  const filteredLogs = recentLogs.filter((entry) => {
    if (logFilter === 'all') return true;
    if (logFilter === 'failed') return entry.status === 'failed';
    const cat = entry.category ?? classifyActionLogCategory(entry.action);
    return cat === logFilter;
  });

  // 7-Day chart scale
  const maxDayTotal = Math.max(
    4,
    ...dailyActivity.map((d) => Math.max(d.sent, d.replies, d.failed, d.sent + d.replies))
  );
  const chartHeight = 140;
  const chartWidth = 420;
  const slotWidth = chartWidth / Math.max(1, dailyActivity.length);

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5 sm:space-y-6 min-w-0">
      {/* Header & Primary Quick Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 min-w-0">
        <div className="space-y-0.5 min-w-0">
          <h1 className="text-lg sm:text-xl font-semibold tracking-tight text-slate-900">
            Outreach Dashboard
          </h1>
          <p className="text-xs text-slate-500 break-words [overflow-wrap:anywhere]">
            {zohoConnected && zohoEmail
              ? `Sending via ${zohoEmail} · ${metrics.activeCampaigns ?? 0} active campaign(s)`
              : 'Connect Zoho Mail to start direct sending and reply tracking.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            className="min-h-[44px] sm:min-h-[38px] px-3.5 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-xs font-medium rounded-md inline-flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing || loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          {!zohoConnected && (
            <button
              type="button"
              onClick={onOpenZohoSetup}
              className="min-h-[44px] sm:min-h-[38px] px-3.5 bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 text-xs font-medium rounded-md inline-flex items-center gap-1.5 cursor-pointer"
            >
              <span>Connect Zoho</span>
            </button>
          )}

          <button
            type="button"
            onClick={onOpenInbox}
            className="min-h-[44px] sm:min-h-[38px] px-3.5 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-xs font-medium rounded-md inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Inbox className="w-3.5 h-3.5" />
            <span>Inbox</span>
          </button>

          <button
            type="button"
            onClick={onOpenChat}
            className="min-h-[44px] sm:min-h-[38px] px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-md inline-flex items-center gap-1.5 cursor-pointer"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Send via Chat</span>
          </button>
        </div>
      </div>

      {/* 4-Card KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 min-w-0">
        <div className="min-w-0 overflow-hidden bg-white border border-slate-200 rounded-lg p-3.5 sm:p-4 flex items-center justify-between gap-2.5">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="text-xs font-medium text-slate-500 truncate">Sent Today</div>
            <div className="text-lg sm:text-2xl font-semibold font-mono tabular-nums text-slate-900">
              {metrics.sentToday}
              <span className="text-xs sm:text-sm font-normal text-slate-400"> / {metrics.dailyCap}</span>
            </div>
            <div className="text-[11px] font-mono tabular-nums text-slate-500 break-words">
              {dailyPct}% of daily cap
            </div>
          </div>
          <svg className="w-10 h-10 sm:w-12 sm:h-12 shrink-0 -rotate-90" viewBox="0 0 44 44" aria-hidden="true">
            <circle
              cx="22"
              cy="22"
              r={ringRadius}
              fill="none"
              stroke="#e2e8f0"
              strokeWidth="4"
            />
            <circle
              cx="22"
              cy="22"
              r={ringRadius}
              fill="none"
              stroke="#0f172a"
              strokeWidth="4"
              strokeDasharray={ringCircumference}
              strokeDashoffset={ringDashOffset}
              strokeLinecap="round"
            />
          </svg>
        </div>

        <button
          type="button"
          onClick={onOpenLeads}
          className="min-w-0 overflow-hidden text-left bg-white hover:border-slate-300 border border-slate-200 rounded-lg p-3.5 sm:p-4 space-y-1 transition-colors cursor-pointer"
        >
          <div className="text-xs font-medium text-slate-500 truncate">Total Leads</div>
          <div className="text-lg sm:text-2xl font-semibold font-mono tabular-nums text-slate-900">
            {totalLeads}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-emerald-700 break-words">
            {metrics.interested} interested · {metrics.queued} queued
          </div>
        </button>

        <div className="min-w-0 overflow-hidden bg-white border border-slate-200 rounded-lg p-3.5 sm:p-4 space-y-1">
          <div className="text-xs font-medium text-slate-500 truncate">Replies</div>
          <div className="text-lg sm:text-2xl font-semibold font-mono tabular-nums text-slate-900">
            {metrics.replies}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 break-words">
            {replyRate}% rate · {metrics.totalSent} sent
          </div>
        </div>

        <button
          type="button"
          onClick={onOpenLogs}
          className="min-w-0 overflow-hidden text-left bg-white hover:border-slate-300 border border-slate-200 rounded-lg p-3.5 sm:p-4 space-y-1 transition-colors cursor-pointer"
        >
          <div className="text-xs font-medium text-slate-500 truncate">Failures & Bounces</div>
          <div
            className={`text-lg sm:text-2xl font-semibold font-mono tabular-nums ${
              failedLogsCount > 0 || metrics.bounces > 0 ? 'text-red-700' : 'text-slate-900'
            }`}
          >
            {failedLogsCount + metrics.bounces}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 break-words">
            {failedLogsCount} error{failedLogsCount === 1 ? '' : 's'} · {metrics.bounces} bounced
          </div>
        </button>
      </div>

      {/* Graphical Analytics Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 min-w-0">
        {/* 7-Day Outreach Chart */}
        <div className="lg:col-span-7 min-w-0 overflow-hidden bg-white border border-slate-200 rounded-lg p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-900">7-Day Outreach Activity</h2>
              <p className="text-xs text-slate-500">Daily sent emails, replies, and failures</p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600 shrink-0">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-blue-600 inline-block" />
                Sent
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600 inline-block" />
                Replies
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-red-600 inline-block" />
                Failed
              </span>
            </div>
          </div>

          <div className="w-full overflow-x-auto">
            <svg
              viewBox={`0 0 ${chartWidth} ${chartHeight + 28}`}
              className="w-full min-w-[280px] h-44"
              role="img"
              aria-label="7-day outreach bar chart"
            >
              {[0, 0.5, 1].map((ratio) => {
                const y = Math.round(chartHeight - ratio * (chartHeight - 16));
                const tickValue = Math.round(maxDayTotal * ratio);
                return (
                  <g key={ratio}>
                    <line
                      x1="28"
                      y1={y}
                      x2={chartWidth - 6}
                      y2={y}
                      stroke="#e2e8f0"
                      strokeDasharray={ratio === 0 ? undefined : '3 3'}
                    />
                    <text
                      x="22"
                      y={y + 4}
                      textAnchor="end"
                      className="fill-slate-400 text-[10px] font-mono"
                    >
                      {tickValue}
                    </text>
                  </g>
                );
              })}

              {dailyActivity.map((day, idx) => {
                const usableWidth = chartWidth - 36;
                const colSlot = usableWidth / Math.max(1, dailyActivity.length);
                const groupX = 32 + idx * colSlot + colSlot / 2;
                const barWidth = Math.min(12, Math.max(7, colSlot / 4.2));
                const gap = 2;
                const scale = (chartHeight - 18) / maxDayTotal;

                const sentH = day.sent > 0 ? Math.max(4, Math.round(day.sent * scale)) : 0;
                const replyH = day.replies > 0 ? Math.max(4, Math.round(day.replies * scale)) : 0;
                const failH = day.failed > 0 ? Math.max(4, Math.round(day.failed * scale)) : 0;

                return (
                  <g key={day.date}>
                    <rect
                      x={groupX - barWidth * 1.5 - gap}
                      y={chartHeight - 2}
                      width={barWidth}
                      height={2}
                      rx={1}
                      fill="#f1f5f9"
                    />
                    {sentH > 0 && (
                      <rect
                        x={groupX - barWidth * 1.5 - gap}
                        y={chartHeight - sentH}
                        width={barWidth}
                        height={sentH}
                        rx={2}
                        fill="#2563eb"
                      >
                        <title>{`${day.label}: ${day.sent} sent`}</title>
                      </rect>
                    )}

                    <rect
                      x={groupX - barWidth / 2}
                      y={chartHeight - 2}
                      width={barWidth}
                      height={2}
                      rx={1}
                      fill="#f1f5f9"
                    />
                    {replyH > 0 && (
                      <rect
                        x={groupX - barWidth / 2}
                        y={chartHeight - replyH}
                        width={barWidth}
                        height={replyH}
                        rx={2}
                        fill="#059669"
                      >
                        <title>{`${day.label}: ${day.replies} replies`}</title>
                      </rect>
                    )}

                    <rect
                      x={groupX + barWidth / 2 + gap}
                      y={chartHeight - 2}
                      width={barWidth}
                      height={2}
                      rx={1}
                      fill="#f1f5f9"
                    />
                    {failH > 0 && (
                      <rect
                        x={groupX + barWidth / 2 + gap}
                        y={chartHeight - failH}
                        width={barWidth}
                        height={failH}
                        rx={2}
                        fill="#dc2626"
                      >
                        <title>{`${day.label}: ${day.failed} failed`}</title>
                      </rect>
                    )}

                    <text
                      x={groupX}
                      y={chartHeight + 18}
                      textAnchor="middle"
                      className="fill-slate-500 text-[10px] font-mono"
                    >
                      {day.label}
                    </text>
                  </g>
                );
              })}

              {slotWidth < 0 && <rect width={0} height={0} />}
            </svg>
          </div>
        </div>

        {/* Lead Pipeline Breakdown */}
        <div className="lg:col-span-5 min-w-0 overflow-hidden bg-white border border-slate-200 rounded-lg p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-900">Lead Pipeline</h2>
              <p className="text-xs text-slate-500">Status distribution across {totalLeads} leads</p>
            </div>
            <button
              type="button"
              onClick={onOpenLeads}
              className="text-xs font-medium text-blue-700 hover:text-blue-800 inline-flex items-center gap-1 shrink-0 cursor-pointer"
            >
              <span>Leads</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-2.5 min-w-0">
            {PIPELINE_STAGES.map((stage) => {
              const count = leadCounts[stage.key] ?? 0;
              const pct = totalLeads > 0 ? Math.round((count / totalLeads) * 100) : 0;
              return (
                <div key={stage.key} className="space-y-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 text-xs min-w-0">
                    <span className={`font-medium truncate ${stage.textColor}`}>{stage.label}</span>
                    <span className="font-mono tabular-nums text-slate-600 shrink-0">
                      {count} <span className="text-slate-400">({pct}%)</span>
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-sm overflow-hidden">
                    <div
                      className={`h-full ${stage.barColor} transition-all duration-300`}
                      style={{ width: `${count > 0 ? Math.max(3, pct) : 0}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Recent Agent Log (classified + failures) */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden min-w-0">
        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 space-y-3 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-900">Recent Agent Log</h2>
              <p className="text-xs text-slate-500">
                Classified actions executed by the agent, including failures
              </p>
            </div>

            <button
              type="button"
              onClick={onOpenLogs}
              className="h-8 px-3 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-xs font-medium rounded-md inline-flex items-center gap-1 shrink-0 cursor-pointer"
            >
              <span>Full Log</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Classification & Outcome Filter Bar */}
          <div className="flex items-center gap-1.5 overflow-x-auto max-w-full pb-0.5">
            <button
              type="button"
              onClick={() => setLogFilter('all')}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-md border whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                logFilter === 'all'
                  ? 'bg-slate-900 border-slate-900 text-white'
                  : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              All ({recentLogs.length})
            </button>
            {LOG_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setLogFilter(cat.id)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md border whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  logFilter === cat.id
                    ? 'bg-slate-900 border-slate-900 text-white'
                    : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
              >
                {cat.label} ({categoryCounts[cat.id]})
              </button>
            ))}
            <button
              type="button"
              onClick={() => setLogFilter('failed')}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-md border whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                logFilter === 'failed'
                  ? 'bg-red-700 border-red-700 text-white'
                  : 'bg-red-50/70 border-red-200 text-red-700 hover:bg-red-100'
              }`}
            >
              Failures ({failedLogsCount})
            </button>
          </div>
        </div>

        {filteredLogs.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <Send className="w-5 h-5 text-slate-400 mx-auto" />
            <div className="text-sm font-medium text-slate-900">
              {logFilter === 'failed'
                ? 'No failures recorded'
                : logFilter === 'all'
                ? 'No agent actions recorded yet'
                : `No ${CATEGORY_LABEL[logFilter]} actions recorded yet`}
            </div>
            <p className="text-xs text-slate-500">
              {logFilter === 'failed'
                ? 'Every recent tool call and send succeeded.'
                : 'Open Agent Chat to send an email, import leads, or run a campaign.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200 min-w-0">
            {filteredLogs.map((entry) => {
              const isFailed = entry.status === 'failed';
              const category = entry.category ?? classifyActionLogCategory(entry.action);
              return (
                <div
                  key={entry.id}
                  className="px-4 sm:px-5 py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 hover:bg-slate-50/70 min-w-0"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs min-w-0">
                      <span
                        className={`px-2 py-0.5 text-[11px] font-medium rounded border shrink-0 ${
                          CATEGORY_BADGE_CLASS[category]
                        }`}
                      >
                        {CATEGORY_LABEL[category]}
                      </span>
                      {isFailed ? (
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
                    </div>
                    <p
                      className={`text-xs leading-relaxed break-words [overflow-wrap:anywhere] ${
                        isFailed ? 'text-red-700' : 'text-slate-600'
                      }`}
                    >
                      {entry.error || entry.summary}
                    </p>
                  </div>

                  <div className="font-mono text-[11px] tabular-nums text-slate-400 shrink-0">
                    {new Date(entry.created_at).toLocaleString()}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
