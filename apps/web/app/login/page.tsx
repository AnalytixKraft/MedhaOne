"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { usePermissions } from "@/components/auth/permission-provider";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiRequestError, apiClient } from "@/lib/api/client";

type OrganizationOption = {
  id: string;
  name: string;
};

export default function LoginPage() {
  const router = useRouter();
  const { refreshPermissions } = usePermissions();
  const [email, setEmail] = useState("admin@medhaone.app");
  const [password, setPassword] = useState("ChangeMe123!");
  const [organizationOptions, setOrganizationOptions] = useState<OrganizationOption[]>([]);
  const [selectedOrganization, setSelectedOrganization] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await apiClient.login({
        email,
        password,
        organization_slug: selectedOrganization || undefined,
      });
      await refreshPermissions();
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      if (
        err instanceof ApiRequestError &&
        err.code === "ORG_SELECTION_REQUIRED" &&
        err.details &&
        typeof err.details === "object" &&
        "organizations" in err.details &&
        Array.isArray(err.details.organizations)
      ) {
        const organizations = err.details.organizations
          .filter(
            (item): item is OrganizationOption =>
              Boolean(item) &&
              typeof item === "object" &&
              "id" in item &&
              "name" in item &&
              typeof item.id === "string" &&
              typeof item.name === "string",
          )
          .map((item) => ({ id: item.id, name: item.name }));

        setOrganizationOptions(organizations);
        setSelectedOrganization(organizations[0]?.id ?? "");
        setError("Multiple organizations match this account. Select one to continue.");
      } else {
        setError(err instanceof Error ? err.message : "Authentication failed");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-4 py-12">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(37,99,235,0.2),_transparent_45%),radial-gradient(circle_at_bottom_left,_rgba(14,165,233,0.16),_transparent_40%)]" />
      <Card className="relative w-full max-w-md border-slate-700/80 bg-slate-900/70 backdrop-blur">
        <CardHeader>
          <CardTitle className="text-white">MedhaOne Login</CardTitle>
          <CardDescription>
            Sign in to access the ERP operational core.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <label className="text-sm text-slate-200" htmlFor="email">
                Email
              </label>
              <Input
                id="email"
                data-testid="login-email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setOrganizationOptions([]);
                  setSelectedOrganization("");
                }}
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm text-slate-200" htmlFor="password">
                Password
              </label>
              <Input
                id="password"
                data-testid="login-password"
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setOrganizationOptions([]);
                  setSelectedOrganization("");
                }}
                required
              />
            </div>
            {organizationOptions.length > 0 ? (
              <div className="space-y-2">
                <label className="text-sm text-slate-200" htmlFor="organization">
                  Organization
                </label>
                <select
                  id="organization"
                  value={selectedOrganization}
                  onChange={(e) => setSelectedOrganization(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-slate-950 ring-offset-background"
                  required
                >
                  {organizationOptions.map((organization) => (
                    <option key={organization.id} value={organization.id}>
                      {organization.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {error ? <p className="text-sm text-red-400">{error}</p> : null}
            <Button
              className="w-full"
              data-testid="login-submit"
              type="submit"
              disabled={loading}
            >
              {loading ? "Signing in..." : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
