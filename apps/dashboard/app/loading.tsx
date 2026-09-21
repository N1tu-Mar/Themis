export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-3">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Loading</p>
      <div className="h-6 w-48 animate-pulse rounded-sm bg-line motion-reduce:animate-none" />
      <div className="h-40 animate-pulse rounded-md border border-line bg-white motion-reduce:animate-none" />
    </div>
  );
}
