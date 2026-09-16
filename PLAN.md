# Production-Grade CareerBridge (NOVARA Career Widget)

## Status

**Workstream B (this repo), Phase 1 correctness/security/CSP work: done and verified** (24/24 automated browser tests, including a strict-CSP scenario with zero violations). Covers findings 1–10 below, the CSP-safe theming architecture, config attributes, the public JS API, and the CORS-on-error fix in the mock backend.

**Still open:**
- Build/delivery pipeline (esbuild, `frontend/src/` module split, immutable versioned `dist/<version>/` output) — not started
- Phase 2 items (search/pagination, inline job detail, analytics beacon, npm package, SRI, RTL, iframe auto-resize snippet) — not started
- Workstream A (the real Novara API changes below) — out of reach from this repo; `backend/main.py` simulates the intended contract as a local dev mock in the meantime

## Context

The `poc-carrerpage` project proves the embedding pattern (JS widget with Shadow DOM + iframe fallback) but is PoC-quality throughout. Scope confirmed with the user: stay with a **universal embed script + iframe** (no platform-native WordPress/Wix packages), but make it genuinely production-grade — safe to hand to any external site with a copy-paste snippet.

This plan was validated against the current source. The audit found six correctness/security defects that must be fixed regardless of new features, plus contradictions in this plan's own first draft. Those are recorded below and folded into the work.

Two decisions taken during planning:
- **Per-company domain allowlisting: yes** (with the asymmetry caveats in finding 11).
- **No new backend service.** The team owns the existing Novara career-page API, so cross-cutting concerns go into it and the CDN edge rather than a separate BFF. The first draft of this plan proposed a proxy service; that was over-engineering and has been removed.

---

## Validation findings (current PoC defects)

### Critical — security & correctness

1. **Attribute-context XSS via `esc()`** — `frontend/widget.js:255-259` escapes by `textContent` → `innerHTML`, which escapes `&`, `<`, `>` but **not `"` or `'`**. Every use is inside a quoted HTML attribute (`widget.js:284` `src=`/`alt=`, `:301` `data-dept=`, `:316` `data-department=`, `:327` `href=` + `aria-label=`). A job title or logo URL containing `"` breaks out of the attribute → script execution **on every host site embedding that company's widget**. Since the data is tenant-controlled, this is a cross-tenant stored-XSS vector: one malicious or compromised Novara customer could execute script on their embedding partners' sites. Fix: separate `escHtml` / `escAttr` (escape `"` and `'` too), or drop string-templating for DOM construction.
2. **Only one widget per page** — `CONTAINER_ID` is hardcoded to `"novara-careers"` (`widget.js:17`) and looked up with `getElementById`. A page with two sections (e.g. Engineering + Design) is impossible. Fix: query *all* matching containers by attribute, render each independently.
3. **Init race — the widget silently never renders on late-injected containers** — `init()` runs once on `DOMContentLoaded`/immediately (`widget.js:446-450`). Page builders, lazy loaders, tab panels, and SPA route changes insert the container *after* that. This means the README's **Wix Velo flow (Option B) does not work as documented** — it injects the container via `$w().html` after page ready, and the body-end script has already run and given up. Fix: `MutationObserver` + an idempotent public `init()`.
4. **Silent truncation at 100 jobs, with a visibly wrong count** — `size=100` is hardcoded (`widget.js:409`) while the header badge renders `total_count` from the dashboard API (`widget.js:292`). A company with 150 jobs shows "150 open positions" above 100 cards, and department pills show counts that don't match the filtered list. Fix: paginate/lazy-load, or reconcile the displayed count with what was actually fetched.
5. **Host URL can hijack the rendered company** — the query param is read *before* the data attribute (`widget.js:379-380`). On a normal host page, appending `?companySlug=other-co` to the URL swaps out which company's jobs render. The query param is only meant for the iframe path. Fix: data attribute wins; query param only honored when running as the iframe document.
6. **`color-mix()` with no fallback** — used 6× for hover, shadow, and the light theme variant (`widget.js:141,218,224,426`). Unsupported on Safari < 16.2 and older Chromium; those visitors get missing backgrounds/shadows. Fix: compute derived colors in JS (the widget already has the hex) and set them as concrete CSS variables.

### Blocking for real-world embedding

7. **Strict-CSP host sites will break the widget** — it injects an inline `<style>` (`widget.js:384-386`, needs `style-src 'unsafe-inline'`), `@import`s Google Fonts inside the shadow stylesheet (`widget.js:31`, needs `style-src`/`font-src` allowances), sets inline `style=` attributes (`widget.js:316`), and loads logos from arbitrary origins (needs `img-src`). Any host with a locked-down CSP — common in enterprise and finance, i.e. exactly this customer profile — gets a blank widget with console errors. Fix: constructable stylesheets via `adoptedStyleSheets` (not subject to `style-src 'unsafe-inline'`), self-host fonts, drop inline style attributes, and publish a documented CSP snippet for hosts.
8. **The Google Fonts `@import` is also a render-blocking perf hit** — an `@import` at the top of the shadow stylesheet serializes a second network round trip before first paint. Self-hosting fixes CSP and perf together, so it belongs in Phase 1.
9. **Invalid ARIA on the filter bar** — `role="tablist"` (`widget.js:304`) wrapping plain `<button>`s with no `role="tab"`, `aria-selected`, or controlled panel. Screen readers announce a broken tab widget. Fix: drop the role and use a labeled group of toggle buttons — simpler, and the correct semantic here.
10. **No caching story at any layer** — the client explicitly opts out with `cache: 'no-store'` on both calls (`widget.js:408-409`), and `frontend/nginx.conf` sets no `Cache-Control`, no compression, and no immutable caching for versioned assets. Every widget render on every page view is two uncached round trips. (Also: the `Cross-Origin-Embedder-Policy` header in `nginx.conf:12` is a no-op — COEP applies to the embedding document, not the served resource. `Cross-Origin-Resource-Policy` on line 11 is the one doing the work.)

### Allowlist enforcement is asymmetric across the two embed paths

11. **The iframe path cannot see the host domain the way the script path can.** On the script embed, the browser sets `Origin` to the host page's origin — page JS cannot forge it, so enforcement is real. On the iframe embed the widget runs on *our own* document, so its API calls carry `Origin: <our CDN>` — the embedding site is invisible. The only signals are the iframe document's own `Referer` (browser-set to the parent page, so trustworthy when present) and `window.location.ancestorOrigins` (unsupported in Firefox, and self-reported by client JS either way). Consequences to design around, not paper over:
    - Enforce **strictly on the script path** (`Origin`), and treat the iframe path as **advisory** — it deters casual unauthorized embedding but is not a security boundary against a determined scraper, who can call the public API directly with a forged header. Say this plainly to customers rather than overselling it.
    - **Fail open, with logging, when the referrer is stripped.** Hosts sending `Referrer-Policy: no-referrer` or `same-origin` erase the signal entirely; blocking on absence would break legitimate paying customers over a header they chose for their own privacy reasons.
    - Allowlist matching needs **wildcard support** (`*.wixsite.com`, `*.staging.acme.com`) plus localhost/preview exemptions, or every Wix preview and dev environment breaks before launch.
    - A rejected embed must render a **specific, actionable message** ("this domain isn't authorized — add it in your Novara settings"), not a generic failure, or every misconfiguration becomes a support ticket that looks like an outage.

### Contradictions in this plan's first draft (now resolved)

12. **`font-family: inherit` vs. the style-isolation guarantee** — auto-theming wanted host typography to flow in; the whole point of Shadow DOM here is that host CSS *cannot* reach in. Resolution: inheritance is opt-in per property — `data-inherit-font="true"`, default off — so isolation stays the default and typography matching is a deliberate choice.
13. **Iframe auto-resize vs. the "zero JS on host" promise** — `postMessage` resize *requires* a listener on the host page, the one thing the iframe path exists to avoid. Resolution: ship an optional one-line resizer snippet, and without it fall back to a configured height with internal scrolling. Document the tradeoff instead of advertising auto-resize as free.

---

## Architecture

No new service. Three places do the work, and only the first is this repo:

```
widget.js  ──▶  CDN edge  ──────────────▶  existing Novara career-page API
(this repo)     cache + rate limit         CORS, domain allowlist,
                immutable asset hosting    combined bootstrap endpoint

backend/  ──▶  local dev mock only (never deployed)
```

- **The widget calls the existing API directly.** The PoC's `backend/main.py` mirrors the real API's paths exactly, which confirms the real API already serves what the widget needs — the proxy was never load-bearing.
- **`backend/` is demoted to a local dev mock** so contributors can run the widget without hitting staging. It must never be deployed. The README currently claims it proxies the real API when it actually returns hardcoded data — correct that text rather than leaving a documented lie.
- **CDN edge handles caching and rate limiting.** You need the CDN anyway to host `widget.js`; this is configuration, not a service to deploy, monitor, and carry a pager for. **Rate limiting must not be per-IP** — a widget's traffic is host-page views, so every visitor is a different IP while a corporate NAT looks like one abuser. Limit per `company_slug`.
- **The API owns the domain allowlist**, because the company→domains mapping already lives in its database. An edge function would have to fetch and cache that mapping for no benefit.
- **Cache keys must include the origin** (`Vary: Origin`) at both the API and the edge. Without it, a response cached for an allowed domain gets served to a disallowed one, silently voiding the allowlist.
- **Immutable versioned builds + a mutable `v1` alias.** A single mutable `latest` that every embed points at means one bad push breaks every customer site at once, with no rollback that doesn't wait on CDN TTLs. Exact-version paths cache forever; the `v1` alias moves only within semver-compatible releases and is the documented default.
- **One core module serves both embed paths** — `index.html` just calls the same `init()`.

---

## Workstream A — Novara API (existing codebase, small additions)

- **CORS**: permissive `Access-Control-Allow-Origin` on the public career-page endpoints (verify what's already sent before assuming work is needed here).
- **`Cache-Control` + `ETag`** on responses, with `Vary: Origin`.
- **Combined bootstrap endpoint** (`career-page/bootstrap?company_slug=…`) returning dashboard + first page of jobs in one payload. The widget currently makes two parallel round trips per render (`widget.js:407-410`); this halves them and yields one cacheable object.
- **Per-company domain allowlist**: registry of permitted domains in company settings, wildcard + localhost matching, `Origin` enforcement on the script path, `Referer`/`ancestorOrigins` advisory check on the iframe path, fail-open-with-logging when the referrer is stripped, and a distinct error code the widget can map to a specific "domain not authorized" message.
- **Schema alignment**: the widget renders `job.city` / `job.country` / `job.deadline` (`widget.js:321,323`) — confirm the real API's field names and standardize end-to-end. The PoC mock uses `location` / `application_deadline`, so those fields render blank today.
- **Per-`company_slug` rate limiting** if the edge can't express it.

## Workstream B — Widget (this repo)

### Phase 1 — Foundation

**Fix the validated defects** (findings 1-10) — prerequisites, not enhancements.

**Build & delivery**
- Source moves to `frontend/src/` (core, api, helpers, theme, styles as modules), bundled with `esbuild` into a minified IIFE for `<script src>` and an ESM build for bundler consumers
- Immutable versioned output + `v1` alias; `Cache-Control: immutable` and compression in `nginx.conf`

**Client resilience**
- Fetch timeout + retry with backoff
- Skeleton loader sized to reserve final layout height (avoids CLS on the host page)
- Last-known-good `localStorage` cache — on API failure, show stale data with a "showing cached results" notice instead of a dead widget
- Distinct error states (network / unknown company / rate-limited / domain-not-authorized) with a Retry action
- **Client-side error beacon** (sampled) — without it you are blind to widget failures on customer sites you cannot access or debug. Support-critical, so Phase 1.

**Embed-time configuration** (`data-*` attributes, mirrored as iframe query params)
- `data-layout="grid|list"`, `data-max-jobs`, `data-department` (pre-filter + hide the bar)
- `data-apply-target="_self|_blank"`, `data-theme="light|dark|auto"`, `data-locale`
- `data-heading-level` — the widget emits `<h1>` (`widget.js:290`), hijacking the host page's heading hierarchy and its SEO. Default to `h2`, make it configurable.
- keep existing `data-company-slug`, `data-primary-color`

**Auto-theming (matching the host site with zero/minimal config)**
Two distinct needs:
- *Company branding* (already automatic): `theme_settings.primary_color` from the API applies per company.
- *Host site's look* (new) — true inheritance is limited by design (Shadow DOM isolates; the iframe is a separate document), so layer reliable mechanisms rather than guessing:
  1. **CSS custom-property hooks** — widget CSS reads `var(--novara-primary, …)`, `--novara-bg`, `--novara-text`. Custom properties inherit *through* the shadow boundary with no JS glue, so any host whose theme exposes CSS variables gets an exact match by mapping one line. The recommended path for design-conscious hosts.
  2. **`prefers-color-scheme` auto light/dark** — works on both paths with no host cooperation; `data-theme="auto"` default.
  3. **`data-inherit-font="true"`** — opt-in typography inheritance, off by default (finding 12).
  4. **Transparent background** on the widget wrapper (already true for the iframe) so the host's background shows through.
  5. **Heuristic color-sampling** — Phase 2, opt-in only (`data-auto-theme="experimental"`); it can sample the wrong element and produce a visibly broken widget, so never the default.

**Integration DX**
- Public JS API: `window.NovaraCareers.init(el, opts)` / `.refresh()` / `.destroy()` — required for SPA hosts and the late-injection cases in finding 3
- Multi-instance rendering (finding 2)
- Optional iframe auto-resize snippet with origin-validated, namespaced `postMessage` (unvalidated resize messages are spoofable by any page)
- Alternate `<novara-careers company-slug="…">` custom element over the same core
- **RTL support** — `dir` awareness for Arabic/Hebrew host sites; logical CSS properties throughout

**Accessibility**
- Fix the invalid tablist ARIA (finding 9); audit focus order and visible focus states
- `prefers-reduced-motion` — disable card fade/hover animations
- Contrast guard: if a host-supplied `data-primary-color` fails WCAG AA against white button text, auto-darken or swap text color rather than shipping unreadable buttons

### Phase 2 — Scale & polish

- Keyword search + pagination/infinite scroll (pairs with the finding-4 fix)
- **Inline job detail view** (modal/accordion) instead of always bouncing to `novara.vivasoftltd.dev` — keeps candidates on the host site, a real conversion win and the most visible differentiator versus a plain job list
- **Source attribution on apply URLs** (UTM/referrer params) — without it there's no way to attribute applications to the widget, i.e. no way to prove the integration's value to customers
- SRI hashes published per versioned build
- Opt-out analytics beacon (render + apply-click) — off by default or clearly disclosed
- npm package (`@novara/career-widget`) + TypeScript types for bundler consumers
- Shadow DOM fallback (namespaced classes) for legacy browsers, if the support matrix demands it
- Documented SEO limitation + optional `<noscript>` job list, since neither Shadow DOM nor iframe content is reliably crawlable

### Cross-cutting: privacy

A third-party script that writes `localStorage` and sends beacons has GDPR implications for EU host sites. Keep it cookie-less and PII-free, make caching and beacons independently disableable, and ship a short privacy statement hosts can reference in their own policy.

---

## Open product decision

**Inline job detail vs. redirect** (Phase 2) — keeping candidates on the host page converts better, but moves the application funnel off Novara's own property and duplicates job-detail rendering in the widget.

---

## Repo changes

```
frontend/
├── src/
│   ├── core.js       # init/render, shared by the script and iframe paths
│   ├── api.js        # fetch, retry, timeout, cache, stale fallback
│   ├── helpers.js    # escHtml/escAttr, date/salary/employment formatting
│   ├── theme.js      # color derivation (color-mix replacement), contrast guard
│   └── styles.js
├── dist/<version>/   # immutable build output: widget.js (IIFE), widget.esm.js
├── build.mjs         # esbuild config
├── package.json
├── index.html        # iframe host
└── nginx.conf        # + cache-control, compression, immutable versioned assets

backend/              # LOCAL DEV MOCK ONLY — never deployed
└── main.py           # keep as-is; fix the README text that calls it a proxy
```

## Verification

- Unit tests (Vitest) for `helpers.js` — including explicit cases for `"`/`'` in job titles and logo URLs (finding 1) — and for `api.js` retry/cache/stale-fallback behavior
- Playwright: job cards render; filters work; two widgets on one page render independently (finding 2); a container injected *after* load still renders (finding 3); API unreachable → cached data with notice, not a blank widget
- CSP regression test: load the widget in a page served with a strict `Content-Security-Policy` and assert it renders
- Allowlist tests (against the API): allowed origin renders; disallowed origin returns the distinct error the widget maps to "not authorized"; wildcard and localhost entries match; stripped referrer fails *open*; and a response cached for an allowed origin is **not** served to a disallowed one (the `Vary: Origin` regression)
- Manual matrix: the `docker-compose up` WordPress flow against the new build output, plus a real Wix site — Wix's sandbox can't be reproduced locally, and finding 3 originated there
