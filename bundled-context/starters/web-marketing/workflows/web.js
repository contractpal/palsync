// {{PAL_NAME}} — web workflow (web-marketing starter skeleton).
// Pattern per the palbuilder-workflow skill: one run(controller), declare only the globals you
// use, action switch with thin handlers, unknown action falls through to the home page.
// Workflow JS is the RESTRICTED engine: var only (no let/const), no object literals, no ES6.
var c, page, payload;

function run(controller)
{
    c = controller;
    payload = c.createPayload();

    // robots.txt and sitemap.xml — intercept before the action switch.
    // c.getHref() returns the raw request path (e.g. "/robots.txt").
    // Return plain-text responses directly; no page needed.
    var href = c.getHref();

    if (href == "/robots.txt") {
        return c.createAjaxResponse(
            "User-agent: *\nAllow: /\nSitemap: https://YOUR-DOMAIN/sitemap.xml",
            false
        );
    }

    if (href == "/sitemap.xml") {
        // Minimal sitemap. Extend with additional <url> blocks as the site grows.
        // For a dynamic sitemap (pages from a dataset), build the XML string in a
        // helper function and return it here.
        var sitemapXml =
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" +
            "<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">" +
              "<url><loc>https://YOUR-DOMAIN/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>" +
            "</urlset>";
        return c.createAjaxResponse(sitemapXml, false);
    }

    switch (c.getAction()) {
        // Add page actions here as the site grows, one case per page:
        // case "getAbout":
        //     page = c.getPage("about");
        //     break;
        default:
            page = c.getPage("home");
            break;
    }

    page.addPayload(payload);
    return page;
}
