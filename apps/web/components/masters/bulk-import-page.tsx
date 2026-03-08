"use client";

import { useState } from "react";

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

export function BulkImportPage() {
  const [partyFile, setPartyFile] = useState<File | null>(null);
  const [itemFile, setItemFile] = useState<File | null>(null);
  const [importingParties, setImportingParties] = useState(false);
  const [importingItems, setImportingItems] = useState(false);
  const [partyResult, setPartyResult] = useState<ResultState>(emptyResult);
  const [itemResult, setItemResult] = useState<ResultState>(emptyResult);

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

  async function importItems() {
    if (!itemFile) {
      setItemResult({
        status: "error",
        message: "Select a CSV file for item import.",
        summary: null,
      });
      return;
    }

    setImportingItems(true);
    try {
      const csvText = await itemFile.text();
      const summary = await apiClient.bulkCreateItems({ csv_data: csvText });
      setItemResult({
        status: "success",
        message: "Item import completed.",
        summary,
      });
    } catch (caught) {
      setItemResult({
        status: "error",
        message: caught instanceof Error ? caught.message : "Item import failed.",
        summary: null,
      });
    } finally {
      setImportingItems(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageTitle title="Bulk Import" description="Import parties and items using CSV templates." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Import Party Master Data</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
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
                <a href="/api/masters/templates/party-import.csv">Download Template</a>
              </Button>
            </div>
            <ImportResult result={partyResult} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Import Items</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => setItemFile(event.target.files?.[0] ?? null)}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={importItems} disabled={importingItems}>
                {importingItems ? "Importing..." : "Import Items"}
              </Button>
              <Button asChild type="button" variant="outline">
                <a href="/api/masters/templates/item-import.csv">Download Template</a>
              </Button>
            </div>
            <ImportResult result={itemResult} />
          </CardContent>
        </Card>
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
