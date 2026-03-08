"use client";

import { Monitor, Moon, Sun } from "lucide-react";

import { usePermissions } from "@/components/auth/permission-provider";
import { useThemePreference } from "@/components/theme-preference-provider";
import { cn } from "@/lib/utils";

const options = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

export function ThemePreferenceSelector() {
  const { user } = usePermissions();
  const { preference, loading, saving, setPreference } = useThemePreference();

  if (!user) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/80 bg-card px-3 py-2 shadow-sm">
      <div className="hidden min-w-0 sm:block">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Theme
        </p>
        <p className="truncate text-xs text-foreground/80">
          {saving ? "Saving..." : loading ? "Syncing..." : "User preference"}
        </p>
      </div>
      <div className="flex items-center gap-1 rounded-md bg-muted/70 p-1">
        {options.map((option) => {
          const Icon = option.icon;
          const active = preference === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => void setPreference(option.value)}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-background/80 hover:text-foreground",
              )}
              aria-pressed={active}
              data-testid={`theme-preference-${option.value}`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden md:inline">{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
