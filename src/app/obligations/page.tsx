import type { Metadata } from "next";

import { Register } from "@/components/obligation/register";

export const metadata: Metadata = { title: "Explore" };

export default function ObligationsPage() {
  return <Register />;
}
