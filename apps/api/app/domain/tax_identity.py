import re

from app.core.exceptions import AppException

GSTIN_PATTERN = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[A-Z0-9]{3}$")
GST_STATE_BY_CODE: dict[str, str] = {
    "01": "Jammu & Kashmir",
    "02": "Himachal Pradesh",
    "03": "Punjab",
    "04": "Chandigarh",
    "05": "Uttarakhand",
    "06": "Haryana",
    "07": "Delhi",
    "08": "Rajasthan",
    "09": "Uttar Pradesh",
    "10": "Bihar",
    "11": "Sikkim",
    "12": "Arunachal Pradesh",
    "13": "Nagaland",
    "14": "Manipur",
    "15": "Mizoram",
    "16": "Tripura",
    "17": "Meghalaya",
    "18": "Assam",
    "19": "West Bengal",
    "20": "Jharkhand",
    "21": "Odisha",
    "22": "Chhattisgarh",
    "23": "Madhya Pradesh",
    "24": "Gujarat",
    "25": "Daman & Diu",
    "26": "Dadra & Nagar Haveli",
    "27": "Maharashtra",
    "28": "Andhra Pradesh",
    "29": "Karnataka",
    "30": "Goa",
    "31": "Lakshadweep",
    "32": "Kerala",
    "33": "Tamil Nadu",
    "34": "Puducherry",
    "35": "Andaman & Nicobar",
    "36": "Telangana",
    "37": "Andhra Pradesh (New)",
    "38": "Ladakh",
}


def normalize_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip().upper()
    return normalized or None


def extract_pan_from_gstin(gstin: str) -> str:
    return gstin[2:12]


def extract_state_code_from_gstin(gstin: str) -> str:
    return gstin[0:2]


def derive_state_from_gstin(gstin: str) -> str | None:
    return GST_STATE_BY_CODE.get(extract_state_code_from_gstin(gstin))


def normalize_and_validate_gstin(gstin: str | None) -> str | None:
    normalized = normalize_optional_text(gstin)
    if normalized is None:
        return None

    if not GSTIN_PATTERN.fullmatch(normalized):
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="Invalid GSTIN format",
            details={"field": "gstin"},
        )

    return normalized
