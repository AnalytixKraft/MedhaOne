import type { Page } from "@playwright/test";

type PurchaseOrderLine = {
  ordered_qty: string;
  received_qty: string;
};

type PurchaseOrder = {
  id: number;
  lines: PurchaseOrderLine[];
};

type PurchaseOrderListResponse = {
  items: PurchaseOrder[];
};

type GrnLine = {
  product_id: number;
  batch_id: number;
};

type Grn = {
  id: number;
  grn_number: string;
  status: string;
  warehouse_id: number;
  lines: GrnLine[];
};

type StockSummaryLookup = {
  qty_on_hand: string;
};

type GrnSnapshot = {
  status: string;
  lineSignature: string;
};

type InvariantResult = {
  passed: boolean;
  failures: string[];
  warnings: string[];
};

const postedGrnSnapshots = new Map<number, GrnSnapshot>();

function asNumber(value: string): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : NaN;
}

async function getJson<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path);
  if (!response.ok()) {
    throw new Error(`Request failed: ${path} [${response.status()}]`);
  }
  return (await response.json()) as T;
}

export async function validateInvariants(page: Page): Promise<InvariantResult> {
  const failures: string[] = [];
  const warnings: string[] = [];

  let poList: PurchaseOrderListResponse;
  let grns: Grn[];

  try {
    poList = await getJson<PurchaseOrderListResponse>(page, "/api/purchase/po");
  } catch (error) {
    return {
      passed: false,
      failures: [`Unable to validate PO invariants: ${String(error)}`],
      warnings,
    };
  }

  try {
    grns = await getJson<Grn[]>(page, "/api/purchase/grn");
  } catch (error) {
    return {
      passed: false,
      failures: [`Unable to validate GRN invariants: ${String(error)}`],
      warnings,
    };
  }

  // Invariant 1: Stock never negative for known posted GRN lines.
  for (const grn of grns.filter((item) => item.status === "POSTED")) {
    for (const line of grn.lines) {
      const lookup = `/api/test/stock-summary?warehouse_id=${grn.warehouse_id}&product_id=${line.product_id}&batch_id=${line.batch_id}`;
      const response = await page.request.get(lookup);
      if (response.status() === 404) {
        failures.push(`Stock summary missing for posted GRN ${grn.grn_number}`);
        continue;
      }
      if (!response.ok()) {
        failures.push(
          `Stock summary lookup failed for GRN ${grn.grn_number}: ${response.status()}`,
        );
        continue;
      }

      const stock = (await response.json()) as StockSummaryLookup;
      const qty = asNumber(stock.qty_on_hand);
      if (Number.isNaN(qty) || qty < 0) {
        failures.push(
          `Negative/invalid stock detected for GRN ${grn.grn_number}: ${stock.qty_on_hand}`,
        );
      }
    }
  }

  // Invariant 2: Posted GRN should not mutate after first observation.
  for (const grn of grns.filter((item) => item.status === "POSTED")) {
    const lineSignature = JSON.stringify(
      grn.lines.map((line) => ({
        product_id: line.product_id,
        batch_id: line.batch_id,
      })),
    );
    const current: GrnSnapshot = {
      status: grn.status,
      lineSignature,
    };
    const previous = postedGrnSnapshots.get(grn.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(current)) {
      failures.push(`Posted GRN changed after posting: ${grn.grn_number}`);
    } else {
      postedGrnSnapshots.set(grn.id, current);
    }
  }

  // Invariant 3: PO line received qty must not exceed ordered qty.
  for (const po of poList.items) {
    for (const line of po.lines) {
      const ordered = asNumber(line.ordered_qty);
      const received = asNumber(line.received_qty);
      if (Number.isNaN(ordered) || Number.isNaN(received)) {
        failures.push(`Invalid numeric quantities in PO ${po.id}`);
        continue;
      }
      if (received > ordered) {
        failures.push(
          `PO invariant failed for PO ${po.id}: received_qty (${received}) > ordered_qty (${ordered})`,
        );
      }
    }
  }

  // Invariant 4 (proxy): duplicate GRN numbers indicate duplicate processing risk.
  const duplicateLedgerResponse = await page.request.get("/api/test/ledger-grn-duplicates");
  if (duplicateLedgerResponse.status() === 404) {
    warnings.push("Invariant #4 skipped: ledger duplicate endpoint not available");
  } else if (!duplicateLedgerResponse.ok()) {
    failures.push(
      `Invariant #4 failed: ledger duplicate endpoint returned ${duplicateLedgerResponse.status()}`,
    );
  } else {
    const payload = (await duplicateLedgerResponse.json()) as {
      has_duplicates: boolean;
      duplicate_refs: Array<{ ref_id: string; count: number }>;
    };
    if (payload.has_duplicates) {
      failures.push(
        `Duplicate GRN ledger entries found: ${JSON.stringify(payload.duplicate_refs)}`,
      );
    }
  }

  return {
    passed: failures.length === 0,
    failures,
    warnings,
  };
}
