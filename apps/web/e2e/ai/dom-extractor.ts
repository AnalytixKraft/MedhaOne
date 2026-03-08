import type { Page } from "@playwright/test";

export type DomElementKind = "button" | "input" | "select" | "link";

export type DomElementSummary = {
  kind: DomElementKind;
  target: string;
  testId: string | null;
  text: string | null;
  label: string | null;
  placeholder: string | null;
  href: string | null;
  destructive: boolean;
};

export type DomSummary = {
  currentUrl: string;
  title: string;
  headings: string[];
  validationErrors: string[];
  visibleText: string[];
  buttons: DomElementSummary[];
  inputs: DomElementSummary[];
  selects: DomElementSummary[];
  links: DomElementSummary[];
  targets: DomElementSummary[];
};

const DOM_EXTRACTOR_SCRIPT = String.raw`(() => {
  const destructivePattern = /\b(delete|remove|archive|destroy|deactivate|cancel)\b/i;
  const loadingPattern = /\b(loading|signing in|submitting|saving|please wait|processing)\b/i;

  function isVisible(element) {
    const el = element;
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0" &&
      rect.width > 0 &&
      rect.height > 0
    );
  }

  const buttons = Array.from(document.querySelectorAll("button:not([role='combobox']), [role='button']"))
    .filter((element) => isVisible(element))
    .map((node) => {
      const el = node;
      const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
      const testId = node.getAttribute("data-testid");
      const target = testId || text;
      const ariaDisabled = node.getAttribute("aria-disabled") === "true";
      const disabled = ("disabled" in el && Boolean(el.disabled)) || ariaDisabled;
      const busy = node.getAttribute("aria-busy") === "true" || loadingPattern.test(text);
      return {
        kind: "button",
        target,
        testId,
        text: text || null,
        label: null,
        placeholder: null,
        href: null,
        destructive: destructivePattern.test(text),
        disabled,
        busy,
      };
    })
    .filter((button) => button.target.length > 0 && !button.disabled && !button.busy)
    .slice(0, 24);

  const inputs = Array.from(document.querySelectorAll("input, textarea"))
    .filter((element) => isVisible(element))
    .filter((node) => {
      if (!(node instanceof HTMLInputElement)) {
        return true;
      }

      return !["checkbox", "radio", "submit", "button", "hidden"].includes(node.type);
    })
    .map((node) => {
      const field = node;
      const testId = node.getAttribute("data-testid");
      const placeholder = (field.getAttribute("placeholder") ?? "")
        .replace(/\s+/g, " ")
        .trim();
      let label = "";
      if (field.id) {
        const byFor = document.querySelector('label[for="' + field.id + '"]');
        if (byFor) {
          label = (byFor.textContent ?? "").replace(/\s+/g, " ").trim();
        }
      }
      if (!label) {
        const closestLabel = field.closest("label");
        if (closestLabel) {
          label = (closestLabel.textContent ?? "").replace(/\s+/g, " ").trim();
        }
      }
      if (!label) {
        label = (field.getAttribute("aria-label") ?? "").replace(/\s+/g, " ").trim();
      }
      const target = testId || label || placeholder;
      return {
        kind: "input",
        target,
        testId,
        text: null,
        label: label || null,
        placeholder: placeholder || null,
        href: null,
        destructive: false,
      };
    })
    .filter((input) => input.target.length > 0)
    .slice(0, 20);

  const selects = Array.from(document.querySelectorAll("select, [role='combobox']"))
    .filter((element) => isVisible(element))
    .map((node) => {
      const field = node;
      const testId = node.getAttribute("data-testid");
      let label = "";
      const fieldId = field.getAttribute("id");
      if (fieldId) {
        const byFor = document.querySelector('label[for="' + fieldId + '"]');
        if (byFor) {
          label = (byFor.textContent ?? "").replace(/\s+/g, " ").trim();
        }
      }
      if (!label) {
        const closestLabel = field.closest("label");
        if (closestLabel) {
          label = (closestLabel.textContent ?? "").replace(/\s+/g, " ").trim();
        }
      }
      if (!label) {
        label = (field.getAttribute("aria-label") ?? "").replace(/\s+/g, " ").trim();
      }
      const target = testId || label;
      return {
        kind: "select",
        target,
        testId,
        text: null,
        label: label || null,
        placeholder: null,
        href: null,
        destructive: false,
      };
    })
    .filter((select) => select.target.length > 0)
    .slice(0, 20);

  const links = Array.from(document.querySelectorAll("a[href]"))
    .filter((element) => isVisible(element))
    .map((node) => {
      const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
      const testId = node.getAttribute("data-testid");
      const href = node.getAttribute("href");
      const headingText =
        Array.from(node.querySelectorAll("h1, h2, h3, h4, h5, h6"))
          .map((child) => (child.textContent ?? "").replace(/\s+/g, " ").trim())
          .find((value) => value.length > 0) ?? "";
      const ariaLabel = (node.getAttribute("aria-label") ?? "").replace(/\s+/g, " ").trim();
      const target = testId || headingText || ariaLabel || text;
      return {
        kind: "link",
        target,
        testId,
        text: text || null,
        label: null,
        placeholder: null,
        href,
        destructive: destructivePattern.test(text),
      };
    })
    .filter((link) => link.target.length > 0)
    .slice(0, 40);

  const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
    .filter((element) => isVisible(element))
    .map((node) => (node.textContent ?? "").replace(/\s+/g, " ").trim())
    .filter((text) => text.length > 0)
    .slice(0, 16);

  const validationErrors = Array.from(
    document.querySelectorAll("[role='alert'], .text-rose-600, .text-rose-700"),
  )
    .filter((element) => isVisible(element))
    .map((node) => (node.textContent ?? "").replace(/\s+/g, " ").trim())
    .filter((text) => text.length > 0)
    .slice(0, 20);

  const visibleText = Array.from(document.querySelectorAll("h1, h2, h3, p, span, td, th, li"))
    .filter((element) => isVisible(element))
    .map((node) => (node.textContent ?? "").replace(/\s+/g, " ").trim())
    .filter((text) => text.length >= 3)
    .slice(0, 80);

  const targets = [...buttons, ...inputs, ...selects, ...links]
    .filter((item, index, all) => all.findIndex((entry) => entry.target === item.target) === index)
    .slice(0, 80);

  return {
    currentUrl: window.location.href,
    title: document.title,
    headings,
    validationErrors,
    visibleText,
    buttons,
    inputs,
    selects,
    links,
    targets,
  };
})()`;

export async function extractDomSummary(page: Page): Promise<DomSummary> {
  return (await page.evaluate(DOM_EXTRACTOR_SCRIPT)) as DomSummary;
}
