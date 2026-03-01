import type { Page } from "@playwright/test";

export type DOMButtonSummary = {
  text: string;
  testid: string | null;
};

export type DOMInputSummary = {
  label: string;
  testid: string | null;
  type: string;
};

export type DOMSelectSummary = {
  label: string;
  testid: string | null;
};

export type DOMSummary = {
  url: string;
  title: string;
  buttons: DOMButtonSummary[];
  inputs: DOMInputSummary[];
  selects: DOMSelectSummary[];
  visibleTextSnippets: string[];
  availableTestIds: string[];
};

export async function summarizePage(page: Page): Promise<DOMSummary> {
  return page.evaluate(() => {
    const isVisible = (element: Element): boolean => {
      const el = element as HTMLElement;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };

    const normalize = (value: string | null | undefined): string => {
      return (value ?? "").replace(/\s+/g, " ").trim();
    };

    const getLabel = (element: Element): string => {
      const el = element as HTMLInputElement | HTMLSelectElement;
      if (el.id) {
        const byFor = document.querySelector(`label[for="${el.id}"]`);
        if (byFor) {
          return normalize(byFor.textContent);
        }
      }
      const closestLabel = el.closest("label");
      if (closestLabel) {
        return normalize(closestLabel.textContent);
      }
      const aria = el.getAttribute("aria-label");
      if (aria) {
        return normalize(aria);
      }
      return normalize(el.getAttribute("placeholder")) || "Unlabeled";
    };

    const visibleButtons = Array.from(
      document.querySelectorAll("button, [role='button'], a[role='button']"),
    )
      .filter(isVisible)
      .map((node) => ({
        text: normalize(node.textContent),
        testid: node.getAttribute("data-testid"),
      }))
      .filter((button) => button.text.length > 0 || !!button.testid)
      .slice(0, 50);

    const visibleInputs = Array.from(
      document.querySelectorAll("input, textarea"),
    )
      .filter(isVisible)
      .map((node) => {
        const input = node as HTMLInputElement;
        return {
          label: getLabel(node),
          testid: node.getAttribute("data-testid"),
          type: input.type || "text",
        };
      })
      .slice(0, 50);

    const visibleSelects = Array.from(document.querySelectorAll("select"))
      .filter(isVisible)
      .map((node) => ({
        label: getLabel(node),
        testid: node.getAttribute("data-testid"),
      }))
      .slice(0, 50);

    const visibleTextSnippets = Array.from(
      document.querySelectorAll("h1, h2, h3, h4, p, span, td, th, li"),
    )
      .filter(isVisible)
      .map((node) => normalize(node.textContent))
      .filter((text) => text.length >= 3)
      .slice(0, 40);

    const availableTestIds = Array.from(
      document.querySelectorAll("[data-testid]"),
    )
      .filter(isVisible)
      .map((node) => node.getAttribute("data-testid"))
      .filter((testid): testid is string => !!testid)
      .slice(0, 300);

    // Special target for navigate actions.
    availableTestIds.push("__page__");

    return {
      url: window.location.href,
      title: document.title,
      buttons: visibleButtons,
      inputs: visibleInputs,
      selects: visibleSelects,
      visibleTextSnippets,
      availableTestIds: Array.from(new Set(availableTestIds)),
    };
  });
}

