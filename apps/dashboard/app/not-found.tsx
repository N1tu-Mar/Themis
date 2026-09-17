import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-line bg-white px-6 py-16 text-center">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Not on record</p>
      <h1 className="text-lg font-semibold text-ink">Nothing here matches that reference</h1>
      <p className="max-w-sm text-sm text-muted">
        The case or merchant you're looking for doesn't exist in this dataset. Check the reference and try again.
      </p>
      <Link href="/cases" className="mt-2 rounded-sm border border-ink bg-ink px-3 py-1.5 text-xs font-medium text-white hover:bg-ink/90">
        Back to cases
      </Link>
    </div>
  );
}
