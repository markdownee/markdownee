"""Sync example: crawl a page and extract clean main-content text from Python.

The native Python library uses Crawlee Python and Python Trafilatura Core.
The default HTTP crawler needs no browser installation.

Run:  python main.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import markdownee

OUTPUT_DIR = Path.cwd() / "output"


def main() -> None:
    """Export one page, inspect its manifest, and request an in-memory result."""
    url = sys.argv[1] if len(sys.argv) > 1 else "https://example.com"
    # Each crawl writes files and a manifest in its own run subdirectory.
    # Python selects formats directly; dataset/KVS save tokens are TypeScript-only.
    summary = markdownee.crawl(
        [url],
        formats=["markdown", "minified-html", "original"],
        output_dir=str(OUTPUT_DIR),
        max_requests_per_crawl=1,
    )

    # Partial failures do NOT raise — they are reflected in summary.failed.
    print("CrawlSummary:")
    print(f"  total     = {summary.total}")
    print(f"  succeeded = {summary.succeeded}")
    print(f"  failed    = {summary.failed}")
    print(f"  skipped   = {summary.skipped}")
    print(f"  output_dir    = {summary.output_dir}")
    print(f"  manifest_path = {summary.manifest_path}")

    # Successful manifest records map format names to relative filenames.
    records = json.loads(Path(summary.manifest_path).read_text(encoding="utf-8"))
    print(f"\nManifest has {len(records)} record(s).")
    first = records[0] if records else None
    if first:
        title = (first.get("metadata") or {}).get("title")
        files = first.get("files", {})
        print(f"  url     = {first.get('url')!r}")
        print(f"  status  = {first.get('status')!r}")
        print(f"  title   = {title!r}")
        print(f"  formats = {list(files)}")
        markdown = files.get("markdown")
        if isinstance(markdown, str):
            content = (Path(summary.output_dir) / markdown).read_text(encoding="utf-8")
            snippet = content.strip().splitlines()[:3]
            print("  markdown preview:")
            for line in snippet:
                print(f"    | {line}")

    # Exported content lives next to the manifest in this run's directory.
    filenames = sorted(p.name for p in Path(summary.output_dir).iterdir() if p.is_file())
    print(f"\nFiles written to {summary.output_dir}:")
    for name in filenames:
        print(f"  - {name}")

    # fetch() crawls exactly ONE URL (no link-following) and returns the
    # extracted content as a selected-format map (`formats` defaults to "markdown").
    # Missing formats are omitted; no output directory is persisted.
    # It raises MarkdowneeError when the page cannot be extracted.
    contents = markdownee.fetch(url)
    print("\nfetch() markdown preview:")
    for line in contents.get("markdown", "").strip().splitlines()[:3]:
        print(f"  | {line}")


if __name__ == "__main__":
    main()
