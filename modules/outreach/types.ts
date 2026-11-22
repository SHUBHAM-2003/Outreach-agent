export type LeadStatus =
  | 'new'
  | 'queued'
  | 'sent'
  | 'replied'
  | 'interested'
  | 'not_interested'
  | 'bounced'
  | 'unsubscribed';

export interface Lead {
  id: string;
  name: string;
  email: string;
  company: string;
  website: string;
  phone: string;
  notes: string;
  status: LeadStatus;
  created_at: string;
}

export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed';

export interface Campaign {
  id: string;
  name: string;
  brand: string;
  subject_template: string;
  body_template: string;
  followup_days: number[];
  daily_cap: number;
  status: CampaignStatus;
  created_at: string;
}

export type CampaignLeadStatus = 'queued' | 'sent' | 'completed' | 'stopped' | 'failed';

export interface CampaignLead {
  id: string;
  campaign_id: string;
  lead_id: string;
  step: number;
  status: CampaignLeadStatus;
  next_send_at: string | null;
  last_sent_at: string | null;
  message_id: string | null;
  thread_id: string | null;
}

export type EmailDirection = 'outbound' | 'inbound';

export type EmailClassification =
  | 'interested'
  | 'not_interested'
  | 'question'
  | 'out_of_office'
  | 'bounce'
  | 'unsubscribe'
  | 'other'
  | 'outbound_sent';

export interface EmailLog {
  id: string;
  lead_id: string | null;
  campaign_id: string | null;
  direction: EmailDirection;
  subject: string;
  snippet: string;
  zoho_message_id: string | null;
  classification: EmailClassification | null;
  created_at: string;
}

export interface ActionLog {
  id: string;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
}

export type PendingActionType =
  | 'run_campaign'
  | 'send_reply'
  | 'delete_message'
  | 'bulk_update';

export type PendingActionStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';

export interface PendingAction {
  id: string;
  type: PendingActionType;
  payload: Record<string, unknown>;
  status: PendingActionStatus;
  created_at: string;
}

export interface MemoryRecord {
  key: string;
  value: Record<string, unknown>;
  updated_at: string;
}

export interface CompanyContext {
  brands: Array<{
    name: string;
    positioning: string;
    website?: string;
  }>;
  offers: string[];
  tone: string;
  icp: string;
  signature: string;
  unsubscribe_text: string;
}

export interface ProgressMemory {
  campaigns_summary: string;
  last_inbox_check: string | null;
  notes: string;
}

export interface DashboardMetrics {
  sentToday: number;
  dailyCap: number;
  totalSent: number;
  replies: number;
  interested: number;
  bounces: number;
  queued: number;
  pendingApprovals: number;
  totalLeads?: number;
  activeCampaigns?: number;
}

export interface DailyActivityPoint {
  date: string;
  label: string;
  sent: number;
  replies: number;
  failed: number;
}

export type LogCategory = 'outreach' | 'inbox' | 'leads' | 'campaigns' | 'system';

export interface DashboardLogEntry {
  id: string;
  action: string;
  category?: LogCategory;
  status: 'success' | 'failed';
  summary: string;
  error?: string;
  created_at: string;
}

export interface ZohoConfigRecord {
  refresh_token: string;
  accountId: string;
  fromAddress: string;
  updated_at: string;
}

export interface StoredChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tools?: Array<{
    name: string;
    args: Record<string, unknown>;
    result?: unknown;
  }>;
  modelUsed?: string;
  error?: string;
}

export interface ChatSessionRecord {
  id: string;
  title: string;
  messages: StoredChatMessage[];
  created_at: string;
  updated_at: string;
}

