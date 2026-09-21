import type { Metadata } from "next";
import { Suspense } from "react";

import { CreateFlow } from "@/components/obligation/create-flow";

export const metadata: Metadata = { title: "Create obligation" };

export default function NewObligationPage() {
  return (
    <Suspense>
      <CreateFlow />
    </Suspense>
  );
}
