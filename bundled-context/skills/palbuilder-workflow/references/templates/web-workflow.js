// {{PAL_NAME}} — web workflow skeleton (pattern: GiftHub web.js).
// One page ("website") + ${mainFrag} routing: each route sets payload values,
// sendResponse() finishes. RESTRICTED engine: var only, no object literals, no ES6.
var c;
var pal;
var request;
var page;
var ajax;
var payload;
var href;
var meta;

function run(controller) {
    c = controller;
    request = c.getRequest();
    pal = c.getPal();
    href = c.getHref();
    payload = c.createPayload();
    meta = c.createData();
    page = c.getPage("website");

    // Defaults — the home route. Every case overrides what differs.
    payload.set("title", "{{PAL_NAME}} | What It Does For Whom");
    payload.set("description", "One plain sentence: what {{PAL_NAME}} does, for whom, and the outcome.");
    payload.set("mainFrag", "landing");
    payload.set("active_nav", "home");

    // Canonical: home aliases collapse to the bare domain.
    if (href == "home.html" || href == "index.html" || href == "website.html" || href == "") {
        payload.set("canonical", pal.getWebUrl());
    } else {
        payload.set("canonical", pal.getWebUrl() + href);
    }

    switch (c.getAction() || href) {
        case "robots.txt":
            return getRobots();
        case "sitemap.xml":
            return getSitemap();
        case "llms.txt":
            return getLlms();
        case "home.html":
            break; // defaults already correct
        case "about.html":
            payload.set("active_nav", "about");
            payload.set("title", "About {{PAL_NAME}}");
            payload.set("description", "About page description, 50-160 chars.");
            payload.set("mainFrag", "about");
            break;
        default:
            break; // unknown route → home defaults
    }

    meta.set("type", "website");
    meta.set("url", payload.get("canonical"));
    // meta.set("image", "https://YOUR-DOMAIN/Images/og-card.png");
    return sendResponse();
}

function sendResponse() {
    if (!meta.isEmpty()) {
        meta.set("title", payload.get("title"));
        meta.set("description", payload.get("description"));
        payload.addDataMap("meta", meta);
    }
    if (request.isAjax()) {
        if (ajax == null) {
            ajax = c.createAjaxResponse(pal.getAjaxFragment(payload.get("mainFrag")), true);
        }
        ajax.addPayload(payload);
        return ajax;
    }
    page.addPayload(payload);
    return page;
}

function getRobots() {
    var robots = c.createAjaxResponse(
        "User-agent: *\nAllow: /\nSitemap: " + pal.getWebUrl() + "sitemap.xml\n", false);
    robots.setContentType("text/plain");
    return robots;
}

function getSitemap() {
    var url = pal.getWebUrl();
    var xml =
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" +
        "<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">" +
          "<url><loc>" + url + "</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>" +
        "</urlset>";
    var sitemap = c.createAjaxResponse(xml, false);
    sitemap.setContentType("application/xml");
    return sitemap;
}

function getLlms() {
    var llms = c.createAjaxResponse(
        "# {{PAL_NAME}}\n\nReplace with the real product scope, core pages, and claims.\n", false);
    llms.setContentType("text/plain");
    return llms;
}
