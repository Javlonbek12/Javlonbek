import { redirect } from "next/navigation";

// The equipment has its own section now.
export default function DistributionEquipmentPage() {
  redirect("/equipment/tables");
}
