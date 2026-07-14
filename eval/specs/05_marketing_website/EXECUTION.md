# EXECUTION — signal_ridge (palsync test 5)
spec: SPEC.md (status: approved)   mode: lite

## Auto mode
This build runs fully autonomously. The agent executes all tasks end-to-end without stopping
for human input. There are no mid-build gates, no "ask first" pauses, no blocker escalations.
If the agent encounters ambiguity, it proceeds with the most standard approach and documents
what it chose. Human scoring happens once at the end against §12; the agent's desktop
render-inspect-revise, routing, and SEO self-verification remain mandatory during the build;
mobile capture belongs to final review.

## Build plan
Before the first UI task, load `design-build` and checkpoint its six-line design brief; use approved inline SVG icons from `component-library.md` → Icons; validation rules include `debugTagShipped`, `designClassRequired`, `missingFragment`,
`emptyAction`, `pbMain`, and `pbSection` (page shell owns `pb-main`; fragment root is `pb-section`).
Dependency order (leaf-first — foundations before things that use them):
1. Foundation as a standalone first step: use bash `cp` (never read-then-write) to copy the web
   templates from `palbuilder-workflow/references/templates/` (`web-workflow.js` and
   `web-page.html`) plus shell/styles and only behavior scripts with real consumers
   from `design-system-init/references/`; replace `{{PAL_NAME}}`, author readable
   `styles/styles.css`, and register the four runtime entries in `pal.json`, then adapt.
2. Build shared nav/footer fragments and routePage action.
3. Build Home first; this establishes marketing composition.
4. Build Services, About, and Contact with their distinct §6 compositions; never clone the Home
   hero/card structure across routes.
5. Add SEO head values and crawler-file responses for robots.txt, sitemap.xml, llms.txt.
6. Final SEO + desktop/mobile visual audit. Inspect `designAudit` and pixels for every route, fix
   the highest-impact failures, re-render changed viewports, and re-run routing/SEO after visual edits.

Parallel-safe: Services/About/Contact fragments can be drafted independently after T3, but execute
sequentially so nav and SEO keys stay aligned. Sequential: T1 → T2 → T3 → T4 → T5 → T6.
Risks: crawler-file fallthrough to HTML shell, invalid XHTML in fragments, SEO absolute URL rules,
and accidental extra data/workflow scope. Run one `pal_test` per task after that task's final push.
Checkpoints: after T3 (Home renders), after T5 (crawler files), final after T6.

## Tasks
| id | task | tier | spec ref | depends | status | success condition (behavioral + tool-checkable) |
|---|---|---|---|---|---|---|
| T1 | foundation web shell, styles.css, and initial workflow | cheap | §3, §6, §10 | — | todo | Web page shell, matching templates copied with bash `cp`, shell/styles plus only runtime scripts with real consumers present and registered in pal.json, readable `styles.css`; pal_validate 0; pal_test web workflow VALIDATED |
| T2 | shared full-width nav/footer + routePage | standard | §3, §4 global navigation, §5 routePage | T1 | todo | focus-only skip link; familiar non-pill nav; every label routes to matching H1; pal_validate 0 |
| T3 | Home split hero + outcome proof composition | frontier | §4 Home, §6 Home, §12 | T2 | todo | exact Home copy; `What gets steadier` outcomes share first desktop viewport; desktop screenshot audit errors 0 |
| T4 | distinct Services/About/Contact compositions | standard | §4 Services, §4 About, §4 Contact, §6 | T3 | todo | Services numbered list, About editorial split, compact Contact panel; exact copy; no cloned generic template; pal_test VALIDATED |
| T5 | SEO head values + crawler files | standard | §5 robotsTxt/sitemapXml/llmsTxt, §7, §12 | T4 | todo | pal_seo_audit 0 errors; robots.txt/sitemap.xml/llms.txt return non-HTML crawler bodies with exact §4/§7 strings |
| T6 | final route/SEO/visual audit + refinement | standard | §12 | T5 | todo | pal_validate/test/SEO pass; desktop + mobile screenshots for all routes have designAudit errors 0; rubric average >=1.5 with focal point/spacing/responsive =2 and no 0; changed viewports re-captured; routing/SEO still pass |

## Checkpoints (append-only, one line per completed task)
## Blockers (what needs the human — be exact)
None — auto mode; workspace set by evaluator before run.
