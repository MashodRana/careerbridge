# Integration Guide — Widget & Iframe

How to embed CareerBridge on any site, and every attribute you can set when generating an embed snippet for a customer. For getting the widget itself into production, see [DEPLOYMENT.md](DEPLOYMENT.md) — this document assumes it's already hosted somewhere real.

---

## Choosing a strategy

| | JS Widget | Iframe |
|---|---|---|
| Embed code | `<div>` + `<script>` (or a `<novara-careers>` element) | `<iframe src="…">` |
| Style isolation | Shadow DOM | Full — separate document |
| Requires JS enabled on host | Yes | No |
| Works in JS-restricted CMS editors | Depends on the CMS | Always |
| SEO | Inline DOM — better | Iframe content isn't indexed |
| Apply links | Open in same tab or new tab, your choice (`data-apply-target`) | Always open in a new tab |
| Height | Grows/shrinks with content automatically | Fixed `height=` you set, unless you add the optional resize snippet (not built yet — see below) |
| Multiple on one page | Yes | Yes (each is a separate `<iframe>`) |

**Default recommendation:** JS widget, unless the target platform's editor blocks custom `<script>` tags (some CMS "embed" widgets only accept iframes) — in that case, iframe.

---

## JS Widget

### Basic snippet
```html
<div class="novara-careers" data-company-slug="financfy-ltd"></div>
<script src="https://<your-cdn>/widget.js"></script>
```
Use `class="novara-careers"` or `data-novara-careers` rather than `id="novara-careers"` unless you're certain only one widget will ever be on the page — IDs must stay unique, classes don't.

### Multiple widgets on one page
Just repeat the container with different config:
```html
<div class="novara-careers" data-company-slug="financfy-ltd" data-department="eng"></div>
<div class="novara-careers" data-company-slug="financfy-ltd" data-department="prod"></div>
<script src="https://<your-cdn>/widget.js"></script>
```
The script only needs to load once regardless of how many containers are on the page.

### Custom element alternative
Identical behavior, different markup — useful if a platform's editor handles custom elements more gracefully than a bare `<div>`:
```html
<novara-careers data-company-slug="financfy-ltd"></novara-careers>
<script src="https://<your-cdn>/widget.js"></script>
```

### Programmatic usage (SPAs, dynamically mounted content)
If a container is added to the page after the script has already run, the widget picks it up automatically (via a `MutationObserver`) — you don't need to call anything manually in most cases. But for SPA-style apps that need explicit control (mount on route change, force a re-fetch, unmount on route leave):
```js
// Mount into an element you already have a reference to
window.NovaraCareers.init(myElement, { companySlug: "financfy-ltd" });

// Or by selector
window.NovaraCareers.init("#careers-container", { companySlug: "financfy-ltd" });

// Re-fetch and re-render (e.g. after the user changes a filter you control externally)
window.NovaraCareers.refresh(myElement);

// Tear down (e.g. on route leave)
window.NovaraCareers.destroy(myElement);
```

---

## Iframe

### Basic snippet
```html
<iframe
  src="https://<your-cdn>/index.html?companySlug=financfy-ltd"
  width="100%"
  height="800"
  style="border: none; border-radius: 12px; overflow: hidden;"
  title="Careers"
  loading="lazy"
></iframe>
```

### Sizing
There's no automatic height adjustment yet (documented as a deliberate tradeoff in [PLAN.md](PLAN.md) — true auto-resize needs a listener on the host page, which defeats the "zero JS on host" point of choosing iframe in the first place). Pick a `height` generous enough for the expected job count, and rely on the iframe's own internal scrolling for overflow. If a customer specifically wants auto-resize and is fine adding a small script to their page, that's a documented future addition, not something available today.

### Config via query string
Anything the JS widget takes as a `data-*` attribute, the iframe takes as a URL query parameter on `index.html` — see the full table below; every attribute lists both forms.

---

## Full attribute / query-param reference

Every row works as `data-<name>` on the widget's container **and** as a `?<name>=` query param on `index.html` for the iframe (the iframe internally is just the same widget core, configured via its own container's attributes, which get set from the query string).

| Attribute | Values | Default | What it does |
|---|---|---|---|
| `company-slug` | any registered slug | *(required)* | Which company's jobs to show. On the JS widget this is a `data-*` attribute; on the iframe it's driven by the URL's `?companySlug=` instead — `index.html` ships with no `data-company-slug` set specifically so the query string can control it. |
| `primary-color` | hex color, e.g. `#dc2626` | the company's own brand color from the API, or a default indigo if neither is set | Overrides the widget's accent color. Automatically darkened if the value would fail WCAG AA contrast against white button text — you'll never get an unreadably light button by accident. |
| `layout` | `list` \| `grid` | `list` | `list` stacks job cards full-width; `grid` lays them out in a responsive multi-column grid. |
| `max-jobs` | positive integer | unlimited | Caps how many job cards render. Also hides the department filter bar (filtering a deliberately-truncated preview doesn't make much sense). The badge stays honest — e.g. "3 of 8 shown" — rather than misrepresenting the count. |
| `department` | a `department_id` from the company's dashboard data | none | Pre-filters to one department and hides the filter bar entirely — use this to embed a department-specific careers section (e.g. an "Engineering Jobs" page that only shows engineering roles). |
| `apply-target` | `_blank` \| `_self` | `_blank` | Whether the "Apply Now" link opens in a new tab or the same tab/frame. (Iframe embeds always effectively open in a new tab regardless of this setting, since `_self` inside an iframe would navigate the iframe itself, not the host page.) |
| `theme` | `auto` \| `light` \| `dark` | `auto` | `auto` follows the visitor's OS/browser dark-mode preference and updates live if they change it mid-visit. Set explicitly if you want the widget to always match your site's fixed theme regardless of the visitor's system setting. |
| `locale` | any BCP-47 locale, e.g. `de-DE`, `fr-FR` | `en-US` | Controls date formatting ("Jan 1, 2027" vs. locale-appropriate equivalents) and number formatting for salary figures. |
| `heading-level` | `h1`–`h6` | `h2` | The HTML heading level used for the company name. Defaults to `h2` deliberately — using `h1` would compete with your page's own main heading and confuse both SEO and screen-reader users about page structure. Only go lower than `h2` if the widget is nested inside a section that's already under an `h2`. |
| `inherit-font` | `true` | `false` (isolated, uses a system font stack) | Opt-in only. By default the widget's typography is fully isolated from your site (that's the point of Shadow DOM) and uses a system font stack, not your site's font. Set this to `true` if you specifically want the widget's text to match your page's font — it inherits whatever `font-family` is active on the container's position in your page. |

### Existing before this round of hardening
`company-slug` and `primary-color` were the original two attributes; everything else above (`layout`, `max-jobs`, `department`, `apply-target`, `theme`, `locale`, `heading-level`, `inherit-font`) was added as part of production-readiness work — see [PLAN.md](PLAN.md).

---

## Auto-theming without any attributes

Beyond the explicit attributes above, the widget can pick up colors automatically from your page's own design system, with **zero configuration**, if your site already defines CSS custom properties. Set any of these on an ancestor of the widget's container (or on `:root` of your page):

```css
:root {
  --novara-primary: #0ea5e9;
  --novara-bg: transparent;
  --novara-text: #1e293b;
}
```

These inherit straight through the Shadow DOM boundary — no JavaScript glue needed on either side. Precedence, highest to lowest:

1. `data-primary-color` (or `?primaryColor=` on the iframe) — an explicit, deliberate override
2. The company's own brand color from the API (`theme_settings.primary_color`)
3. `--novara-primary` inherited from your page, if you've set it
4. The widget's built-in default (indigo)

This mechanism only covers `light`/`dark` (via `theme=auto`) and the primary accent color/background/text via the variables above — it does not attempt to guess your brand color by scanning your page's other elements. That kind of heuristic sampling was deliberately left out (see [PLAN.md](PLAN.md)) since it can grab the wrong element and produce a broken-looking widget; if you want an exact color match without setting `--novara-primary`, use `data-primary-color` instead.

---

## Generating an embed snippet for a new platform

The process is the same regardless of destination (WordPress, Wix, Webflow, a custom React app, plain HTML):

1. **Decide JS widget vs. iframe** using the comparison table at the top — driven mostly by whether the target platform's editor allows a `<script>` tag.
2. **Pick the company** (`company-slug` — required, everything else is optional).
3. **Pick any customization** from the attribute table — most embeds only need `company-slug` and maybe `primary-color`; the rest exist for specific cases (a department-specific page, a grid layout for a wide page section, RTL/locale needs, etc.).
4. **Assemble the snippet:**

   JS widget:
   ```html
   <div class="novara-careers"
        data-company-slug="<slug>"
        data-layout="grid"
        data-department="eng"
        data-theme="dark">
   </div>
   <script src="https://<your-cdn>/widget.js"></script>
   ```

   Iframe — same options, as query params:
   ```html
   <iframe
     src="https://<your-cdn>/index.html?companySlug=<slug>&layout=grid&department=eng&theme=dark"
     width="100%" height="800"
     style="border:none;border-radius:12px;overflow:hidden;"
     title="Careers" loading="lazy">
   </iframe>
   ```
5. **Hand the snippet to the customer** with a one-line note on where to paste it (a "Custom HTML" block, a Wix Embed Code widget, a raw HTML block in their site builder, etc.) — see the platform-specific steps in [README.md](README.md) for WordPress and Wix specifically.
6. **Confirm their embedding domain is registered** in the allowlist (see [DEPLOYMENT.md](DEPLOYMENT.md) Step 3) — otherwise they'll see "This site isn't authorized to display this career page" the moment they publish.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "Missing data-company-slug attribute" | Forgot the attribute (JS widget) or the `?companySlug=` query param (iframe) |
| "This site isn't authorized to display this career page" | The embedding domain isn't registered for that company yet — see [DEPLOYMENT.md](DEPLOYMENT.md) Step 3. If this shows up only inside a CMS's own editor preview (not the published page), it may be the sandboxed-preview `Origin: null` case, already handled on the mock API but worth confirming on the real one. |
| Widget never appears, no error either | Check the browser console for `[NOVARA]`-prefixed errors; also confirm the script tag's `src` actually resolves (typo'd CDN URL is the most common cause) |
| Company name/jobs are missing but no error shown | Check whether `usedStaleCache` kicked in — a small amber notice ("Showing cached results…") should appear if so; if there's no notice and no data, check the Network tab for the actual API response |
| Badge says "N of M" instead of the full count | Expected behavior when a company has more jobs than the fetch page size, or when `data-max-jobs` is set — not a bug |
| Location/deadline fields blank on some jobs | The API's field names for that job don't match what the widget expects (`city`/`country`/`deadline`) — see [DEPLOYMENT.md](DEPLOYMENT.md) Step 1's schema note |
| Colors look wrong / didn't apply | Check precedence order above — an explicit `data-primary-color` always wins; if you expected the company's brand color and it didn't show, check the API response's `theme_settings.primary_color` |
| Filter buttons don't seem to do anything | Should be fixed — if you're on an old cached copy of `widget.js`, force a hard refresh; this was a real bug during development (filtering set a `hidden` attribute that the widget's own stylesheet was silently overriding) |
