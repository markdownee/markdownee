"""Native Python crawling, Trafilatura Core extraction, and multi-format output."""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version

from ._errors import (
    MarkdowneeError,
    MissingBrowserError,
    ProxySchemeError,
)
from ._manifest import CrawlSummary
from ._options import CrawlOptions, FetchOptions
from ._result import FetchResult
from ._run import acrawl, afetch, crawl, fetch

try:
    __version__ = version("markdownee")
except PackageNotFoundError:  # pragma: no cover - source checkout without install
    __version__ = "0+unknown"

__all__ = [
    "MarkdowneeError",
    "FetchOptions",
    "FetchResult",
    "CrawlOptions",
    "CrawlSummary",
    "MissingBrowserError",
    "ProxySchemeError",
    "__version__",
    "acrawl",
    "afetch",
    "crawl",
    "fetch",
]
