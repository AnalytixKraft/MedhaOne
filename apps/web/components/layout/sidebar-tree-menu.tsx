"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

export type SidebarTreeMenuNode = {
  id: string;
  label: string;
  href?: string;
  icon: LucideIcon;
  testId?: string;
  children?: SidebarTreeMenuNode[];
};

type SidebarTreeMenuProps = {
  items: SidebarTreeMenuNode[];
  pathname: string;
  compact?: boolean;
  onNavigate?: () => void;
  storageKey?: string;
};

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function hasActiveDescendant(node: SidebarTreeMenuNode, pathname: string): boolean {
  if (node.href && isActivePath(pathname, node.href)) {
    return true;
  }
  if (!node.children) {
    return false;
  }
  return node.children.some((child) => hasActiveDescendant(child, pathname));
}

function collectActiveAncestorIds(
  nodes: SidebarTreeMenuNode[],
  pathname: string,
  ancestors: string[] = [],
): Set<string> {
  const active = new Set<string>();

  for (const node of nodes) {
    const isCurrentActive = hasActiveDescendant(node, pathname);
    if (!isCurrentActive) {
      continue;
    }

    for (const ancestor of ancestors) {
      active.add(ancestor);
    }
    if (node.children && node.children.length > 0) {
      active.add(node.id);
      for (const childId of collectActiveAncestorIds(
        node.children,
        pathname,
        [...ancestors, node.id],
      )) {
        active.add(childId);
      }
    }
  }

  return active;
}

export function SidebarTreeMenu({
  items,
  pathname,
  compact = false,
  onNavigate,
  storageKey = "medhaone.sidebar.tree.expanded",
}: SidebarTreeMenuProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      if (parsed && typeof parsed === "object") {
        setExpanded(parsed);
      }
    } catch {
      // Ignore invalid persisted state and continue with defaults.
    }
  }, [storageKey]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(storageKey, JSON.stringify(expanded));
  }, [expanded, storageKey]);

  const activeAncestors = useMemo(
    () => collectActiveAncestorIds(items, pathname),
    [items, pathname],
  );

  useEffect(() => {
    if (activeAncestors.size === 0 || compact) {
      return;
    }
    setExpanded((current) => {
      const next = { ...current };
      let changed = false;
      for (const id of activeAncestors) {
        if (!next[id]) {
          next[id] = true;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [activeAncestors, compact]);

  const toggleNode = (id: string) => {
    setExpanded((current) => ({
      ...current,
      [id]: !current[id],
    }));
  };

  const renderNodes = (nodes: SidebarTreeMenuNode[], depth: number) =>
    nodes.map((node) => {
      const Icon = node.icon;
      const hasChildren = Boolean(node.children && node.children.length > 0);
      const isExpanded = Boolean(expanded[node.id]);
      const isActive = hasActiveDescendant(node, pathname);

      if (hasChildren && !compact) {
        const commonRowClass = cn(
          "flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm font-medium transition-colors",
          isActive
            ? "bg-muted text-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        );

        return (
          <div key={node.id}>
            <div
              className={commonRowClass}
              style={{ paddingLeft: `${8 + depth * 16}px` }}
            >
              {node.href ? (
                <Link
                  href={node.href}
                  data-testid={node.testId}
                  onClick={onNavigate}
                  className="flex min-w-0 flex-1 items-center gap-2"
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{node.label}</span>
                </Link>
              ) : (
                <button
                  type="button"
                  data-testid={node.testId}
                  onClick={() => toggleNode(node.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  aria-expanded={isExpanded}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{node.label}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => toggleNode(node.id)}
                className="rounded-sm p-0.5 hover:bg-background/70"
                aria-label={isExpanded ? "Collapse section" : "Expand section"}
                aria-expanded={isExpanded}
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0" />
                )}
              </button>
            </div>
            <div
              className={cn(
                "grid transition-all duration-200 ease-out",
                isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
              )}
            >
              <div className="overflow-hidden">
                <div className="space-y-0.5 pt-0.5">
                  {renderNodes(node.children ?? [], depth + 1)}
                </div>
              </div>
            </div>
          </div>
        );
      }

      if (node.href) {
        return (
          <Link
            key={node.id}
            href={node.href}
            data-testid={node.testId}
            onClick={onNavigate}
            className={cn(
              "flex h-9 items-center gap-2 rounded-md px-2 text-sm font-medium transition-colors",
              isActivePath(pathname, node.href)
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            style={{ paddingLeft: `${8 + depth * 16}px` }}
            title={compact ? node.label : undefined}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {!compact ? <span className="min-w-0 truncate">{node.label}</span> : null}
          </Link>
        );
      }

      return (
        <div
          key={node.id}
          className={cn(
            "flex h-9 items-center gap-2 rounded-md px-2 text-sm font-medium",
            isActive ? "bg-muted text-foreground" : "text-muted-foreground",
          )}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
          title={compact ? node.label : undefined}
        >
          <Icon className="h-4 w-4 shrink-0" />
          {!compact ? <span className="min-w-0 truncate">{node.label}</span> : null}
        </div>
      );
    });

  return <div className="space-y-0.5">{renderNodes(items, 0)}</div>;
}
