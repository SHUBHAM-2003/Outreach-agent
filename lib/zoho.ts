import { storage } from './storage.ts';

const ZOHO_API_BASE = 'https://mail.zoho.in/api';
const ZOHO_TOKEN_URL = 'https://accounts.zoho.in/oauth/v2/token';

interface TokenCache {
  accessToken: string;
  expiresAtMs: number;
}

interface ResolvedZohoCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accountId: string;
  fromAddress: string;
  source: 'zoho_config' | 'env' | 'none';
}

let tokenCache: TokenCache | null = null;
let inflightRefresh: Promise<string> | null = null;

export class ZohoSetupError extends Error {
  code: string;
  statusCode: number;

  constructor(message: string, code = 'zoho_setup_error', statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

function getZohoClientEnv() {
  return {
    clientId: process.env.ZOHO_CLIENT_ID?.trim() ?? '',
    clientSecret: process.env.ZOHO_CLIENT_SECRET?.trim() ?? '',
    refreshToken: process.env.ZOHO_REFRESH_TOKEN?.trim() ?? '',
    accountId: process.env.ZOHO_ACCOUNT_ID?.trim() ?? '',
    fromAddress: process.env.ZOHO_FROM_ADDRESS?.trim() ?? '',
  };
}

function sanitizeZohoErrorText(rawText: string, fallbackStatusText: string): string {
  const trimmed = rawText.trim();
  if (!trimmed) return fallbackStatusText || 'Unknown Zoho error';
  try {
    const parsed = JSON.parse(trimmed) as {
      error?: string;
      error_description?: string;
      status?: { description?: string };
      message?: string;
    };
    // Never reflect token fields if present
    if (parsed.error || parsed.error_description) {
      return [parsed.error, parsed.error_description].filter(Boolean).join(': ');
    }
    if (parsed.status?.description) {
      return parsed.status.description;
    }
    if (parsed.message) {
      return parsed.message;
    }
  } catch {
    // Plain-text response
  }
  // Redact anything resembling token keys if raw text was returned
  if (trimmed.toLowerCase().includes('access_token') || trimmed.toLowerCase().includes('refresh_token')) {
    return fallbackStatusText || 'Zoho OAuth response error';
  }
  return trimmed.slice(0, 400);
}

export async function resolveZohoCredentials(): Promise<ResolvedZohoCredentials> {
  const env = getZohoClientEnv();
  const cfgRow = await storage.zohoConfig.get();

  if (cfgRow && cfgRow.refresh_token && cfgRow.accountId && cfgRow.fromAddress) {
    return {
      clientId: env.clientId,
      clientSecret: env.clientSecret,
      refreshToken: cfgRow.refresh_token.trim(),
      accountId: cfgRow.accountId.trim(),
      fromAddress: cfgRow.fromAddress.trim(),
      source: 'zoho_config',
    };
  }

  if (env.refreshToken && env.accountId && env.fromAddress) {
    return {
      clientId: env.clientId,
      clientSecret: env.clientSecret,
      refreshToken: env.refreshToken,
      accountId: env.accountId,
      fromAddress: env.fromAddress,
      source: 'env',
    };
  }

  return {
    clientId: env.clientId,
    clientSecret: env.clientSecret,
    refreshToken: '',
    accountId: '',
    fromAddress: '',
    source: 'none',
  };
}

export async function requireZohoConfig(): Promise<
  | { ok: true; accountId: string; fromAddress: string; source: 'zoho_config' | 'env' }
  | { ok: false; error: string }
> {
  const creds = await resolveZohoCredentials();
  if (!creds.clientId || !creds.clientSecret) {
    return {
      ok: false,
      error:
        'ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET must be set in server environment variables.',
    };
  }
  if (!creds.refreshToken || !creds.accountId || !creds.fromAddress || creds.source === 'none') {
    return {
      ok: false,
      error:
        'Zoho Mail (.in) is not connected. Open Settings or /setup/zoho to connect with a Zoho authorization code, or configure Zoho environment variables.',
    };
  }
  return {
    ok: true,
    accountId: creds.accountId,
    fromAddress: creds.fromAddress,
    source: creds.source,
  };
}

export async function getZohoConnectionStatus(): Promise<{
  connected: boolean;
  alreadyConnected: boolean;
  source: 'zoho_config' | 'env' | 'none';
  accountId: string | null;
  fromAddress: string | null;
  clientConfigured: boolean;
  updatedAt: string | null;
}> {
  const creds = await resolveZohoCredentials();
  const cfgRow = await storage.zohoConfig.get();
  const clientConfigured = Boolean(creds.clientId && creds.clientSecret);
  const alreadyConnected = Boolean(cfgRow?.refresh_token?.trim());
  const connected =
    clientConfigured &&
    creds.source !== 'none' &&
    Boolean(creds.refreshToken && creds.accountId && creds.fromAddress);

  return {
    connected,
    alreadyConnected,
    source: creds.source,
    accountId: creds.accountId || null,
    fromAddress: creds.fromAddress || null,
    clientConfigured,
    updatedAt: cfgRow?.updated_at ?? null,
  };
}

async function fetchAccessToken(forceRefresh = false): Promise<string> {
  const now = Date.now();
  // Refresh automatically if within 5 minutes of expiry
  if (!forceRefresh && tokenCache && tokenCache.expiresAtMs - now > 5 * 60 * 1000) {
    return tokenCache.accessToken;
  }

  if (!forceRefresh && inflightRefresh) {
    return inflightRefresh;
  }

  inflightRefresh = (async () => {
    const creds = await resolveZohoCredentials();
    if (!creds.clientId || !creds.clientSecret || !creds.refreshToken) {
      throw new Error('Missing Zoho OAuth credentials in database zoho_config or environment variables.');
    }

    const params = new URLSearchParams({
      refresh_token: creds.refreshToken,
      grant_type: 'refresh_token',
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    });

    const resp = await fetch(ZOHO_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: AbortSignal.timeout(15_000),
    });

    const rawText = await resp.text();
    let data: { access_token?: string; expires_in?: number; error?: string; error_description?: string } =
      {};
    try {
      data = JSON.parse(rawText);
    } catch {
      // Non-JSON response
    }

    if (!resp.ok || !data.access_token) {
      const errorText = sanitizeZohoErrorText(rawText, resp.statusText);
      console.error(`[zoho] Refresh token error status=${resp.status} error=${errorText}`);
      throw new Error(`Zoho token refresh failed (${resp.status}): ${errorText}`);
    }

    console.log(`[zoho] Refresh token status=${resp.status}`);
    const expiresInSec = Number(data.expires_in ?? 3600);
    tokenCache = {
      accessToken: data.access_token,
      expiresAtMs: Date.now() + expiresInSec * 1000,
    };
    return tokenCache.accessToken;
  })();

  try {
    return await inflightRefresh;
  } finally {
    inflightRefresh = null;
  }
}

interface ZohoAccountInfo {
  accountId?: string;
  primaryEmailAddress?: string;
  incomingUserName?: string;
  emailAddress?: Array<{ mailId?: string; isPrimary?: boolean }>;
  mailId?: string;
}

export async function connectZohoWithAuthorizationCode(rawCode: string): Promise<{
  email: string;
  accountId: string;
  refresh_token: string;
  folderCount: number;
  message: string;
}> {
  const code = rawCode.trim();
  if (!code) {
    throw new ZohoSetupError('Please enter a Zoho authorization code.', 'missing_code', 400);
  }

  const { clientId, clientSecret } = getZohoClientEnv();
  if (!clientId || !clientSecret) {
    throw new ZohoSetupError(
      'ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET must be configured in server environment secrets before connecting.',
      'missing_client_credentials',
      500
    );
  }

  // 1. Exchange authorization code for refresh_token + access_token
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    code,
  });

  const tokenResp = await fetch(ZOHO_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
    signal: AbortSignal.timeout(15_000),
  });

  const rawTokenText = await tokenResp.text();
  let tokenData: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  } = {};
  try {
    tokenData = JSON.parse(rawTokenText);
  } catch {
    // Non-JSON response
  }

  if (!tokenResp.ok || tokenData.error || !tokenData.access_token) {
    const exactError = sanitizeZohoErrorText(rawTokenText, tokenResp.statusText);
    console.error(`[zoho] POST /oauth/v2/token failed status=${tokenResp.status} error=${exactError}`);
    throw new ZohoSetupError(
      exactError,
      tokenData.error || 'oauth_failed',
      400
    );
  }

  console.log(`[zoho] POST /oauth/v2/token succeeded status=${tokenResp.status}`);

  if (!tokenData.refresh_token) {
    const msg =
      'Zoho response did not include a refresh_token. Generate a fresh Self Client authorization code and try again.';
    console.error(`[zoho] POST /oauth/v2/token error status=${tokenResp.status} error=${msg}`);
    throw new ZohoSetupError(msg, 'missing_refresh_token', 400);
  }

  // 2. Fetch Zoho Mail accounts using access_token to get accountId & primary email
  const accountsResp = await fetch(`${ZOHO_API_BASE}/accounts`, {
    method: 'GET',
    headers: {
      Authorization: `Zoho-oauthtoken ${tokenData.access_token}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  });

  const rawAccountsText = await accountsResp.text();
  let accountsJson: {
    data?: ZohoAccountInfo[];
    status?: { description?: string };
    error?: string;
  } = {};
  try {
    accountsJson = JSON.parse(rawAccountsText);
  } catch {
    // Non-JSON response
  }

  if (!accountsResp.ok || !Array.isArray(accountsJson.data) || accountsJson.data.length === 0) {
    const exactError = sanitizeZohoErrorText(rawAccountsText, accountsResp.statusText);
    console.error(`[zoho] GET /api/accounts failed status=${accountsResp.status} error=${exactError}`);
    throw new ZohoSetupError(exactError, 'accounts_fetch_failed', 400);
  }

  console.log(`[zoho] GET /api/accounts succeeded status=${accountsResp.status}`);

  const primaryAccount = accountsJson.data[0];
  const accountId = String(primaryAccount.accountId ?? '').trim();
  const fromAddress = (
    primaryAccount.primaryEmailAddress ||
    primaryAccount.emailAddress?.find((e) => e.isPrimary)?.mailId ||
    primaryAccount.emailAddress?.[0]?.mailId ||
    primaryAccount.incomingUserName ||
    primaryAccount.mailId ||
    ''
  ).trim();

  if (!accountId || !fromAddress) {
    const msg = 'Zoho returned an account record without an accountId or primary email address.';
    console.error(`[zoho] GET /api/accounts incomplete status=${accountsResp.status} error=${msg}`);
    throw new ZohoSetupError(msg, 'incomplete_account', 400);
  }

  // 3. Persist refresh_token, accountId, and fromAddress into Postgres kv (zoho_config)
  await storage.zohoConfig.upsert({
    refresh_token: tokenData.refresh_token,
    accountId,
    fromAddress,
  });

  // Seed fresh access token cache immediately
  const expiresInSec = Number(tokenData.expires_in ?? 3600);
  tokenCache = {
    accessToken: tokenData.access_token,
    expiresAtMs: Date.now() + expiresInSec * 1000,
  };
  inflightRefresh = null;

  // 4. Test connection by listing inbox folders
  let folderCount = 0;
  try {
    const folders = await zohoMail.listFolders();
    folderCount = folders.length;
  } catch (folderErr) {
    console.error(
      `[zoho] Post-connect folder check warning: ${
        folderErr instanceof Error ? folderErr.message : String(folderErr)
      }`
    );
  }

  return {
    email: fromAddress,
    accountId,
    refresh_token: tokenData.refresh_token,
    folderCount,
    message: `Connected as ${fromAddress}`,
  };
}

async function zohoRequest<T = unknown>(
  endpointPath: string,
  options: RequestInit = {},
  retryOn401 = true
): Promise<T> {
  const cfg = await requireZohoConfig();
  if (!cfg.ok) {
    throw new Error(cfg.error);
  }

  const token = await fetchAccessToken(false);
  const url = `${ZOHO_API_BASE}${endpointPath}`;
  const resp = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
    signal: options.signal ?? AbortSignal.timeout(15_000),
  });

  if (resp.status === 401 && retryOn401) {
    console.warn(`[zoho] Received 401 on ${endpointPath}; refreshing access token.`);
    await fetchAccessToken(true);
    return zohoRequest<T>(endpointPath, options, false);
  }

  const rawText = await resp.text();
  let json: {
    status?: { code?: number; description?: string };
    data?: T;
    error?: string;
  } = {};
  try {
    json = JSON.parse(rawText);
  } catch {
    // Non-JSON response
  }

  if (!resp.ok) {
    const errorText = sanitizeZohoErrorText(rawText, resp.statusText);
    console.error(`[zoho] ${options.method ?? 'GET'} ${endpointPath} status=${resp.status} error=${errorText}`);
    throw new Error(`Zoho API error (${resp.status}): ${errorText}`);
  }

  return (json.data !== undefined ? json.data : json) as T;
}

export interface ZohoFolder {
  folderId: string;
  folderName: string;
  folderType?: string;
  unreadCount?: number;
  messageCount?: number;
}

export interface ZohoMessageSummary {
  messageId: string;
  folderId: string;
  threadId?: string;
  subject: string;
  sender?: string;
  fromAddress?: string;
  toAddress?: string;
  summary?: string;
  receivedTime?: string;
  sentDateInGMT?: string;
  status?: string;
  hasAttachment?: string;
  inReplyTo?: string;
}

export interface ZohoMessageContent {
  messageId: string;
  content?: string;
  subject?: string;
  fromAddress?: string;
  toAddress?: string;
  inReplyTo?: string;
  threadId?: string;
}

export const zohoMail = {
  async listFolders(): Promise<ZohoFolder[]> {
    const cfg = await requireZohoConfig();
    if (!cfg.ok) throw new Error(cfg.error);
    const data = await zohoRequest<ZohoFolder[]>(`/accounts/${cfg.accountId}/folders`, {
      method: 'GET',
    });
    return Array.isArray(data) ? data : [];
  },

  async createFolder(folderName: string, parentFolderId?: string): Promise<ZohoFolder> {
    const cfg = await requireZohoConfig();
    if (!cfg.ok) throw new Error(cfg.error);
    const body: Record<string, string> = { folderName };
    if (parentFolderId) body.parentFolderId = parentFolderId;
    return zohoRequest<ZohoFolder>(`/accounts/${cfg.accountId}/folders`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async listMessages(params: {
    folderId?: string;
    start?: number;
    limit?: number;
    status?: 'unread' | 'read' | 'all';
  } = {}): Promise<ZohoMessageSummary[]> {
    const cfg = await requireZohoConfig();
    if (!cfg.ok) throw new Error(cfg.error);
    const query = new URLSearchParams();
    if (params.folderId) query.set('folderId', params.folderId);
    query.set('start', String(params.start ?? 1));
    query.set('limit', String(Math.min(params.limit ?? 25, 100)));
    if (params.status && params.status !== 'all') query.set('status', params.status);
    query.set('sortorder', 'false');
    const data = await zohoRequest<ZohoMessageSummary[]>(
      `/accounts/${cfg.accountId}/messages/view?${query.toString()}`,
      { method: 'GET' }
    );
    return Array.isArray(data) ? data : [];
  },

  async searchMessages(params: {
    searchKey: string;
    limit?: number;
    start?: number;
  }): Promise<ZohoMessageSummary[]> {
    const cfg = await requireZohoConfig();
    if (!cfg.ok) throw new Error(cfg.error);
    const query = new URLSearchParams({
      searchKey: params.searchKey,
      start: String(params.start ?? 1),
      limit: String(Math.min(params.limit ?? 25, 100)),
    });
    const data = await zohoRequest<ZohoMessageSummary[]>(
      `/accounts/${cfg.accountId}/messages/search?${query.toString()}`,
      { method: 'GET' }
    );
    return Array.isArray(data) ? data : [];
  },

  async resolveFolderId(messageId: string, providedFolderId?: string): Promise<string> {
    if (providedFolderId) return providedFolderId;
    const recent = await this.listMessages({ limit: 50 });
    const found = recent.find((m) => String(m.messageId) === String(messageId));
    if (found?.folderId) return found.folderId;
    const folders = await this.listFolders();
    const inbox = folders.find(
      (f) => f.folderType?.toLowerCase() === 'inbox' || f.folderName.toLowerCase() === 'inbox'
    );
    if (inbox?.folderId) return inbox.folderId;
    throw new Error('Could not resolve folderId for Zoho message.');
  },

  async getMessageContent(messageId: string, folderId?: string): Promise<ZohoMessageContent> {
    const cfg = await requireZohoConfig();
    if (!cfg.ok) throw new Error(cfg.error);
    const targetFolder = await this.resolveFolderId(messageId, folderId);
    const [details, content] = await Promise.all([
      zohoRequest<ZohoMessageSummary>(
        `/accounts/${cfg.accountId}/folders/${targetFolder}/messages/${messageId}/details`,
        { method: 'GET' }
      ).catch(() => null),
      zohoRequest<{ content?: string }>(
        `/accounts/${cfg.accountId}/folders/${targetFolder}/messages/${messageId}/content`,
        { method: 'GET' }
      ),
    ]);
    return {
      messageId,
      content: content?.content ?? '',
      subject: details?.subject ?? '',
      fromAddress: details?.fromAddress ?? details?.sender ?? '',
      toAddress: details?.toAddress ?? '',
      inReplyTo: details?.inReplyTo,
      threadId: details?.threadId,
    };
  },

  async sendEmail(params: {
    toAddress: string;
    subject: string;
    content: string;
    mailFormat?: 'plaintext' | 'html';
    inReplyTo?: string;
    threadId?: string;
  }): Promise<{ messageId: string; threadId: string | null }> {
    const cfg = await requireZohoConfig();
    if (!cfg.ok) throw new Error(cfg.error);
    const payload: Record<string, unknown> = {
      fromAddress: cfg.fromAddress,
      toAddress: params.toAddress,
      subject: params.subject,
      content: params.content,
      mailFormat: params.mailFormat ?? 'plaintext',
    };
    if (params.inReplyTo) {
      payload.inReplyTo = params.inReplyTo;
    }
    const result = await zohoRequest<{ messageId?: string; threadId?: string }>(
      `/accounts/${cfg.accountId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
    return {
      messageId: String(result?.messageId ?? ''),
      threadId: result?.threadId ? String(result.threadId) : params.threadId ?? null,
    };
  },

  async createDraft(params: {
    toAddress: string;
    subject: string;
    content: string;
    inReplyTo?: string;
  }): Promise<{ messageId: string }> {
    const cfg = await requireZohoConfig();
    if (!cfg.ok) throw new Error(cfg.error);
    const payload: Record<string, unknown> = {
      fromAddress: cfg.fromAddress,
      toAddress: params.toAddress,
      subject: params.subject,
      content: params.content,
      mailFormat: 'plaintext',
      mode: 'draft',
    };
    if (params.inReplyTo) payload.inReplyTo = params.inReplyTo;
    const result = await zohoRequest<{ messageId?: string }>(
      `/accounts/${cfg.accountId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
    return { messageId: String(result?.messageId ?? '') };
  },

  async updateMessage(params: {
    messageIds: string[];
    mode: 'markAsRead' | 'markAsUnread' | 'moveMessage' | 'applyLabel';
    destfolderId?: string;
    labelId?: string;
  }): Promise<unknown> {
    const cfg = await requireZohoConfig();
    if (!cfg.ok) throw new Error(cfg.error);
    const payload: Record<string, unknown> = {
      mode: params.mode,
      messageId: params.messageIds,
    };
    if (params.destfolderId) payload.destfolderId = params.destfolderId;
    if (params.labelId) payload.labelId = [params.labelId];
    return zohoRequest(`/accounts/${cfg.accountId}/updatemessage`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async moveToTrash(messageId: string): Promise<{ movedToTrash: boolean; trashFolderId: string }> {
    const folders = await this.listFolders();
    const trash = folders.find(
      (f) => f.folderType?.toLowerCase() === 'trash' || f.folderName.toLowerCase() === 'trash'
    );
    if (!trash) {
      throw new Error('Could not locate Trash folder in Zoho Mail account.');
    }
    await this.updateMessage({
      messageIds: [messageId],
      mode: 'moveMessage',
      destfolderId: trash.folderId,
    });
    return { movedToTrash: true, trashFolderId: trash.folderId };
  },
};
