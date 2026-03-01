import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { PermissionProvider } from "@/components/auth/permission-provider";
import { ThemeProvider } from "@/components/theme-provider";

import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "MedhaOne ERP",
  description: "MedhaOne - Intelligent ERP Platform",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <PermissionProvider>{children}</PermissionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
