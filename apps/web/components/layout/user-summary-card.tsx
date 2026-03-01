"use client";

import { useEffect, useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AuthUser, apiClient } from "@/lib/api/client";

type State = {
  loading: boolean;
  data: AuthUser | null;
  error: string | null;
};

export function UserSummaryCard() {
  const [state, setState] = useState<State>({
    loading: true,
    data: null,
    error: null,
  });

  useEffect(() => {
    const load = async () => {
      try {
        const user = await apiClient.getMe();
        setState({ loading: false, data: user, error: null });
      } catch (error) {
        setState({
          loading: false,
          data: null,
          error: error instanceof Error ? error.message : "Failed to load user",
        });
      }
    };

    void load();
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Authenticated Session</CardTitle>
        <CardDescription>Data loaded from backend <code>/auth/me</code>.</CardDescription>
      </CardHeader>
      <CardContent>
        {state.loading ? <p className="text-sm text-muted-foreground">Loading profile...</p> : null}
        {state.error ? <p className="text-sm text-red-500">{state.error}</p> : null}
        {state.data ? (
          <div className="space-y-1 text-sm">
            <p>
              <span className="font-medium">Name:</span> {state.data.full_name}
            </p>
            <p>
              <span className="font-medium">Email:</span> {state.data.email}
            </p>
            <p>
              <span className="font-medium">Role:</span>{" "}
              {state.data.role?.name ||
                (state.data.roles.length > 0
                  ? state.data.roles.map((role) => role.name).join(", ")
                  : "Unassigned")}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
