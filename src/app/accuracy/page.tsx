import { Metadata } from 'next';
import { Suspense } from 'react';
import AccuracyClient from './AccuracyClient';

export const metadata: Metadata = {
  title: 'Accuracy Dashboard — Legal Tracker AI',
  description: 'Track AI prediction accuracy over time',
};

export default function AccuracyPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-slate-400">Loading…</div>}>
      <AccuracyClient />
    </Suspense>
  );
}
