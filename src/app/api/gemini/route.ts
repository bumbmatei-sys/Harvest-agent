import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

export const dynamic = 'force-dynamic';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/**
 * POST /api/gemini
 *
 * Body:
 *   { action: "embed", text: string }
 *   { action: "generate", prompt: string, systemInstruction?: string }
 */
export async function POST(request: Request) {
  try {
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

      const result = await ai.models.embedContent({
        model: 'gemini-embedding-2-preview',
        contents: [text],
      });

      const vector = result.embeddings?.[0]?.values;
      return NextResponse.json({ vector });
    }

    if (action === 'generate') {
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
      { error: error?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
