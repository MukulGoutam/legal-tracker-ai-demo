import type { Metadata } from 'next';
import Link from 'next/link';
import IntakeForm from './IntakeForm';

export const metadata: Metadata = {
  title: 'New Matter — Legal Tracker',
  description: 'Create a new legal matter with data-driven fee and duration estimates.',
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const demoMode = params['demo'] === '1';

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700"
          >
            ← Back
          </Link>
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900">New Matter</h1>
          <p className="mt-1 text-sm text-slate-500">
            Set up a new legal matter and get data-driven estimates from historical data.
          </p>
        </div>

        <IntakeForm demoMode={demoMode} />
      </div>
    </div>
  );
}
