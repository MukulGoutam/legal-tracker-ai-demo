import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Providers from "./Providers";
import Link from "next/link";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Legal Tracker AI",
  description: "AI-powered legal matter management and fee prediction",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>
          <header className="sticky top-0 z-20 border-b border-slate-200 bg-white shadow-sm">
            <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3 sm:px-6 lg:px-8">
              <Link href="/" className="text-sm font-bold text-slate-900 tracking-tight">
                Legal Tracker AI
              </Link>
              <nav className="flex items-center gap-5 text-sm font-medium">
                <Link href="/" className="text-slate-500 hover:text-slate-900 transition-colors">
                  Matters
                </Link>
                <Link href="/matters/new" className="text-slate-500 hover:text-slate-900 transition-colors">
                  New Matter
                </Link>
                <Link href="/accuracy" className="text-slate-500 hover:text-slate-900 transition-colors">
                  Accuracy Dashboard
                </Link>
              </nav>
            </div>
          </header>
          <main className="flex-1">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
