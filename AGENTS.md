# Working preferences

- Work locally only — do NOT push to GitHub (`origin` is github.com:KaranChawlaD/bots). Commits are fine if asked; never push.

# Verification

- Backend typecheck: `npm run typecheck`
- UI typecheck + build: `npm --prefix scenario-ui run build`
- UI lint: `npm --prefix scenario-ui run lint` (baseline: 0 errors, 9 pre-existing warnings)
- Full UI build served by the server: `npm run ui:build` (outputs `scenario-ui/dist`)

# Privacy / safety rules

- Account emails must stay server-side — never expose them in `/api/state` or the UI.
- Publishing a listing requires the approval step; dry-run is the default.
- Offer sends respect per-account rate limits, daily caps, and duplicate-listing blocks.

# Gotchas

- `data/` is gitignored — safe place for debug screenshots and temp files.
- Kijiji posting flow: category leaf navigates to `p-post-ad.html?categoryId=…&adTitle=…`; the URL flickers during SPA transitions, so detect the form by the description field, not the URL alone.
- Source-listing breadcrumbs are DOM-only on many ads (not JSON-LD) and contain non-category crumbs (site/province/city/`Ad ID …`/`for City of X` suffixes).
