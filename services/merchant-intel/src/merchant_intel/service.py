"""Cache-first merchant resolution, profiles and time-aware risk signals."""
import copy
import re
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from .contract import validate

DEFAULT_TTL = timedelta(days=7)
RETRIES = 3  # optimistic-lock attempts per update
DEFAULT_SIGNAL_TTL = timedelta(days=90)  # matches committed fixture signals
SEVERITIES = ["LOW", "ELEVATED", "HIGH"]


class Clock(Protocol):
    def now(self) -> datetime: ...


class SystemClock:
    def now(self) -> datetime:
        return datetime.now(UTC)


class Researcher(Protocol):
    """External research/browser boundary. Returns {sourceSummary, aliases?, billingPatterns?, riskSignals?}."""

    def research(self, merchant_id: str, canonical_name: str) -> dict[str, Any]: ...


def normalize(text: str) -> str:
    return " ".join(re.sub(r"[^A-Z0-9]+", " ", text.upper()).split())


def parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts).astimezone(UTC)


def iso(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass
class CacheRecord:
    profile: dict[str, Any]  # MerchantProfile contract shape
    researched_at: datetime
    expires_at: datetime
    version: int = 1
    source_summary: str = "internal profile"
    case_states: dict[str, str] = field(default_factory=dict)  # case_id -> OPEN|RESOLVED(+DISPUTE); the processed-case ledger
    rev: int = -1  # storage revision for optimistic locking: -1 = not stored yet; put() must match the stored rev
    sources: list[dict[str, str]] = field(default_factory=list)  # bounded URL/retrieval/content-type attribution; never page bodies


class ConflictError(Exception):
    """put() lost a race: the stored record changed since it was read."""


class ProfileStore(Protocol):
    def get(self, merchant_id: str) -> CacheRecord | None: ...
    def put(self, record: CacheRecord) -> CacheRecord:
        """Conditional write: record.rev must equal the stored rev (-1 if absent) else ConflictError.
        Returns the stored record with its bumped rev."""
    def all(self) -> list[CacheRecord]: ...


class InMemoryProfileStore:
    def __init__(self) -> None:
        self._records: dict[str, CacheRecord] = {}

    def get(self, merchant_id: str) -> CacheRecord | None:
        return self._records.get(merchant_id)

    def put(self, record: CacheRecord) -> CacheRecord:
        mid = record.profile["merchantId"]
        cur = self._records.get(mid)
        if (cur.rev if cur else -1) != record.rev:
            raise ConflictError(mid)
        self._records[mid] = stored = replace(record, rev=record.rev + 1)
        return stored

    def all(self) -> list[CacheRecord]:
        return list(self._records.values())


class MerchantIntel:
    def __init__(
        self, store: ProfileStore, *, clock: Clock | None = None, researcher: Researcher | None = None,
        ttl: timedelta = DEFAULT_TTL, signal_ttl: timedelta = DEFAULT_SIGNAL_TTL,
    ) -> None:
        self.store, self.clock, self.researcher = store, clock or SystemClock(), researcher
        self.ttl, self.signal_ttl = ttl, signal_ttl

    # -- persistence -----------------------------------------------------------
    def load_profiles(self, profiles: list[dict[str, Any]]) -> None:
        """Seed from contract-shaped profiles; researchedAt := updatedAt, so the TTL clock starts there.
        Already-stored merchants are kept: durable data beats a re-seed."""
        for p in profiles:
            validate("MerchantProfile", p)
            researched = parse(p["updatedAt"])
            try:
                self.store.put(CacheRecord(copy.deepcopy(p), researched, researched + self.ttl))
            except ConflictError:
                pass

    # -- resolution ------------------------------------------------------------
    def resolve(self, descriptor: str) -> dict[str, Any]:
        """Exact, or whole-word-prefix, alias match; longest alias wins; ties across merchants are ambiguous."""
        d = normalize(descriptor)
        best_len, hits = 0, {}
        for rec in self.store.all():
            p = rec.profile
            for name in [p["canonicalName"], *p["aliases"]]:
                n = normalize(name)
                if n and (d == n or d.startswith(n + " ")) and len(n) >= best_len:
                    if len(n) > best_len:
                        best_len, hits = len(n), {}
                    hits[p["merchantId"]] = p["canonicalName"]
        if len(hits) == 1:
            (mid, name), = hits.items()
            return {"resolved": True, "ambiguous": False, "merchantId": mid, "canonicalName": name, "candidates": []}
        cands = [{"merchantId": m, "canonicalName": n} for m, n in sorted(hits.items())]
        return {"resolved": False, "ambiguous": bool(cands), "merchantId": None, "canonicalName": None,
                "candidates": cands}

    # -- profile lookup (cache -> research) -----------------------------------
    def get_profile(self, merchant_id: str, *, allow_research: bool = True) -> dict[str, Any] | None:
        """Fresh record: cache hit, no research. Missing/expired: research once if a researcher is wired."""
        now = self.clock.now()
        rec = self.store.get(merchant_id)
        fresh = rec is not None and now < rec.expires_at
        status, performed, error = ("hit" if fresh else "expired" if rec else "miss"), False, None
        if not fresh and allow_research and self.researcher and rec:  # no profile => identity unknown => nothing to research
            try:
                findings = self.researcher.research(merchant_id, rec.profile["canonicalName"])
                rec, performed = self._merge(rec, findings, now), True
            except Exception as exc:  # researcher is external; degrade to stale data instead of failing the case
                error = f"{type(exc).__name__}: {exc}"
        if rec is None:
            return None
        return {"profile": copy.deepcopy(rec.profile), "cache": {
            "status": status, "researchPerformed": performed, "researchError": error,
            "researchedAt": iso(rec.researched_at), "expiresAt": iso(rec.expires_at),
            "version": rec.version, "sourceSummary": rec.source_summary,
            "sources": copy.deepcopy(rec.sources),
            "stale": now >= rec.expires_at}}

    def _merge(self, rec: CacheRecord, f: dict[str, Any], now: datetime) -> CacheRecord:
        for _ in range(RETRIES):
            p = copy.deepcopy(rec.profile)
            for a in f.get("aliases", []):
                if normalize(a) not in {normalize(x) for x in p["aliases"]}:
                    p["aliases"].append(a)
            for b in f.get("billingPatterns", []):
                if b not in p["billingPatterns"]:
                    p["billingPatterns"].append(b)
            for s in f.get("riskSignals", []):
                self._add_signal(p, s, now)
            p["updatedAt"] = iso(now)
            validate("MerchantProfile", p)
            try:
                sources = [s for s in f.get("sources", []) if isinstance(s, dict)
                           and isinstance(s.get("url"), str) and isinstance(s.get("retrievedAt"), str)
                           and isinstance(s.get("contentType"), str)][:5]
                return self.store.put(CacheRecord(p, now, now + self.ttl, rec.version + 1,
                                                  f.get("sourceSummary", "external research"), rec.case_states, rec.rev,
                                                  copy.deepcopy(sources)))
            except ConflictError:
                rec = self.store.get(p["merchantId"]) or rec
                if now < rec.expires_at:
                    return rec  # a concurrent researcher already refreshed it
        raise ConflictError(rec.profile["merchantId"])

    def _add_signal(self, p: dict[str, Any], s: dict[str, Any], now: datetime) -> None:
        if not s.get("evidenceRefs"):
            return  # a signal without evidence is an opinion; drop it
        observed = s.get("observedAt") or iso(now)
        p["riskSignals"].append({
            "type": s["type"], "severity": s["severity"], "observedAt": observed,
            "expiresAt": s.get("expiresAt") or iso(parse(observed) + self.signal_ttl),
            "evidenceRefs": list(s["evidenceRefs"])})

    # -- risk signals ----------------------------------------------------------
    def risk_signals(self, merchant_id: str, *, include_expired: bool = False) -> list[dict[str, Any]] | None:
        """Signals with linear decay: weight 1 at observation -> 0 at expiry; below 0.5 severity drops a level.
        Signals are context for a human/policy, never proof of fraud."""
        rec = self.store.get(merchant_id)
        if rec is None:
            return None
        now, out = self.clock.now(), []
        for s in rec.profile["riskSignals"]:
            start, end = parse(s["observedAt"]), parse(s["expiresAt"])
            expired = now >= end
            if expired and not include_expired:
                continue
            weight = 0.0 if expired else max(0.0, min(1.0, (end - now) / (end - start))) if end > start else 0.0
            rank = SEVERITIES.index(s["severity"])
            eff = SEVERITIES[max(0, rank - 1)] if weight < 0.5 else s["severity"]
            out.append({**s, "weight": round(weight, 3), "effectiveSeverity": eff, "expired": expired})
        out.sort(key=lambda s: (SEVERITIES.index(s["effectiveSeverity"]), s["weight"]), reverse=True)
        return out

    # -- updates after cases ---------------------------------------------------
    def record_case(
        self, merchant_id: str, case_id: str, *, status: str, dispute_confirmed: bool = False,
        signal: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        """status OPEN|RESOLVED. Idempotent per case_id; only touches stats/signals, keeps everything else."""
        if status not in ("OPEN", "RESOLVED"):
            raise ValueError("status must be OPEN or RESOLVED")
        state = "RESOLVED+DISPUTE" if status == "RESOLVED" and dispute_confirmed else status
        for _ in range(RETRIES):
            rec = self.store.get(merchant_id)
            if rec is None:
                return None
            prev = rec.case_states.get(case_id)
            if prev == state:
                return copy.deepcopy(rec.profile)  # replay: nothing to write
            p = copy.deepcopy(rec.profile)
            cs = p["caseStatistics"]
            if prev is None:
                cs["totalCases"] += 1
                cs["openCases"] += status == "OPEN"
            elif prev == "OPEN" and status == "RESOLVED":
                cs["openCases"] = max(0, cs["openCases"] - 1)
            if state == "RESOLVED+DISPUTE":
                cs["resolvedCustomerDisputes"] += 1
            if signal:
                self._add_signal(p, signal, self.clock.now())
            p["updatedAt"] = iso(self.clock.now())
            validate("MerchantProfile", p)
            try:
                self.store.put(CacheRecord(p, rec.researched_at, rec.expires_at, rec.version, rec.source_summary,
                                           {**rec.case_states, case_id: state}, rec.rev, rec.sources))
                return p
            except ConflictError:
                continue
        raise ConflictError(merchant_id)
