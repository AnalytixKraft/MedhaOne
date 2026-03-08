"use client";

import { LogOut, Menu } from "lucide-react";
import { useRouter } from "next/navigation";

import { ThemePreferenceSelector } from "@/components/theme-preference-selector";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api/client";

type AppHeaderProps = {
  brandName: string;
  onToggleDesktopSidebar: () => void;
  onToggleMobileSidebar: () => void;
};

export function AppHeader({ brandName, onToggleDesktopSidebar, onToggleMobileSidebar }: AppHeaderProps) {
  const router = useRouter();

  const handleLogout = async () => {
    await apiClient.logout();
    router.replace("/login");
    router.refresh();
  };

  return (
    <header className="flex h-16 items-center justify-between border-b bg-background px-4">
      <div className="flex items-center gap-3">
        <Button className="md:hidden" variant="outline" size="icon" onClick={onToggleMobileSidebar}>
          <Menu className="h-4 w-4" />
        </Button>
        <Button
          className="hidden md:inline-flex"
          variant="outline"
          size="icon"
          onClick={onToggleDesktopSidebar}
        >
          <Menu className="h-4 w-4" />
        </Button>
        <div className="hidden min-w-0 md:block">
          <p className="truncate text-sm font-semibold text-foreground">{brandName}</p>
          <p className="text-xs text-muted-foreground">ERP workspace</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <ThemePreferenceSelector />
        <Button variant="outline" size="sm" onClick={handleLogout}>
          <LogOut className="mr-1 h-4 w-4" />
          Logout
        </Button>
      </div>
    </header>
  );
}
