import { RbacSessionProvider } from "@/components/rbac/session-provider";

export default function RbacLayout({ children }: { children: React.ReactNode }) {
  return <RbacSessionProvider>{children}</RbacSessionProvider>;
}
