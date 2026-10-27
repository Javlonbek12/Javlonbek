import { redirect } from "next/navigation";

// The equipment models live in the equipment section now.
export default function PlanogramEquipmentPage() {
  redirect("/equipment/models");
}
