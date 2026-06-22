from decimal import ROUND_HALF_UP, Decimal


def unit_price_from_mrp(
    mrp: Decimal | None,
    gst_rate: Decimal | None,
) -> Decimal | None:
    """Back out the GST-exclusive unit price from a GST-inclusive MRP.

    unit_price = mrp / (1 + gst_rate / 100), rounded to 2 decimals.
    Returns None when MRP is not set. A missing GST rate is treated as 0%.
    """
    if mrp is None:
        return None
    rate = gst_rate if gst_rate is not None else Decimal("0")
    divisor = Decimal("1") + (Decimal(rate) / Decimal("100"))
    if divisor <= 0:
        return None
    return (Decimal(mrp) / divisor).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
