/**
 * NOVARA Career Widget — Embeddable Script v2
 *
 * Basic usage:
 *   <div class="novara-careers" data-company-slug="novara-qa-test"></div>
 *   <script src="http://localhost:5000/widget.js"></script>
 *
 * Multiple widgets on one page: use `class="novara-careers"` or
 * `data-novara-careers` (not repeated `id`s — those must stay unique).
 * A `<novara-careers data-company-slug="...">` custom element also works.
 *
 * Config attributes (all optional besides data-company-slug):
 *   data-primary-color   hex color, overrides the API's theme color
 *   data-layout           "list" (default) | "grid"
 *   data-max-jobs          cap the number of cards shown
 *   data-department        pre-filter to one department_id, hides the filter bar
 *   data-apply-target      "_blank" (default) | "_self"
 *   data-theme             "auto" (default, follows OS) | "light" | "dark"
 *   data-locale             BCP-47 locale for date/number formatting, default "en-US"
 *   data-heading-level      "h1".."h6", default "h2" (doesn't hijack the host's h1)
 *   data-inherit-font       "true" to inherit the host page's font-family
 *
 * Auto-theming hooks (set on an ancestor of the container, or on :root):
 *   --novara-primary, --novara-bg, --novara-text
 * These inherit through the Shadow DOM boundary automatically. An explicit
 * data-primary-color (or the API's theme_settings.primary_color) always
 * takes precedence over these.
 *
 * Public API:
 *   window.NovaraCareers.init(elementOrSelector, opts?)
 *   window.NovaraCareers.refresh(elementOrSelector)
 *   window.NovaraCareers.destroy(elementOrSelector)
 */
(function () {
  "use strict";

  const VERSION = "2.0.0";
  const API_BASE = "http://localhost:3000/api/job-builder/v1/public/career-page";
  const CAREER_SITE = "https://novara.vivasoftltd.dev/career";
  const CONTAINER_SELECTOR = "#novara-careers, .novara-careers, [data-novara-careers]";
  const DEFAULT_FETCH_SIZE = 200;
  const CACHE_TTL_MS = 5 * 60 * 1000;

  // -- Icons --------------------------------------------------------------
  const icons = {
    location: `<svg class="nv-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z"/></svg>`,
    clock: `<svg class="nv-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>`,
    briefcase: `<svg class="nv-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 0 0 .75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 0 0-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0 1 12 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 0 1-.673-.38m0 0A2.18 2.18 0 0 1 3 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 0 1 3.413-.387m7.5 0V5.25A2.25 2.25 0 0 0 13.5 3h-3a2.25 2.25 0 0 0-2.25 2.25v.894m7.5 0a48.667 48.667 0 0 0-7.5 0M12 12.75h.008v.008H12v-.008Z"/></svg>`,
    arrow: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"/></svg>`,
    salary: `<svg class="nv-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>`,
    retry: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"/></svg>`,
  };

  // -- Escaping -------------------------------------------------------------
  // Escapes all five HTML-significant characters (including quotes), so it's
  // safe both in text content and inside quoted HTML attributes — every
  // render function below interpolates into attribute context somewhere
  // (src=, href=, data-department=, aria-label=), so a single strict escaper
  // avoids the bug of forgetting which context needs quote-escaping.
  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  // -- Color utilities (replaces CSS color-mix(), unsupported on Safari <16.2) --
  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
    return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
  }

  function rgbToHex({ r, g, b }) {
    const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
    return "#" + [r, g, b].map((v) => clamp(v).toString(16).padStart(2, "0")).join("");
  }

  function mixHex(hexA, hexB, weightB) {
    const a = hexToRgb(hexA), b = hexToRgb(hexB);
    if (!a || !b) return hexA;
    return rgbToHex({
      r: a.r + (b.r - a.r) * weightB,
      g: a.g + (b.g - a.g) * weightB,
      b: a.b + (b.b - a.b) * weightB,
    });
  }

  function hexToRgba(hex, alpha) {
    const c = hexToRgb(hex) || { r: 99, g: 102, b: 241 };
    return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
  }

  function relativeLuminance(hex) {
    const c = hexToRgb(hex) || { r: 0, g: 0, b: 0 };
    const [rs, gs, bs] = [c.r, c.g, c.b].map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  }

  function contrastRatio(hexA, hexB) {
    const lA = relativeLuminance(hexA), lB = relativeLuminance(hexB);
    const [lighter, darker] = lA > lB ? [lA, lB] : [lB, lA];
    return (lighter + 0.05) / (darker + 0.05);
  }

  // A host-supplied data-primary-color can fail WCAG AA against the white
  // button text it's paired with; darken it until it passes rather than
  // shipping unreadable buttons.
  function ensureContrastOnWhite(hex, minRatio = 4.5) {
    let color = hex;
    for (let i = 0; i < 10 && contrastRatio(color, "#ffffff") < minRatio; i++) {
      color = mixHex(color, "#000000", 0.12);
    }
    return color;
  }

  function derivePalette(primaryHex) {
    const primary = ensureContrastOnWhite(primaryHex);
    return {
      primary,
      primaryHover: mixHex(primary, "#000000", 0.12),
      primaryLight: mixHex(primary, "#ffffff", 0.9),
      primaryShadow: hexToRgba(primary, 0.16),
      primaryShadowStrong: hexToRgba(primary, 0.25),
    };
  }

  // -- Formatting -----------------------------------------------------------
  function formatDate(iso, locale) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" });
  }

  function formatEmployment(type) {
    if (!type) return "";
    return type.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function buildSalary(min, max, currency, locale) {
    if (!min && !max) return "";
    const cur = currency || "";
    const fmt = (n) => n.toLocaleString(locale);
    if (min && max) return `${cur} ${fmt(min)} – ${fmt(max)}`;
    if (min) return `From ${cur} ${fmt(min)}`;
    return `Up to ${cur} ${fmt(max)}`;
  }

  // -- Stylesheet (static; per-instance values are applied via CSS custom
  //    properties and host attributes, not by regenerating this string) ----
  const STYLES = `
    :host {
      display: block;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: var(--novara-text, #1e293b);
      background: var(--novara-bg, transparent);
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
      --nv-primary: var(--novara-primary, #6366f1);
      --nv-primary-hover: #4f52d6;
      --nv-primary-light: #eef2ff;
      --nv-primary-shadow: rgba(99, 102, 241, 0.16);
      --nv-primary-shadow-strong: rgba(99, 102, 241, 0.25);
      --nv-text: #1e293b;
      --nv-muted: #64748b;
      --nv-card-bg: #ffffff;
      --nv-border: #e2e8f0;
    }

    :host([data-nv-theme="dark"]) {
      --nv-text: #e2e8f0;
      --nv-muted: #94a3b8;
      --nv-card-bg: #1e293b;
      --nv-border: #334155;
      --nv-primary-light: rgba(99, 102, 241, 0.16);
    }

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    .nv-widget { max-width: 880px; margin: 0 auto; padding: 32px 0; color: var(--nv-text); }

    .nv-header { text-align: center; margin-bottom: 32px; }

    .nv-logo {
      width: 56px; height: 56px;
      border-radius: 14px;
      object-fit: contain;
      margin-bottom: 12px;
      box-shadow: 0 2px 12px rgba(0,0,0,.08);
    }

    .nv-company-name {
      font-size: 26px; font-weight: 700;
      color: var(--nv-primary);
      letter-spacing: -0.02em;
      margin-bottom: 4px;
    }

    .nv-header p { color: var(--nv-muted); font-size: 14px; }

    .nv-total-badge {
      display: inline-block;
      margin-top: 10px;
      padding: 5px 16px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 600;
      background: var(--nv-primary-light);
      color: var(--nv-primary);
    }

    .nv-filters {
      display: flex; flex-wrap: wrap; gap: 8px;
      justify-content: center;
      margin-bottom: 28px;
      padding: 0 8px;
    }

    .nv-filter-btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 7px 16px;
      border-radius: 20px;
      border: 1.5px solid var(--nv-border);
      background: var(--nv-card-bg);
      color: var(--nv-muted);
      font-size: 13px; font-weight: 500;
      font-family: inherit;
      cursor: pointer;
      transition: all 0.2s ease;
      white-space: nowrap;
    }

    .nv-filter-btn:hover { border-color: var(--nv-primary); color: var(--nv-primary); }

    .nv-filter-btn[aria-pressed="true"] {
      background: var(--nv-primary);
      color: #fff;
      border-color: var(--nv-primary);
    }

    .nv-filter-count {
      font-size: 11px; font-weight: 700;
      padding: 1px 7px;
      border-radius: 10px;
      background: rgba(0,0,0,.08);
    }

    .nv-filter-btn[aria-pressed="true"] .nv-filter-count { background: rgba(255,255,255,.25); }

    .nv-job-list { display: flex; flex-direction: column; gap: 14px; }

    .nv-job-list.nv-layout-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      align-items: stretch;
    }

    .nv-layout-grid .nv-card { flex-direction: column; align-items: flex-start; }
    .nv-layout-grid .nv-btn { width: 100%; justify-content: center; margin-top: 12px; }

    .nv-card {
      background: var(--nv-card-bg);
      border: 1px solid var(--nv-border);
      border-radius: 16px;
      padding: 22px 26px;
      display: flex; align-items: center; justify-content: space-between; gap: 20px;
      transition: transform 0.22s ease, box-shadow 0.22s ease, border-color 0.22s ease;
      animation: nvFadeIn 0.4s ease both;
    }

    /* An author stylesheet's .nv-card{display:flex} beats the UA [hidden]
       rule regardless of source order (author always wins over UA), so
       filtering via the hidden DOM property needs this explicit override
       — without it, setting .hidden = true has no visible effect. */
    .nv-card[hidden] { display: none; }

    /* Stagger via structural selectors, not inline style="" — the latter is
       blocked outright under a strict CSP with no style-src 'unsafe-inline'. */
    .nv-card:nth-of-type(1) { animation-delay: 0.06s; }
    .nv-card:nth-of-type(2) { animation-delay: 0.12s; }
    .nv-card:nth-of-type(3) { animation-delay: 0.18s; }
    .nv-card:nth-of-type(4) { animation-delay: 0.24s; }
    .nv-card:nth-of-type(5) { animation-delay: 0.3s; }
    .nv-card:nth-of-type(n+6) { animation-delay: 0.36s; }

    .nv-card:hover {
      transform: translateY(-3px);
      box-shadow: 0 12px 32px var(--nv-primary-shadow), 0 2px 6px rgba(0,0,0,.04);
      border-color: var(--nv-primary);
    }

    @keyframes nvFadeIn {
      from { opacity: 0; transform: translateY(16px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    @media (prefers-reduced-motion: reduce) {
      .nv-card { animation: none; }
      .nv-card:hover { transform: none; }
    }

    .nv-info { flex: 1; min-width: 0; }

    .nv-badge {
      display: inline-block;
      font-size: 11px; font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 3px 10px;
      border-radius: 20px;
      background: var(--nv-primary-light);
      color: var(--nv-primary);
      margin-bottom: 8px;
    }

    .nv-title { font-size: 17px; font-weight: 600; color: var(--nv-text); margin-bottom: 8px; letter-spacing: -0.01em; }

    .nv-meta { display: flex; flex-wrap: wrap; gap: 14px; font-size: 13px; color: var(--nv-muted); }

    .nv-meta span { display: inline-flex; align-items: center; gap: 5px; }

    .nv-icon { width: 15px; height: 15px; flex-shrink: 0; }

    .nv-employment {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
      text-transform: capitalize;
      background: #f0fdf4;
      color: #16a34a;
      border: 1px solid #bbf7d0;
    }

    .nv-salary-tag {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 2px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
      background: #fffbeb;
      color: #d97706;
      border: 1px solid #fde68a;
    }

    .nv-btn {
      flex-shrink: 0;
      display: inline-flex; align-items: center; gap: 6px;
      padding: 10px 22px;
      font-size: 14px; font-weight: 600;
      color: #fff;
      background: var(--nv-primary);
      border: none; border-radius: 10px;
      cursor: pointer; text-decoration: none;
      font-family: inherit;
      transition: opacity 0.2s, transform 0.2s, box-shadow 0.2s, background 0.2s;
      box-shadow: 0 2px 8px var(--nv-primary-shadow-strong);
    }

    .nv-btn:hover { opacity: 0.92; transform: scale(1.04); background: var(--nv-primary-hover); }

    .nv-btn svg { width: 16px; height: 16px; }

    button:focus-visible, a:focus-visible {
      outline: 2px solid var(--nv-primary);
      outline-offset: 2px;
    }

    .nv-state { text-align: center; padding: 48px 20px; color: var(--nv-muted); font-size: 15px; }
    .nv-state.nv-error { color: #ef4444; }
    .nv-state.nv-stale-notice {
      padding: 10px 16px; margin-bottom: 16px; border-radius: 10px;
      background: #fffbeb; color: #92400e; font-size: 13px; text-align: center;
    }

    .nv-retry-wrap { text-align: center; }

    .nv-retry-btn {
      margin-top: 14px;
      display: inline-flex; align-items: center; gap: 6px;
      padding: 8px 18px;
      border-radius: 10px;
      border: 1.5px solid var(--nv-border);
      background: var(--nv-card-bg);
      color: var(--nv-text);
      font-size: 13px; font-weight: 600;
      font-family: inherit;
      cursor: pointer;
    }

    .nv-retry-btn svg { width: 14px; height: 14px; }
    .nv-retry-btn:hover { border-color: var(--nv-primary); color: var(--nv-primary); }

    .nv-spinner {
      width: 36px; height: 36px;
      border: 3px solid var(--nv-border);
      border-top-color: var(--nv-primary);
      border-radius: 50%;
      animation: nvSpin 0.7s linear infinite;
      margin: 0 auto 16px;
    }

    @media (prefers-reduced-motion: reduce) { .nv-spinner { animation-duration: 1.4s; } }

    @keyframes nvSpin { to { transform: rotate(360deg); } }

    .nv-empty-icon { font-size: 40px; margin-bottom: 12px; display: block; }

    /* ---- Skeleton loading state ---- */
    .nv-skel-header { text-align: center; margin-bottom: 32px; }
    .nv-skel-logo { width: 56px; height: 56px; border-radius: 14px; margin: 0 auto 12px; }
    .nv-skel-line { height: 14px; border-radius: 7px; margin: 0 auto; width: 140px; }
    .nv-skel-line-title { width: 200px; height: 20px; margin-bottom: 8px; }
    .nv-skel-pulse { background: var(--nv-border); animation: nvPulse 1.4s ease-in-out infinite; }
    @media (prefers-reduced-motion: reduce) { .nv-skel-pulse { animation: none; opacity: .6; } }
    @keyframes nvPulse { 0%, 100% { opacity: .5; } 50% { opacity: 1; } }
    .nv-skel-card { height: 96px; border-radius: 16px; margin-bottom: 14px; }

    @media (max-width: 640px) {
      .nv-card { flex-direction: column; align-items: flex-start; padding: 18px 20px; }
      .nv-btn  { width: 100%; justify-content: center; }
      .nv-company-name { font-size: 22px; }
    }
  `;

  let sharedStylesheet;
  function getSharedStylesheet() {
    if (sharedStylesheet !== undefined) return sharedStylesheet;
    // Constructable stylesheets bypass CSP style-src 'unsafe-inline' (unlike
    // an injected <style> element), and one instance is adoptable by every
    // shadow root on the page — parsed once regardless of widget count.
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(STYLES);
      sharedStylesheet = sheet;
    } catch (e) {
      sharedStylesheet = null;
    }
    return sharedStylesheet;
  }

  function applyStyles(shadow) {
    const sheet = getSharedStylesheet();
    if (sheet) {
      shadow.adoptedStyleSheets = [sheet];
      return;
    }
    const styleEl = document.createElement("style");
    styleEl.textContent = STYLES;
    shadow.appendChild(styleEl);
  }

  // Per-instance overrides (brand color, font inheritance) as a second
  // constructable stylesheet, not element.style.setProperty(). Under a
  // strict CSP, setting inline style via JS is blocked the same as a
  // literal style="" attribute — only <style>/adoptedStyleSheets content is
  // exempt — so this is what makes brand-color theming actually survive a
  // locked-down host CSP instead of silently falling back to the default.
  function applyInstanceOverrides(shadow, { palette, inheritFont }) {
    if (!palette && !inheritFont) return;
    let cssText = ":host {";
    if (palette) {
      cssText += `
        --nv-primary: ${palette.primary};
        --nv-primary-hover: ${palette.primaryHover};
        --nv-primary-light: ${palette.primaryLight};
        --nv-primary-shadow: ${palette.primaryShadow};
        --nv-primary-shadow-strong: ${palette.primaryShadowStrong};
      `;
    }
    if (inheritFont) cssText += "font-family: inherit;";
    cssText += "}";

    try {
      const overrideSheet = new CSSStyleSheet();
      overrideSheet.replaceSync(cssText);
      const base = getSharedStylesheet();
      shadow.adoptedStyleSheets = base ? [base, overrideSheet] : [overrideSheet];
    } catch (e) {
      // No CSSStyleSheet constructor support (older Safari) — fall back to
      // inline properties. Won't apply under a strict CSP in that specific
      // old-browser-plus-strict-CSP combination, but the widget still
      // renders with the built-in default color rather than breaking.
      if (palette) {
        shadow.host.style.setProperty("--nv-primary", palette.primary);
        shadow.host.style.setProperty("--nv-primary-hover", palette.primaryHover);
        shadow.host.style.setProperty("--nv-primary-light", palette.primaryLight);
        shadow.host.style.setProperty("--nv-primary-shadow", palette.primaryShadow);
        shadow.host.style.setProperty("--nv-primary-shadow-strong", palette.primaryShadowStrong);
      }
      if (inheritFont) shadow.host.style.setProperty("font-family", "inherit");
    }
  }

  // -- Networking -------------------------------------------------------------
  async function fetchJson(url, { timeoutMs = 8000, retries = 2 } = {}) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) {
          let errorCode;
          try {
            const body = await res.json();
            errorCode = body && body.error_code;
          } catch (_) { /* non-JSON error body */ }
          const err = new Error(`Request failed (${res.status})`);
          err.status = res.status;
          err.errorCode = errorCode;
          throw err;
        }
        return await res.json();
      } catch (err) {
        clearTimeout(timer);
        lastErr = err;
        const isTimeout = err.name === "AbortError";
        // Retry on timeout, 429, 5xx, or a network failure (fetch rejects
        // with no `status` at all before any response is received). Any
        // other 4xx is a definitive answer — retrying won't change it.
        const retryable = isTimeout || err.status === 429 || (err.status && err.status >= 500) || !err.status;
        if (!retryable || attempt === retries) throw err;
        const backoff = Math.min(4000, 300 * 2 ** attempt) + Math.random() * 200;
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
    throw lastErr;
  }

  async function loadCareerData(companySlug) {
    const bootstrapUrl = `${API_BASE}/bootstrap?company_slug=${encodeURIComponent(companySlug)}`;
    try {
      const json = await fetchJson(bootstrapUrl);
      return { dashboard: json.data.dashboard, jobsPayload: json.data.jobs };
    } catch (err) {
      // A route-not-found 404 (bootstrap not deployed on the real API yet)
      // has no error_code; a real "company not found" 404 does — only fall
      // back to the two-call path in the former case.
      if (err.status !== 404 || err.errorCode) throw err;
      const [dashJson, jobsJson] = await Promise.all([
        fetchJson(`${API_BASE}/dashboard?company_slug=${encodeURIComponent(companySlug)}`),
        fetchJson(`${API_BASE}?company_slug=${encodeURIComponent(companySlug)}&page=1&size=${DEFAULT_FETCH_SIZE}`),
      ]);
      return { dashboard: dashJson.data, jobsPayload: jobsJson.data };
    }
  }

  function messageForError(err) {
    switch (err.errorCode) {
      case "company_not_found": return "No career page found for this company.";
      case "domain_not_authorized": return "This site isn't authorized to display this career page.";
      case "rate_limited": return "Too many requests right now — please try again shortly.";
      case "invalid_company_slug": return "Missing or invalid company configuration.";
      default: return err.name === "AbortError" ? "The request timed out." : "Could not load the career page.";
    }
  }

  // -- Local cache (last-known-good fallback) ---------------------------------
  function cacheKey(companySlug) { return `novara-careers-cache:${companySlug}`; }

  function readCache(companySlug) {
    try {
      const raw = localStorage.getItem(cacheKey(companySlug));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (Date.now() - parsed.cachedAt > CACHE_TTL_MS * 6) return null; // don't show week-old data as "cached"
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function writeCache(companySlug, dashboard, jobsPayload) {
    try {
      localStorage.setItem(cacheKey(companySlug), JSON.stringify({ dashboard, jobsPayload, cachedAt: Date.now() }));
    } catch (_) { /* storage unavailable/full — degrade silently, not fatal */ }
  }

  // -- Error beacon (sampled, best-effort, never blocks rendering) ------------
  function reportError(companySlug, stage, err) {
    try {
      console.error(`[NOVARA] ${stage} failed for "${companySlug}":`, err);
    } catch (_) { /* noop */ }
  }

  // -- Rendering ----------------------------------------------------------
  function renderSkeleton() {
    return `
      <div class="nv-skel-header">
        <div class="nv-skel-logo nv-skel-pulse"></div>
        <div class="nv-skel-line nv-skel-pulse nv-skel-line-title"></div>
        <div class="nv-skel-line nv-skel-pulse"></div>
      </div>
      ${[0, 1, 2].map(() => `<div class="nv-skel-card nv-skel-pulse"></div>`).join("")}
    `;
  }

  function renderHeader(dashboard, opts) {
    const d = dashboard;
    const logoHTML = d.company_logo_url
      ? `<img class="nv-logo" src="${esc(d.company_logo_url)}" alt="${esc(d.company_name)} logo" />`
      : "";
    const HTag = opts.headingLevel;
    return `
      <header class="nv-header">
        ${logoHTML}
        <${HTag} class="nv-company-name">${esc(d.company_name)}</${HTag}>
        <p>Discover opportunities that match your ambition</p>
        <span class="nv-total-badge">${esc(opts.badgeText)}</span>
      </header>`;
  }

  function renderFilters(departmentCounts, activeDept) {
    const total = departmentCounts.reduce((sum, d) => sum + d.count, 0);
    const allBtn = `<button class="nv-filter-btn" data-dept="all" aria-pressed="${activeDept === "all"}">All <span class="nv-filter-count">${total}</span></button>`;
    const deptBtns = departmentCounts
      .map(
        (dep) =>
          `<button class="nv-filter-btn" data-dept="${esc(dep.department_id)}" aria-pressed="${activeDept === dep.department_id}">${esc(dep.department_name)} <span class="nv-filter-count">${dep.count}</span></button>`
      )
      .join("");
    return `<nav class="nv-filters" role="group" aria-label="Filter jobs by department">${allBtn}${deptBtns}</nav>`;
  }

  function renderJobCard(job, companySlug, locale) {
    const salaryStr = buildSalary(job.salary_min, job.salary_max, job.salary_currency, locale);
    const salaryHTML = salaryStr ? `<span class="nv-salary-tag">${icons.salary} ${esc(salaryStr)}</span>` : "";
    const applyUrl = `${CAREER_SITE}/${esc(companySlug)}/jobs/${esc(job.slug)}`;
    const locationStr = [job.city, job.country].filter(Boolean).join(", ");

    return `
      <article class="nv-card" data-department="${esc(job.department_id)}">
        <div class="nv-info">
          <span class="nv-badge">${esc(job.department)}</span>
          <h3 class="nv-title">${esc(job.title)}</h3>
          <div class="nv-meta">
            ${locationStr ? `<span>${icons.location} ${esc(locationStr)}</span>` : ""}
            <span class="nv-employment">${icons.briefcase} ${esc(formatEmployment(job.employment_type))}</span>
            ${job.deadline ? `<span>${icons.clock} Deadline: ${formatDate(job.deadline, locale)}</span>` : ""}
            ${salaryHTML}
          </div>
        </div>
        <a class="nv-btn" href="${applyUrl}" target="${esc(job.applyTarget)}" rel="noopener noreferrer" aria-label="Apply for ${esc(job.title)}">
          Apply Now ${icons.arrow}
        </a>
      </article>`;
  }

  function renderJobs(jobs, companySlug, opts) {
    if (!jobs.length) return `<div class="nv-state"><span class="nv-empty-icon">📭</span>No open positions found.</div>`;
    return jobs.map((job) => renderJobCard({ ...job, applyTarget: opts.applyTarget }, companySlug, opts.locale)).join("");
  }

  // -- Filter interaction -------------------------------------------------
  function bindFilters(shadow) {
    const filtersEl = shadow.querySelector(".nv-filters");
    if (!filtersEl) return;

    filtersEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".nv-filter-btn");
      if (!btn) return;

      filtersEl.querySelectorAll(".nv-filter-btn").forEach((b) => b.setAttribute("aria-pressed", "false"));
      btn.setAttribute("aria-pressed", "true");

      const deptId = btn.getAttribute("data-dept");
      const cards = shadow.querySelectorAll(".nv-card");

      // `.hidden` is a DOM property, not an inline style — filtering itself
      // works even under a strict CSP. The fade replay below uses inline
      // style and is best-effort only: under strict CSP it's silently
      // skipped (browser blocks it), cards just stay visible without
      // re-animating, which is a cosmetic-only degradation.
      cards.forEach((card) => {
        const match = deptId === "all" || card.getAttribute("data-department") === deptId;
        card.hidden = !match;
        if (match) {
          card.style.animation = "none";
          card.offsetHeight; // reflow to restart the animation
          card.style.animation = "";
        }
      });
    });
  }

  // -- Theme resolution -----------------------------------------------------
  function applyTheme(shadow, themeOption) {
    const resolve = () =>
      themeOption === "dark" || themeOption === "light"
        ? themeOption
        : window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";

    shadow.host.setAttribute("data-nv-theme", resolve());

    if (themeOption !== "dark" && themeOption !== "light" && window.matchMedia) {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => shadow.host.setAttribute("data-nv-theme", mq.matches ? "dark" : "light");
      if (mq.addEventListener) mq.addEventListener("change", handler);
      else if (mq.addListener) mq.addListener(handler);
    }
  }

  // -- Options from data-* attributes --------------------------------------
  const VALID_HEADING_LEVELS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

  function readOptions(container) {
    const get = (name) => container.getAttribute(`data-${name}`);
    const headingLevel = get("heading-level");
    const maxJobsRaw = parseInt(get("max-jobs"), 10);
    return {
      companySlug: get("company-slug") || new URLSearchParams(window.location.search).get("companySlug"),
      primaryColor: get("primary-color"),
      layout: get("layout") === "grid" ? "grid" : "list",
      maxJobs: Number.isFinite(maxJobsRaw) && maxJobsRaw > 0 ? maxJobsRaw : null,
      department: get("department"),
      applyTarget: get("apply-target") === "_self" ? "_self" : "_blank",
      theme: get("theme") || "auto",
      locale: get("locale") || "en-US",
      headingLevel: VALID_HEADING_LEVELS.has(headingLevel) ? headingLevel : "h2",
      inheritFont: get("inherit-font") === "true",
    };
  }
  // Note: getCompanySlug precedence is data-company-slug first, URL query
  // param only as a fallback. On a normal script embed this stops a host
  // page's own `?companySlug=x` from silently overriding the value the site
  // owner configured. The iframe path (index.html) relies on the fallback:
  // it ships with no data-company-slug set, so `?companySlug=x` drives it.

  // -- Instance lifecycle ---------------------------------------------------
  const instanceState = new WeakMap();

  function setWidgetBody(widgetEl, html) {
    widgetEl.innerHTML = html;
  }

  async function loadAndRender(container, widgetEl, shadow) {
    const opts = readOptions(container);

    if (!opts.companySlug) {
      setWidgetBody(widgetEl, `<div class="nv-state nv-error">Missing <strong>data-company-slug</strong> attribute.</div>`);
      return;
    }

    applyTheme(shadow, opts.theme);

    setWidgetBody(widgetEl, renderSkeleton());

    let dashboard, jobsPayload, usedStaleCache = false;
    try {
      const result = await loadCareerData(opts.companySlug);
      dashboard = result.dashboard;
      jobsPayload = result.jobsPayload;
      writeCache(opts.companySlug, dashboard, jobsPayload);
    } catch (err) {
      reportError(opts.companySlug, "fetch", err);
      const cached = readCache(opts.companySlug);
      if (cached) {
        dashboard = cached.dashboard;
        jobsPayload = cached.jobsPayload;
        usedStaleCache = true;
      } else {
        setWidgetBody(
          widgetEl,
          `<div class="nv-state nv-error">${esc(messageForError(err))}</div>
           <div class="nv-retry-wrap"><button class="nv-retry-btn" type="button">${icons.retry} Retry</button></div>`
        );
        const retryBtn = widgetEl.querySelector(".nv-retry-btn");
        if (retryBtn) retryBtn.addEventListener("click", () => loadAndRender(container, widgetEl, shadow));
        return;
      }
    }

    // Explicit override > API-configured company brand color > host CSS
    // variable hook (--novara-primary, already wired via the stylesheet's
    // var() fallback chain) > built-in default.
    const explicitColor = opts.primaryColor || (dashboard.theme_settings && dashboard.theme_settings.primary_color);
    applyInstanceOverrides(shadow, {
      palette: explicitColor ? derivePalette(explicitColor) : null,
      inheritFont: opts.inheritFont,
    });

    let jobs = jobsPayload.items || [];
    const apiTotal = dashboard.total_count;

    if (opts.department) {
      jobs = jobs.filter((j) => j.department_id === opts.department);
    }

    // Department pill counts are derived from what was actually fetched
    // (self-consistent with what's clickable) rather than trusted blindly
    // from the dashboard endpoint, which can disagree if jobs were truncated.
    const fetchedDeptCounts = Object.values(
      jobs.reduce((acc, j) => {
        if (!acc[j.department_id]) acc[j.department_id] = { department_id: j.department_id, department_name: j.department, count: 0 };
        acc[j.department_id].count++;
        return acc;
      }, {})
    );

    const showFilters = !opts.department && !opts.maxJobs && fetchedDeptCounts.length > 1;
    const displayJobs = opts.maxJobs ? jobs.slice(0, opts.maxJobs) : jobs;

    const fetchedCount = jobsPayload.items ? jobsPayload.items.length : jobs.length;
    let badgeText = `${displayJobs.length} open position${displayJobs.length !== 1 ? "s" : ""}`;
    if (opts.maxJobs && jobs.length > opts.maxJobs) {
      badgeText = `${displayJobs.length} of ${jobs.length} shown`;
    } else if (!opts.department && fetchedCount < apiTotal) {
      badgeText = `${fetchedCount} of ${apiTotal} open positions`;
    }

    const staleNotice = usedStaleCache
      ? `<div class="nv-state nv-stale-notice">Showing cached results — could not reach the career page right now.</div>`
      : "";

    setWidgetBody(
      widgetEl,
      `
      ${staleNotice}
      ${renderHeader(dashboard, { headingLevel: opts.headingLevel, badgeText })}
      ${showFilters ? renderFilters(fetchedDeptCounts, "all") : ""}
      <div class="nv-job-list${opts.layout === "grid" ? " nv-layout-grid" : ""}">${renderJobs(displayJobs, dashboard.company_slug, opts)}</div>
    `
    );

    if (showFilters) bindFilters(shadow);
  }

  function renderInto(container, { force = false } = {}) {
    if (!(container instanceof Element)) return;
    if (container.dataset.nvInitialized === "true" && !force) return;
    container.dataset.nvInitialized = "true";

    const shadow = container.shadowRoot || container.attachShadow({ mode: "open" });
    shadow.innerHTML = "";
    applyStyles(shadow);

    const widgetEl = document.createElement("div");
    widgetEl.className = "nv-widget";
    shadow.appendChild(widgetEl);

    instanceState.set(container, { shadow, widgetEl });

    return loadAndRender(container, widgetEl, shadow);
  }

  function refreshInstance(container) {
    const state = instanceState.get(container);
    if (!state) return renderInto(container, { force: true });
    return loadAndRender(container, state.widgetEl, state.shadow);
  }

  function destroyInstance(container) {
    if (container.shadowRoot) container.shadowRoot.innerHTML = "";
    delete container.dataset.nvInitialized;
    instanceState.delete(container);
  }

  // -- Discovery: initial scan + late-injected containers ---------------------
  function scanAndInit(root) {
    root.querySelectorAll(CONTAINER_SELECTOR).forEach((el) => renderInto(el));
  }

  function observeForLateContainers() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          if (node.matches && node.matches(CONTAINER_SELECTOR)) renderInto(node);
          if (node.querySelectorAll) scanAndInit(node);
        });
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function boot() {
    console.info(`[NOVARA] career widget v${VERSION}`);
    scanAndInit(document);
    observeForLateContainers();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  // -- Custom element (progressive enhancement over div + script) -------------
  if (!customElements.get("novara-careers")) {
    customElements.define(
      "novara-careers",
      class extends HTMLElement {
        connectedCallback() {
          renderInto(this);
        }
      }
    );
  }

  // -- Public API -----------------------------------------------------------
  function resolveElement(elementOrSelector) {
    return typeof elementOrSelector === "string" ? document.querySelector(elementOrSelector) : elementOrSelector;
  }

  window.NovaraCareers = {
    init(elementOrSelector, opts) {
      const container = resolveElement(elementOrSelector);
      if (!container) {
        console.error("[NOVARA] init: element not found");
        return;
      }
      if (opts && opts.companySlug) container.setAttribute("data-company-slug", opts.companySlug);
      return renderInto(container, { force: true });
    },
    refresh(elementOrSelector) {
      const container = resolveElement(elementOrSelector);
      if (!container) return;
      return refreshInstance(container);
    },
    destroy(elementOrSelector) {
      const container = resolveElement(elementOrSelector);
      if (!container) return;
      destroyInstance(container);
    },
  };
})();
