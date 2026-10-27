import { redirect } from "next/navigation";

export default async function PlanogramEquipmentEditPage({
  params,
}: PageProps<"/planograms/equipment/[id]">) {
  redirect(`/equipment/models/${(await params).id}`);
}
