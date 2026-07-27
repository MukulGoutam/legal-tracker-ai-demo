import { NextRequest } from 'next/server';
import { getAI, EXPLAIN_MODEL } from '@/lib/ai-client';

const SYSTEM_PROMPTS: Record<string, string> = {
  intake:
    'You are a legal operations analyst. Write exactly 2-3 sentences explaining this fee estimate to a legal ops professional. Be specific: cite the peer count, the main cost driver adjustment, and what the confidence level means in practice. No disclaimers, no fluff.',
  forecast:
    'Write exactly 2-3 sentences of strategic commentary on this phase budget for a legal operations team. Name the dominant phase and its share of the budget, flag any phase that looks unusually high or low, and give one concrete cost-management suggestion.',
  deviation:
    'In exactly 2-3 sentences, explain the most likely reasons this matter\'s actual cost deviated from the AI prediction by the stated percentage. Consider the confidence level, sample size, and matter attributes. Be direct about what is uncertain.',
};

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { type?: string; context?: object };
  const { type, context } = body;

  if (!type || !context || !(type in SYSTEM_PROMPTS)) {
    return new Response('Invalid request: type and context are required', { status: 400 });
  }

  const system = SYSTEM_PROMPTS[type];
  const ai = getAI();

  const stream = await ai.messages.stream({
    model: EXPLAIN_MODEL,
    max_tokens: 200,
    system,
    messages: [
      {
        role: 'user',
        content: `Context data:\n${JSON.stringify(context, null, 2)}`,
      },
    ],
  });

  const readable = new ReadableStream({
    async start(controller) {
      for await (const chunk of stream) {
        if (
          chunk.type === 'content_block_delta' &&
          chunk.delta.type === 'text_delta'
        ) {
          controller.enqueue(new TextEncoder().encode(chunk.delta.text));
        }
      }
      controller.close();
    },
  });

  return new Response(readable, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
