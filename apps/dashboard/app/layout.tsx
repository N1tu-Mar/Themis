import type { Metadata } from 'next';
import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import { Nav } from '@/components/Nav';
import './globals.css';

const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-sans',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Themis — Investigator Console',
  description: 'Internal bank investigator and merchant-intelligence dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body className="min-h-screen bg-paper font-sans text-ink antialiased">
        <div className="flex min-h-screen flex-col">
          <header className="border-b border-line bg-paper">
            <div className="mx-auto flex max-w-7xl items-center gap-8 px-6">
              <span className="shrink-0 font-mono text-[13px] font-medium tracking-[0.18em] text-ink">
                THEMIS
                <span className="ml-2 font-sans text-[13px] font-normal tracking-normal text-muted">
                  Investigator console
                </span>
              </span>
              <Nav />
            </div>
          </header>
          <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
