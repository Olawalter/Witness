import { Dossier } from "@/components/obligation/dossier";

export async function generateMetadata({ params }: PageProps<"/obligations/[id]">) {
  const { id } = await params;
  return { title: `Obligation #${id}` };
}

export default async function ObligationPage({ params }: PageProps<"/obligations/[id]">) {
  const { id } = await params;
  return <Dossier id={id} />;
}
