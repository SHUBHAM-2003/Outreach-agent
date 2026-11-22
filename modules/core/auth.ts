import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { storage } from '../../lib/storage.ts';

const COOKIE_NAME = 'aoa_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MEMORY_ADMIN_KEY = '_admin_auth';

// Ephemeral fallback secret generated once per server boot (never hardcoded)
const EPHEMERAL_SIGNING_KEY = crypto.randomBytes(32).toString('hex');

function getSigningKey(): string {
  const explicit = process.env.AUTH_SECRET?.trim();
  if (explicit) return explicit;
  const appPassword = process.env.APP_PASSWORD?.trim();
  if (appPassword) {
    return crypto
      .createHash('sha256')
      .update(`aoa-session:${appPassword}`)
      .digest('hex');
  }
  return EPHEMERAL_SIGNING_KEY;
}

function timingSafeCompare(a: string, b: string): boolean {
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function hashPasswordScrypt(password: string, salt?: string): { hash: string; salt: string } {
  const actualSalt = salt ?? crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, actualSalt, 64).toString('hex');
  return { hash: derived, salt: actualSalt };
}

function verifyScryptHash(password: string, storedHash: string, salt: string): boolean {
  const { hash } = hashPasswordScrypt(password, salt);
  return timingSafeCompare(hash, storedHash);
}

export async function getAuthConfigState(): Promise<{
  envConfigured: boolean;
  claimed: boolean;
  setupRequired: boolean;
}> {
  const envPass = process.env.APP_PASSWORD?.trim();
  if (envPass) {
    return { envConfigured: true, claimed: true, setupRequired: false };
  }
  const stored = await storage.memory.get(MEMORY_ADMIN_KEY);
  const claimed = Boolean(
    stored?.value &&
      typeof stored.value.hash === 'string' &&
      typeof stored.value.salt === 'string'
  );
  return { envConfigured: false, claimed, setupRequired: !claimed };
}

export async function claimInitialPassword(password: string): Promise<{ ok: boolean; error?: string }> {
  const envPass = process.env.APP_PASSWORD?.trim();
  if (envPass) {
    return { ok: false, error: 'Workspace password is already configured via APP_PASSWORD.' };
  }
  const existing = await storage.memory.get(MEMORY_ADMIN_KEY);
  if (existing?.value && typeof existing.value.hash === 'string') {
    return { ok: false, error: 'Workspace password has already been claimed.' };
  }
  if (!password || password.length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters long.' };
  }
  const { hash, salt } = hashPasswordScrypt(password);
  await storage.memory.upsert(MEMORY_ADMIN_KEY, {
    hash,
    salt,
    claimed_at: new Date().toISOString(),
  });
  return { ok: true };
}

export async function verifyWorkspacePassword(password: string): Promise<boolean> {
  if (!password) return false;
  const envPass = process.env.APP_PASSWORD?.trim();
  if (envPass) {
    return timingSafeCompare(password, envPass);
  }
  const stored = await storage.memory.get(MEMORY_ADMIN_KEY);
  if (
    stored?.value &&
    typeof stored.value.hash === 'string' &&
    typeof stored.value.salt === 'string'
  ) {
    return verifyScryptHash(password, stored.value.hash, stored.value.salt);
  }
  return false;
}

export function createSignedSessionToken(): string {
  const payload = {
    sub: 'agency_operator',
    iat: Date.now(),
    exp: Date.now() + SESSION_TTL_MS,
    jti: crypto.randomBytes(12).toString('hex'),
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getSigningKey()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySignedSessionToken(token: string | undefined): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [encoded, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', getSigningKey())
    .update(encoded)
    .digest('base64url');
  if (!timingSafeCompare(sig, expectedSig)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
      exp?: number;
      sub?: string;
    };
    if (!parsed.exp || Date.now() > parsed.exp) return false;
    return parsed.sub === 'agency_operator';
  } catch {
    return false;
  }
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    out[key] = decodeURIComponent(val);
  }
  return out;
}

export function setSessionCookie(res: Response, token: string): void {
  const maxAgeSec = Math.floor(SESSION_TTL_MS / 1000);
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=None; Partitioned; Path=/; Max-Age=${maxAgeSec}`
  );
}

export function clearSessionCookie(res: Response): void {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=None; Partitioned; Path=/; Max-Age=0`
  );
}

function verifyMutationCsrf(req: Request): boolean {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  if (req.headers['x-requested-with'] === 'XMLHttpRequest') return true;
  const origin = req.headers.origin;
  const host = (req.headers['x-forwarded-host'] as string | undefined) || req.headers.host;
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      return originHost === host;
    } catch {
      return false;
    }
  }
  return false;
}

export function isRequestAuthenticated(req: Request): boolean {
  const cookies = parseCookies(req.headers.cookie);
  return verifySignedSessionToken(cookies[COOKIE_NAME]);
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!isRequestAuthenticated(req)) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  if (!verifyMutationCsrf(req)) {
    res.status(403).json({ error: 'Invalid request origin or missing X-Requested-With header.' });
    return;
  }
  next();
}

