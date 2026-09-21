"""Bounded Researcher adapter: allowlisted https hosts, page cap, per-page timeout, total deadline.

The injected client does the fetching/extraction: `client.fetch(url, timeout=seconds)` returns a page dict
{summary?, aliases?, billingPatterns?, riskSignals?}. Any failure to get at least one page raises ResearchError,
so MerchantIntel keeps the stale profile and exposes researchError.
"""
import time
from collections.abc import Callable, Sequence
from typing import Any, Protocol
from urllib.parse import urlsplit


class ResearchError(Exception):
    pass


class PageClient(Protocol):
    def fetch(self, url: str, *, timeout: float) -> dict[str, Any]: ...


class BoundedResearcher:
    def __init__(
        self, client: PageClient, *, allowed_domains: Sequence[str], sources: Callable[[str, str], Sequence[str]],
        max_pages: int = 3, timeout: float = 10.0, deadline: float | None = None,
    ) -> None:
        """sources(merchant_id, canonical_name) -> candidate URLs. deadline: total seconds (default timeout*max_pages)."""
        self.client, self.sources, self.max_pages, self.timeout = client, sources, max(0, max_pages), timeout
        self.allowed = tuple(d.strip().lower().lstrip(".") for d in allowed_domains if d.strip())
        self.deadline = deadline if deadline is not None else timeout * self.max_pages

    def _allowed(self, url: str) -> bool:
        u = urlsplit(url)
        host = (u.hostname or "").lower()
        return u.scheme == "https" and any(host == d or host.endswith("." + d) for d in self.allowed)

    def research(self, merchant_id: str, canonical_name: str) -> dict[str, Any]:
        urls = [u for u in self.sources(merchant_id, canonical_name) if self._allowed(u)][: self.max_pages]
        if not urls:
            raise ResearchError("no allowlisted sources")
        end, pages, errors = time.monotonic() + self.deadline, [], []
        for url in urls:
            left = end - time.monotonic()
            if left <= 0:
                errors.append("deadline exceeded")
                break
            try:
                pages.append((url, self.client.fetch(url, timeout=min(self.timeout, left))))
            except Exception as exc:
                errors.append(f"{url}: {type(exc).__name__}: {exc}")
        if not pages:
            raise ResearchError("; ".join(errors))
        out: dict[str, Any] = {"aliases": [], "billingPatterns": [], "riskSignals": []}
        for url, page in pages:
            for k in out:
                out[k] += page.get(k, [])
            for s in page.get("riskSignals", []):
                s.setdefault("evidenceRefs", [url])  # unevidenced signals are dropped downstream
        out["sourceSummary"] = "; ".join(f"{u}: {p.get('summary', 'fetched')}" for u, p in pages)
        return out
