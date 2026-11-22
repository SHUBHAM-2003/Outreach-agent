# Agency Outreach Agent

Server-side AI outreach workspace built with TypeScript, Tailwind CSS, Express/Node API routes, Gemini function calling (`@google/genai`), Zoho Mail (`.in` India DC), and Neon Postgres (`@neondatabase/serverless`).

---

## Architecture

- `/lib/db.ts` — Server-side Neon Postgres client (`@neondatabase/serverless`), automatic startup DDL for `leads`, `campaigns`, `campaign_leads`, `emails_log`, `action_log`, `pending_actions`, and `kv`, plus connection health checks.
- `/lib/storage.ts` — Postgres persistence repository (including one-time automatic import of existing `/data/*.json` files into Neon on first run).
- `/modules/core/auth.ts` — Single-user login against `APP_PASSWORD` (with first-run scrypt claim fallback when unset), deterministic HMAC-SHA256 `HttpOnly` session cookies signed from `APP_PASSWORD`, and CSRF origin/header verification.
- `/modules/core/memory.ts` — `getMemory`, `setMemory`, `mergeMemory`, and tool handlers for `company_context` and `progress` backed by `kv`.
- `/modules/core/agent.ts` & `gemini.ts` — Streaming Gemini agent loop (`gemini-4-hydrogen` with 3 retries at `2s`, `5s`, `10s` on `503`/`429`/`UNAVAILABLE` and automatic fallback through `gemini-2.5-flash`, `gemini-2.5-flash-lite`, and `gemini-3.1-flash-lite`).
- `/modules/core/registry.ts` — Module plugin registry alongside `outreachModule`.
- `/modules/outreach/tools.ts`, `handlers.ts`, `sender.ts` — Direct email sending (`send_email`, `send_reply`, `send_followups`), lead import/deduplication, campaign creation & immediate launch (`run_campaign`), Zoho Mail triage & classification, and daily-capped sending engine.
- `/lib/zoho.ts` — Zoho Mail India DC (`https://mail.zoho.in/api` & `https://accounts.zoho.in/oauth/v2/token`) OAuth token caching, 401 auto-refresh, folder/message/draft/send/soft-delete operations.

---

## 1. Zoho Self Client Setup (India Data Center `.in`)

1. Sign in to the [Zoho API Console (India)](https://api-console.zoho.in/).
2. Click **Add Client** -> **Self Client** -> **Create**.
3. Copy your **Client ID** (`ZOHO_CLIENT_ID`) and **Client Secret** (`ZOHO_CLIENT_SECRET`) into environment variables.
4. Under **Generate Code**, enter the required Zoho Mail scopes:
   ```text
   ZohoMail.accounts.READ,ZohoMail.messages.ALL,ZohoMail.folders.ALL
   ```
   Set Time Duration to **10 minutes** and click **Create** to copy the authorization `code`.
5. **Connect & copy credentials**: Sign in, open **Settings -> Connect Zoho** (or visit `/setup/zoho`), paste the authorization code, and click **Connect**. Copy the displayed `ZOHO_REFRESH_TOKEN`, `ZOHO_ACCOUNT_ID`, and your email (`ZOHO_FROM_ADDRESS`) — you can also reveal `ZOHO_REFRESH_TOKEN` anytime on **Settings**.

---

## 2. Vercel Deploy Steps

1. Push this repository to GitHub/GitLab and import into [Vercel](https://vercel.com/new).
2. Add the actively used environment variables in **Vercel Project Settings -> Environment Variables**:
   - `DATABASE_URL` (Neon Postgres connection string)
   - `GEMINI_API_KEY`
   - `APP_PASSWORD`
   - `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET` (plus optionally `ZOHO_REFRESH_TOKEN`, `ZOHO_ACCOUNT_ID`, `ZOHO_FROM_ADDRESS` if you don't store Zoho config solely in Neon)
   - `DAILY_SEND_CAP` (optional, defaults to `30`)
3. Deploy. `vercel.json` automatically configures `api/index.ts` (`maxDuration: 60`) and SPA fallback routing to `/index.html` for all dedicated pages.
