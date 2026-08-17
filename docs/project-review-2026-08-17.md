# Project review — deepZEN-curator

**Date:** 2026-08-17
**Version reviewed:** v1.4.1 (`main`, commit `eea1458`)

## Context

You asked how the project can be improved, and specifically whether it can be used for a single
taxon project — Sarcolaenaceae curation, Ficus curation, Macaranga curation — rather than the site
checklists it started as.

Short answer: it already does taxon curation. Macaranga and Sarcolaenaceae are registered
datasets today, both specimen-level Kew exports with types, collectors, coordinates and DNA
fields. What is missing is not capability but **project packaging and project-appropriate
defaults**: you cannot hand a Sarcolaenaceae worker a build that contains only Sarcolaenaceae and
opens configured for it.

This review follows `project-review-2026-06-23.md` and `project-review-2026-07-10.md`. Phase 1 of
the July plan landed in `eea1458`, and the release gate is now green — `check:data` and
`check:reliability` pass, emitting warnings only.

## Evidence: the two dataset shapes already in the app

| Dataset | Rows | Taxa | Specimen columns | Coords | Images | Traits |
|---|---|---|---|---|---|---|
| Ankarafantsika | 1548 | 394 | none | – | – | populated |
| Ranomafana | – | 659 | none | – | – | populated |
| Macaranga (Kew) | 539 | 21 | full | 385 | 519 | empty |
| Sarcolaenaceae (Kew) | 787 | 82 | full | 567 | 681 | empty |

The site checklists carry trait data and no specimen data. The taxon monographs are the exact
inverse: zero `Habit`, `Clade`, `Locality` or `VernacularName`, and rich specimen data (421
distinct collectors, 65 type sheets and 787 institution codes in Sarcolaenaceae alone). The
sidebar's degenerate-filter auto-hide means both shapes already render sensibly, so the divide is
in defaults and delivery, not in the data layer.

## Findings

### F1 — There is no per-project build

`src/lib/datasets.js` is a compiled-in array, so every zip ships all four collections and the
selector offers Ankarafantsika and Ranomafana to a Sarcolaenaceae curator. Producing a
single-collection edition means editing source and rebuilding. This is the unimplemented Phase 2
of the July review and the single biggest blocker to project use.

### F2 — Dataset kind is implicit, so monographs inherit checklist defaults

`allowBarcodeLess` is the only per-dataset flag. Three defaults are wrong for a monograph:

- `+page.svelte:177` hard-codes `mapExtentStore.set('madagascar')` on every dataset switch.
  Macaranga has 21 sheets from Comoros, Mayotte and Mauritius, all without coordinates, so they
  are island-anchored and hidden at the Madagascar extent by `isOffMadagascarAnchor`. The map
  opens missing exactly the island material a Macaranga worker wants, and nothing on screen says
  so. `detectExtent` already resolves this correctly from the data; it is simply not the default.
- Sort defaults to `family`, which is meaningless when the dataset is one family.
- The `tree`+`shrub` habit default is dead weight where `Habit` is empty, and would actively hide
  material in a genus with mixed habits.

### F3 — There is no project progress view

Monographic curation is a work queue and the app cannot state how far through it is. Everything
needed is already parsed: Sarcolaenaceae has 10 indeterminate taxa of 82, 106 barcoded sheets
without images, 65 type sheets and 220 sheets without coordinates. A progress panel plus
one-click "needs attention" filters (indet, no coordinates, no image, no collector, unsequenced)
would turn the tool from a browser into a project tracker.

### F4 — No collection-date filter

`CollectionDate` is filled on 703/787 Sarcolaenaceae and 471/539 Macaranga rows, and
`specimenSearchPredicate` (`stores/taxa.js:279`) has no year field. "Capuron material",
"collected since 2000" are routine monographic queries. The predicate is already the shared
narrowing point for Browse, Curate and Map, so this is a small addition.

### F5 — Single curator by design

The per-folder override CSV plus append-only identification log works well for one person. Two
curators on one collection produce two files with no merge path. Identification logs are
append-only and would replay cleanly; specimen corrections would need last-writer-wins plus a
conflict report.

### F6 — DNA status is stranded in a free-text column

Sarcolaenaceae has `LeafSample`, `DNAextracted` and `DNAsequenced` entirely empty while
`DNAnotes` carries "Not attempted" on 521 rows. The status is sitting in the notes column, so the
DNA border and badge system built for exactly this dataset reports nothing. Either populate the
structured columns during export or map the known note vocabulary onto them at parse time.

The nine flagged Sarcolaenaceae coordinates (documented in `scripts/data-quality-notes.js`) also
remain unresolved at source. They are annotated, not fixed, which is the right call — but they
are still wrong in the shipped data.

### F7 — Scale is untested past ~1,500 rows, and Ficus is the case that tests it

No virtual scrolling is an explicit design rule, the map colour cap is 16 species, and the legend
lists every species. Malagasy Ficus (roughly 25 species) drops straight in. A pantropical Ficus
monograph does not: the map extents are Madagascar, WIO and Global only, Global is a coarse
locator with no country borders, and specimen counts would be an order of magnitude past anything
tested. `KNOWN_HABITS` (`utils/csv.js:8`) would also need `hemiepiphyte`; it currently holds
tree, shrub, herb, liana and epiphyte, with only `climber → liana` aliased.

Decide the geographic scope before promising Ficus.

### F8 — Known structural debt, carried forward

`MapView.svelte` is 1424 lines and there is still no browser test suite, both noted in the July
review. Neither blocks project use, but both raise the cost of the next map feature.

## Recommendations

- **A1** Replace the compiled registry with a runtime `datasets.json` manifest and add
  `npm run package -- --datasets=sarcolaenaceae`, copying only the listed CSVs and dropping the
  selector control when one collection is present.
- **A2** Add per-dataset defaults alongside `allowBarcodeLess`: `kind`, map extent, sort and habit
  defaults. Monographs get `auto` extent, which resolves Macaranga to WIO through the existing
  `detectExtent` path.
- **A3** Add a project progress panel and "needs attention" filters (F3).
- **A4** Add a collection-year range to the specimen predicate (F4).
- **A5** Decide Ficus scope before promising it, and extend the habit vocabulary if it goes ahead
  (F7).
- **A6** Add curator-file merge once more than one person works a collection (F5).

A1 and A2 are days of work, not a redesign, and they are what "use it for one project" actually
requires. A3 and A4 are the next highest value per unit of effort.

## What is working well

- The two dataset shapes coexist without special-casing: degenerate filters and sort modes
  auto-hide, so a single-family dataset renders a clean sidebar with no code branches.
- The specimen filter layer is already strong — collector series, collection number, country,
  herbarium, type status, leaf sample, DNA sequenced and free text, all shared across Browse,
  Curate and Map so the three views narrow in lock-step.
- Phase 1 of the July review is genuinely done. Correction saves work from an immutable candidate,
  combined saves are retry-safe, external edits are detected rather than overwritten, and
  `scripts/verify-reliability.js` covers those paths.
- The release gate is green and the validator now reports real data problems (duplicate barcodes,
  conflicting rows, imageless sheets, coordinate inconsistencies) as warnings with named records.
- The build is still small and genuinely offline, with two runtime dependencies.

## Validation performed

- `npm run check:data` — passes. Warnings only: 11 checklist taxa without barcodes (an explicit
  per-dataset contract), 126 imageless barcoded sheets across the two Kew datasets, and the nine
  annotated Sarcolaenaceae coordinate issues.
- `npm run check:reliability` — passes, all four groups.
- Dataset profiling was done directly against the four shipped CSVs in `static/data/`.
- The working tree was clean before this report was added.

## Implementation note

A1 and A2 are implemented on `feat/dataset-manifest-packaging`, alongside this document. A3–A6
are not started.
