# WYNCH blog — article template

`templates/article.wynch.liquid` — a single blog-article page styled in the
WYNCH design system (orange `#ff6315`, cream background, Giorgio Sans + Aktiv
Grotesk fonts from the wynch.wine CDN).

It is an **alternate** template, so it does **not** replace the theme's
default article template — you assign it to whichever articles you want.

## Install
1. **Online Store → Themes → ⋯ → Edit code.**
2. **Templates → Add a new template → article** → name it **`wynch`**.
   - If the theme creates `article.wynch.json`, delete that and add
     `article.wynch.liquid` instead (or paste this file's contents so the
     template is the Liquid version).
3. Paste the contents of `templates/article.wynch.liquid`. Save.

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
