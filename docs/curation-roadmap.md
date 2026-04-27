# Curation roadmap

This document captures the staged plan for evolving deepZEN-curator from a site-checklist browser into a curation tool for plant groups (e.g. Grewia of Madagascar). Phase 1 is the active phase; Phases 2–4+ are sketched at the end and will be re-planned when their turn comes.

## Phase 1: Adapt sidebar to single-group datasets

### Context

deepZEN-curator was built with site-based checklists (Ankarafantsika, Ranomafana) in mind, where the user narrows a broad flora through a stack of taxonomic and trait filters. A second use case is now in view: **herbarium curation of a particular plant group** (e.g. all Grewia of Madagascar). On a Grewia-only dataset every species has the same Order (Malvales), Family (Malvaceae), and Genus (Grewia), so those filter selects collapse to one option each — visual clutter that adds no value.

Phase 1 is the cheap, no-risk first step on the road to a full curation mode (which will eventually include ID editing, notes, open schema, and write-back to the per-user override CSV — see "Future phases" below). Two changes:

1. **Auto-hide degenerate filters** — any filter whose underlying option set has ≤1 distinct value disappears from the sidebar. The same dataset registry, the same components, the same code paths — the sidebar just adapts.
2. **Surface `Clade` as a filter** — `Clade` is already parsed onto the species object but never used. Add it to the filter machinery so when a curator populates Clade with phylogenetic groupings (common in the Grewia-of-Madagascar workflow), it just appears.

The auto-hide rule means Clade itself stays invisible on datasets that don't use it (single value or empty), so this is purely additive — no harm to the existing Ankarafantsika UX.

### Scope

In: sidebar visibility logic, Clade as a filter field, sort-pill visibility for degenerate sort modes.

Out: per-dataset filter declaration in `datasets.js`; open schema (extra columns auto-becoming filters); write-back; ID editing; notes. All deferred to Phases 2–3.

### Approach

#### A. Surface `Clade` end-to-end

`Clade` is already parsed onto species objects (`csv.js:102`). The work is to wire it through the same machinery as `Family`/`Genus`/etc.

1. **`src/lib/utils/csv.js`**
   - Add `cladeSet` alongside the existing trait sets; collect into `allClades` (sorted, falsy filtered) — mirror `allFamilies`.
   - Include `clade` in the `searchText` join so it's discoverable when the v2 text search lands (`searchText` already concatenates name + family + genus + vernacular).
   - Return `allClades` from `parseSpeciesCsv`.

2. **`src/lib/stores/taxa.js`**
   - Add `clade: ''` to the `filterStore` initial value and to the reset block read by `clearFilters` (the reset block lives in the component, not the store; this is an existing duplication).
   - Add `'clade'` to `FILTER_FIELDS`.
   - Add `case 'clade': return species.clade === value;` to `matchesField`.
   - Add `case 'clade': return s.clade;` to `fieldValue`.
   - Add `clade: 'allClades'` to `FIELD_TO_OPTION_SOURCE`.

3. **`src/lib/components/Sidebar.svelte`**
   - Add `clade: ''` to `clearFilters`.
   - Add a Clade `<select>` between Genus and Vernacular (taxonomically the right spot for sub-genus phylogenetic groupings, which is the curator use case). Wire it via `handleTraitChange('clade')`.

#### B. Auto-hide degenerate filters

Hide any filter row whose option list has ≤1 distinct value. Implemented inline as `{#if $taxaStore.allXxx.length > 1}` guards on each filter `<div>` in `Sidebar.svelte`.

| Filter | Source | Hide when |
|---|---|---|
| Order | `$taxaStore.allOrders` | `length ≤ 1` |
| Family | `$taxaStore.allFamilies` | `length ≤ 1` |
| Genus | `$taxaStore.allGenera` | `length ≤ 1` |
| Clade *(new)* | `$taxaStore.allClades` | `length ≤ 1` |
| Vernacular | `$vernacularOptions` | `length ≤ 1` |
| Habit | `$taxaStore.allHabits` | `length ≤ 1` |
| LeafArrangement | `$taxaStore.allLeafArrangements` | `length ≤ 1` |
| LeafForm | `$taxaStore.allLeafForms` | `length ≤ 1` |
| LeafVenation | `$taxaStore.allLeafVenations` | `length ≤ 1` |
| LeafMargin | `$taxaStore.allLeafMargins` | `length ≤ 1` |
| Stipules | `$taxaStore.allStipules` | `length ≤ 1` |
| Exudate | `$taxaStore.allExudates` | `length ≤ 1` |
| StemArmature | `$taxaStore.allStemArmatures` | `length ≤ 1` |
| Tendrils | `$taxaStore.allTendrils` | `length ≤ 1` |

Inline guards beat a derived `availableFilters` store: cheaper, no extra subscription per filter, and the cost (one `.length > 1` check per render) is negligible vs. the existing `filterOptionCounts` pass.

**Edge case — restoring a filter after dataset switch.** A residual filter value (e.g. `family: 'Malvaceae'`) from a previous dataset would persist via `filterStore` even if the new dataset would auto-hide that select. The dataset-switch effect in `+page.svelte` already clears filters on dataset change; this plan assumes that holds. Verify in step 1 of the verification list.

#### C. Auto-hide degenerate sort modes

`SortPills` offers Name / Family / Order. If the dataset has only one Family, the "Family" sort collapses to "Name" (`cmpFamily` falls through to `cmpName`). If only one Order, "Order" collapses to "Family". Hide the redundant pills:

- Hide "Order" pill when `$taxaStore.allOrders.length ≤ 1`.
- Hide "Family" pill when `$taxaStore.allFamilies.length ≤ 1`.
- "Name" is always shown.
- If the active `sortStore` value is a hidden mode (e.g. user had "Family" selected then switched to a Grewia-only dataset), reset to `'name'`. A small `$effect` in `SortPills.svelte` handles this.

### Verification

Manual, in-browser. The app already supports dropping new CSVs into `static/data/` without re-bundling, so testing degenerate datasets is fast.

1. **Existing datasets unchanged.** `npm run dev`, load Ankarafantsika. Confirm every existing filter still renders and behaves identically. Confirm Clade filter is hidden (the shipped CSV's Clade column is sparse / single-valued).
2. **Single-genus dataset.** Make a throwaway CSV with all rows sharing `Family=Malvaceae,Order=Malvales,Genus=Grewia` and varied `Clade` values; drop in `static/data/`, register in `datasets.js`, switch. Expected: Order/Family/Genus selects, Order/Family sort pills, and most trait selects vanish; Clade and Vernacular remain (assuming ≥2 distinct values in each).
3. **Filter persistence on switch.** Load Ankarafantsika, set `Family=Annonaceae`, switch to the Grewia stub, switch back. Filter state should not leak.
4. **Active-sort fallback.** Set sort to "Order" on Ankarafantsika, switch to the Grewia stub. Active sort should reset to "Name".
5. **Clade filter functional.** On the Grewia stub, pick a Clade option; the grid should narrow correspondingly. Counts in `(N)` next to other dropdown options update via `filterOptionCounts`.
6. **`clearFilters` resets cleanly.** With a Clade selected, click "Clear filters". Clade should reset to "All clades", grid should expand.

No automated tests — repository has none and CLAUDE.md doesn't mandate adding any.

## Future phases

### Phase 2 — open schema

Auto-detect any CSV column outside the canonical schema and surface it as a filter when it has >1 distinct value. Lets curators add `Merosity`, `Locality`, `Collector`, etc. without touching code. Per-dataset opt-out via `hiddenFilters: [...]` in `datasets.js`.

### Phase 3 — write-back curation mode

Request `readwrite` permission on the folder handle. Edit `TaxonomicName` inline from a card (re-identify a specimen). Add `Notes` and `EditedAt` (ISO timestamp) columns to the per-user override CSV. Auto-create the override on first edit by cloning the shipped CSV. Persists to the same `<Label>_herbarium_images_<user>.csv` file already used for vernacular-name personalisation. Treat `CatalogueNumber` as the stable specimen identity (already true in the schema).

Together, `CatalogueNumber` (key) + `EditedAt` (last-write-wins ordering) make this data model trivially portable to a row-level cloud DB later — see Phase 4+.

### Phase 4+ — multi-user cloud sync

Discussed but deferred. Two paths considered:

- **Shared cloud folder (low-effort first step).** Curators point deepZEN-curator at a shared Dropbox / OneDrive / Google Drive folder containing per-user override CSVs. Each curator's edits sync via the OS-level file-sync client; the app needs no new code beyond Phase 3. File-level conflicts are rare in practice (different curators work different groups) and handled by the cloud-sync client's existing "(conflict)" copies. Probably indistinguishable from a real DB for <10 curators.
- **TursoDB / libSQL (when shared folder limits bite).** Cloud SQLite with embedded replicas for offline. Worth the move when concurrent writers >10, server-side queries / dashboards are needed, fine-grained access control matters, or a real audit log is required. Caveats for this app: browser embedded replicas need `sqlite-wasm` + a sync layer (not just `@libsql/client/web`); a static-deployed bundle can't safely ship auth tokens, so per-curator tokens pasted at first run is the pragmatic v1; image binaries stay on disk regardless. Migration from Phase 3's CSV is a script, not a rewrite, because the data model is already row-stable.

Default plan: shared cloud folder first (~zero code beyond Phase 3); revisit Turso only if real limits emerge.
