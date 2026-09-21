"""Environment-driven wiring.

MERCHANTS_TABLE                       set -> DynamoProfileStore on that table; unset -> in-memory (MERCHANT_STORE=memory forces it)
MERCHANT_PROFILE_TTL_SECONDS          profile freshness (default 604800 = 7d)
MERCHANT_RESEARCH_ENABLED             "true" to allow research (default off)
MERCHANT_RESEARCH_DOMAINS             comma-separated allowlist (required when enabled)
MERCHANT_RESEARCH_MAX_PAGES / _TIMEOUT_SECONDS   defaults 3 / 10
"""
import os
from collections.abc import Callable, Mapping, Sequence
from datetime import timedelta
from typing import Any

from .dynamo_store import DynamoProfileStore
from .researcher import BoundedResearcher, PageClient
from .service import DEFAULT_TTL, Clock, InMemoryProfileStore, MerchantIntel, ProfileStore


def _ttl(env: Mapping[str, str]) -> timedelta:
    return timedelta(seconds=int(env["MERCHANT_PROFILE_TTL_SECONDS"])) if env.get("MERCHANT_PROFILE_TTL_SECONDS") else DEFAULT_TTL


def store_from_env(environ: Mapping[str, str] | None = None, *, client: Any = None) -> ProfileStore:
    env = os.environ if environ is None else environ
    if env.get("MERCHANT_STORE") == "memory" or not env.get("MERCHANTS_TABLE"):
        return InMemoryProfileStore()
    if client is None:
        import boto3  # lazy: only the deployed path needs it
        client = boto3.client("dynamodb")
    return DynamoProfileStore(client, env["MERCHANTS_TABLE"], default_ttl=_ttl(env))


def intel_from_env(
    environ: Mapping[str, str] | None = None, *, client: Any = None, page_client: PageClient | None = None,
    sources: Callable[[str, str], Sequence[str]] | None = None, clock: Clock | None = None,
) -> MerchantIntel:
    env = os.environ if environ is None else environ
    domains = [d for d in env.get("MERCHANT_RESEARCH_DOMAINS", "").split(",") if d.strip()]
    researcher = None
    if env.get("MERCHANT_RESEARCH_ENABLED", "").lower() == "true" and page_client and sources and domains:
        researcher = BoundedResearcher(
            page_client, allowed_domains=domains, sources=sources,
            max_pages=int(env.get("MERCHANT_RESEARCH_MAX_PAGES", 3)),
            timeout=float(env.get("MERCHANT_RESEARCH_TIMEOUT_SECONDS", 10)))
    return MerchantIntel(store_from_env(env, client=client), clock=clock, researcher=researcher, ttl=_ttl(env))
