export function ConfigProblem({ problems }: { problems: string[] }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <p className="label">Configuration</p>
      <h1 className="text-3xl">WITNESS cannot start with this configuration.</h1>
      <p className="text-muted">
        The app runs only against the network and contract it is configured for. Set these public values in{" "}
        <code className="font-mono text-ink">.env.local</code> (see <code className="font-mono text-ink">.env.example</code>) and
        restart.
      </p>
      <ul className="grid gap-2">
        {problems.map((p) => (
          <li key={p} className="border border-not-fulfilled/40 bg-surface px-4 py-3 font-mono text-sm">
            {p}
          </li>
        ))}
      </ul>
    </main>
  );
}
