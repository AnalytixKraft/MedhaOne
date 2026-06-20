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

// Compact theme switcher (icon toggle) shown in the app header.
export function ThemePreferenceSelector() {
  const { user } = usePermissions();
  const { preference, setPreference } = useThemePreference();

  if (!user) {
    return null;
  }

  return (
    <div className="inline-flex items-center rounded-lg border border-border/80 bg-card p-1 shadow-sm">
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
