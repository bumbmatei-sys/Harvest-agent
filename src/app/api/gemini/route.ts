import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { requireAuth } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const MAX_TEXT_LENGTH = 50000; // 50KB limit for embed text
const MAX_PROMPT_LENGTH = 30000; // 30KB limit for generate prompts

/**
 * POST /api/gemini
 *
 * Body:
 *   { action: "embed", text: string }
 *   { action: "generate", prompt: string, systemInstruction?: string }
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

      const { text } = body;
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

      const result = await ai.models.embedContent({
        model: 'gemini-embedding-2-preview',
        contents: [text],
      });

      const vector = result.embeddings?.[0]?.values;
      return NextResponse.json({ vector });
    }

    if (action === 'generate') {
      // ── Server-side subscription enforcement ──
      const user = userOrErr;
      if (!user.tenantId) {
        // Main site user — requires active AI chat subscription
        const userDoc = await adminDb.collection('users').doc(user.uid).get();
        const sub = userDoc.data()?.aiChatSubscription;
        if (!sub || (sub.status !== 'active' && sub.status !== 'trialing')) {
          return NextResponse.json(
            { error: 'Active AI chat subscription required.' },
            { status: 403 }
          );
        }
      } else {
        // Tenant user — check plan has AI (Community+)
        const tenantDoc = await adminDb.collection('tenants').doc(user.tenantId).get();
        const plan = tenantDoc.data()?.plan;
        // plus plan has no AI access
        if (plan === 'plus') {
          return NextResponse.json(
            { error: 'AI chat is not available on the Individual plan.' },
            { status: 403 }
          );
        }
      }

      if (!process.env.MIMO_API_KEY) {
        return NextResponse.json(
          { error: 'MIMO_API_KEY is not configured on the server.' },
          { status: 500 }
        );
      }

      const { prompt, systemInstruction } = body;
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

      const messages: Array<{ role: string; content: string }> = [];
      if (systemInstruction) {
        messages.push({ role: 'system', content: systemInstruction });
      }
      messages.push({ role: 'user', content: prompt });

      const response = await fetch('https://token-plan-cn.xiaomimimo.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.MIMO_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'mimo-v2.5',
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
      return NextResponse.json({ text });
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
