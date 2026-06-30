# JSON-LD structured data — match the @type to the page, not one block for the whole site

Put ONE `<script type="application/ld+json">` block in the page `<head>` (or one `schemaText`
payload var in the templated pattern). The mistake to avoid: dropping the same generic
`Organization` block onto every page. Pick the type that actually describes that page:

| Page kind | `@type` | Notes |
|---|---|---|
| Home | `Organization` + your product, combined via `@graph` | See example below |
| About | `AboutPage` with a `mainEntity` describing the product | |
| Features/product | `WebPage` with `about` (the product) + `mainEntity: ItemList` of features | Add `breadcrumb: BreadcrumbList` on any non-home page that sits under a section |
| FAQ | `FAQPage` with `mainEntity: [Question/acceptedAnswer, ...]` using the REAL on-page Q&A | Don't invent questions not shown to users |
| Blog index | `Blog` with a `publisher` | |
| Blog post | `og:type="article"` + per-post meta (`article:author`, `article:published_time`) | JSON-LD `@type: Article` optional but the OG article tags are the minimum |
| Contact/support | `ContactPage` | |
| Signup/get-started | `WebPage` with a `potentialAction: RegisterAction` | |

`@graph` example for a home page that is both a company and a product (real pattern, trimmed):

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "name": "Brand Parent Co",
      "url": "https://parent-co.com/",
      "logo": "https://YOUR-DOMAIN/nx-ref/Images/logo.png"
    },
    {
      "@type": "WebApplication",
      "name": "Product Name",
      "url": "https://YOUR-DOMAIN",
      "applicationCategory": "...",
      "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
      "publisher": { "@type": "Organization", "name": "Brand Parent Co", "url": "https://parent-co.com/" }
    }
  ]
}
```

Rules that don't change regardless of type:
- Every URL inside JSON-LD is absolute (the og:image/og:url absolute-URL trap applies here too).
- JSON-LD is real JSON — double quotes, no trailing commas, no comments.
- In the templated pattern, store each page's JSON-LD as raw JSON text in its own
  `scripts/schema/<page>.js` file and load it with `pal.getScript("schema/<page>")` — keeps the
  workflow's route switch readable and lets you diff schema changes independently of routing.
