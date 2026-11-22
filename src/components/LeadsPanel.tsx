import React, { useCallback, useEffect, useState } from 'react';
import { Upload, Search, X } from 'lucide-react';
import type { Lead, LeadStatus } from '../../modules/outreach/types.ts';
import { apiFetch, ApiError } from '../lib/api.ts';

interface LeadsPanelProps {
  onRefreshDashboard: () => Promise<void>;
}

const LEAD_STATUSES: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'queued', label: 'Queued' },
  { value: 'sent', label: 'Sent' },
  { value: 'replied', label: 'Replied' },
  { value: 'interested', label: 'Interested' },
  { value: 'not_interested', label: 'Not Interested' },
  { value: 'bounced', label: 'Bounced' },
  { value: 'unsubscribed', label: 'Unsubscribed' },
];

const STATUS_TEXT_COLOR: Record<LeadStatus, string> = {
  new: 'text-slate-600',
  queued: 'text-blue-700',
  sent: 'text-slate-700',
  replied: 'text-amber-700',
  interested: 'text-emerald-700 font-medium',
  not_interested: 'text-slate-500',
  bounced: 'text-red-700',
  unsubscribed: 'text-red-700',
};

export const LeadsPanel: React.FC<LeadsPanelProps> = ({ onRefreshDashboard }) => {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [rawText, setRawText] = useState('');
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const loadLeads = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (statusFilter !== 'all') qs.set('status', statusFilter);
      if (search.trim()) qs.set('search', search.trim());
      const data = await apiFetch<{ leads: Lead[]; counts?: Record<string, number> }>(
        `/api/leads?${qs.toString()}`
      );
      setLeads(data.leads ?? []);
      if (data.counts) {
        setStatusCounts(data.counts);
      }
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) {
        setImportNotice(err instanceof Error ? err.message : 'Failed to load leads.');
      }
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  useEffect(() => {
    void loadLeads();
  }, [loadLeads]);

  async function handleImportSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!rawText.trim()) return;
    setImporting(true);
    setImportNotice(null);
    try {
      const res = await apiFetch<{
        imported: number;
        skipped_duplicates: number;
        invalid_rows: number;
      }>('/api/leads/import', {
        method: 'POST',
        body: JSON.stringify({ raw_text: rawText }),
      });
      setImportNotice(
        `Imported ${res.imported} leads · Skipped ${res.skipped_duplicates} duplicates · Invalid ${res.invalid_rows}`
      );
      setRawText('');
      setShowImport(false);
      await Promise.all([loadLeads(), onRefreshDashboard()]);
    } catch (err) {
      setImportNotice(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setImporting(false);
    }
  }

  async function handleStatusChange(id: string, nextStatus: LeadStatus) {
    try {
      await apiFetch(`/api/leads/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: { status: nextStatus } }),
      });
      await Promise.all([loadLeads(), onRefreshDashboard()]);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) {
        setImportNotice(err instanceof Error ? err.message : 'Status update failed.');
      }
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5 min-w-0">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 min-w-0">
        <div className="relative flex-1 min-w-0 sm:max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, or company..."
            className="w-full min-h-[44px] sm:min-h-[38px] pl-9 pr-3 text-sm bg-white border border-slate-300 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>

        <button
          type="button"
          onClick={() => setShowImport(true)}
          className="min-h-[44px] sm:min-h-[38px] px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-md inline-flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
        >
          <Upload className="w-3.5 h-3.5" />
          <span>Import Leads</span>
        </button>
      </div>

      {/* Classified Status Filter with Counts */}
      <div className="flex items-center gap-1.5 overflow-x-auto max-w-full pb-1">
        {LEAD_STATUSES.map((s) => {
          const count = statusCounts[s.value] ?? (s.value === 'all' ? leads.length : 0);
          return (
            <button
              key={s.value}
              type="button"
              onClick={() => setStatusFilter(s.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md border whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                statusFilter === s.value
                  ? 'bg-slate-900 border-slate-900 text-white'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {s.label} ({count})
            </button>
          );
        })}
      </div>

      {importNotice && (
        <div className="p-3 bg-white border border-slate-200 rounded-md text-xs text-slate-700 flex items-center justify-between gap-2 min-w-0">
          <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">{importNotice}</span>
          <button
            type="button"
            onClick={() => setImportNotice(null)}
            className="text-slate-400 hover:text-slate-700 shrink-0 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Table / Cards */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden min-w-0">
        {loading ? (
          <div className="p-8 space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-9 bg-slate-100 rounded animate-pulse" />
            ))}
          </div>
        ) : leads.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">No leads match this classification</h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Paste CSV rows or ask the Outreach Agent in chat to import prospects. Duplicates are
              automatically removed by email.
            </p>
            <button
              type="button"
              onClick={() => setShowImport(true)}
              className="h-9 px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-md inline-flex items-center gap-2 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Import First Leads</span>
            </button>
          </div>
        ) : (
          <>
            {/* Mobile Cards */}
            <div className="md:hidden divide-y divide-slate-200 min-w-0">
              {leads.map((lead) => (
                <div key={lead.id} className="p-4 space-y-2.5 min-w-0">
                  <div className="flex items-start justify-between gap-3 min-w-0">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-slate-900 break-words [overflow-wrap:anywhere]">
                        {lead.name || lead.email}
                      </div>
                      <div className="font-mono text-xs text-slate-600 break-words [overflow-wrap:anywhere]">
                        {lead.email}
                      </div>
                    </div>
                    <select
                      aria-label={`Status for ${lead.email}`}
                      value={lead.status}
                      onChange={(e) =>
                        void handleStatusChange(lead.id, e.target.value as LeadStatus)
                      }
                      className={`min-h-[38px] text-xs bg-white border border-slate-200 rounded px-2.5 py-1 shrink-0 focus:outline-none focus:ring-2 focus:ring-blue-600 ${
                        STATUS_TEXT_COLOR[lead.status]
                      }`}
                    >
                      {LEAD_STATUSES.filter((s) => s.value !== 'all').map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {(lead.company || lead.website) && (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 min-w-0">
                      {lead.company && (
                        <span className="break-words [overflow-wrap:anywhere]">{lead.company}</span>
                      )}
                      {lead.company && lead.website && <span aria-hidden="true">·</span>}
                      {lead.website && (
                        <span className="break-words [overflow-wrap:anywhere] min-w-0">
                          {lead.website}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                    <th className="py-2.5 px-4">Name</th>
                    <th className="py-2.5 px-4">Email</th>
                    <th className="py-2.5 px-4">Company</th>
                    <th className="py-2.5 px-4">Website</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-right">Added</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-sm">
                  {leads.map((lead) => (
                    <tr key={lead.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-4 font-medium text-slate-900 max-w-[180px] break-words [overflow-wrap:anywhere]">
                        {lead.name || '-'}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-xs text-slate-700 max-w-[220px] break-words [overflow-wrap:anywhere]">
                        {lead.email}
                      </td>
                      <td className="py-2.5 px-4 text-slate-700 max-w-[180px] break-words [overflow-wrap:anywhere]">
                        {lead.company || '-'}
                      </td>
                      <td className="py-2.5 px-4 text-xs text-slate-500 max-w-[180px] break-words [overflow-wrap:anywhere]">
                        {lead.website || '-'}
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        <select
                          aria-label={`Status for ${lead.email}`}
                          value={lead.status}
                          onChange={(e) =>
                            void handleStatusChange(lead.id, e.target.value as LeadStatus)
                          }
                          className={`text-xs bg-transparent border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-600 ${
                            STATUS_TEXT_COLOR[lead.status]
                          }`}
                        >
                          {LEAD_STATUSES.filter((s) => s.value !== 'all').map((s) => (
                            <option key={s.value} value={s.value}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums text-slate-500 whitespace-nowrap">
                        {new Date(lead.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Import Modal */}
      {showImport && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white border border-slate-200 rounded-lg p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">Import Leads (CSV / Text)</h3>
              <button
                type="button"
                onClick={() => setShowImport(false)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleImportSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Paste CSV with header or lines containing email addresses
                </label>
                <textarea
                  rows={7}
                  required
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder={`name,email,company,website\nMaya Rao,maya@northstar.io,Northstar Labs,https://northstar.io\nRohan Mehta,rohan@acme.in,Acme Co,https://acme.in`}
                  className="w-full p-3 font-mono text-xs bg-white border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowImport(false)}
                  className="h-9 px-4 bg-white border border-slate-300 text-slate-700 text-xs font-medium rounded-md cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={importing}
                  className="h-9 px-4 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-medium rounded-md cursor-pointer"
                >
                  {importing ? 'Importing...' : 'Validate & Import'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
