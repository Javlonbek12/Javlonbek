import { redirect } from "next/navigation";

// The order builder lives in each campaign now.
export default function DistributionBuilderPage() {
  redirect("/distribution/campaigns");
}
