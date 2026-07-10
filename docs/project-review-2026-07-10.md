# Project review - deepZEN-curator

**Date:** 2026-07-10

## Critical findings

### 1. P0: correction saves can become partially persisted

The identification log is written first, then the specimen is mutated before the override file succeeds (`src/lib/components/SpecimenEditModal.svelte:185`). If the second write fails, the UI reports failure even though the identification persisted. For correction-only failures, retrying can appear to have no changes because memory was already mutated.

Persist from an immutable copy, update stores only after success, and make partial outcomes explicit and retryable.

### 2. P0: the current SDM encoding loses information

The generator independently rescales each raster's minimum to `0` (`scripts/generate-distributions.js:94`), while the decoder treats `0` as no-data/unsuitable (`src/lib/utils/distributions.js:78`). Thus valid minimum predictions disappear, no-data is ambiguous, and colours are not necessarily comparable between species.

### 3. P1: specimen filters exclude many valid map records

Species qualification is based on matching image filenames (`src/lib/stores/taxa.js:344`). The shipped Kew datasets contain 126 barcoded but imageless specimens, 119 of which are mapped. These cannot reliably be found on the map by barcode, country, or herbarium.

### 4. P1: anchored islands are inconsistently region-filtered

Browse and Map use display coordinates, including island anchors, but Data uses recorded `lat/lng` (`src/lib/components/CurationView.svelte:85`). The three views can therefore disagree about an approximate island record.

### 5. P1: SDM state can become stale

The decoded cache is keyed only by taxon (`src/lib/components/MapView.svelte:182`). Switching to another folder for the same dataset can reuse the previous folder's raster. The Map is also hidden when there are no occurrence coordinates (`src/lib/components/BrowseCurateToggle.svelte:11`), even if that folder contains distribution models.

### 6. P1: the release gate is not green

`npm run check` fails because 11 checklist taxa lack images, although the parser deliberately supports barcode-less placeholders. This needs an explicit dataset contract rather than disagreement between parser and validator.

Sarcolaenaceae also has nine Madagascar-labelled coordinates outside Madagascar, several with obvious sign or transcription problems.

### 7. P2: coverage is strongest below the UI

Geo and curation round-trip checks pass, but no automated browser workflow covers dataset switching, folder changes, saving, map interaction, or SDMs. The production build succeeds with four map accessibility warnings. `MapView.svelte` has also reached 1,501 lines, so extending it in place will increase regression risk.

## What is working well

The underlying architecture remains strong:

- The app is genuinely offline and does not bundle specimen images.
- The derived data layer is thoughtful and avoids repeated sorting.
- Generation guards are used consistently around asynchronous work.
- The curation parsing, persistence, and round-trip checks pass.
- The complete build is only about 1.6 MB before external images and models.
- Keeping model assets beside the selected collection is the correct delivery direction.

## Recommended SDM direction

Binary modelled ranges should be the default, but they should be labelled **modelled suitable range**, not simply *range* or *presence*. A thresholded SDM is an inference, and its extent can change substantially with the chosen threshold. That choice must be recorded and scientifically defensible rather than applied casually in the browser. [Recent thresholding research](https://besjournals.onlinelibrary.wiley.com/doi/10.1111/2041-210x.70226) reinforces how strongly this choice affects mapped area.

Continuous suitability should remain available as an optional expert inspection mode. It should not be called probability unless the model output is genuinely calibrated; presence-only MaxEnt-style outputs commonly are not direct occurrence probabilities. [Yackulic et al.](https://besjournals.onlinelibrary.wiley.com/doi/10.1111/2041-210x.12004) discuss this distinction directly.

### Multiple-species display

- Permit selection of up to 16 ranges.
- Default to an **overlap-count layer**, using one sequential scale from `1...N`.
- At hover, report the count and names of the selected species present in that cell.
- Keep global fill opacity adjustable, while coastlines and range boundaries remain stronger.
- Do not encode 16-way overlap by blending 16 categorical colours. It quickly becomes muddy and cannot reveal which combination produced a colour.
- Use the existing categorical palette for occurrence points, individual range outlines, or a later 4x4 small-multiple comparison.
- Treat overlap count as exploratory. Naively stacking thresholded SDMs can bias richness estimates, as demonstrated by [Calabrese et al.](https://onlinelibrary.wiley.com/doi/10.1111/geb.12102).

The range selection should be independent of the map legend's hidden-species state. Hiding occurrences and selecting model layers are different operations and should not share a store.

## Dataset delivery

The selector should list only collections included in that particular distribution.

The current compiled registry (`src/lib/datasets.js:9`) should become a runtime `datasets.json` manifest. A packaging command could then produce:

- A Ranomafana-only edition.
- A Macaranga and Sarcolaenaceae edition.
- A full development or research edition.
- Any future combination without rebuilding the application code.

Only listed CSVs should be copied into `build/data`. When one collection is present, show its name without a dropdown. This is primarily a relevance and user-confidence improvement; the four CSVs themselves occupy only about 1.1 MB.

The app should not infer availability from failed CSV requests or scan for arbitrary files. A small explicit manifest is deterministic, testable, and compatible with the static offline server.

## Recommended plan

### Phase 1: stabilise current behaviour

1. Fix save failure semantics using an immutable working copy.
2. Do not mutate `taxaStore` objects until the corresponding file write succeeds.
3. Make combined identification and correction saves retry-safe, with explicit reporting if only one file was written.
4. Add last-modified conflict detection before replacing a correction CSV that may have been edited externally.
5. Fix specimen-level filters so they operate over specimens rather than only image filenames.
6. Use display coordinates consistently for region filtering, including island anchors.
7. Decide whether barcode-less checklist entries are valid warnings or invalid records, document the decision, and make `npm run check` pass accordingly.
8. Add validation warnings for country/coordinate inconsistencies, duplicate barcodes, conflicting duplicate rows, and duplicate image filenames.
9. Correct or explicitly annotate the suspicious Sarcolaenaceae coordinates.
10. Resolve the current map keyboard-accessibility warnings.
11. Include the curation persistence checks in the normal release gate.

### Phase 2: introduce collection packaging

1. Add a versioned runtime dataset manifest containing `defaultDatasetId` and the available dataset entries.
2. Load and validate it before restoring the persisted dataset selection.
3. Add a packaging command such as `npm run package -- --datasets=ranomafana`.
4. Copy the common application build, selected CSVs, launchers, and appropriate README into the release directory.
5. Validate unique IDs, an existing default dataset, existing CSV files, and the absence of unlisted CSVs.
6. Keep a full four-collection manifest for development and internal research builds.

### Phase 3: replace the SDM data contract

Revise the manifest before any model package is distributed. It should record:

- A manifest schema version.
- The exact scientific name and optional aliases.
- A stable model identifier distinct from the filename slug.
- CRS, bounding box, grid dimensions, resolution, and no-data encoding.
- The source output type and its value scale.
- The threshold value and threshold-selection method.
- Model algorithm and version.
- Model generation date and source-data date.
- Number of occurrence records used.
- Evaluation metrics and validation method.
- Provenance or source reference.

All range masks intended for overlap should be resampled during preparation onto one aligned Madagascar grid. Suitability rasters should preserve no-data separately from valid zero or minimum suitability. The prep script should fail on an unexpected CRS, rotated grid, invalid bounds, missing threshold, taxon-key collision, or incompatible grid.

Small checked-in raster fixtures should test:

- No-data preservation.
- Minimum and maximum value encoding.
- Threshold conversion.
- Pixel lookup at bounds and cell centres.
- Geographic placement.
- Taxon aliases and slug collisions.
- Pixel-wise overlap counts.

### Phase 4: implement range-first rendering

1. Extract the SDM loader, decoded-raster cache, and layer controls from `MapView.svelte` before expanding the feature.
2. Cache by folder identity, model identifier, file metadata, and manifest version rather than taxon alone.
3. Clear selected models and decoded assets when the collection folder changes.
4. Make Map available whenever the dataset has occurrence points or a valid model manifest.
5. Add a selected-range set capped at 16 species.
6. Add **Overlap** and **Inspect species** display modes.
7. Render overlap with a sequential count scale, not categorical colour blending.
8. Label continuous values as suitability unless the manifest explicitly declares calibrated occurrence probability.
9. Label binary cells as modelled suitable range and expose the threshold method in concise metadata.
10. Add loading, missing-file, malformed-manifest, and incompatible-grid states rather than silently hiding the feature.
11. Add range-aware tooltips and a global opacity control.
12. Consider switching biomes off automatically while a model layer is active to reduce competing fills.

### Phase 5: verification and field pilot

1. Add a focused Playwright Chromium suite covering dataset switching, Map availability from model-only data, range selection, overlap counts, folder changes, and failed-save recovery.
2. Compare two or three well-understood species with occurrence points and expert expectations.
3. Evaluate threshold sensitivity during model preparation rather than exposing an arbitrary threshold slider in the field UI.
4. Verify coastline alignment and no-data behavior at Madagascar's edges.
5. Benchmark loading, memory use, opacity changes, and hover queries with 16 selected masks on the intended field laptop.
6. Confirm that re-identifications and synonyms resolve to the intended model through manifest names or aliases.

## Branch recommendation

Keep `feat/sdm-distributions` as the prototype branch and do not merge it unchanged. Its on-drive delivery approach is good, but the raster contract, cache identity, scientific terminology, and multi-species comparison model should be revised while no distributed model data depends on them.

## Validation performed

- `npm run check:geo` passed.
- `npm run build` passed, with four map accessibility warnings.
- `npm run check:phaseb` passed.
- `npm run check:phaseb:persist` passed.
- `npm run check` failed at `check:data` because 11 barcode-less checklist taxa are currently treated as species without images.
- The working tree was clean before this report was added.

## Phase 1 implementation update - 2026-07-10

Phase 1 was implemented after this review:

- Correction saves now serialise an immutable candidate specimen Map and update shared state only after durable writes succeed.
- Combined correction and identification saves are ordered and retry-safe; exact identification-log tails are de-duplicated.
- Loaded correction-file timestamps are tracked, and external/newer CSV edits produce a conflict instead of being overwritten.
- Specimen-level filters now qualify species from all barcoded specimens, including mapped records without images.
- Data-region filtering now uses display coordinates consistently, including island anchors.
- Barcode-less checklist rows are an explicit per-dataset contract; barcoded imageless sheets are documented as valid Data/Map records.
- Data validation now reports duplicate/conflicting barcodes, duplicate image ownership, imageless barcoded sheets, and Madagascar coordinate inconsistencies.
- The nine suspicious Sarcolaenaceae coordinates are explicitly documented in `scripts/data-quality-notes.js` pending source verification; the shipped values were not guessed or silently changed.
- The SVG map and its specimen/stack markers now have keyboard pan, zoom, reset, focus, and activation behavior.
- `npm run check` now includes data, geo, Phase B parity, Phase B persistence, focused reliability checks, and the production build.

Focused regression coverage lives in `scripts/verify-reliability.js` and exercises imageless specimen filtering, anchored-region filtering, immutable correction writes, external-file conflicts, aborted failed streams, and idempotent identification retries.
