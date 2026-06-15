import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

export const dynamic = 'force-dynamic';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/**
 * POST /api/gemini
 *
 * Body:
 *   { action: "embed", text: string }
 *   { action: "generate", prompt: string, systemInstruction?: string, model?: string }
 */
export async function POST(request: Request) {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY is not configured on the server.' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { action } = body;

    if (action === 'embed') {
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
      const { prompt, systemInstruction, model } = body;
      if (!prompt || typeof prompt !== 'string') {
        return NextResponse.json(
          { error: '"prompt" is required for generate action.' },
          { status: 400 }
        );
      }

      const response = await ai.models.generateContent({
        model: model || 'gemini-3.1-flash-lite-preview',
        contents: prompt,
        config: {
          ...(systemInstruction ? { systemInstruction } : {}),
        },
      });

      const text = response.text || '';
      return NextResponse.json({ text });
    }

    return NextResponse.json(
      { error: 'Invalid action. Use "embed" or "generate".' },
      { status: 400 }
    );
  } catch (error: any) {
    console.error('Gemini API route error:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
