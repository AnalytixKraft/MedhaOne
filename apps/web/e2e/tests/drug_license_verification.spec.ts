import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "../utils/auth";

test("drug licence verification screen loads and prefills the party licence number", async ({
  page,
}) => {
  await loginAsAdmin(page);

  const suffix = Date.now();
  const createResponse = await page.context().request.post("/api/masters/parties", {
    data: {
      party_name: `DL Verify Party ${suffix}`,
      party_type: "SUPPLIER",
      party_category: "DISTRIBUTOR",
      mobile: "9876543210",
      state: "Maharashtra",
      city: "Pune",
      gstin: `27ABCDE${String(suffix).slice(-4)}F1Z5`,
      drug_license_number: `DL-E2E-${suffix}`,
      is_active: true,
    },
  });

  expect(createResponse.ok()).toBeTruthy();
  const party = (await createResponse.json()) as { id: number; drug_license_number: string };

  await page.goto(`/masters/drug-license-verification?partyId=${party.id}`);

  await expect(page.getByRole("heading", { name: "Drug Licence Verification" })).toBeVisible();
  await expect(page.getByTestId("drug-license-party-selector")).toBeVisible();
  await expect(page.getByTestId("drug-license-number-input")).toHaveValue(
    party.drug_license_number,
  );
});
