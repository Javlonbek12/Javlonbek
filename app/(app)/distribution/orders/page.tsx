import { redirect } from "next/navigation";

// Orders became campaigns.
export default function DistributionOrdersPage() {
  redirect("/distribution/campaigns");
}
