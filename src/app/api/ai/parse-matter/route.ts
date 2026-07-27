import { NextRequest, NextResponse } from 'next/server';
import { getAI, PARSE_MODEL } from '@/lib/ai-client';

const SYSTEM_PROMPT = `You are a legal matter data extractor. Given a description, email, or case summary, extract structured matter fields and return ONLY a JSON object with no markdown, no explanation, nothing else.

Valid taxonomy:
- substantiveLaw: one of "Litigation" | "IP" | "Employment" | "Corporate"
- category: one of "Commercial Litigation" | "Employment Litigation" | "IP Litigation" | "Product Liability" | "Patent Prosecution" | "Trademark" | "Advice & Counseling" | "M&A"
- liabilityEstimate: one of "Probable" | "Reasonably Possible" | "Remote" | null

Return exactly this JSON shape:
{
  "name": "short matter name (5-10 words)",
  "substantiveLaw": "...",
  "category": "...",
  "liabilityEstimate": "... or null",
  "jurisdiction": "city/state/court string or null",
  "description": "1-2 sentence cleaned description",
  "extractionNotes": "brief note on uncertain fields, or empty string"
}`;

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { text?: string };
  const text = body.text?.trim();
  if (!text) {
    return NextResponse.json({ message: 'text is required' }, { status: 400 });
  }

  const ai = getAI();
  const message = await ai.messages.create({
    model: PARSE_MODEL,
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: text }],
  });

  const raw = message.content[0]?.type === 'text' ? message.content[0].text : '';

  // Strip markdown code fences if present
  const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  try {
    const parsed = JSON.parse(stripped) as unknown;
    return NextResponse.json(parsed);
  } catch {
    return NextResponse.json({ message: 'Failed to parse AI response', raw }, { status: 422 });
  }
}
