const INTEGER_UOMS = new Set([
  "BOX",
  "BOXES",
  "BOTTLE",
  "BOTTLES",
  "CAP",
  "CAPS",
  "CAPSULE",
  "CAPSULES",
  "PC",
  "PCS",
  "PIECE",
  "PIECES",
  "STRIP",
  "STRIPS",
  "TAB",
  "TABLET",
  "TABLETS",
  "UNIT",
  "UNITS",
  "VIAL",
  "VIALS",
]);

const DECIMAL_UOMS = new Set([
  "G",
  "GM",
  "GRAM",
  "GRAMS",
  "KG",
  "KGS",
  "KILOGRAM",
  "KILOGRAMS",
  "L",
  "LITER",
  "LITERS",
  "LITRE",
  "LITRES",
  "LTR",
  "LTRS",
  "ML",
  "MILLILITER",
  "MILLILITERS",
  "MILLILITRE",
  "MILLILITRES",
]);

export function normalizeQuantityPrecision(precision?: number | null) {
  if (!Number.isFinite(precision)) {
    return 0;
  }

  return Math.min(3, Math.max(0, Math.trunc(precision ?? 0)));
}

export function inferQuantityPrecisionFromUom(uom?: string | null) {
  const normalized = uom?.trim().toUpperCase();
  if (!normalized) {
    return 0;
  }

  if (DECIMAL_UOMS.has(normalized)) {
    return 3;
  }

  if (INTEGER_UOMS.has(normalized)) {
    return 0;
  }

  return 0;
}

export function formatQuantity(
  value: number | string | null | undefined,
  precision: number,
) {
  const normalizedPrecision = normalizeQuantityPrecision(precision);
  const parsed =
    typeof value === "number" ? value : Number.parseFloat(String(value ?? "0"));

  if (!Number.isFinite(parsed)) {
    return (0).toFixed(normalizedPrecision);
  }

  return parsed.toFixed(normalizedPrecision);
}

export function getQuantityStep(precision: number) {
  const normalizedPrecision = normalizeQuantityPrecision(precision);
  if (normalizedPrecision === 0) {
    return "1";
  }

  return `0.${"0".repeat(normalizedPrecision - 1)}1`;
}

export function isQuantityInputValue(value: string, precision: number) {
  const normalizedPrecision = normalizeQuantityPrecision(precision);
  const trimmed = value.trim();

  if (trimmed === "") {
    return true;
  }

  if (normalizedPrecision === 0) {
    return /^\d+$/.test(trimmed);
  }

  const pattern = new RegExp(`^\\d+(?:\\.\\d{0,${normalizedPrecision}})?$`);
  return pattern.test(trimmed);
}

export function normalizeQuantityInput(value: string, precision: number) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed)) {
    return "";
  }

  return formatQuantity(parsed, precision);
}
