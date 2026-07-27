import Link from 'next/link';
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

function fmtDate(d: Date): string {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default async function Home() {
  const matters = await prisma.matter.findMany({
    orderBy: { openedAt: 'desc' },
    take: 50,
    select: {
      id: true,
      name: true,
      category: true,
      status: true,
      openedAt: true,
      closedAt: true,
      substantiveLaw: true,
    },
  });

  const openCount = matters.filter((m) => m.status === 'Open').length;
  const closedCount = matters.filter((m) => m.status === 'Closed').length;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Matters</h1>
            <p className="mt-1 text-sm text-slate-500">
              {openCount} open · {closedCount} closed
            </p>
          </div>
          <Link
            href="/matters/new"
            className="inline-flex h-9 items-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
          >
            + New Matter
          </Link>
        </div>

        {matters.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-12 text-center">
            <p className="text-sm font-medium text-slate-500">No matters yet</p>
            <p className="mt-1 text-xs text-slate-400">Create your first matter to get started</p>
            <Link href="/matters/new" className="mt-4 inline-block text-sm text-blue-600 hover:underline">
              Create matter →
            </Link>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Matter</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Category</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Status</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Opened</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {matters.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3">
                      <p className="font-medium text-slate-900">{m.name}</p>
                      <p className="text-xs text-slate-400">{m.substantiveLaw}</p>
                    </td>
                    <td className="px-5 py-3">
                      <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
                        {m.category}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
                          m.status === 'Open'
                            ? 'bg-green-50 text-green-700 ring-green-600/20'
                            : 'bg-slate-100 text-slate-600 ring-slate-500/20'
                        }`}
                      >
                        {m.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-500">{fmtDate(m.openedAt)}</td>
                    <td className="px-5 py-3 text-right">
                      <Link href={`/matters/${m.id}`} className="text-xs font-medium text-blue-600 hover:underline">
                        View →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <QuickLink
            href="/matters/new"
            title="New Matter"
            description="Create a matter and get an AI fee prediction at intake"
          />
          <QuickLink
            href="/accuracy"
            title="Accuracy Dashboard"
            description="See how AI predictions compare to actual invoices"
          />
          <QuickLink
            href="/accuracy?demo=1"
            title="Demo Mode"
            description="Explore accuracy metrics with preset filter views"
          />
        </div>
      </div>
    </div>
  );
}

function QuickLink({ href, title, description }: { href: string; title: string; description: string }) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:border-blue-200 hover:shadow-md transition-all"
    >
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      <p className="mt-1 text-xs text-slate-500">{description}</p>
    </Link>
  );
}
