import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { requireAuth, type AuthenticatedUser } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { getMimoChatUrl, MIMO_MODEL, GEMINI_EMBEDDING_MODEL } from '@/lib/ai-config';
import {
  approxTokens,
  checkAndReserveIngest,
  refundIngest,
  checkQueryBudget,
  incrementQueryTokens,
} from '@/lib/rag-usage';

export const dynamic = 'force-dynamic';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const MAX_TEXT_LENGTH = 50000; // 50KB limit for embed text
const MAX_PROMPT_LENGTH = 30000; // 30KB limit for generate prompts

/**
 * Exact billed token count for an embed input. Gemini's embedContent response
 * (developer API, apiKey auth) exposes NO token count — its billableCharacter
 * /statistics.tokenCount fields are "Gemini Enterprise Agent Platform" (Vertex)
 * only, undefined here — so we ask the free `countTokens` endpoint (the real
 * billed unit). If that ever fails/returns nothing we fall back to the documented
 * ~4-chars/token APPROXIMATION. Used only for the ingest gate; never metered
 * against a field that might silently be 0.
 */
async function countEmbedTokens(text: string): Promise<number> {
  try {
    const r = await ai.models.countTokens({ model: GEMINI_EMBEDDING_MODEL, contents: [text] });
    if (typeof r.totalTokens === 'number' && r.totalTokens > 0) return r.totalTokens;
  } catch (e) {
    console.warn('Gemini countTokens failed — falling back to char/4 estimate:', e);
  }
  return approxTokens(text); // documented approximation (~4 chars/token)
}

// ── AI RAG chat usage limits (server-side, easy to tune) ──
// The chat runs on a single shared MiMo subscription, so per-user usage is
// capped to protect against runaway token use and concurrency spikes. The
// redirect/cooldown replies below are canned text returned WITHOUT calling
// MiMo, so they cost nothing and shed load.
const FREE_MESSAGES = 10;     // messages 1–10 get a normal AI answer
const REDIRECT_MESSAGES = 3;  // messages 11–13 get the Holy-Spirit redirect
const COOLDOWN_HOURS = 3;     // then the chat rests for this long

const REDIRECT_MESSAGE = `You've brought a lot of questions today, and that's a good thing. But some questions are best taken to the One who knows you fully. The Holy Spirit is your true Helper and Teacher (John 14:26), and learning to hear His voice is worth far more than anything I could tell you. Here's a simple way to begin:

1. Get quiet. Find a still place and put away distractions. "Be still, and know that I am God" (Psalm 46:10).
2. Open the Scriptures. God's voice never contradicts His Word — read slowly and ask Him to speak through it.
3. Pray honestly, then listen. Bring Him your question, then pause and wait. Don't rush to fill the silence.
4. Notice the gentle nudge. His leading usually comes as a quiet peace, a returning thought, or a verse that stands out — not as noise (1 Kings 19:11–12).
5. Test what you hear. Weigh it against Scripture and wise, godly counsel.

Take this question to Him in prayer. He is nearer than you think.`;

const COOLDOWN_MESSAGE = `Let's pause here for a little while. Rest in what God has already shown you today, and spend some of this time with Him directly — in prayer, in His Word, and in stillness. I'll be ready to help again in a few hours. "Come to Me, all you who are weary and burdened, and I will give you rest" (Matthew 11:28).`;

/**
 * Enforce the per-user AI RAG chat usage limit, keyed on the authenticated uid.
 * Runs BEFORE any MiMo call. Returns the MiMo answer while within the free
 * allowance, otherwise a canned redirect/cooldown reply (no MiMo call). State
 * lives in `chat_usage/{uid}`, written only here via the Admin SDK.
 */
async function enforceChatLimit(
  user: AuthenticatedUser,
  callMimo: () => Promise<NextResponse>
): Promise<NextResponse> {
  const usageRef = adminDb.collection('chat_usage').doc(user.uid);
  const snap = await usageRef.get();
  const data: Record<string, any> = (snap.exists ? snap.data() : null) || {};

  let windowCount: number = typeof data.windowCount === 'number' ? data.windowCount : 0;
  let cooldownUntil: number | null = typeof data.cooldownUntil === 'number' ? data.cooldownUntil : null;
  const lastMessageAt: number | null = typeof data.lastMessageAt === 'number' ? data.lastMessageAt : null;

  const now = Date.now();
  const COOLDOWN_MS = COOLDOWN_HOURS * 3600_000;

  const save = (fields: Record<string, unknown>) =>
    usageRef.set({ tenantId: user.tenantId ?? null, updatedAt: now, ...fields }, { merge: true });

  // In cooldown → rest, but still record the attempt.
  if (cooldownUntil && now < cooldownUntil) {
    await save({ windowCount, cooldownUntil, lastMessageAt: now });
    return NextResponse.json({ text: COOLDOWN_MESSAGE, limited: true });
  }

  // Reset the window after a finished cooldown OR a natural 3h+ gap.
  if ((cooldownUntil && now >= cooldownUntil) || (lastMessageAt && now - lastMessageAt > COOLDOWN_MS)) {
    windowCount = 0;
    cooldownUntil = null;
  }

  const n = windowCount + 1;

  // Within the free allowance → real answer (only count successful calls).
  if (n <= FREE_MESSAGES) {
    const res = await callMimo();
    if (res.status === 200) {
      await save({ windowCount: n, cooldownUntil: null, lastMessageAt: now });
    }
    return res;
  }

  // Redirect window (messages 11–13) → canned redirect, no MiMo call.
  if (n <= FREE_MESSAGES + REDIRECT_MESSAGES) {
    const startsCooldown = n === FREE_MESSAGES + REDIRECT_MESSAGES;
    await save({
      windowCount: n,
      cooldownUntil: startsCooldown ? now + COOLDOWN_MS : null,
      lastMessageAt: now,
    });
    return NextResponse.json({ text: REDIRECT_MESSAGE, limited: startsCooldown });
  }

  // Safety net → force a cooldown.
  await save({ windowCount: n, cooldownUntil: now + COOLDOWN_MS, lastMessageAt: now });
  return NextResponse.json({ text: COOLDOWN_MESSAGE, limited: true });
}

/**
 * POST /api/gemini
 *
 * Body:
 *   { action: "embed", text: string }
 *   { action: "generate", prompt: string, systemInstruction?: string, purpose?: "chat" }
 *
 * `purpose: "chat"` marks an AI RAG chat request, which is rate-limited per user
 * (see enforceChatLimit). Embeddings and the automated blog omit it and are not limited.
 */
export async function POST(request: NextRequest) {
  try {
    // Require authentication — prevents API abuse
    const userOrErr = await requireAuth(request);
    if (userOrErr instanceof Response) return userOrErr;

    const body = await request.json();
    const { action } = body;

    if (action === 'embed') {
      if (!process.env.GEMINI_API_KEY) {
        return NextResponse.json(
          { error: 'GEMINI_API_KEY is not configured on the server.' },
          { status: 500 }
        );
      }

      const { text, purpose } = body;
      if (!text || typeof text !== 'string') {
        return NextResponse.json(
          { error: '"text" is required for embed action.' },
          { status: 400 }
        );
      }
      if (text.length > MAX_TEXT_LENGTH) {
        return NextResponse.json(
          { error: `Text exceeds maximum length of ${MAX_TEXT_LENGTH} characters.` },
          { status: 400 }
        );
      }

      // Ingest metering — ONLY for `purpose: 'ingest'` (embedding a KB document).
      // The chat's query-time embed (searchVectorDB) sends NO purpose, so it is
      // never charged to the ingest ceiling — otherwise a full KB would block
      // querying, which is exactly what option C avoids. Super admins
      // (tenantId: null) are exempt, and we only meter a real tenantId so no
      // tenants/null/usage doc is ever written. This is a HARD pre-call gate:
      // reserve atomically first; only embed if it fits.
      const meterIngest = purpose === 'ingest' && !userOrErr.isSuperAdmin && !!userOrErr.tenantId;
      let reservedTokens = 0;
      if (meterIngest) {
        reservedTokens = await countEmbedTokens(text);
        const gate = await checkAndReserveIngest(userOrErr.tenantId as string, reservedTokens);
        if (!gate.allowed) {
          return NextResponse.json(
            {
              error:
                'Knowledge base is full — delete sources to free space, or upgrade your plan for more capacity.',
              code: 'ingest_ceiling_reached',
              used: gate.used,
              ceiling: gate.ceiling,
            },
            { status: 403 }
          );
        }
      }

      try {
        const result = await ai.models.embedContent({
          model: GEMINI_EMBEDDING_MODEL,
          contents: [text],
        });

        const vector = result.embeddings?.[0]?.values;
        if (!vector) {
          console.error('Gemini embed returned no vector for request');
          // Nothing embedded → give the reserved ceiling back.
          if (meterIngest) await refundIngest(userOrErr.tenantId as string, reservedTokens);
          return NextResponse.json(
            { error: 'Embedding provider returned no vector.' },
            { status: 502 }
          );
        }
        return NextResponse.json({ vector });
      } catch (embedErr: any) {
        // Provider error → refund the reservation so a transient failure never
        // permanently consumes the tenant's ingest ceiling.
        if (meterIngest) await refundIngest(userOrErr.tenantId as string, reservedTokens);
        // Surface the real upstream cause (bad model id, invalid key, quota) to
        // the client instead of a generic 500, without echoing the API key.
        const status = embedErr?.status ?? embedErr?.code ?? null;
        const message = embedErr?.message || String(embedErr);
        console.error('Gemini embedContent error:', status, message);
        return NextResponse.json(
          { error: `Embedding failed: ${message}`, status },
          { status: 502 }
        );
      }
    }

    if (action === 'generate') {
      if (!process.env.MIMO_API_KEY) {
        return NextResponse.json(
          { error: 'MIMO_API_KEY is not configured on the server.' },
          { status: 500 }
        );
      }

      const { prompt, systemInstruction, purpose } = body;
      if (!prompt || typeof prompt !== 'string') {
        return NextResponse.json(
          { error: '"prompt" is required for generate action.' },
          { status: 400 }
        );
      }
      if (prompt.length > MAX_PROMPT_LENGTH) {
        return NextResponse.json(
          { error: `Prompt exceeds maximum length of ${MAX_PROMPT_LENGTH} characters.` },
          { status: 400 }
        );
      }

      // Calls MiMo and returns its answer in the standard { text } shape.
      const callMimo = async (): Promise<NextResponse> => {
        const messages: Array<{ role: string; content: string }> = [];
        if (systemInstruction) {
          messages.push({ role: 'system', content: systemInstruction });
        }
        messages.push({ role: 'user', content: prompt });

        const response = await fetch(getMimoChatUrl(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.MIMO_API_KEY}`,
          },
          body: JSON.stringify({
            model: MIMO_MODEL,
            messages,
            max_completion_tokens: 4096,
            temperature: 0.7,
            top_p: 0.95,
          }),
        });

        if (!response.ok) {
          const errBody = await response.text();
          console.error('MiMo API error:', response.status, errBody);
          return NextResponse.json(
            { error: `MiMo API error: ${response.status}` },
            { status: 502 }
          );
        }

        const data = await response.json();
        const text = data.choices?.[0]?.message?.content || '';

        // Query-token metering (post-call): chat only, real tenant, non-super-
        // admin. MiMo is OpenAI-compatible and returns usage.total_tokens
        // (prompt + completion); fall back to the documented ~4-chars/token
        // APPROXIMATION only if it is ever absent. Best-effort — a metering
        // failure must never break the answer. FieldValue.increment keeps
        // concurrent answers race-free.
        if (purpose === 'chat' && !userOrErr.isSuperAdmin && userOrErr.tenantId) {
          const usedTokens =
            typeof data?.usage?.total_tokens === 'number' && data.usage.total_tokens > 0
              ? data.usage.total_tokens
              : approxTokens(`${systemInstruction || ''}${prompt}${text}`);
          try {
            await incrementQueryTokens(userOrErr.tenantId, usedTokens);
          } catch (e) {
            console.error('query token metering failed:', e);
          }
        }

        return NextResponse.json({ text });
      };

      // Only the AI RAG chat is rate-limited. Embeddings and the automated blog
      // never send `purpose: 'chat'`, so they are unaffected. Super admins are
      // exempt. Enforcement is server-side and keyed on the authenticated uid,
      // so the client cannot bypass or reset it.
      if (purpose === 'chat' && !userOrErr.isSuperAdmin) {
        // Tenant monthly query-token cap — HARD pre-call gate. Block the NEXT
        // query once at/over cap (token cost is known only after the answer, so
        // one final over-shoot is acceptable). Only a real tenant is metered; a
        // null-tenant chat (main-site user) is never charged and never writes a
        // tenants/null doc.
        if (userOrErr.tenantId) {
          const budget = await checkQueryBudget(userOrErr.tenantId);
          if (!budget.allowed) {
            return NextResponse.json({
              text: "You've reached your ministry's monthly AI question limit (it resets on the 1st). To keep going now, ask your ministry admin to upgrade the plan.",
              limited: true,
              capReached: 'query',
              used: budget.used,
              cap: budget.cap,
            });
          }
        }
        return await enforceChatLimit(userOrErr, callMimo);
      }

      return await callMimo();
    }

    return NextResponse.json(
      { error: 'Invalid action. Use "embed" or "generate".' },
      { status: 400 }
    );
  } catch (error: any) {
    console.error('API route error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
