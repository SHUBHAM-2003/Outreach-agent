import React, { useState } from 'react';
import { Check, X, AlertTriangle } from 'lucide-react';
import type { PendingAction } from '../../modules/outreach/types.ts';

interface ApprovalCardProps {
  action: PendingAction;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
}

export const ApprovalCard: React.FC<ApprovalCardProps> = ({
  action,
  onApprove,
  onReject,
}) => {
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const payload = action.payload as Record<string, unknown>;

  const title =
    action.type === 'run_campaign'
      ? `Approve Campaign Launch: ${String(payload.campaign_name ?? 'Campaign')}`
      : action.type === 'send_reply'
      ? `Approve Outbound Reply to ${String(payload.to_address ?? '')}`
      : action.type === 'delete_message'
      ? `Approve Move to Trash (${String(payload.message_id ?? '')})`
      : `Approve Action (${action.type})`;

  const sampleEmail = payload.sample_email as { subject?: string; body?: string } | undefined;
  const sampleRecipient = payload.sample_recipient as
    | { name?: string; email?: string; company?: string }
    | undefined;
  const isUnlistedRecipient =
    action.type === 'send_reply' && payload.recipient_in_leads === false;

  async function handleApprove() {
    setBusy('approve');
    try {
      await onApprove(action.id);
    } finally {
      setBusy(null);
    }
  }

  async function handleReject() {
    setBusy('reject');
    try {
      await onReject(action.id);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="bg-white border border-slate-300 rounded-lg p-4 space-y-3 min-w-0 overflow-hidden">
      <div className="flex items-start justify-between gap-4 min-w-0">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-amber-700 break-words">
            Approval Required · {action.type.replace('_', ' ')}
          </p>
          <h4 className="text-sm font-semibold text-slate-900 mt-0.5 break-words [overflow-wrap:anywhere]">
            {title}
          </h4>
        </div>
        <span className="text-xs font-mono tabular-nums text-slate-500 whitespace-nowrap shrink-0">
          {action.status}
        </span>
      </div>

      {action.type === 'run_campaign' && (
        <div className="space-y-2.5 text-xs text-slate-600 min-w-0">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono tabular-nums text-slate-700 min-w-0">
            <span>Recipients: {String(payload.recipient_count ?? 0)}</span>
            <span aria-hidden="true">·</span>
            <span>Daily cap: {String(payload.daily_cap ?? 30)}/day</span>
            <span aria-hidden="true">·</span>
            <span className="break-words [overflow-wrap:anywhere]">
              Brand: {String(payload.brand ?? '-')}
            </span>
          </div>
          {sampleEmail && (
            <div className="bg-slate-50 border border-slate-200 rounded-md p-3 space-y-1.5 min-w-0 overflow-hidden">
              <div className="text-xs text-slate-500 break-words [overflow-wrap:anywhere]">
                Sample rendered email
                {sampleRecipient?.email ? ` for ${sampleRecipient.email}` : ''}:
              </div>
              <div className="text-xs font-semibold text-slate-900 break-words [overflow-wrap:anywhere]">
                Subject: {sampleEmail.subject}
              </div>
              <pre className="max-w-full overflow-x-auto text-xs text-slate-700 whitespace-pre-wrap break-words [overflow-wrap:anywhere] font-sans leading-relaxed">
                {sampleEmail.body}
              </pre>
            </div>
          )}
        </div>
      )}

      {action.type === 'send_reply' && (
        <div className="space-y-2 text-xs text-slate-600 min-w-0">
          {isUnlistedRecipient && (
            <div className="flex items-center gap-2 p-2.5 rounded-md bg-amber-50 border border-amber-200 text-amber-800 min-w-0">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span className="min-w-0 flex-1 break-words">
                Recipient address is not in your existing leads table. Verify before approving.
              </span>
            </div>
          )}
          <div className="bg-slate-50 border border-slate-200 rounded-md p-3 space-y-1.5 min-w-0 overflow-hidden">
            <div className="font-mono text-slate-700 break-words [overflow-wrap:anywhere]">
              To: {String(payload.to_address ?? '')}
            </div>
            <div className="font-semibold text-slate-900 break-words [overflow-wrap:anywhere]">
              Subject: {String(payload.subject ?? '')}
            </div>
            <pre className="max-w-full overflow-x-auto text-xs text-slate-700 whitespace-pre-wrap break-words [overflow-wrap:anywhere] font-sans leading-relaxed">
              {String(payload.body ?? payload.body_preview ?? '')}
            </pre>
          </div>
        </div>
      )}

      {action.type === 'delete_message' && (
        <p className="text-xs text-slate-600 break-words [overflow-wrap:anywhere]">
          Soft delete only: moves Zoho Mail message{' '}
          <span className="font-mono text-slate-800 break-all">
            {String(payload.message_id ?? '')}
          </span>{' '}
          to Trash. Permanent deletion is disabled.
        </p>
      )}

      {action.status === 'pending' && (
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            disabled={busy !== null}
            onClick={handleApprove}
            className="h-9 px-4 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" />
            <span>{busy === 'approve' ? 'Executing...' : 'Approve'}</span>
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={handleReject}
            className="h-9 px-4 bg-white hover:bg-slate-50 border border-slate-300 disabled:opacity-50 text-slate-700 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            <span>{busy === 'reject' ? 'Rejecting...' : 'Reject'}</span>
          </button>
        </div>
      )}
    </div>
  );
};
