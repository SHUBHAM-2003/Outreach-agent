import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

let cachedUrl: string | null = null;
let cachedSql: NeonQueryFunction<false, false> | null = null;

export function getDatabaseUrl(): string {
  return process.env.DATABASE_URL?.trim() ?? '';
}

export function getSql(): NeonQueryFunction<false, false> {
  if (typeof window !== 'undefined') {
    throw new Error('lib/db.ts is server-side only.');
  }
  const url = getDatabaseUrl();
  if (!url) {
    throw new Error('DATABASE_URL environment variable is not configured.');
  }
  if (!cachedSql || cachedUrl !== url) {
    cachedSql = neon(url);
    cachedUrl = url;
  }
  return cachedSql;
}

export async function dbQuery<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const sql = getSql();
  const rows = await sql.query(text, params);
  return rows as T[];
}

export async function ensureDatabaseSchema(): Promise<void> {
  const sql = getSql();

  await sql.query(`
    CREATE TABLE IF NOT EXISTS leads (
      id text PRIMARY KEY,
      name text NOT NULL DEFAULT '',
      email text NOT NULL UNIQUE,
      company text NOT NULL DEFAULT '',
      website text NOT NULL DEFAULT '',
      phone text NOT NULL DEFAULT '',
      notes text NOT NULL DEFAULT '',
      status text NOT NULL DEFAULT 'new',
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await sql.query(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id text PRIMARY KEY,
      name text NOT NULL,
      brand text NOT NULL,
      subject_template text NOT NULL,
      body_template text NOT NULL,
      followup_days jsonb NOT NULL DEFAULT '[3,7,14]'::jsonb,
      daily_cap integer NOT NULL DEFAULT 30,
      status text NOT NULL DEFAULT 'draft',
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await sql.query(`
    CREATE TABLE IF NOT EXISTS campaign_leads (
      id text PRIMARY KEY,
      campaign_id text NOT NULL,
      lead_id text NOT NULL,
      step integer NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'queued',
      next_send_at timestamptz NULL,
      last_sent_at timestamptz NULL,
      message_id text NULL,
      thread_id text NULL,
      UNIQUE (campaign_id, lead_id)
    )
  `);

  await sql.query(`
    CREATE TABLE IF NOT EXISTS emails_log (
      id text PRIMARY KEY,
      lead_id text NULL,
      campaign_id text NULL,
      direction text NOT NULL,
      subject text NOT NULL DEFAULT '',
      snippet text NOT NULL DEFAULT '',
      zoho_message_id text NULL,
      classification text NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await sql.query(`
    CREATE TABLE IF NOT EXISTS action_log (
      id text PRIMARY KEY,
      action text NOT NULL,
      details jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await sql.query(`
    CREATE TABLE IF NOT EXISTS pending_actions (
      id text PRIMARY KEY,
      type text NOT NULL,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      status text NOT NULL DEFAULT 'pending',
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await sql.query(`
    CREATE TABLE IF NOT EXISTS kv (
      key text PRIMARY KEY,
      value jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await sql.query(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id text PRIMARY KEY,
      title text NOT NULL DEFAULT 'New Chat',
      messages jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await sql.query(`CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads (created_at DESC)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status)`);
  await sql.query(
    `CREATE INDEX IF NOT EXISTS idx_campaign_leads_due ON campaign_leads (status, next_send_at)`
  );
  await sql.query(
    `CREATE INDEX IF NOT EXISTS idx_emails_log_created_at ON emails_log (created_at DESC)`
  );
  await sql.query(
    `CREATE INDEX IF NOT EXISTS idx_emails_log_zoho_id ON emails_log (zoho_message_id)`
  );
  await sql.query(
    `CREATE INDEX IF NOT EXISTS idx_action_log_created_at ON action_log (created_at DESC)`
  );
  await sql.query(
    `CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated_at ON chat_sessions (updated_at DESC)`
  );
}

export async function testDatabaseConnection(): Promise<{
  connected: boolean;
  label: string;
  error?: string;
}> {
  try {
    const sql = getSql();
    await sql.query('SELECT 1 AS ok');
    return {
      connected: true,
      label: 'Storage: Neon connected',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      connected: false,
      label: message,
      error: message,
    };
  }
}
