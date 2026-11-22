import React, { useCallback, useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import type { MemoryRecord } from '../../modules/outreach/types.ts';
import { apiFetch, ApiError } from '../lib/api.ts';

export const MemoryPanel: React.FC = () => {
  const [records, setRecords] = useState<MemoryRecord[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>('company_context');
  const [jsonText, setJsonText] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const loadMemory = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ records: MemoryRecord[] }>('/api/memory');
      const list = data.records ?? [];
      setRecords(list);
      const current = list.find((r) => r.key === selectedKey) ?? list[0];
      if (current) {
        setSelectedKey(current.key);
        setJsonText(JSON.stringify(current.value, null, 2));
      }
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) {
        setNotice({
          type: 'err',
          text: err instanceof Error ? err.message : 'Failed to load memory.',
        });
      }
    } finally {
      setLoading(false);
    }
  }, [selectedKey]);

  useEffect(() => {
    void loadMemory();
  }, [loadMemory]);

  function handleSelectKey(key: string) {
    setSelectedKey(key);
    setNotice(null);
    const rec = records.find((r) => r.key === key);
    setJsonText(JSON.stringify(rec?.value ?? {}, null, 2));
  }

  async function handleSave() {
    setNotice(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Memory value must be a JSON object.');
      }
    } catch (err) {
      setNotice({
        type: 'err',
        text: err instanceof Error ? err.message : 'Invalid JSON syntax.',
      });
      return;
    }

    setSaving(true);
    try {
      const res = await apiFetch<{ record: MemoryRecord }>(`/api/memory/${selectedKey}`, {
        method: 'PUT',
        body: JSON.stringify({ value: parsed }),
      });
      setRecords((prev) =>
        prev.map((r) => (r.key === selectedKey ? res.record : r))
      );
      setJsonText(JSON.stringify(res.record.value, null, 2));
      setNotice({ type: 'ok', text: `Saved "${selectedKey}" to persistent memory.` });
    } catch (err) {
      setNotice({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to save memory.',
      });
    } finally {
      setSaving(false);
    }
  }

  const activeRecord = records.find((r) => r.key === selectedKey);

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3 min-w-0">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-slate-900">Agent Memory (JSON)</h2>
          <p className="text-xs text-slate-500 break-words">
            company_context is injected into the Gemini system prompt at the start of every turn.
          </p>
        </div>

        <button
          type="button"
          disabled={saving || loading}
          onClick={() => void handleSave()}
          className="min-h-[44px] sm:min-h-[38px] px-4 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-medium rounded-md inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Save className="w-3.5 h-3.5" />
          <span>{saving ? 'Saving...' : 'Save JSON'}</span>
        </button>
      </div>

      {/* Key Switcher */}
      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto max-w-full w-fit">
        {records.map((rec) => (
          <button
            key={rec.key}
            type="button"
            onClick={() => handleSelectKey(rec.key)}
            className={`px-3 py-1.5 font-mono text-xs rounded-md whitespace-nowrap shrink-0 cursor-pointer ${
              selectedKey === rec.key
                ? 'bg-white text-slate-900 shadow-xs font-medium'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {rec.key}
          </button>
        ))}
      </div>

      {notice && (
        <div
          className={`p-3 rounded-md border text-xs break-words [overflow-wrap:anywhere] ${
            notice.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          {notice.text}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden min-w-0">
        <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 min-w-0">
          <span className="font-mono font-medium text-slate-700 break-words [overflow-wrap:anywhere]">
            {selectedKey}
          </span>
          {activeRecord && (
            <span className="font-mono tabular-nums shrink-0">
              Updated {new Date(activeRecord.updated_at).toLocaleString()}
            </span>
          )}
        </div>

        {loading ? (
          <div className="p-6">
            <div className="h-64 bg-slate-100 rounded animate-pulse" />
          </div>
        ) : (
          <textarea
            rows={18}
            spellCheck={false}
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            className="w-full p-4 font-mono text-xs leading-relaxed text-slate-900 bg-white focus:outline-none"
          />
        )}
      </div>
    </div>
  );
};
