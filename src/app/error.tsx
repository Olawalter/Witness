"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="grid max-w-xl gap-4 border border-not-fulfilled/40 bg-surface p-6">
      <p className="label">Something went wrong</p>
      <h1 className="text-2xl">This page could not be shown.</h1>
      <p className="text-sm text-muted">
        No transaction was sent and no contract state changed. {error.message ? `Detail: ${error.message}` : ""}
      </p>
      <button type="button" className="w-fit bg-ink px-3.5 py-2 text-sm text-paper hover:bg-amber-deep" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
