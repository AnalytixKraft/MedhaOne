import type { LucideIcon } from "lucide-react";
import {
  ArrowLeftRight,
  BarChart3,
  Boxes,
  Building2,
  CalendarClock,
  Database,
  FileSpreadsheet,
  ListTree,
  Package,
  PackageX,
  Pencil,
  Send,
  Settings,
  SlidersHorizontal,
  Users,
  Warehouse,
} from "lucide-react";

export type InventoryTabKey =
  | "master-data"
  | "stock-operations"
  | "reports"
  | "setup";

export type InventoryModuleItem = {
  id: string;
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
  requiredPermission: string;
};

export type InventoryTabConfig = {
  id: InventoryTabKey;
  label: string;
  icon: LucideIcon;
  items: InventoryModuleItem[];
};

export const INVENTORY_TABS: InventoryTabConfig[] = [
  {
    id: "master-data",
    label: "Master Data",
    icon: Database,
    items: [
      {
        id: "parties",
        label: "Parties",
        description: "Manage suppliers, distributors, and other business parties.",
        href: "/masters/parties",
        icon: Users,
        requiredPermission: "masters:view",
      },
      {
        id: "products",
        label: "Products",
        description: "Maintain product catalog and item attributes.",
        href: "/masters/products",
        icon: Package,
        requiredPermission: "masters:view",
      },
      {
        id: "warehouses",
        label: "Warehouses",
        description: "Configure warehouse and storage locations.",
        href: "/masters/warehouses",
        icon: Warehouse,
        requiredPermission: "masters:view",
      },
      {
        id: "brands",
        label: "Brands",
        description: "Configure inventory brands for classification.",
        href: "/inventory/modules/brands",
        icon: Building2,
        requiredPermission: "inventory:view",
      },
      {
        id: "categories",
        label: "Categories",
        description: "Configure item categories and taxonomy.",
        href: "/inventory/modules/categories",
        icon: ListTree,
        requiredPermission: "inventory:view",
      },
    ],
  },
  {
    id: "stock-operations",
    label: "Stock Operations",
    icon: Boxes,
    items: [
      {
        id: "stock-adjustment",
        label: "Stock Adjustment",
        description: "Adjust actual stock quantity when physical stock differs from system stock.",
        href: "/inventory/modules/stock-adjustment",
        icon: SlidersHorizontal,
        requiredPermission: "stock_adjustment:view",
      },
      {
        id: "stock-correction",
        label: "Stock Correction",
        description: "Correct wrong stock batch or expiry by controlled reclassification.",
        href: "/inventory/modules/stock-correction",
        icon: Pencil,
        requiredPermission: "stock_correction:view",
      },
      {
        id: "stock-transfer",
        label: "Stock Transfer",
        description: "Transfer stock between warehouses and locations.",
        href: "/inventory/modules/stock-transfer",
        icon: ArrowLeftRight,
        requiredPermission: "inventory:view",
      },
      {
        id: "stock-issue",
        label: "Stock Issue",
        description: "Issue stock for internal or outbound consumption.",
        href: "/inventory/modules/stock-issue",
        icon: Send,
        requiredPermission: "inventory:view",
      },
    ],
  },
  {
    id: "reports",
    label: "Reports",
    icon: BarChart3,
    items: [
      {
        id: "current-stock",
        label: "Current Stock",
        description: "Real-time stock view by SKU, batch, and warehouse.",
        href: "/reports/current-stock",
        icon: Package,
        requiredPermission: "reports:view",
      },
      {
        id: "stock-movement",
        label: "Stock Movement",
        description: "Ledger-level movement history with running balances.",
        href: "/reports/stock-movement",
        icon: ArrowLeftRight,
        requiredPermission: "reports:view",
      },
      {
        id: "stock-ageing",
        label: "Stock Ageing",
        description: "Age buckets of stock for holding analysis.",
        href: "/reports/stock-ageing",
        icon: CalendarClock,
        requiredPermission: "reports:view",
      },
      {
        id: "expiry",
        label: "Expiry",
        description: "Track near-expiry and expired inventory lots.",
        href: "/reports/expiry",
        icon: CalendarClock,
        requiredPermission: "reports:view",
      },
      {
        id: "dead-stock",
        label: "Dead Stock",
        description: "Identify non-moving and stagnant inventory.",
        href: "/reports/dead-stock",
        icon: PackageX,
        requiredPermission: "reports:view",
      },
    ],
  },
  {
    id: "setup",
    label: "Setup",
    icon: Settings,
    items: [
      {
        id: "opening-stock-upload",
        label: "Opening Stock Upload",
        description: "Bulk upload opening stock through CSV template.",
        href: "/inventory/opening-stock-import",
        icon: FileSpreadsheet,
        requiredPermission: "inventory:view",
      },
      {
        id: "units-of-measure",
        label: "Units of Measure",
        description: "Define and manage inventory UOM configuration.",
        href: "/inventory/modules/units-of-measure",
        icon: SlidersHorizontal,
        requiredPermission: "inventory:view",
      },
      {
        id: "inventory-settings",
        label: "Inventory Settings",
        description: "Configure inventory-level defaults and controls.",
        href: "/inventory/modules/inventory-settings",
        icon: Settings,
        requiredPermission: "inventory:view",
      },
    ],
  },
];

export const INVENTORY_MASTER_DATA_TAB =
  INVENTORY_TABS.find((tab) => tab.id === "master-data") ?? INVENTORY_TABS[0];

export const INVENTORY_REPORTS_TAB =
  INVENTORY_TABS.find((tab) => tab.id === "reports") ?? INVENTORY_TABS[0];

export const INVENTORY_WORKSPACE_TABS = INVENTORY_TABS.filter(
  (tab) => tab.id === "stock-operations" || tab.id === "setup",
);

export function getInventoryTabById(tabId: string | null): InventoryTabConfig {
  const match = INVENTORY_TABS.find((tab) => tab.id === tabId);
  return match ?? INVENTORY_TABS[0];
}

export function getInventoryWorkspaceTabById(
  tabId: string | null,
): InventoryTabConfig {
  const match = INVENTORY_WORKSPACE_TABS.find((tab) => tab.id === tabId);
  return match ?? INVENTORY_WORKSPACE_TABS[0];
}

export function findInventoryModuleBySlug(slug: string): {
  tab: InventoryTabConfig;
  item: InventoryModuleItem;
} | null {
  const targetHref = `/inventory/modules/${slug}`;
  for (const tab of INVENTORY_TABS) {
    const item = tab.items.find((entry) => entry.href === targetHref);
    if (item) {
      return { tab, item };
    }
  }
  return null;
}
