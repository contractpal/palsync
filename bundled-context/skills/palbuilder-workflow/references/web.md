# Web Workflows (`workflowType: 9`)

The web workflow serves the pal's public-web UI at its own domain (e.g.,
`app.gifthub.me`). Users are anonymous by default. This is what non-CloudPiston visitors see
when they hit the pal directly on the internet.

**Access mode summary** — see `palbuilder-core/references/pal-structure.md` for the console
vs web distinction.

**Controller API:** https://secure.cloudpiston.com/cpal/cp-api/web/index.html

Companion:
- `../SKILL.md` — the `run()` pattern, reserved globals (universal to all types)
- `console.md` — the authenticated cousin

---

## What's specific to web workflows

Web workflows share the `run()` shape with console workflows. The differences that matter:

1. **Users are anonymous by default.** There is **no `c.getUser()`** in a web workflow. Any
   authenticated-user model must be built by the pal.
2. **Custom domain.** The pal runs at its own URL, not inside the CloudPiston platform.
3. **The `palTypeWeb` palType.** Pages, fragments, scripts, and styles marked for the web
   context.
4. **Open-internet exposure.** Any endpoint can be hit by any client. Design for that.

---

## No `c.getUser()` — custom auth if needed

Web workflows have no CloudPiston user session. If your pal needs authenticated web users,
you must build that yourself:

- A pal-owned dataset for user records (email, password hash, session token, etc.)
- A workflow-managed sign-in flow (issue and validate tokens)
- Session tracking via cookies, request headers, or dataset lookups

None of the console-side user management (User, Profile, enterprise settings tied to a
profile) is available. Your custom users are just rows in a dataset you designed.

If you need authenticated users AND CloudPiston-managed identity, that's a signal to move
that flow to the console side of the pal.

---

## Dataset access from the open web — be cautious

**Any dataset call in a web workflow can be triggered by anyone on the internet.** Design
defensively:

- **Avoid dataset access when possible.** Static pages, marketing content, and other read-only
  material should render from pal-level data (`pal.getData`, `pal.getDataList`) or pages with
  no dynamic data — cached and cheap.
- **Cache-guard when unavoidable.** For dynamic public content (a public list, a recent
  activity feed), pull from cache first and only hit the dataset on a miss. See
  `palbuilder-data/references/cache.md`.
- **Rate-limit anonymous writes.** Any workflow action that writes to a dataset from an
  anonymous request is an abuse target. Implement throttling (cache-based counters, IP
  tracking, honeypot fields) before shipping.
- **Behind custom auth only.** If a dataset holds anything user-specific or sensitive, gate
  access behind your custom auth flow — never expose it directly.

---

## robots.txt — situational, not required

A pal registers a `robots.txt` page in `pal.json`'s `layout` block:

```json
{
  "layout": {
    "robotsPage": "other/robots.txt"
  }
}
```

The page carries `palType: palTypeRobots` and `contentType: text/plain`. Its content is
served as-is when a crawler requests `/robots.txt`.

**`robots.txt` is not strictly required** — it only matters when the pal serves
unauthenticated public content that search engines will crawl (marketing sites, blogs,
public landing pages). A web workflow that's purely a custom-auth application (login-gated
from the front door) doesn't need one.

For dynamic robots.txt (e.g., different rules per environment), the workflow can serve
generated content instead — but the static-file pattern above is the norm.

---

## Error page

The `layout` block also registers an error page:

```json
{
  "layout": {
    "errorPage": "other/error.html"
  }
}
```

This page renders when a workflow throws an uncaught exception or returns an unrecoverable
error. Design it to be user-friendly — anonymous web visitors have no context for a debug
trace.

---

## Enterprise settings

`c.getEnterprise().getGlobalSetting(key)` is available in web workflows too — despite the
console-flavored naming. Use it for enterprise-shared configuration values:

```js
var contactEmail = c.getEnterprise().getGlobalSetting("contactEmail");
```

---

## SEO — head, meta, structured data

Public web pages need proper `<title>`, meta tags, canonical URLs, and often structured data
(JSON-LD). These are set on the page via payload values that the template renders in the
`<head>` — beyond the scope of this reference.

If your pal has an SEO skill (`seo-*`), consult it. Otherwise:

- Set `<title>` and meta tags via payload values that the head fragment reads
- Include a `link rel="canonical"` on every page
- For structured data, build the JSON in the workflow using `c.createJsonBuffer()` (see
  `palbuilder-data/references/http-client.md`) and pass it to the template

---

## Common gotchas

- **No `c.getUser()`.** Any code that assumes it exists is broken. Web workflows are
  anonymous; auth is custom.
- **Web workflows can't use console-specific palType assets.** A page marked `palTypeConsole`
  won't render in a web workflow. Mark assets meant for both contexts with `palTypeCommon`.
- **Dataset access from web is a security surface.** Read the "be cautious" section above
  before adding any dataset read or write.
- **Search engines don't run JavaScript reliably.** Content that must be indexed should be
  rendered server-side in the page HTML, not injected by client JS.
- **The user session model differs between web and console.** A user signed in on the console
  side is not signed in on the web side. If your pal has both, the two auth models are
  independent.