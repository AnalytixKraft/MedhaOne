from __future__ import annotations

INTEGER_UOMS = {
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
}

DECIMAL_UOMS = {
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
}


def normalize_quantity_precision(value: int | None) -> int:
    if value is None:
        return 0
    return max(0, min(int(value), 3))


def infer_quantity_precision_from_uom(uom: str | None) -> int:
    if not uom:
        return 0

    normalized = uom.strip().upper()
    if normalized in DECIMAL_UOMS:
        return 3
    if normalized in INTEGER_UOMS:
        return 0
    return 0
