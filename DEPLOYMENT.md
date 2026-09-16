# Production Deployment Guide

How to take CareerBridge from this repo's local Docker setup to a real production deployment — hosting the widget, connecting it to the real Novara API, and everything in between. See [PLAN.md](PLAN.md) for the full architecture rationale; this document is the practical how-to.

```
widget.js  ──▶  CDN edge  ──────────────▶  real Novara career-page API
(static asset)  cache + rate limit         CORS, domain allowlist,
                 immutable hosting          bootstrap endpoint
```

There is no backend service to deploy. `backend/` in this repo is a **local dev mock only** — it never ships to production. The widget calls the real Novara API directly.

---

## Step 0 — Point the widget at the real API (blocking)

Today, [frontend/widget.js](frontend/widget.js) hardcodes:

```js
const API_BASE = "http://localhost:3000/api/job-builder/v1/public/career-page";
const CAREER_SITE = "https://novara.vivasoftltd.dev/career";
```

`API_BASE` must be changed before this can run anywhere but your laptop. Before deploying:

1. Change `API_BASE` to the real API: `https://api.novara.vivasoftltd.dev/api/job-builder/v1/public/career-page`
2. Confirm `CAREER_SITE` (used to build each job's "Apply" link) still points at the correct production career site.
3. If you need this to differ per environment (staging vs. prod), the cleanest fix is a small build step that injects the right value rather than hand-editing the file per release — see Step 2.

This repo does not yet have that build step (see [PLAN.md](PLAN.md), "Build & delivery" under Workstream B Phase 1) — until it exists, treat this as a manual edit-before-you-build step, and don't skip it silently.

---

## Step 1 — Confirm the real API meets the widget's requirements

The widget assumes the real Novara API already does (or will do) four things — this is "Workstream A" in [PLAN.md](PLAN.md), and it's **not** something this repo can fix, since it's a different codebase:

| Requirement | Why the widget needs it | If missing |
|---|---|---|
| Permissive CORS on public career-page endpoints | Browser JS on arbitrary third-party sites must be able to read the response | Every embed fails with a CORS error, widget shows a generic error state |
| `Cache-Control` + `ETag` + `Vary: Origin` on responses | Performance, and correctness of any CDN/edge cache in front of the API | Works, but every render re-fetches fully; a naive edge cache without `Vary: Origin` could leak one origin's cached response to another |
| Domain allowlist enforcement (`Origin` strict / `Referer` advisory, fail-open when both absent) | The production security model behind `data-company-slug` — without it, any site can embed any company's data | Not present in the real API yet — see "Domain allowlist" below |
| `job.city` / `job.country` / `job.deadline` field names | The widget renders these exact fields | If the real API uses different names (e.g. `location`, `application_deadline`), those fields render blank — silently, no error |

Verify field names and CORS headers with a real request before your first production embed:

```bash
curl -sI "https://api.novara.vivasoftltd.dev/api/job-builder/v1/public/career-page/dashboard?company_slug=<real-slug>" \
  -H "Origin: https://example-customer-site.com"
```
Check for `access-control-allow-origin` in the response headers, and pull a real job record to diff its field names against what [frontend/widget.js](frontend/widget.js)'s `renderJobCard` reads (`job.city`, `job.country`, `job.department_id`, `job.department`, `job.employment_type`, `job.deadline`, `job.salary_min/max/currency`, `job.slug`).

**The widget also tries `GET .../career-page/bootstrap?company_slug=...` first** (combining dashboard + jobs in one request) and falls back automatically to the two-call path on a plain 404. If the real API doesn't have `/bootstrap` yet, this is harmless — it costs one extra failed request per render until that endpoint exists, then upgrades silently once it does.

**Domain allowlist reality check:** the widget's error handling expects a specific contract — a `403` with JSON body `{"success": false, "error_code": "domain_not_authorized", "message": "..."}`, and critically, **CORS headers on that error response too** (see [backend/main.py](backend/main.py)'s `error_response()` for the reference implementation — this exact bug cost real debugging time during development: without `Access-Control-Allow-Origin` on the 403 itself, the browser blocks the widget from ever reading *why* it failed, and you get a generic "could not load" instead of the specific message). If the real API's allowlist (once built) doesn't follow this contract, the widget still fails safely, just with a worse error message.

---

## Step 2 — Build and host the widget asset

### Minimum viable hosting (works today, no build tooling needed)
`frontend/widget.js` and `frontend/index.html` are plain static files — no bundler currently required to run them. You can host them as-is on any static host / CDN (S3+CloudFront, Cloudflare Pages, Netlify, Vercel static, etc.) once Step 0's edit is made.

1. Upload `widget.js`, `index.html`, and `reset.css` to your CDN/bucket.
2. Serve over **HTTPS** — required, since the widget will be embedded on HTTPS customer sites and mixed content will be blocked.
3. Set response headers:
   - `Content-Type: application/javascript` for `widget.js`
   - `Cache-Control: public, max-age=300, stale-while-revalidate=60` while you're on a single un-versioned path (short TTL, since there's no versioning yet to safely cache longer — see "Versioning" below)
4. Point customers at `https://<your-cdn>/widget.js` and `https://<your-cdn>/index.html` instead of `localhost:5000`.

### Recommended: add real versioning before wide rollout
Right now there is exactly one copy of `widget.js` at one URL. Every embed on every customer site points at that same URL, which means:
- A bad deploy breaks every embedded widget simultaneously, with no rollback that doesn't just re-deploy the old file and hope the CDN cache clears fast enough.
- You can't safely cache the asset for long (hence the short TTL above), which costs performance.

The fix (documented but not yet built — see [PLAN.md](PLAN.md)):
```
dist/1.4.2/widget.js   ← immutable, Cache-Control: public, max-age=31536000, immutable
dist/v1/widget.js      ← alias, moves only within semver-compatible releases, short TTL
```
Customers embed the `v1` alias by default (documented default, gets fixes automatically); you can pin an exact version for a specific customer if needed. A bad release only requires flipping the `v1` alias back, not waiting on individual customer sites to pick up a fix.

Setting this up is a CDN configuration + a small release script (copy the new build to a versioned path, then update the alias) — no application code changes required beyond adding a build step that stamps a version.

### Self-hosting checklist
- [ ] HTTPS only
- [ ] `Access-Control-Allow-Origin: *` is fine on the **static asset** itself (it's public JS, not sensitive) — this is separate from the API's per-company allowlist, which is where real access control lives
- [ ] Gzip/Brotli compression enabled (widget.js is currently ~20KB unminified; minifying via a build step, once added, will shrink this further)
- [ ] `index.html` served with the same HTTPS/CDN setup, referencing the production `widget.js` URL (currently it uses a relative `src="widget.js"`, which resolves correctly as long as both files are deployed to the same directory)

---

## Step 3 — Configure the domain allowlist per customer

Once the real API's allowlist exists (Step 1), each company that wants to embed the widget needs its permitted domains registered — this is data the real API owns, not something configured in this repo. When onboarding a customer:

1. Get their exact embedding domain(s) (e.g. `careers.acme.com`, or `*.acme.wixsite.com` for a Wix preview).
2. Register those domains against their `company_slug` in the real API's company settings.
3. Remember the enforcement asymmetry (see [PLAN.md](PLAN.md) finding 11): it's **strict** for the JS widget (`Origin` header, unforgeable by page JS) and **advisory only** for the iframe (`Referer`, spoofable by non-browser clients). Don't oversell the iframe path's protection to customers who ask about it.
4. `localhost` / `127.0.0.1` (any port) should stay allowed unconditionally in the real API too, mirroring the mock — otherwise every customer's local dev/staging environment breaks.
5. Support wildcard patterns (`*.customerdomain.com`) for customers with multiple subdomains or preview environments.

If a customer reports "the widget shows 'not authorized'" after everything above looks right, the most common causes are: they haven't been registered yet, their embedding domain doesn't match what's registered (check for `www.` mismatches, or `http` vs `https`), or — if testing inside a CMS's own admin preview (e.g. WordPress's Gutenberg Custom HTML block preview) — the preview runs in a sandboxed iframe with an opaque origin (`Origin: null`), which the mock already handles by failing open; confirm the real API does the same before assuming it's a real misconfiguration.

---

## Step 4 — Pre-launch testing checklist

Don't skip this — several of these caught real bugs during development of this widget, not hypothetical ones.

- [ ] **Real host site, not just localhost.** Deploy a test page on an actual HTTPS domain (even a throwaway one) and embed the widget for real — this is the only way to get a real `Origin` header and catch allowlist issues.
- [ ] **Strict CSP.** Load the widget on a page with `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'` and confirm it still renders. This repo's Playwright test suite covers this (see below) — rerun it against your production URLs.
- [ ] **Two widgets on one page.** Confirms multi-instance still works with your production asset build.
- [ ] **Late DOM injection.** If any target customer uses a page builder, SPA framework, or Wix Velo, test a container added to the DOM *after* the script tag runs.
- [ ] **WordPress Custom HTML block preview**, not just the published page — the sandboxed-iframe/`Origin: null` case above.
- [ ] **A company with more jobs than the fetch page size** (currently 200) — confirm the badge honestly shows "X of Y" rather than a wrong total.
- [ ] **API failure simulation** (block the API domain via your browser's dev tools) — confirm the widget shows cached data with a "showing cached results" notice on a second load, not a blank error.
- [ ] **Mobile viewport** — the card layout collapses to a single column under 640px; verify visually.
- [ ] **Rate limiting** — if the real API enforces per-`company_slug` limits, confirm the widget's 429 handling shows a sensible message rather than a generic failure.

### Automated verification
This repo includes a Playwright test suite (not checked in yet — it was run from a scratch directory during development) covering 26 scenarios: XSS-safety, multi-instance, late injection, CSP compliance, allowlist behavior, department filtering, and the public JS API. Re-running an equivalent suite against your production URLs before each release is strongly recommended — ask for it to be added to this repo as a proper `tests/` directory and CI job if you want it version-controlled and repeatable.

---

## Step 5 — Monitoring after launch

Current visibility is limited: the widget logs failures to the browser console (`console.error("[NOVARA] fetch failed for ...")`) but has **no telemetry beacon** — you cannot currently see widget failures happening on customer sites you don't control. This is flagged in [PLAN.md](PLAN.md) as a Phase 1 item ("client-side error beacon") that hasn't been built yet.

Until it exists, your options are:
- Ask affected customers to check their browser console when reporting issues.
- Monitor the real API's own server-side logs/metrics for elevated 4xx/5xx rates, unusual `company_slug` values, or allowlist rejections — this catches most widget-side problems indirectly, since every render is an API call.
- Prioritize building the beacon before scaling to many customers you can't directly support.

---

## Rollback

If a bad release breaks embedded widgets:
- **With versioning set up (Step 2):** flip the `v1` alias back to the previous immutable version. Every customer picks up the fix on their next page load, no customer-side action needed.
- **Without versioning (current state):** re-deploy the previous `widget.js` to the same URL as fast as possible, and be aware your CDN's cache TTL determines how long the broken version keeps being served to some visitors even after you fix it — this is the main reason to prioritize Step 2 before this becomes a real incident.

---

## Summary checklist

- [ ] `API_BASE` in `widget.js` points at the real production API, not `localhost:3000`
- [ ] Real API's CORS, cache headers, and field names confirmed against what the widget expects
- [ ] Real API's domain allowlist returns the exact error contract the widget handles (`403` + `error_code` + CORS headers on the error itself)
- [ ] `widget.js` / `index.html` / `reset.css` hosted on HTTPS with correct cache headers
- [ ] (Recommended, not yet built) immutable versioned hosting + `v1` alias
- [ ] Target customer's domain(s) registered in the real API's allowlist
- [ ] Pre-launch checklist above run against the real deployed URL, not just localhost
- [ ] A plan for finding out about failures post-launch, given there's no beacon yet
