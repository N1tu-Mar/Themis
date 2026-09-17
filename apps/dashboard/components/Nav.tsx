'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/cases', label: 'Cases' },
  { href: '/merchants', label: 'Merchants' },
  { href: '/review', label: 'Human review' },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-6 text-sm">
      {NAV.map((item) => {
        const active = pathname?.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`relative py-4 transition-colors ${
              active ? 'text-ink' : 'text-muted hover:text-ink'
            }`}
          >
            {item.label}
            {active && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-trust" />}
          </Link>
        );
      })}
    </nav>
  );
}
