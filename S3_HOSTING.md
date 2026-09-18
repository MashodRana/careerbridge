# Building a CDN Release & Hosting It on S3 Alone

Two things this document covers:
1. **Generating a versioned, minified "CDN build"** of the widget (the `frontend/build.mjs` script, added alongside this guide — tested and verified against a real browser render, not just a syntax check).
2. **Serving that build from S3 by itself**, no CloudFront — the interim option discussed in the cost/feasibility comparison. See [DEPLOYMENT.md](DEPLOYMENT.md) for the fuller production picture and why CloudFront is still the eventual recommendation.

The build step below was run and verified in this repo. The S3 steps use correct, standard AWS CLI syntax, but weren't run against a real AWS account from here (no AWS CLI/credentials in this environment) — sanity-check the bucket/account-specific values (region, account ID) against your own setup before running them for real.

---

## Part 1 — Generate the CDN build

### What it does
`frontend/build.mjs` minifies `widget.js` and `reset.css` with esbuild, copies `index.html` alongside them, and writes two identical copies of the output:

```
frontend/dist/
├── 1.0.0/          ← immutable — never overwritten once published
│   ├── widget.js
│   ├── index.html
│   └── reset.css
└── v1/              ← the alias — overwritten on every compatible release,
    ├── widget.js       this is what embed snippets should point at
    ├── index.html
    └── reset.css
```

Why two copies instead of one: exact-version paths (`1.0.0/`) can be cached by browsers/CDNs *forever* (`Cache-Control: immutable`) because their content never changes once published. The `v1/` alias is what you actually hand out in embed snippets — it moves to point at the latest compatible release, cached briefly (a few minutes), so a bad release can be rolled back by re-pointing the alias rather than waiting for every customer site's cache to expire. See [DEPLOYMENT.md](DEPLOYMENT.md)'s "Versioning" section for the full rationale.

### Steps

```bash
cd frontend
npm install       # installs esbuild as a dev dependency — one-time
npm run build      # runs build.mjs
```

Verified output from this repo:
```
> careerbridge-widget@1.0.0 build
> node build.mjs

  dist/1.0.0/widget.js  23.0kb
  dist/1.0.0/reset.css  260b

Built version 1.0.0:
  dist/1.0.0/widget.js   23.0KB   (~8KB gzipped — verify with: gzip -c widget.js | wc -c)
  dist/1.0.0/reset.css   0.3KB
  dist/1.0.0/index.html  0.7KB
  mirrored to dist/v1/ (the alias embed snippets should use)
```
`widget.js` goes from 38.5KB raw / ~12KB gzipped (source) to 23.0KB raw / ~8KB gzipped (minified) — smaller payload, same behavior. This was confirmed with a real headless-browser render against the minified output (3 job cards rendered, correct company name, brand color applied), not just a syntax check — minification is usually safe, but "usually" isn't a high enough bar to put in a hosting guide untested.

### Cutting a new release
1. Bump `"version"` in `frontend/package.json` (semver — e.g. `1.0.0` → `1.1.0` for a compatible change, `2.0.0` for a breaking one).
2. `npm run build` again — this writes a new `dist/<new-version>/` and updates `dist/v<major>/` to match. Old versioned directories from previous builds stay wherever you previously uploaded them (this script only touches its own `dist/` output locally — uploading and retention is a separate step, Part 2 below).
3. Upload the new versioned directory, then update the `v1`/`v2`/etc. alias objects on your host to point at the new content (Part 2 shows exactly this for S3).

### Before you ship this for real
[DEPLOYMENT.md](DEPLOYMENT.md) Step 0 still applies — `API_BASE` inside `frontend/widget.js` is hardcoded to `http://localhost:3000/...`. Edit that (and `CAREER_SITE` if needed) to point at the real production API **before** running `npm run build`, since the build step just minifies whatever `widget.js` currently contains — it doesn't change any URLs for you.

---

## Part 2 — Serve the build from a folder in your existing bucket

Recap from the cost/feasibility discussion: this works over HTTPS using AWS's own S3 domain (not a custom branded domain — that specifically requires CloudFront or another TLS-terminating proxy in front, S3 can't do it alone). Fine for an MVP/internal-test phase; revisit CloudFront before a wide customer rollout.

Since you're using an existing bucket rather than a fresh one, everything below is scoped to one folder (prefix) inside it — `<your-prefix>` in the examples — rather than the whole bucket. This matters for two commands specifically: **`put-bucket-policy` and `put-bucket-cors` replace the entire policy/CORS configuration, they don't merge into what's already there.** If the bucket already serves other content with its own policy or CORS rules, blindly running the versions of these commands from a from-scratch setup would silently delete those. Fetch what's already there first and merge by hand.

Throughout, replace:
- `<your-bucket>` — your existing bucket name
- `<region>` — that bucket's region
- `<your-prefix>` — the folder you want the widget under, e.g. `careerbridge` or `widgets/careerbridge` (no leading slash, no trailing slash — the commands below add the slashes)

### Prerequisites
- The AWS CLI installed and configured (`aws configure`) with credentials that can manage the bucket.
- The build from Part 1 already run (`frontend/dist/1.0.0/` and `frontend/dist/v1/` exist).
- Confirm the bucket's actual region — the S3 URL and any `--region` flags must match it: `aws s3api get-bucket-location --bucket <your-bucket>`

### Fast path — you already have a public `public/` prefix

If the bucket already has a `public/` prefix serving other public assets (a logo, etc.), you likely don't need to touch the bucket policy or CORS at all — you can just upload into a subfolder underneath it and inherit whatever already makes `public/` readable.

1. **Confirm the existing policy actually covers subfolders, not just specific files:**
   ```bash
   aws s3api get-bucket-policy --bucket <your-bucket> --query Policy --output text | python3 -m json.tool
   ```
   Look at the `Resource` value(s) in the statement(s) that grant `s3:GetObject`. What matters is whether it's a **wildcard covering the whole prefix**:
   - `"arn:aws:s3:::<your-bucket>/public/*"` — covers everything under `public/`, including a brand-new `public/careerbridge/` subfolder you haven't created yet. **You need nothing further from Step 2.**
   - `"arn:aws:s3:::<your-bucket>/public/logo.png"` (or similarly narrow, naming specific files/paths rather than a `public/*` wildcard) — the existing policy does **not** automatically extend to a new subfolder. You'll need to either add a new statement scoped to `public/careerbridge/*` (see Step 2, merging with what's already there), or ask whoever manages the bucket to widen the existing statement to a `public/*` wildcard if that's intended to be the general-purpose public area.
2. **Pick your subfolder**, e.g. `public/careerbridge`. This becomes `<your-prefix>` in every command in Steps 4–6 below (skip Steps 2–3 entirely if the wildcard check above passed).
3. **Skip CORS** (Step 3) unless you're adding SRI later — see that step's note; it was never actually required for this bucket's existing logo/asset use case either, for the same reason.
4. Jump to **Step 4 — Upload with the right cache headers**, using `<your-prefix>` = `public/careerbridge` (or whatever you picked).

If the wildcard check in step 1 came back narrow (not covering your new subfolder), fall through to the general Steps 1–3 below, which walk through merging a new statement into the existing policy safely.

### Step 1 — Check what's already there before changing anything
```bash
aws s3api get-bucket-policy --bucket <your-bucket> 2>&1
aws s3api get-bucket-cors --bucket <your-bucket> 2>&1
aws s3api get-public-access-block --bucket <your-bucket> 2>&1
```
Each of these returns either the existing config (which you'll need to merge with, not overwrite) or a `NoSuchBucketPolicy`/`NoSuchCORSConfiguration`-style error meaning there's nothing there yet — in that case the commands in Step 2/3 below can be used as-is. If any of them *do* return existing config, adapt the JSON in the next two steps to add your statement/rule alongside what's already there, rather than replacing the file wholesale.

### Step 2 — Allow public read access, scoped to your folder only
If the bucket's public-access-block is already fully open (check Step 1's output), you can skip this first command — it only needs to run once per bucket, not per folder:
```bash
aws s3api put-public-access-block \
  --bucket <your-bucket> \
  --public-access-block-configuration \
  BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false
```

The policy statement itself is scoped to `<your-prefix>/*` only — it does **not** make the rest of the bucket public:
```bash
cat > /tmp/careerbridge-statement.json << 'EOF'
{
  "Sid": "PublicReadForCareerBridgeWidget",
  "Effect": "Allow",
  "Principal": "*",
  "Action": "s3:GetObject",
  "Resource": "arn:aws:s3:::<your-bucket>/<your-prefix>/*"
}
EOF
```
If Step 1 showed **no existing policy**, wrap that statement in a full policy document and apply it directly:
```bash
cat > /tmp/bucket-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadForCareerBridgeWidget",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::<your-bucket>/<your-prefix>/*"
    }
  ]
}
EOF

aws s3api put-bucket-policy --bucket <your-bucket> --policy file:///tmp/bucket-policy.json
```
If Step 1 showed an **existing policy**, take that output, add the statement above into its `"Statement"` array (give it a unique `"Sid"`, as above, so it doesn't collide with existing statements), save the merged result, and `put-bucket-policy` that instead.

### Step 3 — CORS (optional — not needed for the basic embed)
Correction from an earlier version of this guide: CORS is **not actually required** for `<script src="...widget.js">` or `<iframe src="...index.html">`. CORS only governs JavaScript reading a cross-origin response body via `fetch()`/XHR — the widget's own `fetch()` calls go to the Novara API (a separate CORS concern, covered in [DEPLOYMENT.md](DEPLOYMENT.md)), not to S3. Loading a script or navigating an iframe cross-origin never triggers a CORS check, regardless of headers.

The one reason to set this up anyway: if you later add [Subresource Integrity](INTEGRATION.md) (`integrity="sha384-..." crossorigin="anonymous"` on the `<script>` tag, a Phase 2 item in [PLAN.md](PLAN.md)), the `crossorigin` attribute forces a CORS-mode fetch, and it'll fail without this. Skip this step for now if you're not using SRI; come back to it when you are.

CORS rules in S3 apply per-bucket, not per-prefix — there's no way to scope a CORS rule to just `<your-prefix>/*`. The rule below (`GET` only, any origin) is narrow enough that adding it to an existing CORS config for other content should be safe, but check what's already there.

```bash
cat > /tmp/careerbridge-cors-rule.json << 'EOF'
{
  "AllowedOrigins": ["*"],
  "AllowedMethods": ["GET"],
  "AllowedHeaders": ["*"],
  "MaxAgeSeconds": 3600
}
EOF
```
If Step 1 showed **no existing CORS config**:
```bash
cat > /tmp/cors.json << 'EOF'
{
  "CORSRules": [
    {
      "AllowedOrigins": ["*"],
      "AllowedMethods": ["GET"],
      "AllowedHeaders": ["*"],
      "MaxAgeSeconds": 3600
    }
  ]
}
EOF

aws s3api put-bucket-cors --bucket <your-bucket> --cors-configuration file:///tmp/cors.json
```
If Step 1 showed **existing CORS rules**, add the rule above into that config's `"CORSRules"` array alongside what's already there, and `put-bucket-cors` the merged result.

### Step 4 — Upload with the right cache headers
This is the step that actually implements the immutable-vs-alias split from Part 1 — different `Cache-Control` per path, set at upload time. Everything lands under `<your-prefix>/` — nothing else in the bucket is touched.

**Immutable versioned path** (cache forever — content here never changes):
```bash
aws s3 cp frontend/dist/1.0.0/ s3://<your-bucket>/<your-prefix>/1.0.0/ \
  --recursive \
  --cache-control "public, max-age=31536000, immutable" \
  --content-type "application/javascript" \
  --exclude "*" --include "*.js"

aws s3 cp frontend/dist/1.0.0/ s3://<your-bucket>/<your-prefix>/1.0.0/ \
  --recursive \
  --cache-control "public, max-age=31536000, immutable" \
  --content-type "text/css" \
  --exclude "*" --include "*.css"

aws s3 cp frontend/dist/1.0.0/index.html s3://<your-bucket>/<your-prefix>/1.0.0/index.html \
  --cache-control "public, max-age=31536000, immutable" \
  --content-type "text/html"
```

**Alias path** (short TTL — this is the URL you actually hand out, and it changes on every release):
```bash
aws s3 cp frontend/dist/v1/ s3://<your-bucket>/<your-prefix>/v1/ \
  --recursive \
  --cache-control "public, max-age=300" \
  --content-type "application/javascript" \
  --exclude "*" --include "*.js"

aws s3 cp frontend/dist/v1/ s3://<your-bucket>/<your-prefix>/v1/ \
  --recursive \
  --cache-control "public, max-age=300" \
  --content-type "text/css" \
  --exclude "*" --include "*.css"

aws s3 cp frontend/dist/v1/index.html s3://<your-bucket>/<your-prefix>/v1/index.html \
  --cache-control "public, max-age=300" \
  --content-type "text/html"
```

(The separate `--include`/`--exclude` passes per file type exist because `aws s3 cp --recursive` doesn't let you vary `--content-type` within a single call — S3 doesn't infer content type reliably enough on its own for this to be left out.)

### Step 5 — Your embed URLs
```
https://<your-bucket>.s3.<region>.amazonaws.com/<your-prefix>/v1/widget.js
https://<your-bucket>.s3.<region>.amazonaws.com/<your-prefix>/v1/index.html
```
These go wherever [INTEGRATION.md](INTEGRATION.md) says `https://<your-cdn>/widget.js` — e.g.:
```html
<div class="novara-careers" data-company-slug="financfy-ltd"></div>
<script src="https://<your-bucket>.s3.<region>.amazonaws.com/<your-prefix>/v1/widget.js"></script>
```

### Step 6 — Verify
```bash
curl -sI https://<your-bucket>.s3.<region>.amazonaws.com/<your-prefix>/v1/widget.js
```
Check for `200 OK`, `content-type: application/javascript`, and the `cache-control` you set. Then load an actual test page embedding that URL in a real browser — a `curl` 200 doesn't prove the widget renders (its own fetches to the API are a separate concern, already covered in [DEPLOYMENT.md](DEPLOYMENT.md)'s pre-launch checklist).

### Releasing a new version later
1. Run Part 1's build with a bumped version.
2. Upload the new `dist/<version>/` as an immutable path under `<your-prefix>/` (Step 4, first block) — never overwrite an existing versioned path.
3. Upload the new `dist/v1/` over the *existing* `<your-prefix>/v1/` path (Step 4, second block) — this overwrite **is** the rollback/rollout mechanism. Anyone whose browser cache has expired (every 5 minutes, per the `max-age=300` above) picks up the new version automatically.
4. To roll back, re-upload the *previous* version's files to the `<your-prefix>/v1/` path.

---

## Moving to CloudFront later

Nothing above needs to be redone. CloudFront sits in front of the same bucket as a cache/proxy layer — you'd point a CloudFront distribution's origin at `<your-bucket>.s3.<region>.amazonaws.com`, optionally set the distribution's **origin path** to `/<your-prefix>` so embed URLs don't need to repeat the prefix, attach your own domain + ACM certificate to the distribution, and switch the bucket policy statement from public `Principal: "*"` to CloudFront-only access (via Origin Access Control) once it's in front — at that point you'd also tighten the policy `Resource` back to exactly `<your-prefix>/*` if it wasn't already. The `dist/` build output and the immutable/alias path structure stay exactly the same either way.
