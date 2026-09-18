## Final decision: a loader script that injects an iframe

A pure widget and a pure iframe each have one weak spot. Combining them removes both.


| Concern                                                    | Pure widget                             | Pure iframe         | **Loader + iframe (chosen)** |
| ---------------------------------------------------------- | --------------------------------------- | ------------------- | ---------------------------- |
| Owner pastes one snippet                                   | ✅                                       | ✅                   | ✅                            |
| Auto height, no scrollbars                                 | ✅                                       | ❌                   | ✅                            |
| Candidate data isolated from WordPress plugins and scripts | ❌ (any WP plugin could read the inputs) | ✅                   | ✅                            |
| Only your domain can host the form                         | Weak (CORS only)                        | ✅ (frame-ancestors) | ✅                            |
| No CORS, simpler CSRF and captcha                          | ❌                                       | ✅                   | ✅                            |
| Fix bugs without the owner doing anything                  | ✅                                       | ✅                   | ✅                            |


The loader is about 30 lines of JavaScript that finds the placeholder, creates an iframe pointing to your main site, and resizes it. Everything sensitive (form, captcha, upload, submission) lives inside the iframe, on your main site's domain. The WordPress site never touches the candidate's data.

We also provide an **iframe-only fallback snippet** in case the owner's WordPress setup strips scripts.

## 1. Architecture overview

```
vivasoftltd.com (WordPress)                     main.com (your main job site)
┌─────────────────────────────┐                ┌──────────────────────────────────────┐
│ Job page (owner-made)       │  loads         │ /embed/v1/loader.js                  │
│  <div class="vs-apply" ...> │ ─────────────► │                                      │
│  <script loader.js>         │                │ /embed/v1/apply/{jobId}  (form page) │
│   └─ <iframe> ──────────────┼──────────────► │   CSP frame-ancestors = allowed site │
│        form + captcha       │  POST (same    │ POST /embed/v1/applications          │
│        + resume upload      │  origin inside │   → pending user + pending app       │
│   ◄─ postMessage (height,   │  the iframe)   │   → claim / confirm email            │
│      "submitted" event)     │                │ /claim, /confirm-application         │
└─────────────────────────────┘                └──────────────────────────────────────┘
```



## 2. What the WordPress owner does (the whole job)

1. Log in to the main site dashboard, open the job, and click **"Get embed code."**
2. In WordPress, edit the job page and remove the old "Send Us Your Resume" form.
3. Add a **Custom HTML** block (Gutenberg) or an **HTML** widget (Elementor) in the same place.
4. Paste the code, then click Update.
5. Open the page in a private window and check that the form appears.

That's all. Everything else is your team's work, described below.

## 3. The embed code

**Main snippet:**

```html
<div class="vs-apply" data-job="1234" data-site="pk_live_8f3k2..." data-theme="dark"></div>
<script src="https://main.com/embed/v1/loader.js" async></script>
```

- `data-job` is the job ID on the main site.
- `data-site` is a **public site key**. It is not a secret. It identifies which registered website is embedding the form, and it only works from that website's domains.
- `data-theme` can be `dark` or `light`, so the form matches the dark card on the current page.

**Fallback snippet** (if scripts get removed):

```html
<iframe src="https://main.com/embed/v1/apply/1234?site=pk_live_8f3k2...&theme=dark"
        title="Job application form" style="width:100%;height:900px;border:0" loading="lazy"></iframe>
```



## 4. Main site: components to build



### 4.1 Embed site registry (dashboard)

Each website allowed to embed forms gets a record:


| Field                      | Example                                                  |
| -------------------------- | -------------------------------------------------------- |
| `site_key` (public)        | `pk_live_8f3k2...`                                       |
| `name`                     | Vivasoft Website                                         |
| `allowed_origins`          | `https://vivasoftltd.com`, `https://www.vivasoftltd.com` |
| `status`                   | active / disabled (a kill switch)                        |
| `created_by`, `created_at` | audit trail                                              |


Add both the www and non-www origins, plus any staging domain if they have one.

### 4.2 Per-job settings

- A **"Allow embedding on website"** toggle. It's off by default, so only jobs you choose can be embedded.
- A **"Get embed code"** button that generates the snippet with the correct job ID and site key.



### 4.3 Endpoints


| Endpoint                                     | Purpose                                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| `GET /embed/v1/loader.js`                    | The loader script. Short cache (about 5 minutes) so fixes reach every page quickly. |
| `GET /embed/v1/apply/{jobId}?site=…&theme=…` | The form page shown inside the iframe.                                              |
| `POST /embed/v1/applications`                | Receives the submission from inside the iframe.                                     |
| `POST /embed/v1/resend`                      | Resends the claim or confirm email (rate-limited).                                  |
| `GET /claim?token=…`                         | New candidate activates the account.                                                |
| `GET /confirm-application?token=…`           | Existing user confirms the application.                                             |




### 4.4 Database

```
embed_sites:    id, site_key, name, allowed_origins[], status, created_at
jobs:           + embed_enabled (bool)
users:          + status (pending | active), email_verified_at, signup_source
applications:   id, job_id, user_id, embed_site_id, status, source_page, utm_json,
                consent_text_version, consent_at, consent_ip, resume_file_id, created_at
resume_files:   id, storage_key, original_name, mime, size, sha256,
                scan_status (pending | clean | infected), created_at
action_tokens:  id, user_id, application_id, purpose (claim | confirm),
                token_hash, expires_at, used_at, created_at
```



### 4.5 Application states

```
New email:       pending_verification ──(claim link used)──► submitted
Existing email:  pending_confirmation ──(login + confirm)──► submitted
Either:          ──(no action in 30 days)──► expired → data deleted
Either:          ──(spam/malware detected)──► rejected_security
```

Recruiters see only `submitted` applications by default, with an optional filter to see pending ones.

## 5. The loader script (`loader.js`)

```js
(function () {
  var ORIGIN = 'https://main.com';
  document.querySelectorAll('.vs-apply:not([data-vs-ready])').forEach(function (el) {
    el.setAttribute('data-vs-ready', '1');
    var job = (el.dataset.job || '').replace(/[^0-9a-zA-Z_-]/g, '');
    var q = new URLSearchParams({
      site: el.dataset.site || '', theme: el.dataset.theme === 'dark' ? 'dark' : 'light',
      utm: location.search.slice(1, 500), page: location.origin + location.pathname
    });
    var f = document.createElement('iframe');
    f.src = ORIGIN + '/embed/v1/apply/' + encodeURIComponent(job) + '?' + q;
    f.title = 'Job application form';
    f.style.cssText = 'width:100%;border:0;min-height:520px;display:block';
    f.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox');
    f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    el.appendChild(f);
    window.addEventListener('message', function (e) {
      if (e.origin !== ORIGIN || e.source !== f.contentWindow || !e.data) return;
      if (e.data.type === 'vs:height') f.style.height = Math.min(Math.max(+e.data.value || 0, 300), 3000) + 'px';
      if (e.data.type === 'vs:submitted') (window.dataLayer = window.dataLayer || []).push({ event: 'job_application_submitted', job_id: job });
    });
  });
})();
```

**Rules for the loader:**

- It never handles personal data. It only passes the job ID, site key, theme, UTM parameters and page URL.
- It accepts messages only from your origin **and** only from its own iframe.
- It clamps the height to 300–3000px, so a bad message can't break the page layout.
- The sandbox limits what the iframe can do. `allow-same-origin` is safe here because the iframe is cross-origin to the parent page.
- It is written in plain ES5-style JavaScript, which works with any theme and needs no dependencies.



## 6. The form page (inside the iframe)



### 6.1 On load, the server checks

1. The `site` key exists and is active. Otherwise, show a neutral "Form unavailable" page.
2. The job exists, is open, and has `embed_enabled = true`. Otherwise, show "This position is closed" with a link to the careers page.
3. It sends the header `Content-Security-Policy: frame-ancestors <allowed_origins of this site>`. The browser then refuses to display the form on any other website. **This is your main anti-abuse control.**
4. It renders a **signed form token**: an HMAC of `{site_id, job_id, issued_at, nonce}`. It proves the submission came from a form you served, blocks CSRF, and enables a "too fast = bot" check.



### 6.2 Form fields


| Field               | Validation                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------- |
| Full name           | Required, 2–100 characters, letters, spaces, `.'-`                                            |
| Email               | Required, valid format, lowercased; optionally reject disposable-email domains                |
| Years of experience | Required, a number from 0–50                                                                  |
| Resume              | Required, PDF/DOC/DOCX, 5 MB or less                                                          |
| Consent checkbox    | Required: "I agree to Vivasoft processing my data for recruitment" plus a privacy policy link |
| Honeypot field      | Hidden; if it's filled, it's a bot                                                            |
| Captcha             | Cloudflare Turnstile (invisible, friendlier) or reCAPTCHA                                     |




### 6.3 UI states

Every one of these should post a height update to the parent:

- Loading
- Form
- Field errors (shown inline, next to the field)
- Submitting (button disabled, spinner)
- Success
- Server error (with a retry button)
- Job closed
- Form unavailable



### 6.4 UX details

- The success message reads: "Almost done! We sent a link to **a***@gmail.com**. Click it to complete your application." Mask the email and include a resend button.
- Themes: dark matches the current card design, light for other pages.
- Mobile: full width, large tap targets, and `accept=".pdf,.doc,.docx"` on the file input.
- Accessibility: labels on every field, `aria-live` on error messages, and full keyboard navigation.
- Send height updates via `ResizeObserver`, using `parent.postMessage({type:'vs:height', value}, parentOrigin)`, where `parentOrigin` is the validated allowed origin. Never use `'*'`.



## 7. Submission handler (`POST /embed/v1/applications`)

Process in this exact order. Cheap checks come first, so attacks cost you little.

1. **Request limits:** body 6 MB or less, reject other content types, request timeout.
2. **Rate limits:** per IP (for example 5 per 10 minutes), per email (3 per day), per site (a spike alert), plus a global circuit breaker.
3. **Form token:** valid HMAC, age between 3 seconds and 2 hours, nonce not used before (stored in Redis with a TTL).
4. **Honeypot** empty.
5. **Captcha** verified with the provider's server API. Check that the hostname matches your main site.
6. **Site and job re-check:** the site is active, and the job is open and embeddable. It may have closed since the page loaded.
7. **Field validation:** the same rules as the form. Never trust client-side validation.
8. **File validation:**
  - Check the extension, the declared MIME type, **and the actual file signature (magic bytes)**.
  - Reject `.docm`, macros and encrypted PDFs if possible.
  - Rename to a random ID and store in a **private** bucket or directory, never web-accessible.
  - Mark it `scan_status = pending`, and queue an antivirus scan (ClamAV or your cloud provider's scanner).
9. **Duplicate check:** the same email and job are already pending or submitted. Return the same success response without creating a new application.
10. **User lookup:**
  - Not found: create a user with `status=pending` and a `claim` token.
    - Found: create a `confirm` token. Never attach silently.
11. **Create the application** with its status, site, source page, UTM, consent version, timestamp and IP.
12. **Queue the email.** Don't send it inside the request.
13. **Respond** `202 {"ok": true}`. It's the **same response whether the email is new or existing**, which prevents email enumeration.

Wrap steps 10–11 in a **database transaction**, so a failure never leaves half-created records.

## 8. Account claim and confirm flow



### New candidate (claim)

1. The email says: "Complete your application for Senior SEO Executive at Vivasoft," with a button.
2. The link is `https://main.com/claim?token=<random 32 bytes>`, valid for 7 days and single-use.
3. The page shows: "Set a password" (or a "Continue with Google" option).
4. On success:
  - The user becomes `active` and `email_verified_at` is set.
  - The application becomes `submitted`.
  - The token is marked used.
  - The candidate is logged in and taken to "My applications."



### Existing user (confirm)

1. The email says: "Did you apply for Senior SEO Executive? Confirm to submit."
2. The link requires login, even if the token is valid. This protects against someone using another person's email.
3. On confirm, the application becomes `submitted`. The email also includes "This wasn't me," which deletes the pending application.



### Token rules

- Generate tokens with a cryptographically secure random generator, at least 32 bytes.
- Store only the SHA-256 hash.
- Each token is single-use, has an expiry, and is bound to one purpose and one application.
- Generating a new token (via resend) invalidates the old one.
- Don't log full token URLs. Scrub `token=` from application and proxy logs.



### Reminders and cleanup (scheduled jobs)

- Send reminders on day 1 and day 3 if the token hasn't been used.
- After 30 days unclaimed: set the status to `expired`, delete the resume file, and anonymize or delete the pending user.
- Delete infected files immediately and set the application to `rejected_security`.



## 9. Security plan



### 9.1 Threats and countermeasures


| Threat                                                                 | Countermeasure                                                                                                                                                                                        |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Someone embeds your form on their own site (phishing, data collection) | `frame-ancestors` per site key; the site key only works from registered origins; you can disable a site key instantly                                                                                 |
| Clickjacking your main site                                            | `frame-ancestors 'none'` on **all non-embed pages**; only `/embed/v1/apply/`* is frameable                                                                                                            |
| Bots and spam applications                                             | Turnstile/reCAPTCHA, honeypot, minimum fill time from the form token, rate limits, WAF (e.g. Cloudflare) bot rules                                                                                    |
| CSRF / forged submissions                                              | Signed, expiring, single-use form token                                                                                                                                                               |
| Malicious file uploads                                                 | Magic-byte check, size limit, random filenames, private storage, AV scan, quarantine until clean, no macros                                                                                           |
| Recruiter infected by opening a resume                                 | Serve files only after `scan_status=clean`, through short-lived signed URLs with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`; optionally convert to PDF or preview images |
| Someone applies using another person's email                           | Nothing counts until the email owner acts; existing users must log in to confirm; "This wasn't me" option                                                                                             |
| Email enumeration (finding who has accounts)                           | Identical responses and timing for new and existing emails                                                                                                                                            |
| Token theft or reuse                                                   | Hashed, single-use, short expiry, not logged, HTTPS only                                                                                                                                              |
| WordPress site hacked, attacker changes the embed code                 | The attacker can only point to your real form (it stays inside your domain) or remove it. They can't read data from the iframe. You detect it via monitoring and can disable the site key.            |
| Spoofed postMessage                                                    | The loader checks `event.origin` and `event.source`; the iframe posts only to the validated parent origin; messages contain **no personal data**                                                      |
| XSS through job content or input                                       | Escape all output; sanitize job description HTML with an allowlist; strict CSP on embed pages (`script-src 'self'` plus captcha domains, no inline scripts, or nonces)                                |
| Upload flooding / DoS                                                  | Size limits at the proxy (nginx `client_max_body_size`), rate limits, WAF, a global circuit breaker, storage quota alerts                                                                             |
| Double submission (double-click)                                       | Button disabled while submitting, nonce reuse check, duplicate check on email and job                                                                                                                 |
| Personal data leaks                                                    | TLS everywhere with HSTS, encryption at rest for the database and bucket, role-based recruiter access, audit log of who viewed or downloaded resumes                                                  |
| Personal data in URLs, analytics or logs                               | Never put the name or email in URLs; the loader only sends the job ID to analytics; scrub request bodies from logs                                                                                    |




### 9.2 Headers on embed pages

```
Content-Security-Policy: frame-ancestors https://vivasoftltd.com https://www.vivasoftltd.com;
                         default-src 'self'; script-src 'self' https://challenges.cloudflare.com;
                         frame-src https://challenges.cloudflare.com; img-src 'self' data:;
                         style-src 'self'; form-action 'self'; base-uri 'none'; object-src 'none'
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

The `frame-ancestors` list is generated **dynamically** from the site key's `allowed_origins`. Don't set `X-Frame-Options` on embed pages, because it conflicts with `frame-ancestors`. Do keep `X-Frame-Options: DENY` everywhere else.

### 9.3 Cookies

The embed flow needs **no cookies** (the form token is in the page, not a cookie). This avoids third-party cookie blocking and removes a class of CSRF issues. If your framework sets a session cookie on embed routes anyway, disable it for `/embed/`*.

### 9.4 Privacy and compliance

- Show the consent text and a privacy policy link, and store the **consent text version**, timestamp and IP with each application.
- Retention: delete unclaimed applications after 30 days, and set a clear retention period for rejected candidates (for example 12 months). Document it in the privacy policy.
- Candidates can delete their account and applications from "My account."
- Follow the data protection law that applies to you and your candidates, and let your legal or HR team approve the consent wording.



### 9.5 Email security

- Set up SPF, DKIM and DMARC on the sending domain. Otherwise claim emails land in spam and your conversion rate collapses.
- Emails contain only the first name and job title, not the resume or other details.
- Use a transactional provider (SES, Postmark, SendGrid) and track bounces. Mark hard-bounced pending users as invalid.



### 9.6 Kill switches

- Disable a **site key**, which instantly stops all forms on that website.
- Disable **embedding per job**.
- Set a global **"embed maintenance mode"**, which shows "Applications temporarily unavailable, please try again later."



## 10. Monitoring and alerts

Track these on a dashboard:

- Form loads, submissions, and claim or confirm completions (**claim rate** is the key health metric)
- Captcha failures and rate-limit hits (to spot attacks)
- Emails sent, bounced, and marked as spam
- AV scan results and infected files
- Errors by type (validation, server)
- Embed page loads from unexpected referrers (browsers will already have blocked display; this is for visibility)

Send alerts (email or Slack) on these conditions:

- A submission spike above normal
- Any error rate above 5%
- Email bounce rate above 5%
- Any infected file
- The claim rate dropping below its baseline (for example, emails going to spam)



## 11. Edge cases


| Situation                                                                                       | Behavior                                                                                                                          |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Job closes while the candidate is filling the form                                              | The submit handler re-checks and returns "This position just closed," so the typed data isn't silently lost                       |
| The same candidate applies twice                                                                | The same success message; one application; a resend of the existing token                                                         |
| The candidate never receives the email                                                          | A resend button (rate-limited), plus "Check spam," plus a support contact                                                         |
| The candidate uses a different email than their existing account                                | Treated as a new account; offer a merge in "My account" later                                                                     |
| The claim link has expired                                                                      | A page with "Send a new link"                                                                                                     |
| The candidate is already logged in on main.com                                                  | Doesn't matter; the embed doesn't use cookies, so the confirm flow still applies                                                  |
| The WordPress owner pastes the wrong job ID                                                     | The form shows "Position not found" and the dashboard logs a warning for that site                                                |
| Scripts are stripped by a WordPress plugin or Elementor setting                                 | Use the iframe fallback snippet                                                                                                   |
| WordPress caching or optimization plugins (WP Rocket, Autoptimize) delay or combine `loader.js` | The help page tells the owner to exclude `main.com/embed` from JS optimization; the loader also works when deferred               |
| Ad blockers                                                                                     | Use neutral naming (`/embed/…`, no "track" or "analytics" in paths); the form itself is not blocked                               |
| A very slow network                                                                             | Show a loading skeleton; the placeholder shows "If the form doesn't load, apply here →" linking to the main site after 10 seconds |




## 12. Testing plan



### Functional tests

- New email: submit, then claim, and check the application becomes submitted and the recruiter sees it.
- Existing email: submit, confirm while logged in, check it becomes submitted. Test that "This wasn't me" deletes the application.
- Duplicate submit, expired token, reused token, and resend.
- Closed job and job with embedding disabled, both on page load and on submit.
- Every validation rule, the wrong file type, an 8 MB file, and a renamed `.exe` saved as `.pdf`.
- Dark and light themes, mobile (iOS Safari, Android Chrome), desktop (Chrome, Firefox, Safari, Edge).
- Pasting the snippet in Gutenberg, in Elementor, and with the fallback iframe.



### Security tests

- Embed the snippet on an unregistered domain. The browser must refuse to display the form.
- Post directly to the API without a form token, with an expired one, and with a reused one. All must be rejected.
- Script 50 rapid submissions. Rate limiting must kick in.
- Upload the EICAR test file. It must be detected and quarantined.
- Send a fake postMessage from another window. The loader must ignore it.
- Compare responses and timing for new versus existing emails. They must be indistinguishable.
- Enter XSS payloads in the name field and job content. They must be escaped everywhere, including recruiter views and emails.
- Check that tokens and personal data don't appear in any logs.
- Run an OWASP ZAP (or similar) scan against the embed routes.



### Load test

Simulate peak traffic (for example 20 submissions per second) and check that the queue, email sending and storage hold up.

## 13. Rollout plan

These are rough estimates for a small team:


| Phase                     | Work                                                                | Estimate |
| ------------------------- | ------------------------------------------------------------------- | -------- |
| 1. Backend foundation     | Database tables, pending-user rules, site registry, job toggle      | 3–4 days |
| 2. Embed form page        | Form UI, themes, validation, captcha, form token, headers           | 3–4 days |
| 3. Submission pipeline    | Handler, file storage, AV scan, rate limits, duplicates             | 3–4 days |
| 4. Claim and confirm flow | Tokens, pages, emails, reminders, cleanup jobs                      | 3–4 days |
| 5. Loader and embed code  | `loader.js`, "Get embed code" button, fallback snippet              | 1–2 days |
| 6. Monitoring             | Dashboard, alerts, kill switches                                    | 1–2 days |
| 7. Testing                | Functional, security and load tests from section 12                 | 3–5 days |
| 8. Pilot                  | One job (Senior SEO Executive) live for one week, watch the metrics | 1 week   |
| 9. Full rollout           | Owner guide sent, all jobs switched over                            | 1 day    |




## 14. Owner guide (to send to the WordPress owner)

Keep it to one page with screenshots:

1. **Get your code:** Dashboard → Jobs → [job] → "Get embed code" → Copy.
2. **In Gutenberg:** Edit the page → **+** → search "Custom HTML" → paste → Update.
3. **In Elementor:** Edit with Elementor → drag the **HTML** widget into place → paste → Update.
4. **Remove the old form** from the page.
5. **Check:** open the page in a private window. You should see the form. Don't submit a test application with a real email unless you mean to.
6. **If the form doesn't appear:** use the "fallback code" from the same screen, and if you use a caching plugin, clear its cache.
7. **When a job closes:** you don't need to do anything. The form closes itself. You can unpublish the page whenever you like.



## 15. Launch checklist

- [ ] vivasoftltd.com site key created with both www and non-www origins
- [ ] `frame-ancestors` verified on the embed pages; `DENY` on all other pages
- [ ] Captcha keys set for production, with the hostname check enabled
- [ ] AV scanning running; EICAR test passed
- [ ] SPF, DKIM and DMARC passing; a claim email arrives in the Gmail and Outlook inboxes, not spam
- [ ] Rate limits and WAF rules active
- [ ] Retention and cleanup jobs scheduled
- [ ] Privacy policy updated and the consent text approved
- [ ] Monitoring dashboard and alerts working
- [ ] Kill switches tested
- [ ] Pilot job live, and the owner guide sent

If you tell me your main site's stack, I can write the actual code for any part: the submission handler, migrations, `loader.js`, the form page, or the email templates. I can also put this plan into a doc for your team.