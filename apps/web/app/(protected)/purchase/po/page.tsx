import { redirect } from "next/navigation";

export default function LegacyPurchaseOrderPage() {
  redirect("/purchase-orders/new");
}
