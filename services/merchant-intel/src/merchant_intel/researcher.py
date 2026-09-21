"""Vendor-neutral, fail-closed merchant research boundary.

The browser is an untrusted-content transport, not an agent. This module
validates every candidate and redirect before it is fetched, accepts only a
small response envelope, and persists only bounded, attributed facts. Page
text is deliberately never made available as instructions, policy, or tools.
"""
from __future__ import annotations

import ipaddress
import socket
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol
from urllib.parse import urlsplit


MAX_PAGES = 5
DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024
ALLOWED_SCHEMES = frozenset({"https"})
ALLOWED_CONTENT_TYPES = frozenset({"text/html", "text/plain", "application/xhtml+xml"})


class ResearchError(Exception):
    """A research attempt was rejected or could not complete safely."""


@dataclass(frozen=True)
class BrowserPage:
    """Bounded browser result. ``body`` is transient and is never persisted."""

    url: str
    content_type: str
    body: bytes
    retrieved_at: str
    redirects: tuple[str, ...] = ()


class BrowserProvider(Protocol):
    """Browser-vendor-independent transport contract.

    Providers must not follow an unreported redirect. ``url`` is the final
    URL and ``redirects`` contains every location from the requested URL to it.
    """

    def fetch(self, url: str, *, timeout: float, max_bytes: int) -> BrowserPage: ...


# Compatibility seam for the first merchant-intel implementation. New code
# should implement BrowserProvider, not return arbitrary dictionaries.
class PageClient(Protocol):
    def fetch(self, url: str, *, timeout: float) -> dict[str, Any]: ...


class HostResolver(Protocol):
    def __call__(self, host: str) -> Sequence[str]: ...


def resolve_public(host: str) -> Sequence[str]:
    """Resolve a name immediately before browser use; callers can inject this in tests."""
    return sorted({item[4][0] for item in socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)})


def _is_public_address(value: str) -> bool:
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return False
    # is_global excludes private, loopback, link-local, multicast, reserved,
    # unspecified, and carrier/internal special-use ranges.
    return address.is_global


def _iso_now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


class BoundedResearcher:
    """Fetch at most five safe pages and return only summarized attributed facts.

    ``sources`` is application-controlled merchant lookup logic. Neither a
    page nor its extracted text can add URLs, select tools, alter the allowlist,
    or change policy. A legacy PageClient remains supported solely for the
    deterministic, pre-existing local test doubles.
    """

    def __init__(
        self, client: BrowserProvider | PageClient, *, allowed_domains: Sequence[str],
        sources: Callable[[str, str], Sequence[str]], max_pages: int = MAX_PAGES,
        timeout: float = 10.0, deadline: float | None = None,
        max_response_bytes: int = DEFAULT_MAX_RESPONSE_BYTES,
        resolver: HostResolver | None = None,
    ) -> None:
        if timeout <= 0 or max_response_bytes <= 0:
            raise ValueError("research timeout and response bound must be positive")
        self.client, self.sources = client, sources
        self.max_pages = min(MAX_PAGES, max(0, max_pages))
        self.timeout = timeout
        self.deadline = deadline if deadline is not None else timeout * self.max_pages
        self.max_response_bytes = max_response_bytes
        self.allowed = tuple(d.strip().lower().lstrip(".") for d in allowed_domains if d.strip())
        self.resolver = resolver

    def _allowed(self, url: str, *, resolve: bool = True) -> bool:
        u = urlsplit(url)
        host = (u.hostname or "").rstrip(".").lower()
        if (u.scheme.lower() not in ALLOWED_SCHEMES or not host or u.username or u.password
                or any(c.isspace() for c in url)):
            return False
        if host in {"localhost", "metadata.google.internal", "metadata.aws.internal"} or host.endswith((".local", ".internal")):
            return False
        if not any(host == d or host.endswith("." + d) for d in self.allowed):
            return False
        try:
            literal = ipaddress.ip_address(host)
        except ValueError:
            literal = None
        if literal is not None and not literal.is_global:
            return False
        if resolve and self.resolver is not None:
            try:
                addresses = self.resolver(host)
            except Exception:
                return False
            if not addresses or any(not _is_public_address(address) for address in addresses):
                return False
        return True

    @staticmethod
    def _content_type(value: str) -> str:
        return value.split(";", 1)[0].strip().lower()

    def _source(self, page: BrowserPage) -> dict[str, str]:
        if not self._allowed(page.url):
            raise ResearchError("unsafe final destination")
        for location in page.redirects:
            if not self._allowed(location):
                raise ResearchError("unsafe redirect destination")
        if self._content_type(page.content_type) not in ALLOWED_CONTENT_TYPES:
            raise ResearchError("unsupported content type")
        if len(page.body) > self.max_response_bytes:
            raise ResearchError("response exceeds size limit")
        try:
            datetime.fromisoformat(page.retrieved_at.replace("Z", "+00:00"))
            retrieved_at = page.retrieved_at
        except (TypeError, ValueError):
            retrieved_at = _iso_now()
        return {"url": page.url, "retrievedAt": retrieved_at, "contentType": self._content_type(page.content_type)}

    @staticmethod
    def _safe_findings(value: dict[str, Any], source: dict[str, str]) -> dict[str, Any]:
        """Accept fact fields only; page-directed instruction/tool fields are ignored."""
        out: dict[str, Any] = {"aliases": [], "billingPatterns": [], "riskSignals": []}
        for alias in value.get("aliases", []):
            if isinstance(alias, str) and 0 < len(alias) <= 120:
                out["aliases"].append(alias)
        for pattern in value.get("billingPatterns", []):
            if isinstance(pattern, dict) and set(pattern) <= {"amount", "cadenceDays"}:
                out["billingPatterns"].append(pattern)
        for signal in value.get("riskSignals", []):
            if isinstance(signal, dict) and isinstance(signal.get("type"), str) and signal.get("severity") in {"LOW", "ELEVATED", "HIGH"}:
                # Attribution comes from transport, never page-supplied refs.
                out["riskSignals"].append({"type": signal["type"], "severity": signal["severity"], "evidenceRefs": [source["url"]]})
        summary = value.get("summary")
        if isinstance(summary, str):
            # Display data only: no execution path interprets this text.
            out["summary"] = summary.replace("\x00", " ")[:500]
        return out

    def _fetch(self, url: str, timeout: float) -> tuple[dict[str, Any], dict[str, str]]:
        try:
            page = self.client.fetch(url, timeout=timeout, max_bytes=self.max_response_bytes)  # type: ignore[call-arg]
        except TypeError:
            # Legacy local fake: still source/time/page bounded, but it cannot
            # provide raw page data and therefore is never used for live I/O.
            legacy = self.client.fetch(url, timeout=timeout)  # type: ignore[call-arg]
            if not isinstance(legacy, dict):
                raise ResearchError("provider returned an invalid page")
            source = {"url": url, "retrievedAt": _iso_now(), "contentType": "application/x-legacy-fake"}
            return self._safe_findings(legacy, source), source
        if not isinstance(page, BrowserPage):
            raise ResearchError("provider returned an invalid page")
        source = self._source(page)
        # Raw text is intentionally not retained. The built-in extractor is
        # conservative: source attribution is useful until a separately
        # approved typed fact extractor is introduced.
        return {"aliases": [], "billingPatterns": [], "riskSignals": []}, source

    def research(self, merchant_id: str, canonical_name: str) -> dict[str, Any]:
        urls = [url for url in self.sources(merchant_id, canonical_name) if self._allowed(url)][: self.max_pages]
        if not urls:
            raise ResearchError("no allowlisted safe sources")
        end, findings, sources, errors = time.monotonic() + self.deadline, [], [], []
        for url in urls:
            left = end - time.monotonic()
            if left <= 0:
                errors.append("deadline exceeded")
                break
            try:
                result, source = self._fetch(url, min(self.timeout, left))
                findings.append(result)
                sources.append(source)
            except Exception as exc:
                errors.append(f"{url}: {type(exc).__name__}: {exc}")
        if not findings:
            raise ResearchError("; ".join(errors) or "research unavailable")
        out: dict[str, Any] = {"aliases": [], "billingPatterns": [], "riskSignals": [], "sources": sources}
        for item in findings:
            for key in ("aliases", "billingPatterns", "riskSignals"):
                out[key].extend(item[key])
        out["sourceSummary"] = "; ".join(f"{item['url']} @ {item['retrievedAt']}" for item in sources)[:2000]
        return out
