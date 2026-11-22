import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { GEMINI_MODELS, isGeminiConfigured } from './config.ts';

let client: GoogleGenAI | null = null;
const cooledDownModels = new Map<string, number>();

// Backoff delays in ms: 2s, 5s, 10s (up to 3 retries on 503, 429, or UNAVAILABLE)
const RETRY_BACKOFF_MS = [2000, 5000, 10000] as const;
const MODEL_COOLDOWN_MS = 5 * 60 * 1000;
export const GEMINI_CALL_TIMEOUT_MS = 18_000;

export function getGeminiClient(): GoogleGenAI {
  if (!isGeminiConfigured()) {
    throw new Error('GEMINI_API_KEY is not configured in server environment variables.');
  }
  if (!client) {
    client = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY!.trim(),
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return client;
}

export function getThinkingConfigForModel(
  model: string
): { thinkingLevel: ThinkingLevel } | undefined {
  if (model.startsWith('gemini-4-')) {
    return { thinkingLevel: ThinkingLevel.LOW };
  }
  return undefined;
}

function extractErrorStatusAndCode(err: unknown): {
  status?: number;
  apiStatus?: string;
  rawMessage: string;
} {
  if (!err) return { rawMessage: '' };
  const rawMessage = err instanceof Error ? err.message : String(err);
  let status = (err as { status?: number; code?: number }).status ?? (err as { code?: number }).code;
  let apiStatus = (err as { statusText?: string }).statusText;

  const jsonStart = rawMessage.indexOf('{');
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(rawMessage.slice(jsonStart)) as {
        error?: { code?: number; status?: string; message?: string };
        code?: number;
        status?: string;
      };
      const nested = parsed.error ?? parsed;
      if (typeof nested.code === 'number' && !status) {
        status = nested.code;
      }
      if (typeof nested.status === 'string') {
        apiStatus = nested.status;
      }
    } catch {
      // Ignore malformed JSON substring
    }
  }

  return { status, apiStatus, rawMessage };
}

function isRetryableGeminiError(err: unknown): boolean {
  if (!err) return false;
  if ((err as { nonRetryableAfterEmit?: boolean }).nonRetryableAfterEmit) {
    return false;
  }
  const errName = err instanceof Error ? err.name : '';
  const { status, apiStatus, rawMessage } = extractErrorStatusAndCode(err);
  const upper = rawMessage.toUpperCase();
  const upperStatus = (apiStatus ?? '').toUpperCase();

  return (
    errName === 'TimeoutError' ||
    errName === 'AbortError' ||
    status === 503 ||
    status === 429 ||
    upperStatus === 'UNAVAILABLE' ||
    upperStatus === 'RESOURCE_EXHAUSTED' ||
    upper.includes('503') ||
    upper.includes('429') ||
    upper.includes('UNAVAILABLE') ||
    upper.includes('RESOURCE_EXHAUSTED') ||
    upper.includes('HIGH DEMAND') ||
    upper.includes('OVERLOADED') ||
    upper.includes('QUOTA') ||
    upper.includes('RATE LIMIT') ||
    upper.includes('TIMEOUT') ||
    upper.includes('ABORTED')
  );
}

function isModelNotFoundError(err: unknown): boolean {
  if (!err) return false;
  const { status, apiStatus, rawMessage } = extractErrorStatusAndCode(err);
  const upper = rawMessage.toUpperCase();
  const upperStatus = (apiStatus ?? '').toUpperCase();
  return status === 404 || upperStatus === 'NOT_FOUND' || upper.includes('NOT_FOUND');
}

export function formatFriendlyGeminiError(err: unknown): string {
  const errName = err instanceof Error ? err.name : '';
  const { status, apiStatus, rawMessage } = extractErrorStatusAndCode(err);
  const upper = rawMessage.toUpperCase();
  const upperStatus = (apiStatus ?? '').toUpperCase();

  if (errName === 'TimeoutError' || upper.includes('TIMEOUT')) {
    return 'Gemini took too long to respond and timed out across the primary and backup models. Please try again.';
  }

  if (
    status === 503 ||
    upperStatus === 'UNAVAILABLE' ||
    upper.includes('503') ||
    upper.includes('UNAVAILABLE') ||
    upper.includes('HIGH DEMAND') ||
    upper.includes('OVERLOADED')
  ) {
    return 'Gemini is temporarily overloaded across the primary and fallback models. Please wait a few seconds and try again.';
  }

  if (
    status === 429 ||
    upperStatus === 'RESOURCE_EXHAUSTED' ||
    upper.includes('429') ||
    upper.includes('RESOURCE_EXHAUSTED') ||
    upper.includes('QUOTA') ||
    upper.includes('RATE LIMIT')
  ) {
    return 'The free Gemini API rate limit or quota was reached across all fallback models. Please wait about a minute and try again.';
  }

  if (
    status === 401 ||
    status === 403 ||
    upperStatus === 'PERMISSION_DENIED' ||
    upper.includes('API_KEY_INVALID') ||
    upper.includes('PERMISSION_DENIED')
  ) {
    return 'Gemini API authentication failed. Please check GEMINI_API_KEY in Settings > Secrets.';
  }

  if (status === 404 || upperStatus === 'NOT_FOUND') {
    return 'The requested Gemini model was not found for this API key. Please try again.';
  }

  if (!rawMessage || rawMessage.includes('{')) {
    return 'Something went wrong while communicating with Gemini. Please try again in a moment.';
  }

  return rawMessage;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isModelCooledDown(model: string): boolean {
  const until = cooledDownModels.get(model);
  if (!until) return false;
  if (Date.now() >= until) {
    cooledDownModels.delete(model);
    return false;
  }
  return true;
}

export async function withGeminiFallback<T>(
  primaryModel: string,
  fallbackModels: readonly string[] | string,
  runner: (model: string) => Promise<T>,
  onStatus?: (message: string) => void
): Promise<{ result: T; modelUsed: string }> {
  const rawFallbacks = Array.isArray(fallbackModels) ? fallbackModels : [fallbackModels];
  const uniqueFallbacks = rawFallbacks.filter((m) => m && m !== primaryModel);

  let lastError: unknown;

  const skipPrimary = isModelCooledDown(primaryModel) && uniqueFallbacks.length > 0;

  if (!skipPrimary) {
    for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt++) {
      try {
        const result = await runner(primaryModel);
        return { result, modelUsed: primaryModel };
      } catch (err) {
        lastError = err;
        if (isModelNotFoundError(err)) {
          cooledDownModels.set(primaryModel, Date.now() + MODEL_COOLDOWN_MS);
          break;
        }
        if (!isRetryableGeminiError(err)) {
          throw err;
        }
        if (attempt < RETRY_BACKOFF_MS.length) {
          const delayMs = RETRY_BACKOFF_MS[attempt];
          const delaySec = Math.round(delayMs / 1000);
          onStatus?.(
            `Model busy — retrying ${primaryModel} in ${delaySec}s (${attempt + 1}/${RETRY_BACKOFF_MS.length})...`
          );
          await sleep(delayMs);
        }
      }
    }
    cooledDownModels.set(primaryModel, Date.now() + MODEL_COOLDOWN_MS);
  }

  // Try each healthy fallback model sequentially
  for (const fallbackModel of uniqueFallbacks) {
    if (isModelCooledDown(fallbackModel)) continue;
    try {
      onStatus?.(`Switching to ${fallbackModel}...`);
      const result = await runner(fallbackModel);
      return { result, modelUsed: fallbackModel };
    } catch (fallbackErr) {
      lastError = fallbackErr;
      if (isRetryableGeminiError(fallbackErr) || isModelNotFoundError(fallbackErr)) {
        cooledDownModels.set(fallbackModel, Date.now() + MODEL_COOLDOWN_MS);
        continue;
      }
      throw fallbackErr;
    }
  }

  // If all fallbacks were on cooldown, do one final direct pass through fallbacks
  for (const fallbackModel of uniqueFallbacks) {
    try {
      onStatus?.(`Retrying ${fallbackModel}...`);
      const result = await runner(fallbackModel);
      cooledDownModels.delete(fallbackModel);
      return { result, modelUsed: fallbackModel };
    } catch (fallbackErr) {
      lastError = fallbackErr;
      if (!isRetryableGeminiError(fallbackErr) && !isModelNotFoundError(fallbackErr)) {
        throw fallbackErr;
      }
    }
  }

  throw lastError;
}

export { GEMINI_MODELS };
