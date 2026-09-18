"""Selected-format content returned by the Python single-page API."""

from __future__ import annotations

from typing import TypedDict


class FetchResult(TypedDict, total=False):
    """Requested content; keys are absent when the page yields no such format."""

    txt: str
    markdown: str
    html: str
    minified_html: str
    original: str
