export default function Loading() {
  return (
    <div className="grid gap-4" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-64 max-w-full animate-pulse bg-surface" />
      <div className="h-4 w-96 max-w-full animate-pulse bg-surface" />
      <div className="mt-6 h-48 animate-pulse bg-surface" />
    </div>
  );
}
