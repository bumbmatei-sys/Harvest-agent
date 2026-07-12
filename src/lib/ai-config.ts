// Shared AI model/provider configuration. Single source of truth so a model
// swap or deprecation is a one-place edit instead of a multi-file grep.

// MiMo (Xiaomi) Token Plan chat-completions endpoint — used by the blog
// generator, the newsletter generator, and the AI RAG chat.
export const MIMO_MODEL = 'mimo-v2.5';

// Contract: `MIMO_BASE_URL` is the REGION base URL exactly as shown on the
// Token Plan subscription page (e.g. https://token-plan-sgp.xiaomimimo.com/v1),
// i.e. everything up to and INCLUDING `/v1` — the code appends
// `/chat/completions`. A Token Plan key only authenticates against its own
// region's base URL, so this must be configurable per deployment. Unset →
// defaults to the China cluster, keeping current behavior byte-for-byte.
export function getMimoChatUrl(): string {
  const base = (process.env.MIMO_BASE_URL || 'https://token-plan-cn.xiaomimimo.com/v1').replace(
    /\/+$/,
    '',
  );
  return `${base}/chat/completions`;
}

// Gemini model with native video (incl. YouTube URL) understanding.
export const GEMINI_VIDEO_MODEL = 'gemini-3.5-flash';

// Current GA Gemini embedding model. The previous id
// ('gemini-embedding-2-preview') is not a valid model, so every embed
// call 500'd — which left AI Knowledge sources stuck on "Processing…".
export const GEMINI_EMBEDDING_MODEL = 'gemini-embedding-001';
