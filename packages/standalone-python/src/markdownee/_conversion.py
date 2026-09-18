"""Render all formats from one cleaned semantic HTML fragment."""

from __future__ import annotations

import html
import json
import re
from collections.abc import Mapping, Sequence

from bs4 import BeautifulSoup, NavigableString, Tag
from markdownify import markdownify

from ._errors import MarkdowneeError
from ._options import Format, Layout, validate_url
from ._result import FetchResult

_BLOCKS = frozenset(
    {
        "address",
        "article",
        "aside",
        "blockquote",
        "div",
        "dl",
        "dt",
        "dd",
        "figcaption",
        "figure",
        "footer",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "header",
        "hr",
        "li",
        "main",
        "nav",
        "ol",
        "p",
        "section",
        "table",
        "tr",
        "ul",
    }
)
_ORDINARY = {
    "title": "title",
    "author": "author",
    "date": "date",
    "description": "description",
    "languageCode": "language-code",
}
_ENHANCED = {
    "sitename": "site-name",
    "siteName": "site-name",
    "url": "url",
    "hostname": "hostname",
    "declaredPageType": "page-type",
}


def plain_text(fragment: str) -> str:
    """Walk body structure while keeping preformatted text and inline punctuation."""
    root = BeautifulSoup(fragment, "html.parser")
    parts: list[str] = []
    preserved: list[str] = []

    def walk(node: Tag | NavigableString) -> None:
        """Render one node without adding whitespace around inline elements."""
        if isinstance(node, NavigableString):
            parts.append(re.sub(r"\s+", " ", str(node)))
            return
        name = node.name
        if name in {"head", "script", "style"}:
            return
        if name == "pre":
            preserved.append(node.get_text())
            parts.append(f"\n\n\x00{len(preserved) - 1}\x00\n\n")
            return
        if name == "img":
            parts.append(str(node.get("alt", "")))
            return
        if name == "br":
            parts.append("\n")
            return
        if name in _BLOCKS and name != "tr":
            parts.append("\n\n")
        if name in {"td", "th"} and node.find_previous_sibling(["td", "th"]):
            parts.append(" | ")
        for child in node.children:
            if isinstance(child, (Tag, NavigableString)):
                walk(child)
        if name == "tr":
            parts.append("\n")
        elif name in _BLOCKS:
            parts.append("\n\n")

    walk(root.body or root)
    result = re.sub(r"[ \t]*\n[ \t]*", "\n", "".join(parts))
    result = re.sub(r"\n{3,}", "\n\n", result).strip()
    for index, value in enumerate(preserved):
        result = result.replace(f"\x00{index}\x00", value)
    return result


def _metadata_fields(metadata: Mapping[str, object], layout: Layout) -> dict[str, str]:
    """Select the flat product metadata vocabulary; omit unavailable values."""
    names = _ORDINARY if layout == "standard" else _ORDINARY | _ENHANCED
    result: dict[str, str] = {}
    for source, target in names.items():
        value = metadata.get(source)
        if not isinstance(value, str) or not value:
            continue
        if target == "url":
            try:
                validate_url(value)
            except MarkdowneeError:
                continue
        result[target] = value
    return result


def render(
    fragment: str,
    original: str,
    formats: Sequence[Format],
    *,
    metadata: Mapping[str, object],
    layout: Layout,
    crawl: Mapping[str, str | int],
) -> FetchResult:
    """Convert cleaned HTML once; original preserves captured input verbatim."""
    result: FetchResult = {}
    fields = {} if layout == "minimal" else _metadata_fields(metadata, layout)
    if layout == "enhanced":
        fields.update({f"crawl-{key}": str(value) for key, value in crawl.items()})
    front = ""
    if fields:
        front = (
            "---\n"
            + "\n".join(
                f"{key}: {json.dumps(value, ensure_ascii=False)}" for key, value in fields.items()
            )
            + "\n---\n\n"
        )
    presentation = fragment
    if layout != "minimal" and fragment:
        head: list[str] = ['<meta charset="utf-8">']
        for key, value in fields.items():
            escaped = html.escape(value, quote=True)
            if key == "title":
                head.append(f"<title>{escaped}</title>")
            elif key != "language-code":
                name = key if key in {"author", "date", "description"} else f"markdownee:{key}"
                head.append(f'<meta name="{name}" content="{escaped}">')
        lang = html.escape(fields.get("language-code", ""), quote=True)
        language = f' lang="{lang}"' if lang else ""
        presentation = (
            f"<!doctype html><html{language}><head>{''.join(head)}</head>"
            f"<body>{fragment}</body></html>"
        )
    for selected in formats:
        if selected == "original":
            result["original"] = original
        elif not fragment.strip():
            continue
        elif selected == "txt":
            result["txt"] = front + plain_text(fragment)
        elif selected == "markdown":
            result["markdown"] = (
                front
                + markdownify(
                    fragment,
                    heading_style="ATX",
                    bullets="-",
                    escape_underscores=False,
                    table_infer_header=True,
                ).strip()
            )
        elif selected == "html":
            # Newlines occur only between block siblings. Never pretty-print inline
            # nodes or pre/code contents, where indentation changes rendered text.
            result["html"] = re.sub(
                r"(</(?:p|h[1-6]|section|article|div|ul|ol|table)>)"
                r"(?=<(?:p|h[1-6]|section|article|div|ul|ol|table)[ >])",
                r"\1\n",
                presentation,
            )
        elif selected == "minified-html":
            result["minified_html"] = presentation
    return result
