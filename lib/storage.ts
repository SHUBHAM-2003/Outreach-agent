import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type {
  ActionLog,
  Campaign,
  CampaignLead,
  CampaignLeadStatus,
  CampaignStatus,
  ChatSessionRecord,
  CompanyContext,
  EmailClassification,
  EmailDirection,
  EmailLog,
  Lead,
  LeadStatus,
  MemoryRecord,
  PendingAction,
  PendingActionStatus,
  PendingActionType,
  ProgressMemory,
  StoredChatMessage,
  ZohoConfigRecord,
} from '../modules/outreach/types.ts';
import { ensureDatabaseSchema, getSql, testDatabaseConnection } from './db.ts';

const LEGACY_DATA_DIR = path.resolve(process.cwd(), 'data');
const MIGRATION_KEY = '_json_migrated';
const RESERVED_KV_KEYS = new Set(['zoho_config', 'settings', MIGRATION_KEY]);

export const DEFAULT_COMPANY_CONTEXT: CompanyContext = {
  brands: [
    {
      name: 'Your Agency Name',
      positioning: 'Performance creative & full-funnel web studio for B2B SaaS and D2C brands',
      website: 'https://youragency.example',
    },
  ],
  offers: [
    '14-day conversion audit & landing page teardown',
    'Monthly growth design & engineering retainer',
  ],
  tone: 'Direct, consultative, concise (under 110 words), zero hype or buzzwords.',
  icp: 'Founders, Heads of Growth, and Marketing Directors at companies with 10-200 employees.',
  signature: 'Best,\nAlex\nYour Agency Name',
  unsubscribe_text: 'If this is not relevant, reply STOP and I will not reach out again.',
};

export const DEFAULT_PROGRESS: ProgressMemory = {
  campaigns_summary: 'No campaigns launched yet.',
  last_inbox_check: null,
  notes: '',
};

const cronLocksMap = new Map<string, number>();
let initPromise: Promise<void> | null = null;

function toIso(value: unknown, fallback?: string): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return fallback ?? new Date().toISOString();
}

function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? trimmed : parsed.toISOString();
  }
  return null;
}

function parseJsonValue<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function mapLeadRow(row: Record<string, unknown>): Lead {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    email: String(row.email ?? '').toLowerCase(),
    company: String(row.company ?? ''),
    website: String(row.website ?? ''),
    phone: String(row.phone ?? ''),
    notes: String(row.notes ?? ''),
    status: String(row.status ?? 'new') as LeadStatus,
    created_at: toIso(row.created_at),
  };
}

function mapCampaignRow(row: Record<string, unknown>): Campaign {
  const rawFollowups = parseJsonValue<unknown>(row.followup_days, [3, 7, 14]);
  const followups = Array.isArray(rawFollowups)
    ? rawFollowups.map(Number).filter((n) => Number.isFinite(n) && n > 0)
    : [3, 7, 14];
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    brand: String(row.brand ?? ''),
    subject_template: String(row.subject_template ?? ''),
    body_template: String(row.body_template ?? ''),
    followup_days: followups.length > 0 ? followups : [3, 7, 14],
    daily_cap: Number(row.daily_cap ?? 30),
    status: String(row.status ?? 'draft') as CampaignStatus,
    created_at: toIso(row.created_at),
  };
}

function mapCampaignLeadRow(row: Record<string, unknown>): CampaignLead {
  return {
    id: String(row.id),
    campaign_id: String(row.campaign_id),
    lead_id: String(row.lead_id),
    step: Number(row.step ?? 0),
    status: String(row.status ?? 'queued') as CampaignLeadStatus,
    next_send_at: toIsoOrNull(row.next_send_at),
    last_sent_at: toIsoOrNull(row.last_sent_at),
    message_id: row.message_id ? String(row.message_id) : null,
    thread_id: row.thread_id ? String(row.thread_id) : null,
  };
}

function mapEmailLogRow(row: Record<string, unknown>): EmailLog {
  return {
    id: String(row.id),
    lead_id: row.lead_id ? String(row.lead_id) : null,
    campaign_id: row.campaign_id ? String(row.campaign_id) : null,
    direction: String(row.direction) as EmailDirection,
    subject: String(row.subject ?? ''),
    snippet: String(row.snippet ?? ''),
    zoho_message_id: row.zoho_message_id ? String(row.zoho_message_id) : null,
    classification: row.classification ? (String(row.classification) as EmailClassification) : null,
    created_at: toIso(row.created_at),
  };
}

function mapActionLogRow(row: Record<string, unknown>): ActionLog {
  return {
    id: String(row.id),
    action: String(row.action),
    details: parseJsonValue<Record<string, unknown>>(row.details, {}),
    created_at: toIso(row.created_at),
  };
}

function mapPendingActionRow(row: Record<string, unknown>): PendingAction {
  return {
    id: String(row.id),
    type: String(row.type) as PendingActionType,
    payload: parseJsonValue<Record<string, unknown>>(row.payload, {}),
    status: String(row.status ?? 'pending') as PendingActionStatus,
    created_at: toIso(row.created_at),
  };
}

function readLegacyJsonFile<T>(filename: string, fallback: T): T {
  const fullPath = path.join(LEGACY_DATA_DIR, filename);
  try {
    if (!fs.existsSync(fullPath)) return fallback;
    const raw = fs.readFileSync(fullPath, 'utf8').trim();
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function importLegacyJsonDataOnce(): Promise<void> {
  const sql = getSql();
  const migrationCheck = await sql.query(
    `SELECT value FROM kv WHERE key = $1 LIMIT 1`,
    [MIGRATION_KEY]
  );
  if (migrationCheck.length > 0) {
    return;
  }

  const counts: Record<string, number> = {
    leads: 0,
    campaigns: 0,
    campaign_leads: 0,
    emails_log: 0,
    action_log: 0,
    pending_actions: 0,
    kv: 0,
  };

  if (fs.existsSync(LEGACY_DATA_DIR)) {
    const legacyLeads = readLegacyJsonFile<unknown>('leads.json', []);
    if (Array.isArray(legacyLeads)) {
      for (const item of legacyLeads) {
        if (!item || typeof item !== 'object') continue;
        const r = item as Record<string, unknown>;
        const email = String(r.email ?? '').trim().toLowerCase();
        if (!email) continue;
        const inserted = await sql.query(
          `INSERT INTO leads (id, name, email, company, website, phone, notes, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz)
           ON CONFLICT (email) DO NOTHING
           RETURNING id`,
          [
            String(r.id || crypto.randomUUID()),
            String(r.name ?? ''),
            email,
            String(r.company ?? ''),
            String(r.website ?? ''),
            String(r.phone ?? ''),
            String(r.notes ?? ''),
            String(r.status ?? 'new'),
            toIso(r.created_at),
          ]
        );
        counts.leads += inserted.length;
      }
    }

    const legacyCampaigns = readLegacyJsonFile<unknown>('campaigns.json', []);
    if (Array.isArray(legacyCampaigns)) {
      for (const item of legacyCampaigns) {
        if (!item || typeof item !== 'object') continue;
        const r = item as Record<string, unknown>;
        const id = String(r.id || crypto.randomUUID());
        const followups = Array.isArray(r.followup_days) ? r.followup_days : [3, 7, 14];
        const inserted = await sql.query(
          `INSERT INTO campaigns (id, name, brand, subject_template, body_template, followup_days, daily_cap, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::timestamptz)
           ON CONFLICT (id) DO NOTHING
           RETURNING id`,
          [
            id,
            String(r.name ?? 'Campaign'),
            String(r.brand ?? ''),
            String(r.subject_template ?? ''),
            String(r.body_template ?? ''),
            JSON.stringify(followups),
            Number(r.daily_cap ?? 30),
            String(r.status ?? 'draft'),
            toIso(r.created_at),
          ]
        );
        counts.campaigns += inserted.length;
      }
    }

    const legacyCampaignLeads = readLegacyJsonFile<unknown>('campaign_leads.json', []);
    if (Array.isArray(legacyCampaignLeads)) {
      for (const item of legacyCampaignLeads) {
        if (!item || typeof item !== 'object') continue;
        const r = item as Record<string, unknown>;
        if (!r.campaign_id || !r.lead_id) continue;
        const inserted = await sql.query(
          `INSERT INTO campaign_leads (id, campaign_id, lead_id, step, status, next_send_at, last_sent_at, message_id, thread_id)
           VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8, $9)
           ON CONFLICT (campaign_id, lead_id) DO NOTHING
           RETURNING id`,
          [
            String(r.id || crypto.randomUUID()),
            String(r.campaign_id),
            String(r.lead_id),
            Number(r.step ?? 0),
            String(r.status ?? 'queued'),
            toIsoOrNull(r.next_send_at),
            toIsoOrNull(r.last_sent_at),
            r.message_id ? String(r.message_id) : null,
            r.thread_id ? String(r.thread_id) : null,
          ]
        );
        counts.campaign_leads += inserted.length;
      }
    }

    const legacyEmails = readLegacyJsonFile<unknown>('emails_log.json', []);
    if (Array.isArray(legacyEmails)) {
      for (const item of legacyEmails) {
        if (!item || typeof item !== 'object') continue;
        const r = item as Record<string, unknown>;
        const inserted = await sql.query(
          `INSERT INTO emails_log (id, lead_id, campaign_id, direction, subject, snippet, zoho_message_id, classification, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz)
           ON CONFLICT (id) DO NOTHING
           RETURNING id`,
          [
            String(r.id || crypto.randomUUID()),
            r.lead_id ? String(r.lead_id) : null,
            r.campaign_id ? String(r.campaign_id) : null,
            String(r.direction ?? 'outbound'),
            String(r.subject ?? ''),
            String(r.snippet ?? ''),
            r.zoho_message_id ? String(r.zoho_message_id) : null,
            r.classification ? String(r.classification) : null,
            toIso(r.created_at),
          ]
        );
        counts.emails_log += inserted.length;
      }
    }

    const legacyActions = readLegacyJsonFile<unknown>('action_log.json', []);
    if (Array.isArray(legacyActions)) {
      for (const item of legacyActions) {
        if (!item || typeof item !== 'object') continue;
        const r = item as Record<string, unknown>;
        const inserted = await sql.query(
          `INSERT INTO action_log (id, action, details, created_at)
           VALUES ($1, $2, $3::jsonb, $4::timestamptz)
           ON CONFLICT (id) DO NOTHING
           RETURNING id`,
          [
            String(r.id || crypto.randomUUID()),
            String(r.action ?? 'unknown'),
            JSON.stringify(r.details && typeof r.details === 'object' ? r.details : {}),
            toIso(r.created_at),
          ]
        );
        counts.action_log += inserted.length;
      }
    }

    const legacyPending = readLegacyJsonFile<unknown>('pending_actions.json', []);
    if (Array.isArray(legacyPending)) {
      for (const item of legacyPending) {
        if (!item || typeof item !== 'object') continue;
        const r = item as Record<string, unknown>;
        const inserted = await sql.query(
          `INSERT INTO pending_actions (id, type, payload, status, created_at)
           VALUES ($1, $2, $3::jsonb, $4, $5::timestamptz)
           ON CONFLICT (id) DO NOTHING
           RETURNING id`,
          [
            String(r.id || crypto.randomUUID()),
            String(r.type ?? 'run_campaign'),
            JSON.stringify(r.payload && typeof r.payload === 'object' ? r.payload : {}),
            String(r.status ?? 'pending'),
            toIso(r.created_at),
          ]
        );
        counts.pending_actions += inserted.length;
      }
    }

    const legacyMemory = readLegacyJsonFile<Record<string, unknown> | null>('memory.json', null);
    if (legacyMemory && typeof legacyMemory === 'object' && !Array.isArray(legacyMemory)) {
      const updatedMap =
        legacyMemory._updated_at && typeof legacyMemory._updated_at === 'object'
          ? (legacyMemory._updated_at as Record<string, string>)
          : {};
      for (const [k, rawVal] of Object.entries(legacyMemory)) {
        if (k === '_updated_at' || !rawVal || typeof rawVal !== 'object' || Array.isArray(rawVal)) {
          continue;
        }
        const entryObj = rawVal as Record<string, unknown>;
        const actualValue =
          'value' in entryObj &&
          'updated_at' in entryObj &&
          entryObj.value &&
          typeof entryObj.value === 'object'
            ? (entryObj.value as Record<string, unknown>)
            : entryObj;
        const updatedAt = toIso(
          'updated_at' in entryObj ? entryObj.updated_at : updatedMap[k]
        );
        const inserted = await sql.query(
          `INSERT INTO kv (key, value, updated_at)
           VALUES ($1, $2::jsonb, $3::timestamptz)
           ON CONFLICT (key) DO NOTHING
           RETURNING key`,
          [k, JSON.stringify(actualValue), updatedAt]
        );
        counts.kv += inserted.length;
      }
    }

    const legacyZoho = readLegacyJsonFile<Record<string, unknown> | null>('zoho_config.json', null);
    if (legacyZoho && typeof legacyZoho === 'object' && !Array.isArray(legacyZoho)) {
      const refresh_token = String(legacyZoho.refresh_token ?? '').trim();
      if (refresh_token) {
        const zohoValue = {
          refresh_token,
          accountId: String(legacyZoho.accountId ?? legacyZoho.account_id ?? '').trim(),
          fromAddress: String(legacyZoho.fromAddress ?? legacyZoho.from_address ?? '').trim(),
          updated_at: toIso(legacyZoho.updated_at),
        };
        const inserted = await sql.query(
          `INSERT INTO kv (key, value, updated_at)
           VALUES ('zoho_config', $1::jsonb, $2::timestamptz)
           ON CONFLICT (key) DO NOTHING
           RETURNING key`,
          [JSON.stringify(zohoValue), zohoValue.updated_at]
        );
        counts.kv += inserted.length;
      }
    }
  }

  // Ensure default kv records exist
  await sql.query(
    `INSERT INTO kv (key, value, updated_at)
     VALUES ('company_context', $1::jsonb, now())
     ON CONFLICT (key) DO NOTHING`,
    [JSON.stringify(DEFAULT_COMPANY_CONTEXT)]
  );
  await sql.query(
    `INSERT INTO kv (key, value, updated_at)
     VALUES ('progress', $1::jsonb, now())
     ON CONFLICT (key) DO NOTHING`,
    [JSON.stringify(DEFAULT_PROGRESS)]
  );
  await sql.query(
    `INSERT INTO kv (key, value, updated_at)
     VALUES ('settings', $1::jsonb, now())
     ON CONFLICT (key) DO NOTHING`,
    [JSON.stringify({ storage: 'neon', initialized_at: new Date().toISOString() })]
  );

  await sql.query(
    `INSERT INTO kv (key, value, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    [
      MIGRATION_KEY,
      JSON.stringify({
        done: true,
        migrated_at: new Date().toISOString(),
        counts,
      }),
    ]
  );

  console.log('[storage] Neon Postgres initialized and one-time /data import checked:', counts);
}

export async function ensureStorageInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      await ensureDatabaseSchema();
      await importLegacyJsonDataOnce();
    })().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

export async function getStorageStatus(): Promise<{
  connected: boolean;
  label: string;
  error?: string;
}> {
  try {
    await ensureStorageInitialized();
    return await testDatabaseConnection();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      connected: false,
      label: message,
      error: message,
    };
  }
}

export const storage = {
  memory: {
    async get(key: string): Promise<MemoryRecord | null> {
      await ensureStorageInitialized();
      const sql = getSql();
      const rows = await sql.query(
        `SELECT key, value, updated_at FROM kv WHERE key = $1 LIMIT 1`,
        [key]
      );
      if (rows.length === 0) return null;
      const row = rows[0] as Record<string, unknown>;
      return {
        key: String(row.key),
        value: parseJsonValue<Record<string, unknown>>(row.value, {}),
        updated_at: toIso(row.updated_at),
      };
    },

    async list(): Promise<MemoryRecord[]> {
      await ensureStorageInitialized();
      const sql = getSql();
      const rows = await sql.query(
        `SELECT key, value, updated_at
         FROM kv
         WHERE key NOT IN ('zoho_config', 'settings', '_json_migrated')
         ORDER BY key ASC`
      );
      return rows.map((r) => {
        const row = r as Record<string, unknown>;
        return {
          key: String(row.key),
          value: parseJsonValue<Record<string, unknown>>(row.value, {}),
          updated_at: toIso(row.updated_at),
        };
      });
    },

    async upsert(key: string, value: Record<string, unknown>): Promise<MemoryRecord> {
      await ensureStorageInitialized();
      const sql = getSql();
      const updatedAt = new Date().toISOString();
      const rows = await sql.query(
        `INSERT INTO kv (key, value, updated_at)
         VALUES ($1, $2::jsonb, $3::timestamptz)
         ON CONFLICT (key) DO UPDATE
           SET value = EXCLUDED.value,
               updated_at = EXCLUDED.updated_at
         RETURNING key, value, updated_at`,
        [key, JSON.stringify(value), updatedAt]
      );
      const row = rows[0] as Record<string, unknown>;
      return {
        key: String(row.key),
        value: parseJsonValue<Record<string, unknown>>(row.value, {}),
        updated_at: toIso(row.updated_at, updatedAt),
      };
    },
  },

  leads: {
    async list(filter?: { status?: string; search?: string; limit?: number }): Promise<Lead[]> {
      await ensureStorageInitialized();
      const sql = getSql();
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (filter?.status && filter.status !== 'all') {
        params.push(filter.status);
        conditions.push(`status = $${params.length}`);
      }

      if (filter?.search && filter.search.trim()) {
        params.push(`%${filter.search.trim()}%`);
        const p = `$${params.length}`;
        conditions.push(
          `(name ILIKE ${p} OR email ILIKE ${p} OR company ILIKE ${p} OR notes ILIKE ${p})`
        );
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      let limitClause = '';
      if (filter?.limit && Number.isFinite(filter.limit) && filter.limit > 0) {
        params.push(Math.floor(filter.limit));
        limitClause = `LIMIT $${params.length}`;
      }

      const rows = await sql.query(
        `SELECT id, name, email, company, website, phone, notes, status, created_at
         FROM leads
         ${whereClause}
         ORDER BY created_at DESC
         ${limitClause}`,
        params
      );
      return rows.map((r) => mapLeadRow(r as Record<string, unknown>));
    },

    async getById(id: string): Promise<Lead | null> {
      await ensureStorageInitialized();
      const sql = getSql();
      const rows = await sql.query(
        `SELECT id, name, email, company, website, phone, notes, status, created_at
         FROM leads WHERE id = $1 LIMIT 1`,
        [id]
      );
      return rows.length > 0 ? mapLeadRow(rows[0] as Record<string, unknown>) : null;
    },

    async getByEmail(email: string): Promise<Lead | null> {
      await ensureStorageInitialized();
      const sql = getSql();
      const normalized = email.trim().toLowerCase();
      const rows = await sql.query(
        `SELECT id, name, email, company, website, phone, notes, status, created_at
         FROM leads WHERE lower(email) = $1 LIMIT 1`,
        [normalized]
      );
      return rows.length > 0 ? mapLeadRow(rows[0] as Record<string, unknown>) : null;
    },

    async insertMany(items: Array<Omit<Lead, 'id' | 'created_at'>>): Promise<Lead[]> {
      await ensureStorageInitialized();
      if (items.length === 0) return [];
      const sql = getSql();
      const inserted: Lead[] = [];
      const seen = new Set<string>();

      for (const item of items) {
        const email = item.email.trim().toLowerCase();
        if (!email || seen.has(email)) continue;
        seen.add(email);

        const id = crypto.randomUUID();
        const createdAt = new Date().toISOString();
        const rows = await sql.query(
          `INSERT INTO leads (id, name, email, company, website, phone, notes, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz)
           ON CONFLICT (email) DO NOTHING
           RETURNING id, name, email, company, website, phone, notes, status, created_at`,
          [
            id,
            item.name ?? '',
            email,
            item.company ?? '',
            item.website ?? '',
            item.phone ?? '',
            item.notes ?? '',
            item.status ?? 'new',
            createdAt,
          ]
        );
        if (rows.length > 0) {
          inserted.push(mapLeadRow(rows[0] as Record<string, unknown>));
        }
      }

      return inserted;
    },

    async update(id: string, fields: Partial<Omit<Lead, 'id' | 'created_at'>>): Promise<Lead | null> {
      await ensureStorageInitialized();
      const sql = getSql();
      const sets: string[] = [];
      const params: unknown[] = [id];

      const allowedKeys: Array<keyof Omit<Lead, 'id' | 'created_at'>> = [
        'name',
        'email',
        'company',
        'website',
        'phone',
        'notes',
        'status',
      ];
      for (const key of allowedKeys) {
        if (fields[key] !== undefined) {
          const val = key === 'email' ? String(fields[key]).trim().toLowerCase() : fields[key];
          params.push(val);
          sets.push(`${key} = $${params.length}`);
        }
      }

      if (sets.length === 0) {
        return this.getById(id);
      }

      const rows = await sql.query(
        `UPDATE leads
         SET ${sets.join(', ')}
         WHERE id = $1
         RETURNING id, name, email, company, website, phone, notes, status, created_at`,
        params
      );
      return rows.length > 0 ? mapLeadRow(rows[0] as Record<string, unknown>) : null;
    },

    async updateStatus(id: string, status: LeadStatus): Promise<Lead | null> {
      return this.update(id, { status });
    },
  },

  campaigns: {
    async list(): Promise<Campaign[]> {
      await ensureStorageInitialized();
      const sql = getSql();
      const rows = await sql.query(
        `SELECT id, name, brand, subject_template, body_template, followup_days, daily_cap, status, created_at
         FROM campaigns
         ORDER BY created_at DESC`
      );
      return rows.map((r) => mapCampaignRow(r as Record<string, unknown>));
    },

    async getById(id: string): Promise<Campaign | null> {
      await ensureStorageInitialized();
      const sql = getSql();
      const rows = await sql.query(
        `SELECT id, name, brand, subject_template, body_template, followup_days, daily_cap, status, created_at
         FROM campaigns WHERE id = $1 LIMIT 1`,
        [id]
      );
      return rows.length > 0 ? mapCampaignRow(rows[0] as Record<string, unknown>) : null;
    },

    async create(input: Omit<Campaign, 'id' | 'created_at'>): Promise<Campaign> {
      await ensureStorageInitialized();
      const sql = getSql();
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const rows = await sql.query(
        `INSERT INTO campaigns (id, name, brand, subject_template, body_template, followup_days, daily_cap, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::timestamptz)
         RETURNING id, name, brand, subject_template, body_template, followup_days, daily_cap, status, created_at`,
        [
          id,
          input.name,
          input.brand,
          input.subject_template,
          input.body_template,
          JSON.stringify(input.followup_days ?? [3, 7, 14]),
          input.daily_cap,
          input.status,
          createdAt,
        ]
      );
      return mapCampaignRow(rows[0] as Record<string, unknown>);
    },

    async updateStatus(id: string, status: CampaignStatus): Promise<Campaign | null> {
      await ensureStorageInitialized();
      const sql = getSql();
      const rows = await sql.query(
        `UPDATE campaigns
         SET status = $2
         WHERE id = $1
         RETURNING id, name, brand, subject_template, body_template, followup_days, daily_cap, status, created_at`,
        [id, status]
      );
      return rows.length > 0 ? mapCampaignRow(rows[0] as Record<string, unknown>) : null;
    },
  },

  campaignLeads: {
    async list(campaignId?: string): Promise<CampaignLead[]> {
      await ensureStorageInitialized();
      const sql = getSql();
      const rows = campaignId
        ? await sql.query(
            `SELECT id, campaign_id, lead_id, step, status, next_send_at, last_sent_at, message_id, thread_id
             FROM campaign_leads WHERE campaign_id = $1`,
            [campaignId]
          )
        : await sql.query(
            `SELECT id, campaign_id, lead_id, step, status, next_send_at, last_sent_at, message_id, thread_id
             FROM campaign_leads`
          );
      return rows.map((r) => mapCampaignLeadRow(r as Record<string, unknown>));
    },

    async listDue(nowIso: string, limit: number): Promise<CampaignLead[]> {
      await ensureStorageInitialized();
      const sql = getSql();
      const rows = await sql.query(
        `SELECT id, campaign_id, lead_id, step, status, next_send_at, last_sent_at, message_id, thread_id
         FROM campaign_leads
         WHERE status = 'queued'
           AND next_send_at IS NOT NULL
           AND next_send_at <= $1::timestamptz
         ORDER BY next_send_at ASC
         LIMIT $2`,
        [nowIso, Math.max(1, limit * 3)]
      );
      return rows.map((r) => mapCampaignLeadRow(r as Record<string, unknown>));
    },

    async enqueueMany(items: Array<Omit<CampaignLead, 'id'>>): Promise<CampaignLead[]> {
      await ensureStorageInitialized();
      if (items.length === 0) return [];
      const sql = getSql();
      const inserted: CampaignLead[] = [];

      for (const item of items) {
        const id = crypto.randomUUID();
        const rows = await sql.query(
          `INSERT INTO campaign_leads (id, campaign_id, lead_id, step, status, next_send_at, last_sent_at, message_id, thread_id)
           VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8, $9)
           ON CONFLICT (campaign_id, lead_id) DO NOTHING
           RETURNING id, campaign_id, lead_id, step, status, next_send_at, last_sent_at, message_id, thread_id`,
          [
            id,
            item.campaign_id,
            item.lead_id,
            item.step,
            item.status,
            item.next_send_at,
            item.last_sent_at,
            item.message_id,
            item.thread_id,
          ]
        );
        if (rows.length > 0) {
          inserted.push(mapCampaignLeadRow(rows[0] as Record<string, unknown>));
        }
      }

      return inserted;
    },

    async update(
      id: string,
      fields: Partial<Omit<CampaignLead, 'id'>>
    ): Promise<CampaignLead | null> {
      await ensureStorageInitialized();
      const sql = getSql();
      const sets: string[] = [];
      const params: unknown[] = [id];

      if (fields.campaign_id !== undefined) {
        params.push(fields.campaign_id);
        sets.push(`campaign_id = $${params.length}`);
      }
      if (fields.lead_id !== undefined) {
        params.push(fields.lead_id);
        sets.push(`lead_id = $${params.length}`);
      }
      if (fields.step !== undefined) {
        params.push(fields.step);
        sets.push(`step = $${params.length}`);
      }
      if (fields.status !== undefined) {
        params.push(fields.status);
        sets.push(`status = $${params.length}`);
      }
      if (fields.next_send_at !== undefined) {
        params.push(fields.next_send_at);
        sets.push(`next_send_at = $${params.length}::timestamptz`);
      }
      if (fields.last_sent_at !== undefined) {
        params.push(fields.last_sent_at);
        sets.push(`last_sent_at = $${params.length}::timestamptz`);
      }
      if (fields.message_id !== undefined) {
        params.push(fields.message_id);
        sets.push(`message_id = $${params.length}`);
      }
      if (fields.thread_id !== undefined) {
        params.push(fields.thread_id);
        sets.push(`thread_id = $${params.length}`);
      }

      if (sets.length === 0) return null;

      const rows = await sql.query(
        `UPDATE campaign_leads
         SET ${sets.join(', ')}
         WHERE id = $1
         RETURNING id, campaign_id, lead_id, step, status, next_send_at, last_sent_at, message_id, thread_id`,
        params
      );
      return rows.length > 0 ? mapCampaignLeadRow(rows[0] as Record<string, unknown>) : null;
    },

    async stopForLead(leadId: string): Promise<number> {
      await ensureStorageInitialized();
      const sql = getSql();
      const rows = await sql.query(
        `UPDATE campaign_leads
         SET status = 'stopped', next_send_at = NULL
         WHERE lead_id = $1 AND status = 'queued'
         RETURNING id`,
        [leadId]
      );
      return rows.length;
    },

    async removeByIds(ids: string[]): Promise<number> {
      await ensureStorageInitialized();
      if (ids.length === 0) return 0;
      const sql = getSql();
      const rows = await sql.query(
        `DELETE FROM campaign_leads
         WHERE id = ANY($1::text[]) AND status = 'queued'
         RETURNING id`,
        [ids]
      );
      return rows.length;
    },

    async findByThreadOrMessage(
      threadId?: string | null,
      messageId?: string | null
    ): Promise<CampaignLead | null> {
      await ensureStorageInitialized();
      if (!threadId && !messageId) return null;
      const sql = getSql();
      const rows = await sql.query(
        `SELECT id, campaign_id, lead_id, step, status, next_send_at, last_sent_at, message_id, thread_id
         FROM campaign_leads
         WHERE ($1::text IS NOT NULL AND thread_id = $1)
            OR ($2::text IS NOT NULL AND message_id = $2)
         LIMIT 1`,
        [threadId ?? null, messageId ?? null]
      );
      return rows.length > 0 ? mapCampaignLeadRow(rows[0] as Record<string, unknown>) : null;
    },
  },

  emailsLog: {
    async list(limit = 100): Promise<EmailLog[]> {
      await ensureStorageInitialized();
      const sql = getSql();
      const rows = await sql.query(
        `SELECT id, lead_id, campaign_id, direction, subject, snippet, zoho_message_id, classification, created_at
         FROM emails_log
         ORDER BY created_at DESC
         LIMIT $1`,
        [Math.max(1, limit)]
      );
      return rows.map((r) => mapEmailLogRow(r as Record<string, unknown>));
    },

    async countOutboundToday(): Promise<number> {
      await ensureStorageInitialized();
      const sql = getSql();
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);
      const rows = await sql.query(
        `SELECT COUNT(*)::int AS cnt
         FROM emails_log
         WHERE direction = 'outbound' AND created_at >= $1::timestamptz`,
        [startOfDay.toISOString()]
      );
      const row = rows[0] as { cnt?: number | string } | undefined;
      return Number(row?.cnt ?? 0);
    },

    async existsByZohoId(zohoMessageId: string): Promise<boolean> {
      await ensureStorageInitialized();
      if (!zohoMessageId) return false;
      const sql = getSql();
      const rows = await sql.query(
        `SELECT 1 FROM emails_log WHERE zoho_message_id = $1 LIMIT 1`,
        [zohoMessageId]
      );
      return rows.length > 0;
    },

    async insert(entry: Omit<EmailLog, 'id' | 'created_at'>): Promise<EmailLog> {
      await ensureStorageInitialized();
      const sql = getSql();
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const rows = await sql.query(
        `INSERT INTO emails_log (id, lead_id, campaign_id, direction, subject, snippet, zoho_message_id, classification, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz)
         RETURNING id, lead_id, campaign_id, direction, subject, snippet, zoho_message_id, classification, created_at`,
        [
          id,
          entry.lead_id,
          entry.campaign_id,
          entry.direction,
          entry.subject,
          entry.snippet,
          entry.zoho_message_id,
          entry.classification,
          createdAt,
        ]
      );
      return mapEmailLogRow(rows[0] as Record<string, unknown>);
    },
  },

  actionLog: {
    async list(limit = 100): Promise<ActionLog[]> {
      await ensureStorageInitialized();
      const sql = getSql();
      const rows = await sql.query(
        `SELECT id, action, details, created_at
         FROM action_log
         ORDER BY created_at DESC
         LIMIT $1`,
        [Math.max(1, limit)]
      );
      return rows.map((r) => mapActionLogRow(r as Record<string, unknown>));
    },

    async log(action: string, details: Record<string, unknown>): Promise<ActionLog> {
      await ensureStorageInitialized();
      const sql = getSql();
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const rows = await sql.query(
        `INSERT INTO action_log (id, action, details, created_at)
         VALUES ($1, $2, $3::jsonb, $4::timestamptz)
         RETURNING id, action, details, created_at`,
        [id, action, JSON.stringify(details ?? {}), createdAt]
      );
      return mapActionLogRow(rows[0] as Record<string, unknown>);
    },
  },

  pendingActions: {
    async list(status?: PendingActionStatus): Promise<PendingAction[]> {
      await ensureStorageInitialized();
      const sql = getSql();
      const rows = status
        ? await sql.query(
            `SELECT id, type, payload, status, created_at
             FROM pending_actions WHERE status = $1 ORDER BY created_at DESC`,
            [status]
          )
        : await sql.query(
            `SELECT id, type, payload, status, created_at
             FROM pending_actions ORDER BY created_at DESC`
          );
      return rows.map((r) => mapPendingActionRow(r as Record<string, unknown>));
    },

    async getById(id: string): Promise<PendingAction | null> {
      await ensureStorageInitialized();
      const sql = getSql();
      const rows = await sql.query(
        `SELECT id, type, payload, status, created_at
         FROM pending_actions WHERE id = $1 LIMIT 1`,
        [id]
      );
      return rows.length > 0 ? mapPendingActionRow(rows[0] as Record<string, unknown>) : null;
    },

    async create(
      type: PendingAction['type'],
      payload: Record<string, unknown>
    ): Promise<PendingAction> {
      await ensureStorageInitialized();
      const sql = getSql();
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const rows = await sql.query(
        `INSERT INTO pending_actions (id, type, payload, status, created_at)
         VALUES ($1, $2, $3::jsonb, 'pending', $4::timestamptz)
         RETURNING id, type, payload, status, created_at`,
        [id, type, JSON.stringify(payload ?? {}), createdAt]
      );
      return mapPendingActionRow(rows[0] as Record<string, unknown>);
    },

    async updateStatus(id: string, status: PendingActionStatus): Promise<PendingAction | null> {
      await ensureStorageInitialized();
      const sql = getSql();
      const rows = await sql.query(
        `UPDATE pending_actions
         SET status = $2
         WHERE id = $1
         RETURNING id, type, payload, status, created_at`,
        [id, status]
      );
      return rows.length > 0 ? mapPendingActionRow(rows[0] as Record<string, unknown>) : null;
    },
  },

  cronLocks: {
    async acquire(name: string, ttlSeconds = 240): Promise<boolean> {
      const nowMs = Date.now();
      const existingUntil = cronLocksMap.get(name);
      if (existingUntil && existingUntil > nowMs) {
        return false;
      }
      cronLocksMap.set(name, nowMs + ttlSeconds * 1000);
      return true;
    },

    async release(name: string): Promise<void> {
      cronLocksMap.delete(name);
    },
  },

  zohoConfig: {
    async get(): Promise<ZohoConfigRecord | null> {
      await ensureStorageInitialized();
      const sql = getSql();
      const rows = await sql.query(
        `SELECT value, updated_at FROM kv WHERE key = 'zoho_config' LIMIT 1`
      );
      if (rows.length === 0) return null;
      const row = rows[0] as Record<string, unknown>;
      const raw = parseJsonValue<Record<string, unknown> | null>(row.value, null);
      if (!raw || typeof raw !== 'object') return null;
      const refresh_token = String(raw.refresh_token ?? '').trim();
      const accountId = String(raw.accountId ?? raw.account_id ?? '').trim();
      const fromAddress = String(raw.fromAddress ?? raw.from_address ?? '').trim();
      if (!refresh_token) return null;
      return {
        refresh_token,
        accountId,
        fromAddress,
        updated_at: toIso(raw.updated_at ?? row.updated_at),
      };
    },

    async upsert(input: {
      refresh_token: string;
      accountId: string;
      fromAddress: string;
    }): Promise<ZohoConfigRecord> {
      await ensureStorageInitialized();
      const sql = getSql();
      const rowData: ZohoConfigRecord = {
        refresh_token: input.refresh_token.trim(),
        accountId: input.accountId.trim(),
        fromAddress: input.fromAddress.trim(),
        updated_at: new Date().toISOString(),
      };
      await sql.query(
        `INSERT INTO kv (key, value, updated_at)
         VALUES ('zoho_config', $1::jsonb, $2::timestamptz)
         ON CONFLICT (key) DO UPDATE
           SET value = EXCLUDED.value,
               updated_at = EXCLUDED.updated_at`,
        [JSON.stringify(rowData), rowData.updated_at]
      );
      return rowData;
    },
  },

  chats: {
    async pruneExpired(): Promise<number> {
      await ensureStorageInitialized();
      const sql = getSql();
      const rows = await sql.query(
        `DELETE FROM chat_sessions
         WHERE updated_at < now() - interval '24 hours'
         RETURNING id`
      );
      return rows.length;
    },

    async list(limit = 100): Promise<ChatSessionRecord[]> {
      await this.pruneExpired();
      const sql = getSql();
      const rows = await sql.query(
        `SELECT id, title, messages, created_at, updated_at
         FROM chat_sessions
         WHERE updated_at >= now() - interval '24 hours'
         ORDER BY updated_at DESC
         LIMIT $1`,
        [Math.max(1, limit)]
      );
      return rows.map((r) => {
        const row = r as Record<string, unknown>;
        const msgs = parseJsonValue<StoredChatMessage[]>(row.messages, []);
        return {
          id: String(row.id),
          title: String(row.title ?? 'New Chat'),
          messages: Array.isArray(msgs) ? msgs : [],
          created_at: toIso(row.created_at),
          updated_at: toIso(row.updated_at),
        };
      });
    },

    async getById(id: string): Promise<ChatSessionRecord | null> {
      await this.pruneExpired();
      const sql = getSql();
      const rows = await sql.query(
        `SELECT id, title, messages, created_at, updated_at
         FROM chat_sessions
         WHERE id = $1 AND updated_at >= now() - interval '24 hours'
         LIMIT 1`,
        [id]
      );
      if (rows.length === 0) return null;
      const row = rows[0] as Record<string, unknown>;
      const msgs = parseJsonValue<StoredChatMessage[]>(row.messages, []);
      return {
        id: String(row.id),
        title: String(row.title ?? 'New Chat'),
        messages: Array.isArray(msgs) ? msgs : [],
        created_at: toIso(row.created_at),
        updated_at: toIso(row.updated_at),
      };
    },

    async upsert(input: {
      id: string;
      title: string;
      messages: StoredChatMessage[];
    }): Promise<ChatSessionRecord> {
      await this.pruneExpired();
      const sql = getSql();
      const nowIso = new Date().toISOString();
      const cleanTitle = input.title.trim().slice(0, 120) || 'New Chat';
      const rows = await sql.query(
        `INSERT INTO chat_sessions (id, title, messages, created_at, updated_at)
         VALUES ($1, $2, $3::jsonb, $4::timestamptz, $4::timestamptz)
         ON CONFLICT (id) DO UPDATE
           SET title = EXCLUDED.title,
               messages = EXCLUDED.messages,
               updated_at = EXCLUDED.updated_at
         RETURNING id, title, messages, created_at, updated_at`,
        [input.id, cleanTitle, JSON.stringify(input.messages ?? []), nowIso]
      );
      const row = rows[0] as Record<string, unknown>;
      const msgs = parseJsonValue<StoredChatMessage[]>(row.messages, []);
      return {
        id: String(row.id),
        title: String(row.title ?? cleanTitle),
        messages: Array.isArray(msgs) ? msgs : [],
        created_at: toIso(row.created_at, nowIso),
        updated_at: toIso(row.updated_at, nowIso),
      };
    },

    async deleteById(id: string): Promise<void> {
      await ensureStorageInitialized();
      const sql = getSql();
      await sql.query(`DELETE FROM chat_sessions WHERE id = $1`, [id]);
    },

    async clearAll(): Promise<void> {
      await ensureStorageInitialized();
      const sql = getSql();
      await sql.query(`DELETE FROM chat_sessions`);
    },
  },
};
