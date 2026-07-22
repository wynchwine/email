# WYNCH landing — Shopify version

Same landing as `public/index.html`, packaged for a Shopify theme so the
`create_customer` / login form runs **same-origin** on `wynch.wine` and can
auto-create + log the customer in (classic customer accounts). Klaviyo still
goes to the Vercel API.

## Files
- `layout/join.liquid` — minimal full-screen layout (no theme header/footer).
- `templates/page.join.liquid` — the page markup, styles and scripts.

## Before you paste — set one value
In `templates/page.join.liquid` replace the placeholder:

```js
var API_BASE = 'https://REPLACE-WITH-YOUR-VERCEL-DOMAIN';
```

with your Vercel production URL, e.g. `https://join.wynch.wine` (the `/api/subscribe`
endpoint lives there; CORS is already open, so the Shopify page can call it).

## Install in Shopify
1. **Online Store → Themes → ⋯ → Edit code.**
2. **Layouts → Add a new layout** → name it `join` → paste `layout/join.liquid`.
3. **Templates → Add a new template → page** → name it `join` → if it creates
   `page.join.json`/`.liquid`, replace its contents with `templates/page.join.liquid`
   (it must start with `{% layout 'join' %}`).
4. **Online Store → Pages → Add page** → title e.g. "Join" → in **Theme template**
   pick **join** → Save. The page is now at `https://wynch.wine/pages/join`.

## How it works on Shopify
- **Step 2 (opt-in):** posts name/email to `API_BASE/api/subscribe` (Vercel) —
  "Yes" subscribes to the Klaviyo newsletter; "No" just creates the profile.
- **Step 3 (buttons):** submits a same-origin `create_customer` form to `/account`
  → Shopify creates the account and logs the user in, then redirects.

## Requirements
- Customer accounts = **Classic**, with registration enabled.
- Vercel env `KLAVIYO_API_KEY` (and `KLAVIYO_NEWSLETTER_LIST_ID` for the list).
- If a customer email already exists, Shopify shows its registration error —
  handle "log in instead" separately if needed.
