"use client";

export function AppFooter() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t px-4 py-3 text-center text-xs text-muted-foreground md:px-6">
      Powered by AnalytixKraft - MedhaOne {currentYear}
    </footer>
  );
}
