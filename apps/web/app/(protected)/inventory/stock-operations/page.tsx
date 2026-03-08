import { redirect } from "next/navigation";

export default function InventoryStockOperationsPage() {
  redirect("/inventory?tab=stock-operations");
}
