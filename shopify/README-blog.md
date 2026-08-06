# WYNCH blog — article template

`templates/article.wynch.liquid` — a single blog-article page styled in the
WYNCH design system (orange `#ff6315`, cream background, Giorgio Sans + Aktiv
Grotesk fonts from the wynch.wine CDN).

It is an **alternate** template, so it does **not** replace the theme's
default article template — you assign it to whichever articles you want.

## Install

There are two file sets depending on your theme type. Most current themes are
"Online Store 2.0" (JSON templates) — use option A. If your theme uses classic
Liquid templates, option B is simpler.

### A) OS 2.0 / JSON theme (recommended — avoids "Invalid JSON" errors)
Your theme creates `.json` templates, which cannot hold Liquid directly. Use
the section + JSON template instead:
1. **Online Store → Themes → ⋯ → Edit code.**
2. **Sections → Add a new section** → name it **`wynch-article`** → if it
   creates `wynch-article.liquid`, replace its contents with
   `sections/wynch-article.liquid`. Save.
3. **Templates → Add a new template → article** → name it **`wynch`**. It will
   create `article.wynch.json` → replace its contents with
   `templates/article.wynch.json` (it just references the section). Save.

### B) Classic Liquid theme
1. **Templates → Add a new template → article** → choose type **liquid** (not
   json) → name it **`wynch`**.
2. Paste the contents of `templates/article.wynch.liquid`. Save.

## Use it on an article
- **Online Store → Blog posts →** open a post → in the sidebar **Theme
  template** pick **wynch** → Save.
- The post now renders with this template at `…/blogs/<blog>/<article>`.

## What it shows
- Back-to-blog link, title, date · author
- Featured image (article image)
- Article body (`article.content`) with WYNCH typography
- Tags (link to the tag filter)
- A footer CTA to `/pages/join` (the club landing)
- Native comments block (only if comments are enabled for the blog)

## Notes
- Styles are scoped under `.wynch-article`, so they won't affect the rest of
  the theme. The site header/footer come from the theme layout as usual.
- Fonts load from the wynch.wine CDN (same as the landing).
- The CTA points to `/pages/join`; change it if your club page differs.

## Wine card inside an article

### Easiest — by product handle (auto)
Just write a token where you want a wine card:

```
[[wine:riesling-kabinett-2023]]
```

Put it on its own line in the article body. On render it becomes a full card
pulled straight from the Shopify product — image, title, price, region · grape
(from `secondary::region::…` / `secondary::grape::…` tags), a short tasting note
(from the product description) and an **In den Warenkorb** button. Nothing to
paste or fill in; change the wine by changing the handle.

- The handle is the last part of the product URL: `/products/**riesling-kabinett-2023**`.
- If the handle is wrong, the article shows "Wein … nicht gefunden" so you can fix it.
- Region/grape only appear if the product has the `secondary::region::…` /
  `secondary::grape::…` tags (same scheme the sommelier uses).

### Manual — full control (optional)
For a one-off card with custom text/image, open the body editor's **`<>` (Show
HTML)** view and paste the block from **`wine-card-snippet.html`**, then fill in
the placeholders.

The card styles live in `sections/wynch-article.liquid`. On mobile the card
stacks (image on top).
