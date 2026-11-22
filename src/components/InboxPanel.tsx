import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, MessageSquare } from 'lucide-react';
import { EMAIL_CLASSIFICATION_META } from '../../modules/outreach/classification.ts';
import type { EmailClassification, EmailLog, Lead } from '../../modules/outreach/types.ts';
import { apiFetch, ApiError } from '../lib/api.ts';

interface EnrichedEmailLog extends EmailLog {
  lead?: Lead | null;
}

interface InboxPanelProps {
  onRefreshDashboard: () => Promise<void>;
  onAskAgentDraft: (prompt: string) => void;
  onOpenZohoSetup: () => void;
}

type ClassificationFilterKey =
  | 'all'
  | 'interested'
  | 'question'
  | 'reply_other'
  | 'bounce_unsub'
  | 'outbound'
  | 'other';

const CLASSIFICATION_FILTERS: Array<{ id: ClassificationFilterKey; label: string }> = [
  { id: 'all', label: 'All Classified' },
  { id: 'interested', label: 'Interested' },
  { id: 'question', label: 'Questions' },
  { id: 'reply_other', label: 'Not Interested / OOO' },
  { id: 'bounce_unsub', label: 'Bounces & Unsub' },
  { id: 'outbound', label: 'Outbound Sent' },
  { id: 'other', label: 'Other' },
];

function getEmailGroup(item: EnrichedEmailLog): ClassificationFilterKey {
  if (item.classification && item.classification in EMAIL_CLASSIFICATION_META) {
    return EMAIL_CLASSIFICATION_META[item.classification].group as ClassificationFilterKey;
  }
  return item.direction === 'outbound' ? 'outbound' : 'other';
}

export const InboxPanel: React.FC<InboxPanelProps> = ({
  onRefreshDashboard,
  onAskAgentDraft,
  onOpenZohoSetup,
}) => {
  const [emails, setEmails] = useState<EnrichedEmailLog[]>([]);
  const [zohoConfigured, setZohoConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [directionFilter, setDirectionFilter] = useState<'all' | 'inbound' | 'outbound'>('all');
  const [classFilter, setClassFilter] = useState<ClassificationFilterKey>('all');

  const loadInbox = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{
        emails: EnrichedEmailLog[];
        zohoConfigured: boolean;
      }>('/api/inbox');
      setEmails(data.emails ?? []);
      setZohoConfigured(data.zohoConfigured);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) {
        setNotice(err instanceof Error ? err.message : 'Failed to load inbox.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  async function handleSyncInbox() {
    setSyncing(true);
    setNotice(null);
    try {
      const res = await apiFetch<{
        processed_count?: number;
        matched_count?: number;
        error?: string;
      }>('/api/inbox/check', { method: 'POST' });
      if (res.error) {
        setNotice(res.error);
      } else {
        setNotice(
          `Inbox synced · ${res.processed_count ?? 0} new messages processed · ${
            res.matched_count ?? 0
          } matched to leads`
        );
      }
      await Promise.all([loadInbox(), onRefreshDashboard()]);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Inbox sync failed.');
    } finally {
      setSyncing(false);
    }
  }

  const directionMatched = emails.filter(
    (e) => directionFilter === 'all' || e.direction === directionFilter
  );

  const dirCounts = {
    all: emails.length,
    inbound: emails.filter((e) => e.direction === 'inbound').length,
    outbound: emails.filter((e) => e.direction === 'outbound').length,
  };

  const groupCounts: Record<ClassificationFilterKey, number> = {
    all: directionMatched.length,
    interested: 0,
    question: 0,
    reply_other: 0,
    bounce_unsub: 0,
    outbound: 0,
    other: 0,
  };
  for (const item of directionMatched) {
    const grp = getEmailGroup(item);
    groupCounts[grp] = (groupCounts[grp] ?? 0) + 1;
  }

  const filtered = directionMatched.filter(
    (e) => classFilter === 'all' || getEmailGroup(e) === classFilter
  );

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3 min-w-0">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-slate-900">Inbox & Mail Log</h2>
          <p className="text-xs text-slate-500 break-words">
            Inbound replies are classified automatically and linked to leads.
          </p>
        </div>

        <button
          type="button"
          disabled={syncing}
          onClick={() => void handleSyncInbox()}
          className="min-h-[44px] sm:min-h-[38px] px-4 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-medium rounded-md inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
          <span>{syncing ? 'Checking Zoho Inbox...' : 'Check Inbox Now'}</span>
        </button>
      </div>

      {!zohoConfigured && (
        <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-900 flex flex-wrap items-center justify-between gap-3 min-w-0">
          <span className="min-w-0 flex-1 break-words">
            Zoho Mail (.in) is not connected yet. Connect with a Zoho Self Client authorization code
            or configure Zoho environment variables.
          </span>
          <button
            type="button"
            onClick={onOpenZohoSetup}
            className="h-8 px-3 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-md whitespace-nowrap shrink-0 cursor-pointer"
          >
            Connect Zoho
          </button>
        </div>
      )}

      {notice && (
        <div className="p-3 bg-white border border-slate-200 rounded-md text-xs text-slate-700 break-words [overflow-wrap:anywhere]">
          {notice}
        </div>
      )}

      {/* Direction + Classification Filters */}
      <div className="space-y-2.5 min-w-0">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto max-w-full w-fit">
          {(['all', 'inbound', 'outbound'] as const).map((dir) => (
            <button
              key={dir}
              type="button"
              onClick={() => {
                setDirectionFilter(dir);
                setClassFilter('all');
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize whitespace-nowrap shrink-0 cursor-pointer ${
                directionFilter === dir
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {dir} ({dirCounts[dir]})
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto max-w-full pb-1">
          {CLASSIFICATION_FILTERS.map((cf) => (
            <button
              key={cf.id}
              type="button"
              onClick={() => setClassFilter(cf.id)}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-md border whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                classFilter === cf.id
                  ? 'bg-slate-900 border-slate-900 text-white'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {cf.label} ({groupCounts[cf.id]})
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-200 overflow-hidden min-w-0">
        {loading ? (
          <div className="p-8 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 bg-slate-100 rounded animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <h3 className="text-sm font-semibold text-slate-900">No matching emails</h3>
            <p className="text-xs text-slate-500">
              Run an inbox check or send an email to populate this classification.
            </p>
          </div>
        ) : (
          filtered.map((item) => {
            const clsKey: EmailClassification =
              item.classification && item.classification in EMAIL_CLASSIFICATION_META
                ? item.classification
                : item.direction === 'outbound'
                ? 'outbound_sent'
                : 'other';
            const clsMeta = EMAIL_CLASSIFICATION_META[clsKey];

            return (
              <div key={item.id} className="p-4 hover:bg-slate-50/70 space-y-2 min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 min-w-0 flex-1">
                    <span className="px-2 py-0.5 text-[11px] font-medium rounded border bg-slate-50 border-slate-200 text-slate-700 uppercase tracking-wide shrink-0">
                      {item.direction}
                    </span>
                    <span
                      className={`px-2 py-0.5 text-[11px] font-medium rounded border shrink-0 ${clsMeta.badgeClass}`}
                    >
                      {clsMeta.label}
                    </span>
                    <span className="text-slate-700 font-medium break-words [overflow-wrap:anywhere] min-w-0">
                      {item.lead
                        ? `${item.lead.name ? `${item.lead.name} ` : ''}(${item.lead.email})`
                        : 'Unmatched sender'}
                    </span>
                  </div>
                  <span className="font-mono text-[11px] tabular-nums text-slate-400 shrink-0">
                    {new Date(item.created_at).toLocaleString()}
                  </span>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 min-w-0">
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-900 break-words [overflow-wrap:anywhere]">
                      {item.subject || '(no subject)'}
                    </div>
                    <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed break-words [overflow-wrap:anywhere]">
                      {item.snippet}
                    </p>
                  </div>
                  {item.direction === 'inbound' && item.zoho_message_id && (
                    <button
                      type="button"
                      onClick={() =>
                        onAskAgentDraft(
                          `Read message ${item.zoho_message_id} and draft a concise reply addressing their note.`
                        )
                      }
                      className="h-8 px-3 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 self-start cursor-pointer"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>Draft in Chat</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
