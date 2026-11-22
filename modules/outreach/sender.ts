import { storage } from '../../lib/storage.ts';
import { requireZohoConfig, zohoMail } from '../../lib/zoho.ts';
import { getDailySendCap } from '../core/config.ts';
import { getCompanyContext } from '../core/memory.ts';
import type { Campaign, CompanyContext, Lead } from './types.ts';

const SKIP_LEAD_STATUSES = new Set([
  'replied',
  'interested',
  'not_interested',
  'bounced',
  'unsubscribed',
]);

export function renderEmailTemplate(
  campaign: Pick<Campaign, 'subject_template' | 'body_template'>,
  lead: Pick<Lead, 'name' | 'company' | 'website' | 'email'>,
  ctx: CompanyContext,
  step = 0
): { subject: string; body: string } {
  const vars: Record<string, string> = {
    name: lead.name?.trim() || 'there',
    company: lead.company?.trim() || 'your team',
    website: lead.website?.trim() || '',
    email: lead.email,
  };

  const interpolate = (tpl: string) =>
    tpl.replace(/\{\{\s*(name|company|website|email)\s*\}\}/gi, (_, key: string) => {
      return vars[key.toLowerCase()] ?? '';
    });

  const baseSubject = interpolate(campaign.subject_template).trim();
  const subject = step > 0 && !baseSubject.toLowerCase().startsWith('re:') ? `Re: ${baseSubject}` : baseSubject;

  const bodyParts = [interpolate(campaign.body_template).trim()];
  if (ctx.signature?.trim()) {
    bodyParts.push(ctx.signature.trim());
  }
  if (ctx.unsubscribe_text?.trim()) {
    bodyParts.push(`---\n${ctx.unsubscribe_text.trim()}`);
  }

  return {
    subject,
    body: bodyParts.join('\n\n'),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface SendRunResult {
  status: 'completed' | 'locked' | 'cap_reached' | 'zoho_unconfigured' | 'nothing_due';
  sentCount: number;
  skippedCount: number;
  failedCount: number;
  sentToday: number;
  dailyCap: number;
  details: Array<{ leadEmail: string; campaignId: string; status: string; message?: string }>;
}

export async function runSendingEngine(options: {
  maxPerRun?: number;
  maxRuntimeMs?: number;
  skipDelay?: boolean;
} = {}): Promise<SendRunResult> {
  const dailyCap = getDailySendCap();
  const maxPerRun = Math.min(options.maxPerRun ?? 10, 10);
  const maxRuntimeMs = options.maxRuntimeMs ?? 50_000;
  const startedAt = Date.now();

  const zohoCfg = await requireZohoConfig();
  if (!zohoCfg.ok) {
    const sentToday = await storage.emailsLog.countOutboundToday();
    return {
      status: 'zoho_unconfigured',
      sentCount: 0,
      skippedCount: 0,
      failedCount: 0,
      sentToday,
      dailyCap,
      details: [{ leadEmail: '-', campaignId: '-', status: 'error', message: zohoCfg.error }],
    };
  }

  const locked = await storage.cronLocks.acquire('send_engine', 240);
  if (!locked) {
    const sentToday = await storage.emailsLog.countOutboundToday();
    return {
      status: 'locked',
      sentCount: 0,
      skippedCount: 0,
      failedCount: 0,
      sentToday,
      dailyCap,
      details: [],
    };
  }

  try {
    let sentToday = await storage.emailsLog.countOutboundToday();
    if (sentToday >= dailyCap) {
      return {
        status: 'cap_reached',
        sentCount: 0,
        skippedCount: 0,
        failedCount: 0,
        sentToday,
        dailyCap,
        details: [],
      };
    }

    const remainingToday = dailyCap - sentToday;
    const batchLimit = Math.min(maxPerRun, remainingToday);
    const nowIso = new Date().toISOString();

    const dueItems = await storage.campaignLeads.listDue(nowIso, batchLimit);
    if (dueItems.length === 0) {
      return {
        status: 'nothing_due',
        sentCount: 0,
        skippedCount: 0,
        failedCount: 0,
        sentToday,
        dailyCap,
        details: [],
      };
    }

    const ctx = await getCompanyContext();
    const campaigns = await storage.campaigns.list();
    const campaignMap = new Map(campaigns.map((c) => [c.id, c]));

    let sentCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    const details: SendRunResult['details'] = [];

    for (const item of dueItems) {
      if (sentCount >= batchLimit || sentToday >= dailyCap) break;

      const campaign = campaignMap.get(item.campaign_id);
      if (!campaign || campaign.status !== 'active') {
        skippedCount++;
        continue;
      }

      // Enforce per-campaign cap as well, never exceeding global DAILY_SEND_CAP
      const effectiveCap = Math.min(campaign.daily_cap || dailyCap, dailyCap);
      if (sentToday >= effectiveCap) {
        break;
      }

      const lead = await storage.leads.getById(item.lead_id);
      if (!lead || SKIP_LEAD_STATUSES.has(lead.status)) {
        await storage.campaignLeads.update(item.id, { status: 'stopped', next_send_at: null });
        skippedCount++;
        details.push({
          leadEmail: lead?.email ?? 'unknown',
          campaignId: campaign.id,
          status: 'skipped',
          message: `Lead status is ${lead?.status ?? 'missing'}`,
        });
        continue;
      }

      // Randomized 20-40s pacing delay between consecutive sends when function timeout budget allows
      if (sentCount > 0 && !options.skipDelay) {
        const elapsed = Date.now() - startedAt;
        const remainingBudget = maxRuntimeMs - elapsed;
        if (remainingBudget > 22_000) {
          const delayMs = Math.min(
            20_000 + Math.floor(Math.random() * 20_000),
            remainingBudget - 5_000
          );
          if (delayMs > 1000) {
            await sleep(delayMs);
          }
        } else {
          // Stop gracefully before serverless timeout
          break;
        }
      }

      const rendered = renderEmailTemplate(campaign, lead, ctx, item.step);

      try {
        const sent = await zohoMail.sendEmail({
          toAddress: lead.email,
          subject: rendered.subject,
          content: rendered.body,
          mailFormat: 'plaintext',
          inReplyTo: item.step > 0 && item.message_id ? item.message_id : undefined,
          threadId: item.thread_id ?? undefined,
        });

        const now = new Date();
        const followups =
          Array.isArray(campaign.followup_days) && campaign.followup_days.length > 0
            ? campaign.followup_days
            : [3, 7, 14];
        const nextStep = item.step + 1;
        const hasMoreFollowups = item.step < followups.length;
        const daysToAdd = hasMoreFollowups ? followups[item.step] : 0;
        const nextSendAt = hasMoreFollowups
          ? new Date(now.getTime() + daysToAdd * 24 * 60 * 60 * 1000).toISOString()
          : null;

        await storage.campaignLeads.update(item.id, {
          step: nextStep,
          status: hasMoreFollowups ? 'queued' : 'completed',
          last_sent_at: now.toISOString(),
          next_send_at: nextSendAt,
          message_id: sent.messageId || item.message_id,
          thread_id: sent.threadId || item.thread_id,
        });

        if (lead.status === 'new' || lead.status === 'queued') {
          await storage.leads.updateStatus(lead.id, 'sent');
        }

        await storage.emailsLog.insert({
          lead_id: lead.id,
          campaign_id: campaign.id,
          direction: 'outbound',
          subject: rendered.subject,
          snippet: rendered.body.slice(0, 280),
          zoho_message_id: sent.messageId || null,
          classification: 'outbound_sent',
        });

        await storage.actionLog.log('send_campaign_email', {
          campaign_id: campaign.id,
          lead_id: lead.id,
          lead_email: lead.email,
          step: item.step,
          zoho_message_id: sent.messageId || null,
        });

        sentCount++;
        sentToday++;
        details.push({
          leadEmail: lead.email,
          campaignId: campaign.id,
          status: 'sent',
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await storage.campaignLeads.update(item.id, { status: 'failed' });
        await storage.actionLog.log('send_campaign_email_failed', {
          campaign_id: campaign.id,
          lead_id: lead.id,
          error: message,
        });
        failedCount++;
        details.push({
          leadEmail: lead.email,
          campaignId: campaign.id,
          status: 'failed',
          message,
        });
      }
    }

    return {
      status: 'completed',
      sentCount,
      skippedCount,
      failedCount,
      sentToday,
      dailyCap,
      details,
    };
  } finally {
    await storage.cronLocks.release('send_engine');
  }
}
