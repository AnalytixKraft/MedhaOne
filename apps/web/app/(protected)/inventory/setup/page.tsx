import { redirect } from "next/navigation";

export default function InventorySetupPage() {
  redirect("/inventory?tab=setup");
}
