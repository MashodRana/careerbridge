# CareerBridge

**CareerBridge** is NOVARA's embeddable career widget — a single `<script>` or `<iframe>` snippet that bridges any website (WordPress, Wix, or a custom app) to a company's live NOVARA job listings, with no backend work required on the host site. It connects directly to the **real Novara staging API**.

> This directory is still named `poc-carrerpage` on disk (its original working name) — renaming the folder itself would break the Docker build context and every path in this README, so it's left as-is. CareerBridge is the project's name going forward.

Two embedding strategies are supported:

| Strategy | How | Best for |
|----------|-----|----------|
| **JavaScript Widget** | `<div>` + `<script>` tag — renders natively via Shadow DOM | Sites that allow custom JS (WordPress, Wix Custom Code) |
| **Iframe** | `<iframe>` pointing to the hosted preview page | Sites with restricted JS (Wix Embed HTML, any CMS) |

```
CareerBridge/
├── backend/
│   ├── Dockerfile
│   ├── main.py              # LOCAL DEV MOCK API — never deployed; see below
│   └── requirements.txt
├── frontend/
│   ├── Dockerfile
│   ├── index.html            # Standalone page (for iframe embed)
│   ├── reset.css             # Minimal reset for the standalone page
│   └── widget.js             # JS widget (for script embed)
├── docker-compose.yml
├── PLAN.md                   # Production-readiness plan and status
└── README.md
```

---

## Prerequisites

| Tool | Version |
|------|---------|
| Docker & Docker Compose | Latest |
| A modern browser | — |

> That's it — no local Python, Node, or web server needed.

---

## 1 · Start Everything

```bash
docker-compose up -d --build
```

This spins up **four** containers:

| Service | URL | Description |
|---------|-----|-------------|
| **backend** | [http://localhost:3000](http://localhost:3000) | FastAPI local dev mock (not proxied, not for production) |
| **frontend** | [http://localhost:5000](http://localhost:5000) | Widget assets (nginx) |
| **wordpress** | [http://localhost:8080](http://localhost:8080) | WordPress test site |
| **db** | _(internal)_ | MariaDB for WordPress |

### Verify the services

- **Mock API:** [http://localhost:3000/api/job-builder/v1/public/career-page/dashboard?company_slug=novara-qa-test](http://localhost:3000/api/job-builder/v1/public/career-page/dashboard?company_slug=novara-qa-test)
- **Widget preview (iframe-ready):** [http://localhost:5000/index.html](http://localhost:5000/index.html)

---

## 2 · WordPress Setup (first time only)

1. Open [http://localhost:8080](http://localhost:8080) and complete the WordPress install wizard (pick any site title / admin credentials).

---

## 3 · Embed in WordPress

1. **Log in** to WordPress admin: [http://localhost:8080/wp-admin](http://localhost:8080/wp-admin)
2. Go to **Pages → Add New Page**.
3. Set the page title to **Careers**.
4. Click the **`+`** block inserter → search for **Custom HTML** → add the block.
5. Paste **one** of the embed codes below, then click **Publish**.

### Option A — JavaScript Widget (recommended)

Renders natively in the page. Uses Shadow DOM for style isolation.

```html
<div class="novara-careers" data-company-slug="financfy-ltd"></div>
<!-- Note: In production, replace localhost:5000 with your CDN URL (e.g. https://cdn.novara.com/widget.js) -->
<script src="http://localhost:5000/widget.js"></script>
```

> Use `class="novara-careers"` (or `data-novara-careers`) rather than `id="novara-careers"` if you might embed more than one widget on the same page — `id` still works for a single instance, but IDs must stay unique. A `<novara-careers data-company-slug="…">` custom element also works as a drop-in alternative to the `<div>`.

### Option B — Iframe

Loads the standalone preview page inside an iframe. Zero JS needed on the host page.

```html
<iframe
  src="http://localhost:5000/index.html?companySlug=financfy-ltd"
  width="100%"
  height="800"
  style="border: none; border-radius: 12px; overflow: hidden;"
  title="NOVARA Career Widget"
  loading="lazy"
></iframe>
```

> **Note on Localhost:** In this PoC, `localhost:5000` points to the local frontend container. In production, this would be your public CDN URL (e.g., `src="https://cdn.novara.com/widget/index.html?companySlug=financfy-ltd"`).

> **Tip:** The `index.html` page has a transparent background, so it inherits the WordPress theme's colors.

---

## 4 · Embed in Wix

> **Note:** Wix is a hosted platform — no Docker container for it. These steps use your live Wix Editor. In production, replace `localhost` URLs with public ones.

### Option A — Wix "Embed HTML" widget (quickest)

This uses Wix's built-in HTML embed component. Works with both the **iframe** and **widget** snippet.

1. Open the **Wix Editor** for your site.
2. Click **Add Elements** (`+`) → **Embed Code** → **Embed HTML**.
3. Click **Enter Code** and switch the mode to **Code**.
4. Paste **either** the JS Widget or Iframe snippet from the WordPress section above.
5. Click **Update** → resize the element to fit your page layout.
6. **Preview** or **Publish** the site.

### Option B — Wix Custom Code injection (native, no sandbox)

This injects `widget.js` directly into the page `<body>`, so it runs natively — no Wix iframe wrapper.

#### Step 1: Add the script to your site

1. In the Wix **Dashboard**, go to **Settings → Custom Code** (or **Marketing & SEO → Custom Code**).
2. Click **+ Add Custom Code**.
3. Paste this snippet:

```html
<script src="http://localhost:5000/widget.js"></script>
```

4. Configure:
   - **Name:** `NOVARA Career Widget`
   - **Add Code to Pages:** Choose **specific pages** → select your Careers page
   - **Place Code in:** **Body - end**
5. Click **Apply**.

#### Step 2: Add the container div with Velo (Wix Code)

1. In the Wix Editor, enable **Dev Mode** (toggle at the top bar).
2. Open the **Careers page** in the editor.
3. Add a **Container Box** or **Section** where you want the widget. Give it the ID `careers-section` in the Properties panel.
4. In the Velo code panel (`Page Code` tab), add:

```javascript
$w.onReady(function () {
  const container = $w("#careers-section");
  container.html = `<div class="novara-careers" data-company-slug="financfy-ltd"></div>`;
});
```

5. **Publish** the site.

---

## Embedding Strategy Comparison

| Aspect | JS Widget | Iframe |
|--------|-----------|--------|
| Embed code | `<div>` + `<script>` | `<iframe src="…">` |
| Style isolation | Shadow DOM | Natural (separate document) |
| CSS conflicts? | ❌ None | ❌ None |
| Requires JS on host? | ✅ Yes | ❌ No |
| Works in restricted CMS? | ⚠️ Depends on CMS | ✅ Always |
| SEO-friendly? | ✅ Inline DOM | ⚠️ Iframe content not indexed |
| Apply links | Open in same context | Open in new tab (`target="_blank"`) |
| WordPress | ✅ | ✅ |
| Wix | ✅ (Custom Code) | ✅ (Embed HTML) |

---

## Configuration Reference

All optional, set as `data-*` attributes on the container (both the `<div>` and the `<novara-careers>` custom element), or as query params on the iframe `src`:

| Attribute | Values | Default | Notes |
|---|---|---|---|
| `data-primary-color` | hex color | API's `theme_settings.primary_color` | Auto-darkened if it would fail WCAG AA contrast against white button text |
| `data-layout` | `list` \| `grid` | `list` | |
| `data-max-jobs` | integer | unlimited | Also hides the department filter bar |
| `data-department` | a `department_id` | none | Pre-filters to one department, hides the filter bar |
| `data-apply-target` | `_blank` \| `_self` | `_blank` | |
| `data-theme` | `auto` \| `light` \| `dark` | `auto` | `auto` follows the visitor's OS/browser preference and updates live |
| `data-locale` | BCP-47 locale | `en-US` | Used for date and number formatting |
| `data-heading-level` | `h1`–`h6` | `h2` | Avoid `h1` — it would compete with the host page's own top-level heading |
| `data-inherit-font` | `true` | `false` (isolated) | Opts into inheriting the host page's font — off by default so Shadow DOM style isolation stays the default guarantee |

**Auto-theming without any attributes at all:** set `--novara-primary`, `--novara-bg`, or `--novara-text` as CSS custom properties on an ancestor of the widget container (or on `:root`). These inherit through the Shadow DOM boundary automatically. An explicit `data-primary-color`, or the company's brand color from the API, always takes precedence over these.

**Public JS API** (for SPA hosts, or anywhere you need to mount/update/remove a widget programmatically):

```js
window.NovaraCareers.init(elementOrSelector, { companySlug: "financfy-ltd" });
window.NovaraCareers.refresh(elementOrSelector); // re-fetch and re-render
window.NovaraCareers.destroy(elementOrSelector); // tear down
```

---

## How It Works

### JS Widget flow

```
Host Page (WordPress / Wix / any site)
└── <div id="novara-careers" data-company-slug="financfy-ltd">
    └── #shadow-root (Shadow DOM – styles isolated)
        ├── <style>…</style>           ← scoped CSS + dynamic theme color
        └── <div class="nv-widget">
            ├── company logo + name    ← from dashboard API
            ├── department filter pills ← from dashboard API
            └── job cards              ← from jobs API
```

### Iframe flow

```
Host Page
└── <iframe src="http://localhost:5000/index.html">
    └── index.html (transparent background)
        └── widget.js (same Shadow DOM rendering inside the iframe)
```

In production, both paths call the real Novara API directly:
- **Dashboard:** `https://api.novara.vivasoftltd.dev/api/job-builder/v1/public/career-page/dashboard?company_slug=…`
- **Jobs:** `https://api.novara.vivasoftltd.dev/api/job-builder/v1/public/career-page?company_slug=…&page=1&size=100`
- **Bootstrap (both combined, one round trip):** `https://api.novara.vivasoftltd.dev/api/job-builder/v1/public/career-page/bootstrap?company_slug=…`

There is **no backend proxy in production** — the widget's `API_BASE` points straight at the real API. `backend/` in this repo is a **local dev mock only**, described below.

---

## Local Dev Mock API (`backend/`, port 3000)

`backend/main.py` is **not a proxy and is never deployed**. It's a same-process stand-in for the real Novara API's contract, so the widget can be developed and tested end-to-end without staging access. It mocks two companies (`financfy-ltd`, `novara-qa-test`) and simulates the production behaviors the widget depends on:

| Method | Endpoint | Notes |
|--------|----------|-------|
| `GET` | `/api/job-builder/v1/public/career-page/dashboard` | `company_slug` (required) |
| `GET` | `/api/job-builder/v1/public/career-page` | `company_slug` (required), `page`, `size` |
| `GET` | `/api/job-builder/v1/public/career-page/bootstrap` | `company_slug` (required) — dashboard + jobs combined |

Simulated production behaviors:
- **Per-company domain allowlist** — enforced strictly via the `Origin` header (script embed); advisory-only via `Referer` for the iframe embed, since the iframe's own requests never carry the host page's origin. Falls open (with a logged warning) when neither header is present. `localhost`/`127.0.0.1` are always allowed as a dev exemption; edit `MOCK_ALLOWED_DOMAINS` in `main.py` to test other origins. A disallowed origin gets `403 domain_not_authorized`.
- **Cache-Control + ETag + Vary: Origin** on every response, with `If-None-Match` → `304` support.
- **Per-`company_slug` rate limiting** (not per-IP) — `429 rate_limited` with `Retry-After` past 120 requests/60s for one company.
- Structured errors: `{"success": false, "error_code": "...", "message": "..."}` for `invalid_company_slug` (400), `company_not_found` (404), `domain_not_authorized` (403), and `rate_limited` (429).

---

## Stopping Everything

```bash
docker-compose down
```

To also remove persisted data (WordPress DB + uploads):

```bash
docker-compose down -v
```

---

## Further Reading

- **[INTEGRATION.md](INTEGRATION.md)** — full widget/iframe usage guide: every `data-*` attribute and query param, auto-theming, generating embed snippets for a new platform, troubleshooting.
- **[DEPLOYMENT.md](DEPLOYMENT.md)** — taking this to production: hosting the widget, connecting it to the real Novara API, domain allowlist setup, pre-launch checklist.
- **[PLAN.md](PLAN.md)** — the production-readiness plan and its current implementation status.

---

## License

Internal – Vivasoft / NOVARA — CareerBridge
