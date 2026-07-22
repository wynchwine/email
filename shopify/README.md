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
- **Step 3 (buttons):** fills Shopify's **native** `{% form 'create_customer' %}`
  (rendered by Liquid, so it carries the token Shopify requires) and submits it
  → Shopify creates the account and logs the user in, then redirects (usually
  `/account`). A hand-built form is rejected by Shopify — that's why we use the
  Liquid form tag.

## If the account still isn't created / not logged in
- Check **Admin → Customers**: if the email appears there but you weren't logged
  in, the store requires **email confirmation** on registration — Shopify creates
  the account "pending" and won't auto-login until the customer confirms. Silent
  auto-login isn't possible in that mode; either disable the confirmation
  requirement or accept the confirm-email step.
- If the email is **not** in Customers and it bounced to `/account`, re-check that
  customer accounts are **Classic** with self-registration enabled.
- Shopify's create_customer redirects to `/account` by default; the quiz/shop
  `return_url` is best-effort (themes don't always honor it).

## Requirements
- Customer accounts = **Classic**, with registration enabled.
- Vercel env `KLAVIYO_API_KEY` (and `KLAVIYO_NEWSLETTER_LIST_ID` for the list).
- If a customer email already exists, Shopify shows its registration error —
  handle "log in instead" separately if needed.
