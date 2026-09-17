import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Themis — Investigator Console',
  description: 'Internal bank investigator and merchant-intelligence dashboard',
};

const NAV = [
  { href: '/cases', label: 'Cases' },
  { href: '/merchants', label: 'Merchants' },
  { href: '/review', label: 'Human Review' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <div className="flex min-h-screen flex-col">
          <header className="border-b border-slate-200 bg-white">
            <div className="mx-auto flex max-w-7xl items-center gap-8 px-6 py-3">
              <span className="text-sm font-semibold tracking-wide text-slate-900">
                THEMIS <span className="font-normal text-slate-400">| Investigator Console</span>
              </span>
              <nav className="flex gap-5 text-sm">
                {NAV.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="text-slate-600 hover:text-slate-900"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>
          </header>
          <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
