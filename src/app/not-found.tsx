import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid max-w-xl gap-3">
      <p className="label">Not found</p>
      <h1 className="text-3xl">There is no page here.</h1>
      <p className="text-sm text-muted">Obligations live under their own numbers in the register.</p>
      <div className="flex gap-4 text-sm">
        <Link href="/" className="underline underline-offset-4">Home</Link>
        <Link href="/obligations" className="underline underline-offset-4">The register</Link>
      </div>
    </div>
  );
}
