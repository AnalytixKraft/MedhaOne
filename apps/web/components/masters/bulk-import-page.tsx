"use client";

import { useState } from "react";
import { Download, FileSpreadsheet, Users } from "lucide-react";

import { AppSectionCard } from "@/components/erp/app-primitives";
import { Button } from "@/components/ui/button";
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

export function BulkImportPage() {
  const [partyFile, setPartyFile] = useState<File | null>(null);
  const [productFile, setProductFile] = useState<File | null>(null);
  const [importingParties, setImportingParties] = useState(false);
  const [importingItems, setImportingItems] = useState(false);
  const [partyResult, setPartyResult] = useState<ResultState>(emptyResult);
  const [productResult, setProductResult] = useState<ResultState>(emptyResult);

  async function importParties() {
    if (!partyFile) {
      setPartyResult({
        status: "error",
        message: "Select a CSV file for party import.",
        summary: null,
      });
      return;
    }

    setImportingParties(true);
    try {
      const csvText = await partyFile.text();
      const summary = await apiClient.bulkCreateParties({ csv_data: csvText });
      setPartyResult({
        status: "success",
        message: "Party import completed.",
        summary,
      });
    } catch (caught) {
      setPartyResult({
        status: "error",
        message: caught instanceof Error ? caught.message : "Party import failed.",
        summary: null,
      });
    } finally {
      setImportingParties(false);
    }
  }

  async function importProducts() {
    if (!productFile) {
      setProductResult({
        status: "error",
        message: "Select a CSV file for product import.",
        summary: null,
      });
      return;
    }

    setImportingItems(true);
    try {
      const csvText = await productFile.text();
      const summary = await apiClient.bulkCreateItems({ csv_data: csvText });
      setProductResult({
        status: "success",
        message: "Product import completed.",
        summary,
      });
    } catch (caught) {
      setProductResult({
        status: "error",
        message: caught instanceof Error ? caught.message : "Product import failed.",
        summary: null,
      });
    } finally {
      setImportingItems(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <AppSectionCard
          title="Import Parties"
          description="Upload business parties in bulk using the standard CSV structure."
          actions={
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-500/12 dark:text-amber-200">
              <Users className="h-5 w-5" />
            </span>
          }
        >
          <div className="space-y-4">
            <Input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => setPartyFile(event.target.files?.[0] ?? null)}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={importParties} disabled={importingParties}>
                {importingParties ? "Importing..." : "Import Party Master Data"}
              </Button>
              <Button asChild type="button" variant="outline">
                <a href="/api/masters/templates/party-import.csv" className="inline-flex items-center gap-2">
                  <Download className="h-4 w-4" />
                  Download Template
                </a>
              </Button>
            </div>
            <ImportResult result={partyResult} />
          </div>
        </AppSectionCard>

        <AppSectionCard
          title="Import Products"
          description="Upload product master data in bulk with manufacturer, GST, storage defaults, and commercial fields."
          actions={
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-200">
              <FileSpreadsheet className="h-5 w-5" />
            </span>
          }
        >
          <div className="space-y-4">
            <Input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => setProductFile(event.target.files?.[0] ?? null)}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={importProducts} disabled={importingItems}>
                {importingItems ? "Importing..." : "Import Products"}
              </Button>
              <Button asChild type="button" variant="outline">
                <a href="/api/masters/templates/item-import.csv" className="inline-flex items-center gap-2">
                  <Download className="h-4 w-4" />
                  Download Template
                </a>
              </Button>
            </div>
            <ImportResult result={productResult} />
          </div>
        </AppSectionCard>
      </div>
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
