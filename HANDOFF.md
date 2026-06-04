# Session handoff — per-specimen data model + curation mode

> Working notes for resuming the deepZEN-curator "Phase A/B" work. Living
> document on the feature branch; delete before merging to main.

## How to resume

- **Branch:** `phase-a-per-specimen-data-model`
- **Latest commit:** `4b0f645` "Add per-specimen data model + Macaranga importer (Phase A)"
- **State:** committed **unsigned** (the commit-signing server was erroring) and
  **not pushed** — this container has no git remote, no `gh`. To continue
  elsewhere the branch has to be surfaced via the web UI / pulled locally.
- Re-read this file first, then `src/lib/utils/csv.js` and
  `scripts/import-macaranga.js`.

## The sync situation (important)

Two halves that have never met:
- **Code** (parser changes + converter) lives only on this branch in the
  container.
- **Data** (`Macaranga_Kew_260604.csv`) + images live only on the user's local
  Windows machine (`static\data\`), never synced into the container.

So nothing here has been run against the real dataset. Verification so far is via
parity/round-trip scripts and `npm run build`, not real data or a browser.

## What's done (Phase A) — committed

`src/lib/utils/csv.js`
- Builds `specimensByCatalogue` (Map keyed by `CatalogueNumber`) alongside the
  existing species view. `buildSpeciesView(specimens)` is factored out so a later
  re-identification step can rebuild the view.
- Per-specimen fields: taxonomy, traits, parsed `lat`/`lng`, `locality`,
  `recordedBy`, `recordNumber`, `collectionDate`, `occurrenceId`, `editedAt`,
  `imageFiles[]`, `hasImage`, `currentDetermination`.
- `geolocatedSpecimens` = barcoded specimens with valid coords (includes
  imageless ones, so they still map).
- **Legacy parity:** Ankarafantsika + Ranomafana parse byte-identically to before
  (verified by diffing fingerprints of the species view + all option sets).

`scripts/import-macaranga.js` — converts a raw Kew export → app CSV schema.
- Idempotent (reads old spaced headers, new compact headers, AND its own output);
  safe to run in place. Auto-detects tab/comma delimiter. Dates `DD/MM/YYYY` |
  `DD-MM-YYYY` | ISO → ISO. Coords rounded to 6 dp. Output named after the source
  file, written to `static/data/`.
- Emits data-quality warnings (see rules below) and still writes the file.

## Settled data-model decisions (the hard-won bits)

- **`CatalogueNumber`** = the Kew barcode = specimen key. Always present, **one row
  per specimen**. Keep the column name `CatalogueNumber` (not "Barcode") — it's
  the convention across all datasets and the code.
- **`ImageFile`** = image file basenames, **separate from the accession**. A cell
  holds **0–3** names, `;`-separated, e.g. `K004152211; K004152211_a`.
  - Naming: a sheet's images come from `{base, base_a, base_b}`. **Any subset may
    survive** (a redundant scan can be deleted, keeping e.g. only `_a`). So there
    is NO "unicate = base" rule and NO no-gaps rule.
  - Parser splits `ImageFile` into `imageFiles[]`; each renders one grid
    thumbnail. The grid shows the file basename, which may differ from the
    accession. Imageless-but-georeferenced specimens stay on the map.
  - Legacy datasets have no `ImageFile`/`Barcode` column → fall back to naming
    files by `CatalogueNumber` (preserves their behaviour).
- **`Image Count`** (Kew's) is dropped — unreliable (user may have deleted a
  redundant image) and derivable from `ImageFile`.
- **`Country`** has **multiple values** (Madagascar, Comoros, Mayotte, Réunion,
  Mauritius…). It must filter at the **specimen** level (not species).
- Field renames in the user's latest source: `Collectors` (→ `RecordedBy`),
  `CollectionNumber` (→ `RecordNumber`; was `CollectorNumber`), `Latitude(dd)`,
  `Longitude(dd)`. Internal field stays DwC `recordNumber`, UI label "Collection
  number".

### Converter data-quality rules
- Blank `CatalogueNumber` → warn (should always be present).
- Duplicate `CatalogueNumber` → warn (one row per specimen).
- `ImageFile` cell with >3 names or a repeat → warn.
- A name not in `{base, base_a, base_b}` for its barcode (wrong stem / bad suffix
  like `_c`) → warn. Lone `_a`, `base + _b`, etc. are allowed.
- Same image file under two barcodes → warn.

## Sidebar ↔ columns (current vs desired)

Consistent (correctly absent from sidebar): `Type`, `TypeName`, `FullName`,
`CollectionDate`, `Collectors`, `CollectionNumber`, `Latitude`, `Longitude`,
`ImageFile`.

Not yet built (desired):
- **Search box** matching `CatalogueNumber` + `Collectors` + `CollectionNumber`
  (specimen-level; no search box exists today — `searchText` in csv.js is built
  but unused).
- **"Species"** typeahead (TaxonomicName) under Genus.
- **Country** dropdown filter (specimen-level; `Country` is not loaded into the
  model yet).

## Phase B plan (agreed, NOT yet started)

Curation mode for editing specimen data. Decisions made with the user:
- **Separate curation view** (not editing from the grid): searchable specimen
  list/table + Country filter + per-row edit popup. Species grid stays for
  browse/ID.
- **Editable fields:** determination, coordinates, country, collectors +
  collection number.
- **History scope:** *ID history only*. Re-identifications are append-only;
  other edits are current-value corrections.

Two-layer persistence (both per-user, in the image folder — reuses the existing
override mechanism):
1. **Specimen override CSV** — corrections to coords/country/collectors (current
   values, stamp `EditedAt`). `TaxonomicName` stays the original determination.
   Must be **lossless** → parser needs to retain `FullName`/`TypeStatus`/
   `TypeName`/`PowoId` too.
2. **Identifications log CSV** (new, append-only) —
   `CatalogueNumber, ScientificName, Identifier, IdentificationDate, Remarks`
   (DwC `identifiedBy`/`dateIdentified`/`scientificName`/`identificationRemarks`).
   `currentDetermination` = latest entry per barcode, else original
   `TaxonomicName`. `Identifier` from a persisted curator-name setting;
   `IdentificationDate` auto-fills today.

Implementation sequencing (testable first):
1. **Data layer** — add `country` + lossless fields to `csv.js`; parse ID log +
   derive `currentDetermination`; `serialize.js` (`specimensToCsv`,
   `appendIdentification`). Verify parity + round-trip + derivation here.
2. **Persistence** — `folder.js`: upgrade permission `read`→`readwrite` (prompt on
   first save only); discover the ID log **distinctly** from the specimen override
   (current scanner matches any `Macaranga_Kew_*.csv` — must not mistake the log,
   e.g. `..._identifications_*.csv`, for an override). Curation store save fns.
3. **UI** — `CurationView.svelte`, `SpecimenEditModal.svelte` (with ID-history
   panel), Browse⇄Curate toggle. Build-check only — needs the user's Chromium +
   real data to actually test.

**Next action when resuming:** start Step 1 (data layer) and verify.

## Outstanding user (local) actions

1. Get this branch into the local repo (web-UI PR / pull).
2. Run `node scripts/import-macaranga.js static/data/Macaranga_Kew_260604.csv`
   (converts in place), resolve any warnings.
3. Add to `src/lib/datasets.js`:
   `{ id: 'macaranga', label: 'Macaranga', csvPath: '/data/Macaranga_Kew_260604.csv' }`
   then `node scripts/validate-data.js` and `npm run dev`.
   (Registry entry was deliberately NOT added here — the CSV isn't in this
   container, so it would break `validate-data.js`/build.)

## Key files

- `src/lib/utils/csv.js` — parsing + per-specimen model + species view.
- `scripts/import-macaranga.js` — Kew → app-schema converter (idempotent).
- `src/lib/stores/taxa.js` — filter store, derived species filters, option counts.
- `src/lib/stores/folder.js` — File System Access handle + override CSV discovery.
- `src/lib/components/Sidebar.svelte` — filter UI.
- `src/lib/datasets.js` — dataset registry + override-prefix logic (splits on the
  LAST underscore, so `Macaranga_Kew_260604.csv` → prefix `Macaranga_Kew_`).
