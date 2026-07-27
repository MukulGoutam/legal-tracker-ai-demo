import Anthropic from '@anthropic-ai/sdk';

let _client: Anthropic | null = null;

export function getAI(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

export const PARSE_MODEL = 'claude-haiku-4-5-20251001';
export const EXPLAIN_MODEL = 'claude-haiku-4-5-20251001';
