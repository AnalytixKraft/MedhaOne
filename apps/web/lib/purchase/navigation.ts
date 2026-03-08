export type PurchaseModuleItem = {
  id: string;
  href: string;
  label: string;
  description: string;
  requiredPermission: string;
};

export const PURCHASE_NAV_ITEMS: PurchaseModuleItem[] = [
  {
    id: "po",
    href: "/purchase/po",
    label: "Purchase Orders",
    description: "Create and approve purchase orders.",
    requiredPermission: "purchase:view",
  },
  {
    id: "bills",
    href: "/purchase/bills",
    label: "Purchase Bills",
    description: "Upload invoices, review extraction, and post verified bills.",
    requiredPermission: "purchase_bill:view",
  },
  {
    id: "grn",
    href: "/purchase/grn",
    label: "Goods Receipt Notes",
    description: "Receive stock against approved purchase orders.",
    requiredPermission: "purchase:view",
  },
];
