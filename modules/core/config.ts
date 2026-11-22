// Central Gemini & Outreach Runtime Configuration
// Free-tier Gemini models live here for single-point maintenance and automatic fallback.

export const GEMINI_MODELS = {
  PRIMARY: 'gemini-4-hydrogen',
  FALLBACK_CHAIN: [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-3.1-flash-lite',
  ] as readonly string[],
  CLASSIFIER: 'gemini-4-hydrogen',
  CLASSIFIER_FALLBACK_CHAIN: [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-3.1-flash-lite',
  ] as readonly string[],
} as const;

export function getDailySendCap(): number {
  const raw = Number(process.env.DAILY_SEND_CAP ?? '30');
  if (!Number.isFinite(raw) || raw < 1) return 30;
  return Math.floor(raw);
}

export function isZohoConfigured(): boolean {
  return Boolean(
    process.env.ZOHO_CLIENT_ID?.trim() &&
      process.env.ZOHO_CLIENT_SECRET?.trim() &&
      process.env.ZOHO_REFRESH_TOKEN?.trim() &&
      process.env.ZOHO_ACCOUNT_ID?.trim() &&
      process.env.ZOHO_FROM_ADDRESS?.trim()
  );
}

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}
