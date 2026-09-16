"""
NOVARA Career Widget — LOCAL DEV MOCK API.

This is NOT the production Novara API and must never be deployed. It exists
so contributors can run the widget end-to-end without hitting staging.

It simulates the production API *contract* the widget depends on (see
Workstream A of the widget production-readiness plan), so the widget can be
built and tested against realistic behavior:
  - per-company domain allowlist enforcement (Origin strict / Referer advisory)
  - Cache-Control + ETag + Vary: Origin on responses
  - a combined bootstrap endpoint (dashboard + jobs in one round trip)
  - per-company_slug rate limiting (not per-IP)

Field names match what frontend/widget.js actually renders (job.city,
job.country, job.deadline) rather than the older ad-hoc mock schema.
"""
import hashlib
import json
import re
import time
from collections import defaultdict
from threading import Lock
from typing import Optional
from urllib.parse import urlparse

from fastapi import FastAPI, Query, Request, Response
from fastapi.responses import JSONResponse

app = FastAPI(title="NOVARA Career Widget — Local Dev Mock API", version="0.2.0")

# ---------------------------------------------------------------------------
# Mock data
# ---------------------------------------------------------------------------

MOCK_DASHBOARD_DATA = {
    "financfy-ltd": {
        "company_name": "Financfy Ltd",
        "company_slug": "financfy-ltd",
        "company_logo_url": "https://dummyimage.com/200x200/6366f1/ffffff&text=FL",
        "theme_settings": {
            "primary_color": "#4f46e5",
            "secondary_color": "#ffffff"
        },
        "total_count": 3,
        "department_wise_count": [
            {"department_id": "eng", "department_name": "Engineering", "count": 2},
            {"department_id": "prod", "department_name": "Product", "count": 1}
        ]
    },
    "novara-qa-test": {
        "company_name": "Novara QA Test",
        "company_slug": "novara-qa-test",
        "company_logo_url": "https://dummyimage.com/200x200/ef4444/ffffff&text=NQA",
        "theme_settings": {
            "primary_color": "#dc2626",
            "secondary_color": "#ffffff"
        },
        "total_count": 1,
        "department_wise_count": [
            {"department_id": "qa", "department_name": "QA", "count": 1}
        ]
    }
}

# Field names match what widget.js actually reads: city / country / deadline
# (the old mock used `location` / `application_deadline`, which don't match
# the widget's rendering code — that mismatch is fixed here).
MOCK_JOBS_DATA = {
    "financfy-ltd": [
        {
            "slug": "senior-frontend-engineer-fl",
            "title": "Senior Frontend Engineer",
            "city": "Remote",
            "country": "USA",
            "employment_type": "Full-Time",
            "salary_min": 120000,
            "salary_max": 150000,
            "salary_currency": "USD",
            "deadline": "2027-01-01",
            "department": "Engineering",
            "department_id": "eng"
        },
        {
            "slug": "backend-developer-fl",
            "title": "Backend Developer",
            "city": "New York",
            "country": "USA",
            "employment_type": "Full-Time",
            "salary_min": 110000,
            "salary_max": 140000,
            "salary_currency": "USD",
            "deadline": "2027-02-15",
            "department": "Engineering",
            "department_id": "eng"
        },
        {
            "slug": "product-designer-fl",
            "title": "Product Designer",
            "city": "London",
            "country": "UK",
            "employment_type": "Contract",
            "salary_min": 80000,
            "salary_max": 100000,
            "salary_currency": "GBP",
            "deadline": "2027-03-01",
            "department": "Product",
            "department_id": "prod"
        }
    ],
    "novara-qa-test": [
        {
            "slug": "qa-automation-engineer",
            "title": "QA Automation Engineer",
            "city": "Berlin",
            "country": "Germany",
            "employment_type": "Full-Time",
            "salary_min": 70000,
            "salary_max": 90000,
            "salary_currency": "EUR",
            "deadline": "2026-12-01",
            "department": "QA",
            "department_id": "qa"
        }
    ]
}

# Per-company registered embed domains. Wildcards ("*.example.com") and an
# always-on localhost/127.0.0.1 dev exemption (any port) are supported — see
# match_domain() / is_dev_host() below. A pattern may include ":port" to
# restrict to that exact port (e.g. "localhost:8080" for the bundled
# WordPress container); without a port, it matches the hostname on any port.
# These are deliberately NOT wide open, so the allowlist behavior (403 on an
# unrecognized origin) is observable when testing locally against something
# other than localhost.
MOCK_ALLOWED_DOMAINS = {
    "financfy-ltd": ["*.wixsite.com", "financfy-careers.com", "localhost:8080"],
    "novara-qa-test": ["novara-qa-test.example.com"],
}

DEV_HOSTS = {"localhost", "127.0.0.1"}

COMPANY_SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

# ---------------------------------------------------------------------------
# Rate limiting — per company_slug, NOT per IP. A widget's traffic is
# host-page views: every visitor is a different IP, while a corporate NAT
# looks like one abusive client. Simple in-memory fixed window; fine for a
# single-process mock, not meant to be production infra.
# ---------------------------------------------------------------------------

RATE_LIMIT_MAX_REQUESTS = 120
RATE_LIMIT_WINDOW_SECONDS = 60
_rate_limit_lock = Lock()
_rate_limit_hits: dict[str, list[float]] = defaultdict(list)


def check_rate_limit(company_slug: str) -> Optional[int]:
    """Returns seconds-until-retry if rate limited, else None."""
    now = time.monotonic()
    window_start = now - RATE_LIMIT_WINDOW_SECONDS
    with _rate_limit_lock:
        hits = _rate_limit_hits[company_slug]
        hits[:] = [t for t in hits if t > window_start]
        if len(hits) >= RATE_LIMIT_MAX_REQUESTS:
            oldest = hits[0]
            return max(1, int(oldest + RATE_LIMIT_WINDOW_SECONDS - now))
        hits.append(now)
    return None


# ---------------------------------------------------------------------------
# Domain allowlist — strict on Origin (script embed, browser-set, can't be
# forged by page JS), advisory-only on Referer (iframe embed, where the
# widget's own requests always carry the CDN's origin, not the host page's).
# Fails OPEN with a logged warning when neither signal is present, since a
# host sending Referrer-Policy: no-referrer shouldn't lose a paid feature
# over a privacy header they chose deliberately.
# ---------------------------------------------------------------------------

def is_dev_host(hostname: str) -> bool:
    return hostname in DEV_HOSTS


def match_domain(hostname: str, netloc: str, pattern: str) -> bool:
    # A pattern with a port (e.g. "localhost:8080") matches the exact
    # host:port; without one, it matches the hostname on any port.
    if ":" in pattern:
        return netloc == pattern
    if pattern.startswith("*."):
        suffix = pattern[1:]  # ".example.com"
        return hostname.endswith(suffix) and hostname != suffix.lstrip(".")
    return hostname == pattern


def hostname_allowed(hostname: str, netloc: str, company_slug: str) -> bool:
    if is_dev_host(hostname):
        return True
    patterns = MOCK_ALLOWED_DOMAINS.get(company_slug, [])
    return any(match_domain(hostname, netloc, p) for p in patterns)


class DomainCheckResult:
    def __init__(self, allowed: bool, error_code: Optional[str] = None,
                 checked_origin: Optional[str] = None, advisory: bool = False):
        self.allowed = allowed
        self.error_code = error_code
        self.checked_origin = checked_origin
        self.advisory = advisory


def check_domain_allowlist(request: Request, company_slug: str) -> DomainCheckResult:
    origin = request.headers.get("origin")
    # A sandboxed iframe without allow-same-origin (e.g. WordPress's Gutenberg
    # Custom HTML block, which previews via <iframe sandbox srcdoc="...">) has
    # an opaque origin, and the browser sends the literal string "null" — not
    # a real hostname. Treat it the same as no Origin header at all, or every
    # such legitimate preview context gets rejected as "unauthorized".
    if origin and origin != "null":
        parsed = urlparse(origin)
        if hostname_allowed(parsed.hostname or "", parsed.netloc, company_slug):
            return DomainCheckResult(True, checked_origin=origin)
        return DomainCheckResult(False, error_code="domain_not_authorized", checked_origin=origin)

    # Iframe path: no Origin header on same-document requests. Referer is the
    # only (advisory, spoofable-by-non-browser-clients) signal available.
    referer = request.headers.get("referer")
    if referer:
        parsed = urlparse(referer)
        if not hostname_allowed(parsed.hostname or "", parsed.netloc, company_slug):
            print(f"[allowlist] advisory mismatch: company={company_slug} referer_host={parsed.hostname} (not blocking)")
        return DomainCheckResult(True, checked_origin=referer, advisory=True)

    # No Origin and no Referer (stripped by Referrer-Policy, or a non-browser
    # client). Fail open, but log it — see finding 11 in the widget plan.
    print(f"[allowlist] no Origin/Referer for company={company_slug}; failing open")
    return DomainCheckResult(True, advisory=True)


def error_response(status_code: int, error_code: str, message: str,
                    origin: Optional[str] = None, headers: Optional[dict] = None) -> JSONResponse:
    # CORS headers are required here too, not just on success: without
    # Access-Control-Allow-Origin, the browser blocks the widget's JS from
    # reading the response body at all, so a 403/429/404 shows up as an
    # opaque "failed to fetch" instead of the specific error_code the widget
    # needs to show an actionable message (e.g. "domain not authorized").
    response_headers = dict(headers or {})
    response_headers["Vary"] = "Origin"
    if origin:
        response_headers["Access-Control-Allow-Origin"] = origin
    return JSONResponse(
        status_code=status_code,
        content={"success": False, "error_code": error_code, "message": message},
        headers=response_headers,
    )


def cache_headers(origin: Optional[str], max_age: int = 30) -> dict:
    headers = {
        "Cache-Control": f"public, max-age={max_age}",
        "Vary": "Origin",
    }
    # Reflect the validated origin rather than "*" — a real per-company
    # allowlist needs the browser's own CORS enforcement to have teeth too.
    if origin:
        headers["Access-Control-Allow-Origin"] = origin
    return headers


def etag_for(payload: dict) -> str:
    digest = hashlib.md5(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    return f'"{digest}"'


def not_modified_response(request: Request, etag: str, headers: dict) -> Optional[Response]:
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={**headers, "ETag": etag})
    return None


# ---------------------------------------------------------------------------
# Shared request handling: validate company_slug, enforce allowlist, enforce
# rate limit. Every route below funnels through this.
# ---------------------------------------------------------------------------

def guard_request(request: Request, company_slug: Optional[str]):
    """Returns an error Response to short-circuit with, or None to continue."""
    origin = request.headers.get("origin")

    if not company_slug or not COMPANY_SLUG_RE.match(company_slug):
        return error_response(400, "invalid_company_slug", "company_slug is required and must be a valid slug", origin=origin)

    if company_slug not in MOCK_DASHBOARD_DATA:
        return error_response(404, "company_not_found", "No career page found for this company", origin=origin)

    domain_check = check_domain_allowlist(request, company_slug)
    if not domain_check.allowed:
        return error_response(
            403,
            "domain_not_authorized",
            "This domain isn't authorized to embed this career page. Add it in your Novara settings.",
            origin=origin,
        )

    retry_after = check_rate_limit(company_slug)
    if retry_after is not None:
        return error_response(
            429,
            "rate_limited",
            "Too many requests for this career page. Please try again shortly.",
            origin=origin,
            headers={"Retry-After": str(retry_after)},
        )

    return None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.options("/{full_path:path}")
async def preflight(full_path: str, request: Request):
    origin = request.headers.get("origin", "*")
    return Response(status_code=204, headers={
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Vary": "Origin",
    })


@app.get("/api/job-builder/v1/public/career-page/dashboard")
async def get_dashboard(request: Request, company_slug: str = Query(None)):
    guard = guard_request(request, company_slug)
    if guard:
        return guard

    origin = request.headers.get("origin")
    payload = {
        "success": True,
        "message": "Career page job count dashboard retrieved successfully",
        "data": MOCK_DASHBOARD_DATA[company_slug],
    }
    headers = cache_headers(origin)
    etag = etag_for(payload)
    not_modified = not_modified_response(request, etag, headers)
    if not_modified:
        return not_modified
    return JSONResponse(content=payload, headers={**headers, "ETag": etag})


@app.get("/api/job-builder/v1/public/career-page")
async def get_jobs(request: Request, company_slug: str = Query(None), page: int = 1, size: int = 100):
    guard = guard_request(request, company_slug)
    if guard:
        return guard

    origin = request.headers.get("origin")
    jobs = MOCK_JOBS_DATA[company_slug]
    payload = {
        "success": True,
        "message": "Career page jobs retrieved successfully",
        "data": {
            "items": jobs,
            "total": len(jobs),
            "page": page,
            "size": size,
        },
    }
    headers = cache_headers(origin)
    etag = etag_for(payload)
    not_modified = not_modified_response(request, etag, headers)
    if not_modified:
        return not_modified
    return JSONResponse(content=payload, headers={**headers, "ETag": etag})


@app.get("/api/job-builder/v1/public/career-page/bootstrap")
async def get_bootstrap(request: Request, company_slug: str = Query(None)):
    """Combined dashboard + jobs in one round trip (Workstream A proposal)."""
    guard = guard_request(request, company_slug)
    if guard:
        return guard

    origin = request.headers.get("origin")
    jobs = MOCK_JOBS_DATA[company_slug]
    payload = {
        "success": True,
        "message": "Career page bootstrap data retrieved successfully",
        "data": {
            "dashboard": MOCK_DASHBOARD_DATA[company_slug],
            "jobs": {
                "items": jobs,
                "total": len(jobs),
                "page": 1,
                "size": len(jobs),
            },
        },
    }
    headers = cache_headers(origin)
    etag = etag_for(payload)
    not_modified = not_modified_response(request, etag, headers)
    if not_modified:
        return not_modified
    return JSONResponse(content=payload, headers={**headers, "ETag": etag})
