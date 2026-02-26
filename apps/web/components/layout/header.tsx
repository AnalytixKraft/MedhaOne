"use client";

import { LogOut, Menu } from "lucide-react";
import { useRouter } from "next/navigation";

import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api/client";

type AppHeaderProps = {
  onToggleDesktopSidebar: () => void;
  onToggleMobileSidebar: () => void;
};

export function AppHeader({ onToggleDesktopSidebar, onToggleMobileSidebar }: AppHeaderProps) {
  const router = useRouter();

  const handleLogout = async () => {
    await apiClient.logout();
    router.replace("/login");
    router.refresh();
  };

  return (
    <header className="flex h-16 items-center justify-between border-b bg-background px-4">
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
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <Button variant="outline" size="sm" onClick={handleLogout}>
          <LogOut className="mr-1 h-4 w-4" />
          Logout
        </Button>
      </div>
    </header>
  );
}
