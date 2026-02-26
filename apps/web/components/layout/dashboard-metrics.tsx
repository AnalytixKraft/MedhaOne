"use client";

import { useEffect, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardMetrics, apiClient } from "@/lib/api/client";

type MetricsState = {
  loading: boolean;
  data: DashboardMetrics | null;
  error: string | null;
};

export function DashboardMetricsCards() {
  const [state, setState] = useState<MetricsState>({ loading: true, data: null, error: null });

  useEffect(() => {
    const load = async () => {
      try {
        const metrics = await apiClient.getDashboardMetrics();
        setState({ loading: false, data: metrics, error: null });
      } catch (error) {
        setState({
          loading: false,
          data: null,
          error: error instanceof Error ? error.message : "Failed to load dashboard metrics",
        });
      }
    };

    void load();
  }, []);

  if (state.error) {
    return <p className="text-sm text-red-500">{state.error}</p>;
  }

  const metrics = state.data ?? {
    total_products: 0,
    total_parties: 0,
    total_warehouses: 0,
    stock_items_count: 0,
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {[
        { label: "Total Products", value: metrics.total_products },
        { label: "Total Parties", value: metrics.total_parties },
        { label: "Total Warehouses", value: metrics.total_warehouses },
        { label: "Stock Items", value: metrics.stock_items_count },
      ].map((item) => (
        <Card key={item.label}>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">{item.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{state.loading ? "..." : item.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
