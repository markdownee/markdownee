"""Parse native Python export records into a CrawlSummary."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from ._errors import MarkdowneeError


@dataclass(frozen=True, slots=True)
class CrawlSummary:
    """Terminal page counts and the isolated export directory."""

    total: int
    succeeded: int
    failed: int
    skipped: int
    output_dir: str
    manifest_path: str


def read_summary(manifest_path: Path, output_dir: Path) -> CrawlSummary:
    """Read and tally the manifest at ``manifest_path``."""
    try:
        raw = manifest_path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise MarkdowneeError(
            f"manifest not found at {manifest_path} — the export step wrote nothing"
        ) from exc
    except OSError as exc:
        raise MarkdowneeError(f"could not read manifest at {manifest_path}") from exc
    try:
        records = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise MarkdowneeError(f"malformed manifest at {manifest_path}") from exc
    if not isinstance(records, list):
        raise MarkdowneeError(f"manifest at {manifest_path} is not a JSON array")

    succeeded = failed = skipped = 0
    for record in records:
        status = record.get("status") if isinstance(record, dict) else None
        if status == "success":
            succeeded += 1
        elif status == "failed":
            failed += 1
        elif status == "skipped":
            skipped += 1

    return CrawlSummary(
        total=len(records),
        succeeded=succeeded,
        failed=failed,
        skipped=skipped,
        output_dir=str(output_dir),
        manifest_path=str(manifest_path),
    )
