import { redirect } from "next/navigation";

// The sizes catalog lives in the equipment section now.
export default function DistributionSizesPage() {
  redirect("/equipment/sizes");
}
