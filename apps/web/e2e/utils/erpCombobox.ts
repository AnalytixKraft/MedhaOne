import { expect, Page } from "@playwright/test";

export async function selectErpComboboxOption(
  page: Page,
  testId: string,
  query?: string,
  optionText?: string,
): Promise<void> {
  const trigger = page.getByTestId(testId);
  await trigger.click();

  const panel = page.locator(`[data-combobox-panel="${testId}-panel"]`);
  const search = page.locator(`[data-combobox-search="${testId}-search"]`);
  await expect(search).toBeVisible();

  if (query) {
    await search.fill(query);
    await page.waitForTimeout(150);
  }

  let option = panel.getByRole("button").first();
  if (optionText) {
    const matchedOption = panel.getByRole("button", { name: optionText, exact: false }).first();
    if ((await matchedOption.count()) > 0) {
      option = matchedOption;
    }
  }

  try {
    await expect(option).toBeVisible({ timeout: 1_500 });
    await option.click();
  } catch {
    await search.press("ArrowDown");
    await search.press("Enter");
  }

  if (await panel.isVisible()) {
    await search.press("Escape");
  }
  if (await panel.isVisible()) {
    await page.keyboard.press("Tab");
  }
  if (await panel.isVisible()) {
    await page.locator("body").click({ position: { x: 8, y: 8 } });
  }
  await expect(panel).toBeHidden({ timeout: 2_000 });
  await expect(trigger).not.toContainText("Select", { timeout: 2_000 });
}
