import { FileText, Truck } from "lucide-react";

export type SalesModuleItem = {
  id: string;
  href: string;
  label: string;
  description: string;
  requiredPermission: string;
  icon: typeof FileText;
};

export const SALES_NAV_ITEMS: SalesModuleItem[] = [
  {
    id: "orders",
    href: "/sales/orders",
    label: "Sales Orders",
    description: "Create, confirm, and reserve stock against customer orders.",
    requiredPermission: "sales:view",
    icon: FileText,
  },
  {
    id: "dispatches",
    href: "/sales/dispatches",
    label: "Dispatch Notes",
    description: "Allocate FEFO batches, post dispatches, and reduce physical stock.",
    requiredPermission: "dispatch:view",
    icon: Truck,
  },
];
