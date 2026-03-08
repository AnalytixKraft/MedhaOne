"use client";

import { useState } from "react";

import { usePermissions } from "@/components/auth/permission-provider";
import { PageTitle } from "@/components/layout/page-title";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiClient, type BulkImportResult } from "@/lib/api/client";

type ResultState = {
  status: "idle" | "success" | "error";
  message: string;
  summary: BulkImportResult | null;
};

const emptyResult: ResultState = {
  status: "idle",
  message: "",
  summary: null,
};

export default function OpeningStockImportPage() {
  const { user, hasPermission } = usePermissions();
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ResultState>(emptyResult);

  const canUpload = !!user && (user.is_superuser || hasPermission("inventory:in"));

  async function importOpeningStock() {
    if (!file) {
      setResult({
        status: "error",
        message: "Select a CSV file for opening stock import.",
        summary: null,
      });
      return;
    }

    if (!canUpload) {
      setResult({
        status: "error",
        message: "You do not have permission to upload opening stock.",
        summary: null,
      });
      return;
    }

    setImporting(true);
    try {
      const csvText = await file.text();
      const summary = await apiClient.bulkUploadOpeningStock({ csv_data: csvText });
      setResult({
        status: "success",
        message: "Opening stock import completed.",
        summary,
      });
    } catch (caught) {
      setResult({
        status: "error",
        message:
          caught instanceof Error
            ? caught.message
            : "Opening stock import failed.",
        summary: null,
      });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageTitle
        title="Opening Stock Upload"
        description="Bulk upload opening inventory entries using CSV."
      />

      <Card>
        <CardHeader>
          <CardTitle>Import Opening Stock</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
            Required columns: <code>sku</code>, <code>warehouse_code</code>,{" "}
            <code>batch_no</code>, <code>expiry_date</code>, <code>qty</code>.
            Optional: <code>mfg_date</code>, <code>mrp</code>, <code>ref_id</code>.
          </div>

          <Input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={importOpeningStock}
              disabled={importing || !canUpload}
            >
              {importing ? "Importing..." : "Import Opening Stock"}
            </Button>
            <Button asChild type="button" variant="outline">
              <a href="/api/inventory/templates/opening-stock-import.csv">
                Download Template
              </a>
            </Button>
          </div>

          {!canUpload ? (
            <p className="text-sm text-muted-foreground">
              You have read-only access. Opening stock upload requires{" "}
              <code>inventory:in</code>.
            </p>
          ) : null}

          <ImportResult result={result} />
        </CardContent>
      </Card>
    </div>
  );
}

function ImportResult({ result }: { result: ResultState }) {
  if (result.status === "idle") {
    return null;
  }

  return (
    <div className="rounded-lg border p-3 text-sm">
      <p className={result.status === "error" ? "text-rose-600" : "text-emerald-600"}>
        {result.message}
      </p>
      {result.summary ? (
        <div className="mt-2 space-y-1 text-muted-foreground">
          <p>Created: {result.summary.created_count}</p>
          <p>Failed: {result.summary.failed_count}</p>
          {result.summary.errors.length > 0 ? (
            <ul className="max-h-40 space-y-1 overflow-auto text-xs">
              {result.summary.errors.map((error, index) => (
                <li key={`${error.row}-${index}`}>
                  Row {error.row}
                  {error.field ? ` (${error.field})` : ""}: {error.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
