import { redirect } from "next/navigation";

export default async function DistributionSizeElementPage({
  params,
}: PageProps<"/distribution/sizes/[id]">) {
  redirect(`/equipment/sizes/${(await params).id}`);
}
