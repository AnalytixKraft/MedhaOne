"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const links = [
  { href: "/masters/parties", label: "Party Master" },
  { href: "/masters/products", label: "Products" },
  { href: "/masters/warehouses", label: "Warehouses" },
  { href: "/masters/settings", label: "Master Settings" },
  { href: "/masters/reports", label: "Reports" },
  { href: "/masters/bulk-import", label: "Bulk Import" },
];

export function MastersNav() {
  const pathname = usePathname();

  return (
    <div className="mb-6 flex flex-wrap gap-2">
      {links.map((link) => {
        const active = pathname === link.href;

        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm text-muted-foreground transition hover:bg-muted",
              active && "border-primary text-primary",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </div>
  );
}
