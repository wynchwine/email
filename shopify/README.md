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

## How it works on Shopify (create via Admin API, then log in)
- **Step 2 (opt-in):** calls `API_BASE/api/register` (Vercel → Shopify **Admin
  API**) which **creates the customer** with the chosen password and creates the
  Klaviyo profile ("Yes" = subscribed to marketing, "No" = profile only).
  Admin-API creation is reliable regardless of theme/registration settings.
- **Step 3 (buttons):** waits for that creation to finish, then submits Shopify's
  **native** `{% form 'customer_login' %}` (rendered by Liquid, carries the
  required token) to log the user in same-origin, then redirects.

## Requirements
- Customer accounts = **Classic**.
- The Shopify custom app needs scope **`write_customers`** (for Admin-API create).
- Vercel env: `SHOPIFY_SHOP`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`
  (token via client_credentials), plus `KLAVIYO_API_KEY` /
  `KLAVIYO_NEWSLETTER_LIST_ID` for the profile/subscription.
- Set `API_BASE` in the template to your Vercel production URL.

## Notes
- If the email already exists, `/api/register` returns 409; the login step will
  still run and log the existing customer in (same password).
- The `customer_login` form redirects to `/account` by default; the quiz/shop
  `return_url` is best-effort (themes don't always honor it).

## Requirements
- Customer accounts = **Classic**, with registration enabled.
- Vercel env `KLAVIYO_API_KEY` (and `KLAVIYO_NEWSLETTER_LIST_ID` for the list).
- If a customer email already exists, Shopify shows its registration error —
  handle "log in instead" separately if needed.
