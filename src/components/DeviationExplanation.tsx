'use client';

import { useState } from 'react';

interface Props {
  predicted: number;
  actual: number;
  errorPercent: number;
  isWithinRange: boolean | null;
  confidence: string;
  sampleSize: number | null;
  category: string;
  liabilityEstimate?: string | null;
  jurisdictionTier?: string | null;
}

async function streamInto(
  url: string,
  body: object,
  setter: (s: string) => void,
  setStreaming: (b: boolean) => void,
) {
  setStreaming(true);
  setter('');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) {
      setStreaming(false);
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let accumulated = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      accumulated += decoder.decode(value, { stream: true });
      setter(accumulated);
    }
  } finally {
    setStreaming(false);
  }
}

export default function DeviationExplanation({
  predicted,
  actual,
  errorPercent,
  isWithinRange,
  confidence,
  sampleSize,
  category,
  liabilityEstimate,
  jurisdictionTier,
}: Props) {
  const [text, setText] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [triggered, setTriggered] = useState(false);

  function handleExplain() {
    setTriggered(true);
    void streamInto(
      '/api/ai/explain',
      {
        type: 'deviation',
        context: {
          category,
          predicted,
          actual,
          errorPercent,
          isWithinRange,
          confidence,
          sampleSize,
          liabilityEstimate: liabilityEstimate ?? null,
          jurisdictionTier: jurisdictionTier ?? null,
        },
      },
      setText,
      setStreaming,
    );
  }

  if (!triggered) {
    return (
      <button
        type="button"
        onClick={handleExplain}
        className="text-xs text-violet-600 hover:text-violet-800 hover:underline"
      >
        Why did this deviate? ✨
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-violet-100 bg-violet-50 p-3">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-violet-500">
        ✨ AI Deviation Analysis
      </p>
      <p className="text-xs leading-relaxed text-violet-900">
        {text || (streaming ? '' : 'Failed to load explanation.')}
        {streaming && <span className="animate-pulse">▋</span>}
      </p>
    </div>
  );
}
