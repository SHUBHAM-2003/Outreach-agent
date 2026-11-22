import type { EmailClassification, LogCategory } from './types.ts';

export const LOG_CATEGORIES: Array<{ id: LogCategory; label: string }> = [
  { id: 'outreach', label: 'Outreach' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'leads', label: 'Leads' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'system', label: 'System' },
];

export const CATEGORY_BADGE_CLASS: Record<LogCategory, string> = {
  outreach: 'bg-blue-50 text-blue-700 border-blue-200',
  inbox: 'bg-amber-50 text-amber-800 border-amber-200',
  leads: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  campaigns: 'bg-violet-50 text-violet-700 border-violet-200',
  system: 'bg-slate-100 text-slate-700 border-slate-200',
};

export const CATEGORY_LABEL: Record<LogCategory, string> = {
  outreach: 'Outreach',
  inbox: 'Inbox',
  leads: 'Leads',
  campaigns: 'Campaigns',
  system: 'System',
};

export const EMAIL_CLASSIFICATION_META: Record<
  EmailClassification,
  { label: string; group: string; badgeClass: string }
> = {
  interested: {
    label: 'Interested',
    group: 'interested',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  question: {
    label: 'Question',
    group: 'question',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  not_interested: {
    label: 'Not Interested',
    group: 'reply_other',
    badgeClass: 'bg-slate-100 text-slate-600 border-slate-200',
  },
  out_of_office: {
    label: 'Out of Office',
    group: 'reply_other',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
  },
  bounce: {
    label: 'Bounced',
    group: 'bounce_unsub',
    badgeClass: 'bg-red-50 text-red-700 border-red-200',
  },
  unsubscribe: {
    label: 'Unsubscribed',
    group: 'bounce_unsub',
    badgeClass: 'bg-red-50 text-red-700 border-red-200',
  },
  outbound_sent: {
    label: 'Outbound Sent',
    group: 'outbound',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
  },
  other: {
    label: 'Other',
    group: 'other',
    badgeClass: 'bg-slate-100 text-slate-600 border-slate-200',
  },
};

export function classifyActionLogCategory(action: string): LogCategory {
  if (
    [
      'send_email',
      'send_campaign_email',
      'send_campaign_email_failed',
      'send_followups',
      'send_reply',
      'approve_send_reply',
    ].includes(action)
  ) {
    return 'outreach';
  }
  if (
    [
      'check_inbox',
      'search_mail',
      'read_message',
      'list_folders',
      'draft_reply',
      'move_message',
      'mark_read_unread',
      'label_message',
      'create_folder',
      'delete_message',
      'approve_delete_message',
    ].includes(action)
  ) {
    return 'inbox';
  }
  if (['import_leads', 'list_leads', 'update_lead', 'undo_update_lead'].includes(action)) {
    return 'leads';
  }
  if (
    [
      'create_campaign',
      'run_campaign',
      'pause_campaign',
      'resume_campaign',
      'approve_run_campaign',
      'undo_run_campaign',
      'get_status',
    ].includes(action)
  ) {
    return 'campaigns';
  }
  return 'system';
}

export function summarizeActionLogEntry(
  action: string,
  details: Record<string, unknown>
): { status: 'success' | 'failed'; summary: string; error?: string } {
  const rawError =
    typeof details.error === 'string' && details.error.trim()
      ? details.error.trim()
      : undefined;
  const summaryObj =
    details.summary && typeof details.summary === 'object'
      ? (details.summary as Record<string, unknown>)
      : null;
  const summaryError =
    summaryObj && typeof summaryObj.error === 'string' && summaryObj.error.trim()
      ? summaryObj.error.trim()
      : undefined;
  const effectiveError = rawError || summaryError;

  const isFailed =
    details.status === 'failed' ||
    action.endsWith('_failed') ||
    Boolean(effectiveError);

  if (isFailed) {
    return {
      status: 'failed',
      summary: effectiveError || `${action} failed`,
      error: effectiveError || 'Operation failed',
    };
  }

  if (action === 'send_email') {
    const sentCount = Number(summaryObj?.sent_count ?? details.sent_count ?? 1);
    const toList = Array.isArray(summaryObj?.sent)
      ? summaryObj.sent
          .map((item) => (item && typeof item === 'object' ? (item as { to?: string }).to : ''))
          .filter(Boolean)
          .join(', ')
      : '';
    return {
      status: 'success',
      summary: toList
        ? `Sent ${sentCount} email${sentCount === 1 ? '' : 's'} to ${toList}`
        : `Sent ${sentCount} direct email${sentCount === 1 ? '' : 's'}`,
    };
  }

  if (action === 'send_campaign_email') {
    const email = typeof details.lead_email === 'string' ? details.lead_email : 'lead';
    return {
      status: 'success',
      summary: `Sent campaign step ${Number(details.step ?? 0) + 1} to ${email}`,
    };
  }

  if (action === 'run_campaign') {
    const queuedCount = Number(summaryObj?.queued_count ?? 0);
    const sentCount = Number(summaryObj?.sent_count ?? 0);
    return {
      status: 'success',
      summary: `Queued ${queuedCount} lead(s), sent ${sentCount} immediately`,
    };
  }

  if (action === 'import_leads') {
    const imported = Number(summaryObj?.imported ?? 0);
    const skipped = Number(summaryObj?.skipped_duplicates ?? 0);
    return {
      status: 'success',
      summary: `Imported ${imported} lead(s) (${skipped} duplicate skipped)`,
    };
  }

  if (action === 'list_leads') {
    const count = Number(summaryObj?.count ?? 0);
    return {
      status: 'success',
      summary: `Listed ${count} matching lead(s)`,
    };
  }

  if (action === 'send_followups') {
    const sentCount = Number(summaryObj?.sent_count ?? 0);
    const campaignName =
      typeof summaryObj?.campaign === 'string' && summaryObj.campaign
        ? ` for "${summaryObj.campaign}"`
        : '';
    return {
      status: 'success',
      summary: `Sent ${sentCount} follow-up${sentCount === 1 ? '' : 's'}${campaignName}`,
    };
  }

  if (action === 'check_inbox') {
    const processed = Number(details.processedCount ?? summaryObj?.processed_count ?? 0);
    const matched = Number(details.matchedCount ?? summaryObj?.matched_count ?? 0);
    return {
      status: 'success',
      summary: `Checked inbox · ${processed} new, ${matched} matched to leads`,
    };
  }

  if (action === 'send_reply') {
    const to = typeof summaryObj?.to_address === 'string' ? summaryObj.to_address : 'recipient';
    return {
      status: 'success',
      summary: `Sent reply to ${to}`,
    };
  }

  if (action === 'delete_message') {
    const msgId = typeof summaryObj?.message_id === 'string' ? summaryObj.message_id : '';
    return {
      status: 'success',
      summary: `Moved message ${msgId} to Trash`,
    };
  }

  if (action === 'create_campaign') {
    const campaignObj =
      summaryObj?.campaign && typeof summaryObj.campaign === 'object'
        ? (summaryObj.campaign as { name?: string })
        : null;
    return {
      status: 'success',
      summary: campaignObj?.name ? `Created campaign "${campaignObj.name}"` : 'Created campaign',
    };
  }

  if (action === 'update_lead') {
    return { status: 'success', summary: 'Updated lead record' };
  }

  if (action === 'update_memory') {
    const key = typeof details.key === 'string' ? details.key : 'memory';
    return { status: 'success', summary: `Updated memory "${key}"` };
  }

  if (action === 'connect_zoho') {
    const email = typeof details.email === 'string' ? details.email : '';
    return {
      status: 'success',
      summary: email ? `Connected Zoho Mail as ${email}` : 'Connected Zoho Mail',
    };
  }

  return {
    status: 'success',
    summary: action.replace(/_/g, ' '),
  };
}
