import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { ensureStorageInitialized, getStorageStatus, storage } from './lib/storage.ts';
import {
  connectZohoWithAuthorizationCode,
  getZohoConnectionStatus,
  ZohoSetupError,
} from './lib/zoho.ts';
import { runAgentStream, type ChatTurnMessage } from './modules/core/agent.ts';
import {
  claimInitialPassword,
  clearSessionCookie,
  createSignedSessionToken,
  getAuthConfigState,
  isRequestAuthenticated,
  requireAuth,
  setSessionCookie,
  verifyWorkspacePassword,
} from './modules/core/auth.ts';
import { getDailySendCap, isGeminiConfigured } from './modules/core/config.ts';
import { getAllMemory, getMemory, setMemory } from './modules/core/memory.ts';
import {
  checkInboxHandler,
  executePendingAction,
  getOutreachStatusSummary,
  handleOutreachTool,
  rejectPendingAction,
  undoActionLogEntry,
} from './modules/outreach/handlers.ts';
import { runSendingEngine } from './modules/outreach/sender.ts';

export const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));

// ── Health Check ────────────────────────────────────────────────────────────
app.get('/api/health', async (_req, res) => {
  const storageStatus = await getStorageStatus();
  res.json({
    ok: storageStatus.connected,
    storage: storageStatus.connected ? 'neon' : 'error',
    storageLabel: storageStatus.label,
    ...(storageStatus.error ? { error: storageStatus.error } : {}),
  });
});

// ── Auth Routes ─────────────────────────────────────────────────────────────
app.get('/api/auth/status', async (req, res) => {
  try {
    const [cfg, zohoStatus] = await Promise.all([
      getAuthConfigState(),
      getZohoConnectionStatus(),
    ]);
    const authenticated = isRequestAuthenticated(req);
    res.json({
      authenticated,
      setupRequired: cfg.setupRequired,
      envConfigured: cfg.envConfigured,
      integrations: {
        gemini: isGeminiConfigured(),
        zoho: zohoStatus.connected,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Auth check failed' });
  }
});

app.post('/api/auth/claim', async (req, res) => {
  try {
    const password = String(req.body?.password ?? '');
    const result = await claimInitialPassword(password);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    const token = createSignedSessionToken();
    setSessionCookie(res, token);
    res.json({ ok: true, authenticated: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Claim failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const password = String(req.body?.password ?? '');
    const cfg = await getAuthConfigState();
    if (cfg.setupRequired) {
      res.status(400).json({ error: 'Workspace password has not been claimed yet.' });
      return;
    }
    const valid = await verifyWorkspacePassword(password);
    if (!valid) {
      res.status(401).json({ error: 'Invalid password.' });
      return;
    }
    const token = createSignedSessionToken();
    setSessionCookie(res, token);
    res.json({ ok: true, authenticated: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Login failed' });
  }
});

app.post('/api/auth/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ── Protected Workspace Routes ──────────────────────────────────────────────
app.get('/api/chats', requireAuth, async (_req, res) => {
  try {
    const chats = await storage.chats.list(100);
    res.json({ chats, retentionHours: 24 });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load chats' });
  }
});

app.put('/api/chats/:id', requireAuth, async (req, res) => {
  try {
    const id = String(req.params.id ?? '').trim();
    if (!id) {
      res.status(400).json({ error: 'Chat ID is required.' });
      return;
    }
    const title = String(req.body?.title ?? 'New Chat').trim() || 'New Chat';
    const rawMessages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const saved = await storage.chats.upsert({
      id,
      title,
      messages: rawMessages,
    });
    res.json({ chat: saved });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save chat' });
  }
});

app.delete('/api/chats/:id', requireAuth, async (req, res) => {
  try {
    const id = String(req.params.id ?? '').trim();
    if (id) {
      await storage.chats.deleteById(id);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to delete chat' });
  }
});

app.delete('/api/chats', requireAuth, async (_req, res) => {
  try {
    await storage.chats.clearAll();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to clear chats' });
  }
});

app.post('/api/chat', requireAuth, async (req, res) => {
  void storage.chats.pruneExpired().catch(() => {});

  const rawMessages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const messages: ChatTurnMessage[] = rawMessages
    .filter(
      (m: unknown): m is ChatTurnMessage =>
        Boolean(m) &&
        typeof m === 'object' &&
        ((m as ChatTurnMessage).role === 'user' || (m as ChatTurnMessage).role === 'assistant') &&
        typeof (m as ChatTurnMessage).content === 'string'
    )
    .slice(-24);

  if (messages.length === 0) {
    res.status(400).json({ error: 'At least one chat message is required.' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  res.write(': connected\n\n');

  const sendEvent = (payload: unknown) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  await runAgentStream({
    messages,
    onEvent: (evt) => {
      sendEvent(evt);
    },
  });

  res.end();
});

app.get('/api/dashboard', requireAuth, async (_req, res) => {
  try {
    const [summary, pending, zohoStatus] = await Promise.all([
      getOutreachStatusSummary(),
      storage.pendingActions.list('pending'),
      getZohoConnectionStatus(),
    ]);
    res.json({
      ...summary,
      pending_approvals: pending,
      zohoEmail: zohoStatus.fromAddress,
      integrations: {
        gemini: isGeminiConfigured(),
        zoho: zohoStatus.connected,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Dashboard load failed' });
  }
});

// Settings & Zoho Setup
app.get('/api/settings', requireAuth, async (_req, res) => {
  try {
    const [zoho, storageStatus] = await Promise.all([
      getZohoConnectionStatus(),
      getStorageStatus(),
    ]);
    res.json({
      zoho,
      storage: storageStatus,
      dailySendCap: getDailySendCap(),
      integrations: {
        gemini: isGeminiConfigured(),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Settings load failed' });
  }
});

app.post('/api/settings/zoho-token', requireAuth, async (_req, res) => {
  try {
    const cfg = await storage.zohoConfig.get();
    if (!cfg?.refresh_token) {
      res.status(404).json({ error: 'No refresh_token is saved in database zoho_config.' });
      return;
    }
    res.json({
      refresh_token: cfg.refresh_token,
      accountId: cfg.accountId,
      fromAddress: cfg.fromAddress,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to read saved Zoho refresh token',
    });
  }
});

app.get('/api/setup/zoho', requireAuth, async (_req, res) => {
  try {
    const status = await getZohoConnectionStatus();
    res.json({
      alreadyConnected: status.alreadyConnected,
      connected: status.connected,
      fromAddress: status.fromAddress,
      accountId: status.accountId,
      clientConfigured: status.clientConfigured,
      updatedAt: status.updatedAt,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to inspect Zoho status' });
  }
});

app.post('/api/setup/zoho', requireAuth, async (req, res) => {
  try {
    const code = String(req.body?.code ?? '').trim();
    const result = await connectZohoWithAuthorizationCode(code);
    await storage.actionLog.log('connect_zoho', {
      email: result.email,
      accountId: result.accountId,
      folder_count: result.folderCount,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof ZohoSetupError) {
      res.status(err.statusCode).json({ error: err.message, code: err.code });
      return;
    }
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Zoho connection failed.',
      code: 'zoho_setup_error',
    });
  }
});

// Leads
app.get('/api/leads', requireAuth, async (req, res) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : 'all';
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const [leads, allMatchingSearch] = await Promise.all([
      storage.leads.list({ status, search, limit: 500 }),
      storage.leads.list({ status: 'all', search, limit: 2000 }),
    ]);
    const counts: Record<string, number> = {
      all: allMatchingSearch.length,
      new: 0,
      queued: 0,
      sent: 0,
      replied: 0,
      interested: 0,
      not_interested: 0,
      bounced: 0,
      unsubscribed: 0,
    };
    for (const l of allMatchingSearch) {
      counts[l.status] = (counts[l.status] ?? 0) + 1;
    }
    res.json({ leads, counts });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list leads' });
  }
});

app.post('/api/leads/import', requireAuth, async (req, res) => {
  try {
    const result = await handleOutreachTool('import_leads', {
      raw_text: req.body?.raw_text,
      rows: req.body?.rows,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Lead import failed' });
  }
});

app.patch('/api/leads/:id', requireAuth, async (req, res) => {
  try {
    const result = await handleOutreachTool('update_lead', {
      id: req.params.id,
      fields: req.body?.fields ?? req.body ?? {},
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Lead update failed' });
  }
});

// Campaigns
app.get('/api/campaigns', requireAuth, async (_req, res) => {
  try {
    const [campaigns, campaignLeads] = await Promise.all([
      storage.campaigns.list(),
      storage.campaignLeads.list(),
    ]);
    const statsByCampaign: Record<
      string,
      { queued: number; completed: number; stopped: number; failed: number }
    > = {};
    for (const cl of campaignLeads) {
      if (!statsByCampaign[cl.campaign_id]) {
        statsByCampaign[cl.campaign_id] = { queued: 0, completed: 0, stopped: 0, failed: 0 };
      }
      if (cl.status === 'queued') statsByCampaign[cl.campaign_id].queued++;
      else if (cl.status === 'completed') statsByCampaign[cl.campaign_id].completed++;
      else if (cl.status === 'stopped') statsByCampaign[cl.campaign_id].stopped++;
      else if (cl.status === 'failed') statsByCampaign[cl.campaign_id].failed++;
    }
    res.json({ campaigns, stats: statsByCampaign });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Campaigns load failed' });
  }
});

app.post('/api/campaigns', requireAuth, async (req, res) => {
  try {
    const result = await handleOutreachTool('create_campaign', req.body ?? {});
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Campaign creation failed' });
  }
});

async function handleRunCampaign(req: express.Request, res: express.Response) {
  try {
    const result = await handleOutreachTool('run_campaign', {
      campaign_id: req.params.id,
      lead_filter: req.body?.lead_filter ?? { status: 'new' },
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Campaign run failed' });
  }
}

app.post('/api/campaigns/:id/stage', requireAuth, handleRunCampaign);
app.post('/api/campaigns/:id/run', requireAuth, handleRunCampaign);

app.post('/api/campaigns/:id/pause', requireAuth, async (req, res) => {
  try {
    const result = await handleOutreachTool('pause_campaign', { campaign_id: req.params.id });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Pause failed' });
  }
});

app.post('/api/campaigns/:id/resume', requireAuth, async (req, res) => {
  try {
    const result = await handleOutreachTool('resume_campaign', { campaign_id: req.params.id });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Resume failed' });
  }
});

// Inbox & Sending Trigger
app.get('/api/inbox', requireAuth, async (_req, res) => {
  try {
    const [emails, leads, zohoStatus] = await Promise.all([
      storage.emailsLog.list(150),
      storage.leads.list({ limit: 1000 }),
      getZohoConnectionStatus(),
    ]);
    const leadMap = new Map(leads.map((l) => [l.id, l]));
    const enriched = emails.map((e) => ({
      ...e,
      lead: e.lead_id ? leadMap.get(e.lead_id) ?? null : null,
    }));
    res.json({ emails: enriched, zohoConfigured: zohoStatus.connected });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Inbox load failed' });
  }
});

app.post('/api/inbox/check', requireAuth, async (req, res) => {
  try {
    const since = typeof req.body?.since === 'string' ? req.body.since : undefined;
    const result = await checkInboxHandler(since);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Inbox check failed' });
  }
});

app.post('/api/sending/run', requireAuth, async (_req, res) => {
  try {
    const result = await runSendingEngine({ maxPerRun: 10, maxRuntimeMs: 45_000, skipDelay: false });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Sending run failed' });
  }
});

// Pending Actions & Activity Log
app.get('/api/actions', requireAuth, async (_req, res) => {
  try {
    const [pending_actions, action_log] = await Promise.all([
      storage.pendingActions.list(),
      storage.actionLog.list(150),
    ]);
    res.json({ pending_actions, action_log });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Actions load failed' });
  }
});

app.post('/api/actions/:id/approve', requireAuth, async (req, res) => {
  try {
    const result = await executePendingAction(String(req.params.id));
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Approval failed' });
  }
});

app.post('/api/actions/:id/reject', requireAuth, async (req, res) => {
  try {
    const result = await rejectPendingAction(String(req.params.id));
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Rejection failed' });
  }
});

app.post('/api/actions/undo/:logId', requireAuth, async (req, res) => {
  try {
    const result = await undoActionLogEntry(String(req.params.logId));
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Undo failed' });
  }
});

// Memory
app.get('/api/memory', requireAuth, async (_req, res) => {
  try {
    const records = await getAllMemory();
    res.json({ records });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Memory load failed' });
  }
});

app.put('/api/memory/:key', requireAuth, async (req, res) => {
  try {
    const key = String(req.params.key ?? '').trim();
    if (!key || key.startsWith('_')) {
      res.status(400).json({ error: 'Invalid memory key.' });
      return;
    }
    const value = req.body?.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      res.status(400).json({ error: 'Memory value must be a JSON object.' });
      return;
    }
    const previous = await getMemory(key);
    const updated = await setMemory(key, value as Record<string, unknown>);
    await storage.actionLog.log('update_memory', { key, value, previous });
    res.json({ record: updated });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Memory save failed' });
  }
});

// ── Vite Dev Middleware / Static Production Serving ─────────────────────────
async function startServer() {
  try {
    await ensureStorageInitialized();
  } catch (err) {
    console.error(
      '[storage] Neon initialization deferred/error:',
      err instanceof Error ? err.message : String(err)
    );
  }

  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Agency Outreach Agent server listening on http://0.0.0.0:${port}`);
  });
}

if (!process.env.VERCEL) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

export default app;
