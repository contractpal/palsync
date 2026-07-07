# eval/scoring.md — §12 evaluation sheets

One sheet per scenario. Each row is a single §12 acceptance criterion, copied one-to-one from the
spec — **do not add criteria the spec does not list, do not merge two into one.** Score post-hoc,
once, after the run finishes (never mid-run). Two evaluators using this sheet should produce the
same pass/fail.

- **Check** — `[x]` pass, `[ ]` fail, `[~]` partial (explain in Evidence; a partial counts as fail
  for the pass/total tally unless the spec's criterion is itself a list where some sub-items pass).
- **Evidence** — REQUIRED for every row: what you checked and how (which tool output, which
  screenshot, which pal.json field, which rendered fragment). "Looks right" is not evidence.

Tally the per-sheet **pass/total** into the `§12 (pass/total)` column of
[`eval/RESULTS.md`](RESULTS.md). Copy the sheet per run — keep filled sheets alongside the run's
transcript.

Reference tools: `pal_validate` (offline lint), `pal_test` (workflow validation), `pal_preview` /
`pal_fetch` / `pal_screenshot` (render), `pal_tunnel_test` (tunnel workflows), `pal_seo_audit`
(SEO/crawler files), `pal.json` + workflow source (structure inspection).

---

## Scenario 01 — crud_equipment_checkout

Run: date __________ · model __________ · orch __________ · palbuilder __________

**Global floor**
| # | Check | Criterion | Evidence |
|---|---|---|---|
| G1 | [ ] | `pal_validate` reports 0 errors | |
| G2 | [ ] | `pal_test` console workflow VALIDATED, 0 notes | |
| G3 | [ ] | every §3 nav link routes (no dead links): list, showForm, showCheckout, saveEquipment, checkoutEquipment, checkinEquipment, deleteEquipment | |
| G4 | [ ] | REGRESSION: the pal-init baseline still passes and untouched UI did not shift. | |

**Console pages**
| # | Check | Criterion | Evidence |
|---|---|---|---|
| C1 | [ ] | VISUAL (Equipment list): PageHeader `Equipment`, striped table, status badges, no emoji | |
| C2 | [ ] | Data effects: after each §5 write, a follow-up list render shows the new/changed/deleted row | |

**Happy-path**
| # | Check | Criterion | Evidence |
|---|---|---|---|
| H1 | [ ] | saveEquipment: valid name → list contains the new row | |
| H2 | [ ] | saveEquipment edge: empty name → form re-renders with `Name is required.` and no row is written | |
| H3 | [ ] | checkoutEquipment: valid assignee → row shows `checkedOut` badge and the assignee name | |
| H4 | [ ] | checkoutEquipment edge: empty assignee → form re-renders with `Enter a name to check this item out.` and row remains available | |
| H5 | [ ] | checkinEquipment → row returns to `available`, checkedOutTo is blank | |
| H6 | [ ] | deleteEquipment: Delete link has exact confirm text; after confirmation, row is absent from the list | |

**Total: ____ / 12**

---

## Scenario 02 — data_structures_company_directory

Run: date __________ · model __________ · orch __________ · palbuilder __________

**Global floor**
| # | Check | Criterion | Evidence |
|---|---|---|---|
| G1 | [ ] | `pal_validate` reports 0 errors | |
| G2 | [ ] | `pal_test` console workflow VALIDATED, 0 notes | |
| G3 | [ ] | every §3 nav link routes (no dead links): list, showForm, saveEmployee, filterByOffice | |
| G4 | [ ] | REGRESSION: the pal-init baseline still passes and untouched UI did not shift. | |

**Console pages**
| # | Check | Criterion | Evidence |
|---|---|---|---|
| C1 | [ ] | VISUAL (Directory): H1 `Employee directory`, FilterBar, striped table, Department and Office columns populated by names/cities rather than ids/codes, no emoji | |
| C2 | [ ] | Data effect: after saveEmployee, a follow-up directory render contains the new employee row with the correct department name and office city | |

**Happy-path**
| # | Check | Criterion | Evidence |
|---|---|---|---|
| H1 | [ ] | saveEmployee: valid input → row appears with department name and office city | |
| H2 | [ ] | saveEmployee edge: bad email → `Enter a valid email address.`, and no row is written | |
| H3 | [ ] | filterByOffice: choose Cedar City / CED → only CED rows render; `All offices` restores full list | |
| H4 | [ ] | settings read: footer renders `Questions? Contact help@acmerentals.example` | |
| H5 | [ ] | settings read: directory page size is read from directoryPageSize=`25`, not hard-coded in markup | |

**Structure-choice**
| # | Check | Criterion | Evidence |
|---|---|---|---|
| S1 | [ ] | offices stored in the platform's fixed tabular reference structure, not a DataSet and not hard-coded HTML/workflow strings | |
| S2 | [ ] | settings stored in the platform's key-value data structure, not a DataSet and not hard-coded | |
| S3 | [ ] | directory read implemented via the platform's join/read-model structure, not N+1 department lookups inside a row loop | |

**Total: ____ / 14**

---

## Scenario 03 — console_tx_service_requests

Run: date __________ · model __________ · orch __________ · palbuilder __________

**Global floor**
| # | Check | Criterion | Evidence |
|---|---|---|---|
| G1 | [ ] | `pal_validate` reports 0 errors | |
| G2 | [ ] | `pal_test` console workflow VALIDATED, transaction workflow VALIDATED, 0 notes | |
| G3 | [ ] | every §3 nav link routes (no dead links): list, showForm, createRequest, viewRequest, cancelRequest, tx page, completeRequest | |
| G4 | [ ] | REGRESSION: the pal-init baseline still passes and untouched UI did not shift. | |

**Console + transaction pages**
| # | Check | Criterion | Evidence |
|---|---|---|---|
| C1 | [ ] | VISUAL (Request list): H1 `Service requests`, Status filter, StatusBadge values per DESIGN_SYSTEM, no emoji | |
| C2 | [ ] | VISUAL (Customer completion): H1 `Confirm your service request`, request description, resolution note field, and submit button render on tx.html | |
| C3 | [ ] | Data effects: every write is confirmed by a follow-up read in requestList/requestDetail | |

**Happy-path**
| # | Check | Criterion | Evidence |
|---|---|---|---|
| H1 | [ ] | createRequest: valid input → list shows a new `open` row and a live transaction exists for it | |
| H2 | [ ] | createRequest edge: bad email → `Enter a valid customer email.`, no row, no transaction | |
| H3 | [ ] | createRequest edge: empty description → `Description is required.`, no row, no transaction | |
| H4 | [ ] | viewRequest: detail renders all §4 rows including `Transaction state` | |
| H5 | [ ] | completeRequest: submitting tx.html renders the thank-you line and console row flips to `completed` with resolutionNote and completedAt | |
| H6 | [ ] | cancelRequest: open row flips to `cancelled`, linked transaction is voided/cancelled, and `Cancel request` is absent on non-open rows | |

**Total: ____ / 13**

---

## Scenario 04 — interpal_tunnels_partner_bridge

Run: date __________ · model __________ · orch __________ · palbuilder __________

**Global floor**
| # | Check | Criterion | Evidence |
|---|---|---|---|
| G1 | [ ] | `pal_validate` reports 0 errors | |
| G2 | [ ] | `pal_test` console workflow VALIDATED, tunnel workflow VALIDATED, console webservice workflow VALIDATED, 0 notes | |
| G3 | [ ] | every §3 nav link routes (no dead links): dashboard, syncCatalog, checkProviderHealth, quoteAvailability, bridgeStatus | |
| G4 | [ ] | REGRESSION: the pal-init baseline still passes and untouched UI did not shift. | |

**Console + integration**
| # | Check | Criterion | Evidence |
|---|---|---|---|
| C1 | [ ] | VISUAL (Bridge dashboard): H1 `Partner bridge`, action row, DetailPanel statuses, DataTable, and no emoji | |
| C2 | [ ] | syncCatalog: dashboard renders `Catalog sync complete.` and rows AX-100, BX-200, CX-300 with source `tunnel` | |
| C3 | [ ] | checkProviderHealth: dashboard renders `Provider health check passed.` and providerHealth=`ok` | |
| C4 | [ ] | Failure handling: bad/unavailable provider renders `Partner integration failed.` without deleting existing partnerCatalog rows | |

**Provide/request API checks**
| # | Check | Criterion | Evidence |
|---|---|---|---|
| A1 | [ ] | Local tunnel provide direction: quoteAvailability sku=BX-200 returns `availability:` and `lowStock` | |
| A2 | [ ] | Local webservice provide direction: bridgeStatus returns JSON keys `status`, `lastSyncAt`, `rowCount`, with rowCount=3 after sync | |
| A3 | [ ] | Source review: provider tunnel call, provider webservice call, local tunnel workflow, and local console webservice workflow are present; no browser fetch/ClientPal is used | |

**Total: ____ / 11**

---

## Scenario 05 — marketing_website

Run: date __________ · model __________ · orch __________ · palbuilder __________

**Global floor**
| # | Check | Criterion | Evidence |
|---|---|---|---|
| G1 | [ ] | `pal_validate` reports 0 errors | |
| G2 | [ ] | `pal_test` web workflow VALIDATED, 0 notes | |
| G3 | [ ] | every §3 nav link routes (no dead links): home, services, about, contact, robots.txt, sitemap.xml, llms.txt | |
| G4 | [ ] | REGRESSION: the pal-init baseline still passes and untouched UI did not shift. | |

**Web pages**
| # | Check | Criterion | Evidence |
|---|---|---|---|
| W1 | [ ] | Home contains exact H1 `Field operations that stay on schedule` | |
| W2 | [ ] | Services contains exact H1 `Services for teams outgrowing spreadsheets` | |
| W3 | [ ] | About contains exact H1 `Built for practical operators` | |
| W4 | [ ] | Contact contains exact H1 `Plan the next steady week` | |
| W5 | [ ] | VISUAL (Home): MarketingHero, three cards, CTA, and FooterNav render per DESIGN_SYSTEM.md with no emoji and no centered-everything layout | |

**Indexable pages**
| # | Check | Criterion | Evidence |
|---|---|---|---|
| I1 | [ ] | `pal_seo_audit` reports 0 errors for Home, Services, About, and Contact | |
| I2 | [ ] | robots.txt returns text containing `User-agent: *`, `Allow: /`, and the absolute sitemap URL | |
| I3 | [ ] | sitemap.xml returns XML containing all four canonical URLs | |
| I4 | [ ] | llms.txt returns text containing `Signal Ridge` and the approved summary line | |

**Happy-path**
| # | Check | Criterion | Evidence |
|---|---|---|---|
| H1 | [ ] | Navigation: every global nav label routes to its matching H1 | |
| H2 | [ ] | Contact CTA: `Email Signal Ridge` uses a mailto link for hello@signalridge.example | |

**Total: ____ / 15**
