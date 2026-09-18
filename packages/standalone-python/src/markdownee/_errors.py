"""Typed failures from the native Python library."""

from __future__ import annotations


class MarkdowneeError(Exception):
    """Invalid options, unsuccessful single-page extraction, or a failed crawl."""


class ProxySchemeError(MarkdowneeError):
    """The configured proxy is not an HTTP(S) proxy URL."""


class MissingBrowserError(MarkdowneeError):
    """A Playwright browser is missing; install it with ``playwright install``."""
