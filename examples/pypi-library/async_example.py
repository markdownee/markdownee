"""Async example: crawl multiple pages concurrently with acrawl().

acrawl() runs Crawlee Python with the same options as crawl().
afetch() fetches a single page and returns the content
as values. Run:  python async_example.py
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import markdownee

OUTPUT_DIR = Path.cwd() / "output-async"


async def main() -> None:
    """Await a file export and a single-page result in the current event loop."""
    urls = sys.argv[1:] or ["https://example.com", "https://www.iana.org/domains/reserved"]
    summary = await markdownee.acrawl(
        urls,
        formats=["markdown", "original"],
        output_dir=str(OUTPUT_DIR),
        max_concurrency=2,
        max_requests_per_crawl=2,
    )
    print(
        f"acrawl: {summary.succeeded} of {summary.total} succeeded "
        f"(failed={summary.failed}, skipped={summary.skipped})"
    )
    print(f"output_dir = {summary.output_dir}")

    # afetch() crawls exactly ONE URL (no link-following) and returns the
    # content as a FetchResult mapping for one or several formats.
    # Missing formats are omitted; no output directory is persisted.
    contents = await markdownee.afetch(urls[0], formats=["markdown", "txt"])
    for fmt, text in contents.items():
        print(f"afetch {fmt}: {len(text)} chars")


if __name__ == "__main__":
    asyncio.run(main())
