import { FunctionDeclaration, Type } from '@google/genai';
import { storage } from '../../lib/storage.ts';
import type { CompanyContext, MemoryRecord, ProgressMemory } from '../outreach/types.ts';

const DEFAULT_COMPANY_CONTEXT: CompanyContext = {
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

const DEFAULT_PROGRESS: ProgressMemory = {
  campaigns_summary: 'No campaigns launched yet.',
  last_inbox_check: null,
  notes: '',
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(
  target: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };
  for (const [k, val] of Object.entries(patch)) {
    if (isPlainObject(val) && isPlainObject(result[k])) {
      result[k] = deepMerge(result[k] as Record<string, unknown>, val);
    } else {
      result[k] = val;
    }
  }
  return result;
}

export async function getMemory<T = Record<string, unknown>>(key: string): Promise<T | null> {
  const existing = await storage.memory.get(key);
  if (existing) return existing.value as T;

  if (key === 'company_context') {
    const created = await storage.memory.upsert(
      'company_context',
      DEFAULT_COMPANY_CONTEXT as unknown as Record<string, unknown>
    );
    return created.value as T;
  }
  if (key === 'progress') {
    const created = await storage.memory.upsert(
      'progress',
      DEFAULT_PROGRESS as unknown as Record<string, unknown>
    );
    return created.value as T;
  }
  return null;
}

export async function setMemory(
  key: string,
  value: Record<string, unknown>
): Promise<MemoryRecord> {
  return storage.memory.upsert(key, value);
}

export async function mergeMemory(
  key: string,
  patch: Record<string, unknown>
): Promise<MemoryRecord> {
  const current = (await getMemory<Record<string, unknown>>(key)) ?? {};
  const merged = deepMerge(current, patch);
  return storage.memory.upsert(key, merged);
}

export async function getAllMemory(): Promise<MemoryRecord[]> {
  // Ensure core keys exist before listing
  await getMemory('company_context');
  await getMemory('progress');
  const all = await storage.memory.list();
  // Exclude internal auth hash key from user-facing memory views and AI context
  return all.filter((m) => !m.key.startsWith('_'));
}

export async function getCompanyContext(): Promise<CompanyContext> {
  const ctx = await getMemory<CompanyContext>('company_context');
  return ctx ?? DEFAULT_COMPANY_CONTEXT;
}

export async function getProgress(): Promise<ProgressMemory> {
  const prog = await getMemory<ProgressMemory>('progress');
  return prog ?? DEFAULT_PROGRESS;
}

export const MEMORY_TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'read_memory',
    description:
      'Read a persistent memory document by key (e.g., "company_context" or "progress").',
    parameters: {
      type: Type.OBJECT,
      properties: {
        key: {
          type: Type.STRING,
          description: 'Memory key to read, such as "company_context" or "progress".',
        },
      },
      required: ['key'],
    },
  },
  {
    name: 'update_memory',
    description:
      'Merge a JSON patch object into a persistent memory key (e.g., updating company_context tone, offers, signature, or progress notes).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        key: {
          type: Type.STRING,
          description: 'Memory key to update (cannot start with underscore).',
        },
        patch: {
          type: Type.OBJECT,
          description: 'JSON object fields to merge into the stored memory value.',
          properties: {
            notes: { type: Type.STRING },
            tone: { type: Type.STRING },
            icp: { type: Type.STRING },
            signature: { type: Type.STRING },
            unsubscribe_text: { type: Type.STRING },
            campaigns_summary: { type: Type.STRING },
            last_inbox_check: { type: Type.STRING },
          },
        },
      },
      required: ['key', 'patch'],
    },
  },
];

export async function handleMemoryTool(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  if (name === 'read_memory') {
    const key = String(args.key ?? '').trim();
    if (!key || key.startsWith('_')) {
      return { error: 'Invalid memory key.' };
    }
    const value = await getMemory(key);
    return { key, value };
  }
  if (name === 'update_memory') {
    const key = String(args.key ?? '').trim();
    const patch = args.patch;
    if (!key || key.startsWith('_')) {
      return { error: 'Invalid memory key.' };
    }
    if (!isPlainObject(patch)) {
      return { error: 'Patch must be a JSON object.' };
    }
    const previous = await getMemory(key);
    const updated = await mergeMemory(key, patch);
    await storage.actionLog.log('update_memory', { key, patch, previous });
    return { key: updated.key, value: updated.value, updated_at: updated.updated_at };
  }
  return { error: `Unknown memory tool: ${name}` };
}
