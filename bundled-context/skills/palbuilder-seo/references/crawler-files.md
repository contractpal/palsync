# robots.txt, sitemap.xml, and llms.txt — every WEB pal needs all three

Pick ONE of the two patterns below — both are verified live. Pattern A is simpler and has no
PalBuilder-manifest dependency; use it unless you already have a `pages`/`datalists` structure
that makes Pattern B's data-driven sitemap worth the setup.

### Pattern A — handle it directly in the workflow (no pal.json page needed)

Intercept these hrefs at the very top of `run()`, **before** any route switch — on test/stage
instances every path falls through to the workflow, so without this intercept a request for
`/robots.txt` renders the homepage HTML instead (this exact bug showed up as 305 Lighthouse
parse errors in production).

```js
var c;

function run(controller) {
    c = controller;
    var crawler = serveCrawlerFile();
    if (crawler != null) { return crawler; }
    // ...normal route switch...
}

function serveCrawlerFile() {
    var href = c.getHref();
    if (href == null) { return null; }
    var q = href.indexOf("?");
    if (q >= 0) { href = href.substring(0, q); }

    if (href.indexOf("robots.txt") >= 0) {
        var robots = c.createAjaxResponse(
            "User-agent: *\nAllow: /\nDisallow: /thank-you.html\nSitemap: https://YOUR-DOMAIN/sitemap.xml\n",
            false);
        robots.setContentType("text/plain");           // required — see note below
        return robots;
    }

    if (href.indexOf("sitemap.xml") >= 0) {
        var base = "https://YOUR-DOMAIN/";
        var names = ["index", "page-one", "page-two" /* ...every routable page... */];
        var xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n";
        for (var i = 0; i < names.length; i++) {
            xml += "<url><loc>" + base + names[i] + ".html</loc></url>\n";
        }
        xml += "</urlset>\n";
        var sitemap = c.createAjaxResponse(xml, false);
        sitemap.setContentType("application/xml");     // required — see note below
        return sitemap;
    }
    return null;
}
```

**`setContentType` is not optional.** Served with the default `text/html`, a browser/crawler
parses `<url>`/`<loc>` as unknown HTML tags and shows bare text instead of a real sitemap — use
`text/plain` for robots.txt and `application/xml` for sitemap.xml.

### Pattern B — data-driven via pal.json page entries

Register `robots.txt` (and optionally `llms.txt`) as **Pages** in `pal.json` with
`"palType": "palTypeRobots"`, `"contentType": "text/plain"`. Route to them with
`c.getPage("robots")` / `c.getPage("llms")`. For the sitemap, register a **Fragment** with
`"palType": "palTypeServiceRequest"` (e.g. `sitemap.html`) holding:

```html
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<c:list name="sitemap" id="s">
<url><loc>${s.page}</loc><lastmod>${lastMod}</lastmod></url>
</c:list>
</urlset>
```

driven by a `datasets`/`datalists` entry named `sitemap` (columns: `page`, `priority`,
`changeFreq`) — one row per route, including dynamic routes like blog posts. Serve it from the
workflow:

```js
function getSitemap() {
    var ajax = c.createAjaxResponse(pal.getServiceFragment("sitemap"), true);
    ajax.set("site", getBaseUrl());
    var list = pal.getDataList("sitemap").copy("sitemap");
    for (var i = 0; i < list.getRecordCount(); i++) {
        list.getRecord(i).set("page", getBaseUrl() + list.getRecord(i).getDefaultValue("page", "", true));
    }
    ajax.addDataList(list);
    ajax.setContentType("text/xml");
    return ajax;
}
```

Use this pattern when pages/posts are added dynamically (e.g. a blog) — the datalist grows
without touching workflow code, unlike Pattern A's hardcoded `names` array.

### llms.txt (bonus — modern AI-crawler discovery file)

Not required, but cheap and increasingly checked: a plain-text/markdown file at `/llms.txt`
summarizing what the product is, its core pages, key features, and what it explicitly is NOT
(scope-bounding helps LLM answers stay accurate). Serve it the same way as robots.txt in
whichever pattern you chose above.

### robots.txt content checklist

- `User-agent: *` / `Allow: /` (or scoped `Disallow:` for thank-you/admin/api/temp paths and
  any `?`-querystring duplicate-content URLs).
- `Sitemap: https://YOUR-DOMAIN/sitemap.xml` line, absolute URL.
- `pal_seo_audit` fetches and checks all three files (homepage-HTML fallthrough, content-type,
  required lines/elements) — fix every ERROR it reports there same as for page heads.
