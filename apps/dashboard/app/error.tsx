'use client';

export default function ErrorState({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="rounded-md border border-alert/30 bg-alert-soft px-5 py-4">
      <h1 className="text-lg font-semibold text-alert">Backend data unavailable</h1>
      <p className="mt-1 text-sm text-ink/80">
        The case data source could not be read and no earlier copy is available. Nothing has been changed.
      </p>
      <button
        onClick={reset}
        className="mt-3 rounded-sm border border-ink bg-ink px-3 py-1.5 text-sm text-white transition-colors hover:bg-ink/90"
      >
        Retry
      </button>
    </div>
  );
}
