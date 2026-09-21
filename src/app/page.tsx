import Link from "next/link";

import { Landing } from "@/components/shell/landing";

export default function Home() {
  return (
    <>
      <section className="grid gap-6 pb-12">
        <p className="label">The protocol</p>
        <h1 className="max-w-3xl text-5xl leading-[1.05] sm:text-6xl">Did it actually happen?</h1>
        <p className="max-w-2xl text-lg text-muted">
          WITNESS verifies real-world obligations through evidence and GenLayer consensus.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Link href="/obligations/new" className="bg-ink px-4 py-2.5 text-sm font-medium text-paper hover:bg-amber-deep">
            Create obligation
          </Link>
          <Link href="/obligations" className="border border-ink px-4 py-2.5 text-sm font-medium hover:bg-ink hover:text-paper">
            Explore WITNESS
          </Link>
        </div>
      </section>

      <Landing />

      <section className="rule grid gap-8 pt-10 md:grid-cols-3">
        <div className="grid gap-2">
          <p className="section-no">01</p>
          <h2 className="text-xl">A promise with a bond behind it</h2>
          <p className="text-sm text-muted">
            A creator writes the obligation: what must happen, who is responsible, the criteria that count, the only
            evidence sources that may be read, a deadline, and what each possible verdict does with the bond. The
            responsible party commits exactly that bond. From then on nobody can rewrite the terms.
          </p>
        </div>
        <div className="grid gap-2">
          <p className="section-no">02</p>
          <h2 className="text-xl">Evidence, read under consensus</h2>
          <p className="text-sm text-muted">
            After the deadline anyone can ask GenLayer to witness the evidence. Objective criteria are decided by
            contract code from what the sources return. Criteria that need interpretation go to the validator panel,
            where every validator fetches the same sources, reads them itself, and must agree before anything is
            recorded.
          </p>
        </div>
        <div className="grid gap-2">
          <p className="section-no">03</p>
          <h2 className="text-xl">A settlement that follows</h2>
          <p className="text-sm text-muted">
            The verdict is one of four. Once it is final the bond moves exactly as the terms said, in basis points fixed
            before anything was witnessed. The model never names a verdict, an amount or a recipient; contract code does
            all three.
          </p>
        </div>
      </section>

      <section className="rule mt-10 grid gap-3 pt-10">
        <h2 className="text-xl">Why this needs GenLayer</h2>
        <p className="max-w-3xl text-sm text-muted">
          A conventional contract can hold a bond and compare numbers, but it cannot read a published report and judge
          whether it satisfies what was promised. An oracle can carry an answer in, and then one party decides. WITNESS
          puts the judgment itself under consensus: several validators fetch the same evidence, read it independently,
          and a verdict is recorded only when they agree on every field the settlement depends on, including the quote
          each finding rests on.
        </p>
      </section>
    </>
  );
}
