"""Redaction of known request secrets and URL userinfo in crawler logs."""

from __future__ import annotations

import logging
import re
from collections.abc import Iterable

# Matches the ``user:pass@`` userinfo of a URL so credentials can be masked while
# keeping the scheme/host for debuggability. Greedy up to the LAST ``@`` before a
# ``/`` or whitespace, so a credential containing a literal ``@`` (e.g. a child
# process echoing the password URL-decoded) is masked in full, never partially.
_USERINFO_RE = re.compile(r"(?P<scheme>[a-zA-Z][a-zA-Z0-9+.\-]*://)[^/\s]+@")


def redact(text: str, secrets: Iterable[str] = ()) -> str:
    """Mask known secret strings and any URL userinfo in ``text``."""
    for secret in secrets:
        if secret:
            text = text.replace(secret, "***")
    return _USERINFO_RE.sub(lambda m: f"{m.group('scheme')}***@", text)


class SecretFilter(logging.Filter):
    """Mask configured values and omit raw dependency exception tracebacks."""

    def __init__(self, secrets: Iterable[str]) -> None:
        super().__init__()
        self.secrets = tuple(
            variant
            for value in secrets
            if value
            for variant in (value, value.encode("unicode_escape").decode())
        )

    def filter(self, record: logging.LogRecord) -> bool:
        """Keep useful crawler messages without exception payloads or credentials."""
        record.msg = redact(record.getMessage(), self.secrets)
        record.args = ()
        record.exc_info = None
        record.exc_text = None
        record.stack_info = None
        return True
