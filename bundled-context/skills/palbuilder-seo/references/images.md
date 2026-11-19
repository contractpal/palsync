<!-- Adapted in part from claude-seo (MIT, © Agrici Daniel). -->
# Images in a web pal

Images affect image search, accessibility, and layout stability. The rules below use the
PalBuilder asset path behavior from SKILL.md.

## Alt text

- Every `<img>` gets `alt="what the image shows"`; purely decorative images get `alt=""`.
  Missing alt is an audit warning (`imgAlt`).
- Describe the content, not the file name: "Red running shoe, side view", not "shoe-img".
- Do not stuff keywords. The alt should make sense read aloud by a screen reader.
- Text inside an image is invisible to search engines — repeat the important words in nearby
  visible text.

## Explicit dimensions (CLS)

- Give every `<img>` its real pixel size: `width="800" height="600"` (audit warning
  `imgDimensions`). The browser reserves space before the file loads, so the page does not
  jump — Cumulative Layout Shift is a Core Web Vital.
- Control the displayed size with CSS (`max-width:100%; height:auto`), never by changing the
  width/height attributes to fake a size.
- Keep the true aspect ratio in the attributes; cropping belongs in CSS or in the asset.

## Loading behavior

- Hero / LCP image: `<img fetchpriority="high">` in the initial HTML, **no**
  `loading="lazy"`. Use a real `<img>`, never a CSS `background-image` (full pattern:
  `loading-speed.md`).
- Below-the-fold images: `loading="lazy"`. Lazy-loading the LCP image delays the metric.
- Use `srcset`/`sizes` for large hero art so small screens do not download the desktop file.

## Formats and weight

- Ship JPG for photos/painted art, PNG for graphics that need transparency or hard edges.
- **Do not ship `.webp`** — PalBuilder serves it with the wrong content-type (SKILL.md trap
  5). Compress JPG instead; q50 is an acceptable quality floor for photographic hero art.
- Weight targets (adapted from claude-seo):

| Image kind | Target | Review |
|---|---|---|
| Thumbnails / icons | < 50 KB | > 100 KB |
| Content images | < 100 KB | > 200 KB |
| Hero / banner | < 200 KB | > 300 KB |

- Resize to the largest size actually displayed (2x for retina at most); do not ship a
  4000 px photo for an 800 px slot.

## Paths and absolute URLs

- In page markup use the relative path: `<img src="../Images/hero.jpg"/>`. The server
  rewrites it to `nx-ref/Images/hero.jpg`.
- In `og:image` and any JSON-LD `image`/`logo`, write the full absolute URL:
  `https://YOUR-DOMAIN/nx-ref/Images/hero.jpg` (SKILL.md trap 1). Social scrapers and schema
  consumers fetch from their own servers where relative paths do not resolve.
- File names: lowercase, hyphenated, descriptive (`red-running-shoe.jpg`), so they carry a
  little context and stay readable in URLs.

## Image sitemap (optional)

If image search matters, list image URLs in `sitemap.xml` with the image namespace
(`xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"`) and one
`<image:image><image:loc>…</image:loc></image:image>` per image inside its page's `<url>`
entry. Keep the file served with `application/xml` as described in `crawler-files.md`; a
broken sitemap is worse than none.

## Check before shipping

1. Every `<img>` has alt and width/height.
2. Hero is eager and `fetchpriority="high"`; the rest is lazy.
3. No `.webp`; each image is within its weight target.
4. `og:image` and JSON-LD image URLs are absolute with the `nx-ref/` prefix.
5. `pal_seo_audit` reports no `imgAlt` or `imgDimensions` warnings.
