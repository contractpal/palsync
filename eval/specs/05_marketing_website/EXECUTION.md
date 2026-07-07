# EXECUTION — signal_ridge (palsync test 5)
spec: SPEC.md (status: approved)   mode: lite

## Auto mode
This build runs fully autonomously. The agent executes all tasks end-to-end without stopping
for human input. There are no mid-build gates, no "ask first" pauses, no blocker escalations.
If the agent encounters ambiguity, it proceeds with the most standard approach and documents
what it chose. All review — visual, SEO, and routing — happens once at the end by a human
evaluator against §12.

## Build plan
Dependency order (leaf-first — foundations before things that use them):
1. Apply the `web-marketing` starter via `palsync scaffold`, then adapt web.html and web.js.
2. Build shared nav/footer fragments and routePage action.
3. Build Home first; this establishes marketing composition.
4. Build Services, About, and Contact by cloning the Home structure.
5. Add SEO head values and crawler-file responses for robots.txt, sitemap.xml, llms.txt.
6. Final SEO/render audit.

Parallel-safe: Services/About/Contact fragments can be drafted independently after T3, but execute
sequentially so nav and SEO keys stay aligned. Sequential: T1 → T2 → T3 → T4 → T5 → T6.
Risks: crawler-file fallthrough to HTML shell, invalid XHTML in fragments, SEO absolute URL rules,
and accidental extra data/workflow scope. Verify web workflow compile with pal_test after pushes.
Checkpoints: after T3 (Home renders), after T5 (crawler files), final after T6.

## Tasks
| id | task | tier | spec ref | depends | status | success condition (behavioral + tool-checkable) |
|---|---|---|---|---|---|---|
| T1 | scaffold web shell + workflow skeleton | cheap | §3, §6, §10 | — | todo | pal_validate 0 errors; pal_test web workflow VALIDATED |
| T2 | shared nav/footer + routePage | standard | §3, §4 global navigation, §5 routePage | T1 | todo | every nav label routes to matching H1; pal_validate 0 |
| T3 | Home fragment composition | frontier | §4 Home, §6 Home, §12 | T2 | todo | pal_preview/fetch Home contains H1 `Field operations that stay on schedule` and three card headings |
| T4 | Services/About/Contact fragments | standard | §4 Services, §4 About, §4 Contact, §6 | T3 | todo | each route renders its exact §4 H1 and approved copy; pal_test VALIDATED |
| T5 | SEO head values + crawler files | standard | §5 robotsTxt/sitemapXml/llmsTxt, §7, §12 | T4 | todo | pal_seo_audit 0 errors; robots.txt/sitemap.xml/llms.txt return non-HTML crawler bodies with exact §4/§7 strings |
| T6 | final route/render audit | cheap | §12 | T5 | todo | pal_validate 0; pal_test VALIDATED; all §12 WEB and INDEXABLE checks have evidence |

## Checkpoints (append-only, one line per completed task)
## Blockers (what needs the human — be exact)
None — auto mode; workspace set by evaluator before run.
