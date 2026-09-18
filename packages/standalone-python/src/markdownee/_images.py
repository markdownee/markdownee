"""Bounded image transformation and local storage after HTML cleaning."""

from __future__ import annotations

import asyncio
import hashlib
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path

from bs4 import BeautifulSoup
from lxml import etree

from ._options import Options, validate_url

_SVG_TAGS = frozenset(
    {
        "svg",
        "g",
        "defs",
        "path",
        "rect",
        "circle",
        "ellipse",
        "line",
        "polyline",
        "polygon",
        "text",
        "tspan",
        "title",
        "desc",
        "linearGradient",
        "radialGradient",
        "stop",
        "clipPath",
        "mask",
        "use",
        "symbol",
    }
)
_SVG_ATTRIBUTES = frozenset(
    {
        "id",
        "viewBox",
        "width",
        "height",
        "x",
        "y",
        "x1",
        "x2",
        "y1",
        "y2",
        "cx",
        "cy",
        "r",
        "rx",
        "ry",
        "d",
        "points",
        "fill",
        "stroke",
        "stroke-width",
        "stroke-linecap",
        "stroke-linejoin",
        "fill-rule",
        "clip-rule",
        "opacity",
        "fill-opacity",
        "stroke-opacity",
        "transform",
        "gradientTransform",
        "gradientUnits",
        "offset",
        "stop-color",
        "stop-opacity",
        "font-size",
        "font-family",
        "font-weight",
        "text-anchor",
        "dominant-baseline",
        "dx",
        "dy",
        "preserveAspectRatio",
        "href",
        "clip-path",
        "mask",
    }
)


@dataclass(frozen=True, slots=True)
class EncodedImage:
    """A transformed image, or a reason to omit/retain its URL."""

    data: bytes = b""
    extension: str = ""
    width: int = 0
    height: int = 0
    dropped: bool = False
    warning: str = ""


def sanitize_svg(data: bytes) -> bytes:
    """Keep static SVG geometry; reject entities and remove external references."""
    if re.search(rb"<!\s*(?:DOCTYPE|ENTITY)", data, re.IGNORECASE):
        raise ValueError("SVG declarations are not accepted")
    parser = etree.XMLParser(resolve_entities=False, no_network=True, huge_tree=False)
    root = etree.fromstring(data, parser=parser)
    if etree.QName(root).localname != "svg":
        raise ValueError("not an SVG document")
    for node in list(root.iter()):
        if not isinstance(node.tag, str) or etree.QName(node).localname not in _SVG_TAGS:
            if node.getparent() is not None:
                node.getparent().remove(node)
            continue
        for key, value in list(node.attrib.items()):
            local = etree.QName(key).localname
            unsafe = local not in _SVG_ATTRIBUTES
            if local == "href":
                unsafe = not re.fullmatch(r"#[A-Za-z_][\w.-]*", value)
            if "url" in value.lower():
                unsafe = not re.fullmatch(r"url\(#[A-Za-z_][\w.-]*\)", value)
            if unsafe:
                del node.attrib[key]
    return etree.tostring(root, encoding="utf-8")


def _raster_loader(data: bytes) -> str | None:
    """Select an explicit raster loader from bytes, never an untrusted MIME label."""
    signatures = (
        (b"\xff\xd8\xff", "jpegload_buffer"),
        (b"\x89PNG\r\n\x1a\n", "pngload_buffer"),
        (b"GIF87a", "gifload_buffer"),
        (b"GIF89a", "gifload_buffer"),
        (b"II*\x00", "tiffload_buffer"),
        (b"MM\x00*", "tiffload_buffer"),
        (b"II+\x00", "tiffload_buffer"),
        (b"MM\x00+", "tiffload_buffer"),
    )
    for signature, loader in signatures:
        if data.startswith(signature):
            return loader
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webpload_buffer"
    if data[4:8] == b"ftyp" and data[8:12] in {b"avif", b"avis"}:
        return "heifload_buffer"
    return None


def encode_image(data: bytes, content_type: str, options: Options) -> EncodedImage:
    """Read first-frame raster data with libvips and strip metadata on encoding."""
    if len(data) > options.max_image_bytes:
        return EncodedImage(warning="image exceeds max_image_bytes")
    import pyvips

    # Auto-detection can recognize SVG beyond a long prolog. Use explicit raster
    # loaders, or sanitize XML before the explicit SVG loader sees any bytes.
    loader = _raster_loader(data)
    is_svg = loader is None
    try:
        source = sanitize_svg(data) if is_svg else data
        image = getattr(pyvips.Image, loader or "svgload_buffer")(source, access="sequential")
        if image.width * image.height > options.max_image_pixels:
            return EncodedImage(warning="image exceeds max_image_pixels")
        if image.width < 64 and image.height < 64:
            return EncodedImage(dropped=True)
        if is_svg and not options.rasterize_svg:
            return EncodedImage(source, "svg", image.width, image.height)
        image = image.autorot()
        edge = (
            min(options.max_image_edge or 1568, 1568)
            if is_svg
            else options.max_image_edge or max(image.width, image.height)
        )
        scale = min(1.0, edge / max(image.width, image.height))
        if scale < 1:
            image = image.resize(scale)
        extension = "png" if is_svg else "webp"
        output = (
            image.pngsave_buffer(strip=True) if is_svg else image.webpsave_buffer(Q=80, strip=True)
        )
        return EncodedImage(output, extension, image.width, image.height)
    except (pyvips.Error, ValueError, etree.XMLSyntaxError):
        return EncodedImage(warning="image could not be decoded or sanitized")


async def save_images(
    fragment: str,
    *,
    fetch: Callable[[str], Awaitable[tuple[bytes, str]]],
    directory: Path,
    options: Options,
    originals: bool,
    is_active: Callable[[], bool] = lambda: True,
) -> tuple[str, list[dict[str, str | int]], list[str]]:
    """Rewrite saved image references; failures retain their resolved source URLs."""
    soup = BeautifulSoup(fragment, "html.parser")
    records: list[dict[str, str | int]] = []
    warnings: list[str] = []
    cache: dict[str, tuple[EncodedImage, bytes]] = {}
    # Per-page sequential fetches keep the total bounded by crawler concurrency.
    for node in soup.find_all("img"):
        if not is_active():
            raise asyncio.CancelledError
        url = str(node.get("src", ""))
        try:
            validate_url(url)
            if url not in cache:
                data, content_type = await fetch(url)
                encoded = await asyncio.to_thread(encode_image, data, content_type, options)
                cache[url] = encoded, data
            encoded, data = cache[url]
        except Exception:
            # Download and codec diagnostics can contain credentials or response bytes.
            warnings.append("image download failed")
            continue
        if encoded.dropped:
            node.decompose()
        elif encoded.warning:
            warnings.append(encoded.warning)
        else:
            if not is_active():
                raise asyncio.CancelledError
            digest = hashlib.sha256(url.encode()).hexdigest()[:24]
            filename = f"images-{digest}.{encoded.extension}"
            (directory / filename).write_bytes(encoded.data)
            node["src"] = filename
            node.attrs.pop("srcset", None)
            record: dict[str, str | int] = {
                "key": filename,
                "format": encoded.extension,
                "width": encoded.width,
                "height": encoded.height,
            }
            if originals:
                original = f"images-{digest}-original.bin"
                (directory / original).write_bytes(data)
                record["original_key"] = original
            if record not in records:
                records.append(record)
    return str(soup), records, warnings
