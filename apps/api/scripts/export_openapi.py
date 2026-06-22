"""Export the FastAPI OpenAPI schema to a JSON file.

Usage (from apps/api):
    python scripts/export_openapi.py [output_path]   # defaults to ./openapi.json

No server or database connection is required — the schema is introspected from the
app object. The committed openapi.json is the source of truth the web client's
TypeScript types are generated from (see apps/web `openapi:generate`), and CI fails
if either drifts from the code.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# The Settings validators reject placeholder secrets outside pytest; provide
# deterministic non-placeholder values so importing the app for a pure schema export
# works without a real .env. These never touch a database or get persisted.
os.environ.setdefault("SECRET_KEY", "openapi-export")
os.environ.setdefault("DEFAULT_ADMIN_PASSWORD", "openapi-export")

from app.main import app  # noqa: E402  (import after env defaults are set)


def main() -> None:
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("openapi.json")
    schema = app.openapi()
    # sort_keys keeps the output stable across runs so drift diffs are meaningful.
    output.write_text(json.dumps(schema, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote {output} — {len(schema.get('paths', {}))} paths, "
          f"{len(schema.get('components', {}).get('schemas', {}))} schemas")


if __name__ == "__main__":
    main()
