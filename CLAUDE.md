# deepZEN-curator

Offline herbarium image browser for field botanists in Madagascar. Ships with multiple dataset options (Ankarafantsika, Ranomafana, …) selectable at runtime.

## Stack

- **SvelteKit** (Svelte 5 runes) with `@sveltejs/adapter-static` — fully static, no SSR
- **Vite 6** bundler
- **TailwindCSS 4** via `@tailwindcss/vite` plugin — utility classes only; `app.css` holds just the Tailwind import plus a single `@layer utilities` for `.font-species`
- **PapaParse** for CSV parsing
- **idb-keyval** for IndexedDB persistence of per-dataset folder handles and the active dataset selection
- No backend, no database, no authentication

## Architecture

### Data flow
1. `datasets.js` declares the dataset registry (`id`, `label`, `csvPath`); `stores/dataset.js:currentDatasetStore` holds the active dataset and persists the selection to IndexedDB.
2. `+page.svelte` calls `restoreDataset()` on mount, then reacts to `currentDatasetStore` changes: it clears taxa/filters/folder, calls `csv.js:loadSpeciesData(csvPath)`, and restores that dataset's saved folder handle.
3. `taxa.js:taxaStore` holds the parsed data; `filteredSpecies` is a derived store driven by `filterStore`.
4. `folder.js` keys each `FileSystemDirectoryHandle` by dataset (`imageFolderHandle:{id}`) so folders are remembered per-dataset. A one-time migration moves any legacy single-key handle into the default dataset's slot.
5. Images are loaded on-demand via the File System Access API (Chrome only) — the app never bundles images.

### Key directories
```
src/lib/
  datasets.js        — dataset registry (id, label, csvPath)
  components/        — Svelte 5 components (Sidebar, DatasetSelector, SpeciesGrid, SpeciesCard, HerbariumImage, Lightbox)
  stores/            — Svelte stores (dataset.js, taxa.js, folder.js)
  utils/             — CSV loading and data transformation (csv.js)
src/routes/          — Single page: +page.svelte with +layout.js (ssr=false, prerender=false)
static/data/         — One CSV per dataset (copied to build/data/ at build time)
```

### Data model (species object)
```js
{
  taxonomicName,  // primary key and display label — never show FullName in UI
  vernacularName, // optional local name; shown in brackets after the scientific name
  family, genus, clade, order,
  traits: { habit, leafArrangement, leafForm, leafVenation, leafMargin, stipules, exudate },
  searchText,     // precomputed lowercase string (name + family + genus + vernacular) for future text search
  images: []      // array of CatalogueNumber strings
}
```

## Conventions

- **Plain JavaScript** — no TypeScript. Use JSDoc for complex function signatures if needed.
- **Svelte 5 runes** — use `$state()`, `$derived()`, `$effect()`, `$props()`. No legacy `$:` reactive statements.
- **Svelte stores** — writable/derived from `svelte/store` for cross-component state.
- **Tailwind utility classes only** — no `<style>` blocks. `app.css` holds the Tailwind import plus a single `.font-species` utility for the system-serif italics on species names.
- **Image filenames** are always `CatalogueNumber + ".jpg"`. The CSV `CatalogueNumber` column includes any suffixes (e.g. `K000175461_a`).
- **TaxonomicName** is always the display label. Never show `FullName` in the UI.
- **Taxonomic sort order**: Order → Family → Genus → TaxonomicName (not plain alphabetical).
- **Chrome desktop only** — no Firefox/Safari fallbacks for File System Access API.
- **English UI** — no i18n framework.
- **Emerald is the single accent colour** across all datasets.

## Build & Run

```bash
npm run dev       # dev server with HMR
npm run build     # static build → build/
npm run preview   # preview the production build
```

Deployment: copy `build/`, `start.bat`, `start.sh`, and `README.txt` to target machine. User double-clicks `start.bat` (requires Python installed).

## Datasets

The registry is `src/lib/datasets.js`. Each entry is `{ id, label, csvPath }`; `DEFAULT_DATASET_ID` picks the one loaded on first run. CSV column schema (shared across datasets):

Required: `TaxonomicName` (rows without it are skipped), `CatalogueNumber` (one row per image — a species with 3 images has 3 rows sharing a TaxonomicName).
Optional: `Clade`, `Order`, `Family`, `Genus`, `VernacularName`, `Habit`, `LeafArrangement`, `LeafForm`, `LeafVenation`, `LeafMargin`, `Stipules`, `Exudate`.
Tolerated but never read: `FullName`. Any other columns are silently ignored. Column names are case-sensitive.

### Live CSV editing (no rebuild)

CSVs are copied verbatim from `static/data/` to `build/data/` by `adapter-static` and fetched by PapaParse in the browser at page load — there is no build-time CSV→JSON step. In a deployed install, editing `build/data/<dataset>.csv` and reloading the tab picks up the changes immediately. This is the intended workflow for botanists adding vernacular names, fixing typos, or appending species rows in the field. Adding a *new* dataset still requires editing `src/lib/datasets.js` and rebuilding.

### Shipped CSV filename convention

Shipped CSVs follow `<Label>_herbarium_images_<YYMMDD>.csv` — e.g. `Ankarafantsika_herbarium_images_260420.csv`. The same filename stem (everything up to and including the last underscore) is reused as the prefix the per-user override lookup scans for, so this convention is load-bearing. The `getOverridePrefix` helper in `datasets.js` derives the prefix from `csvPath` — no extra registry field needed.

### Per-user CSV override (personalised CSV in image folder)

Each user can override the shipped CSV by dropping their own file into the image folder they've picked for that dataset. The file must start with the same prefix as the shipped CSV and end in `.csv` — e.g. `Ankarafantsika_herbarium_images_Stuart.csv` or `Ankarafantsika_herbarium_images_Johny.csv`. On every (dataset, folder) change the app calls `readCustomCsvFromFolder` (`stores/folder.js`), which enumerates the folder with `folderHandle.entries()` and filters by prefix. Matching is case-insensitive (for Windows users who rename with different casing). A literal copy of the shipped filename is ignored so backups don't accidentally trigger override mode. If multiple matches exist, the most recently modified wins — matches "use my newest work". When an override loads the sidebar shows `Using <filename> from this folder` with the actual discovered filename. If absent, the shipped CSV is used with no indicator fanfare. If present but malformed, the previously-loaded grid stays visible and an amber banner names the file. To revert to the shipped CSV, delete or rename the personalised file and reload. This piggybacks on the existing folder handle — no second picker, no new IndexedDB key — and is the v1 stepping-stone before cloud sync.

### Adding a dataset

1. Export the CSV (real CSV, not xlsx — PapaParse cannot read Excel).
2. Drop it into `static/data/`.
3. Append a `{ id, label, csvPath }` entry to `datasets` in `src/lib/datasets.js`.
4. Rebuild. The sidebar selector picks it up automatically; at ≥3 datasets it switches from a segmented control to a dropdown.

If a registry entry points at a CSV that doesn't exist yet (e.g. the Ranomafana placeholder), switching to it logs a 404 and leaves `taxaStore` null — the grid is empty until the file is dropped in.

### Per-dataset folder handles

Image folder handles are stored in IndexedDB under `imageFolderHandle:{datasetId}`. Switching datasets auto-restores that dataset's last folder. Existing installs upgrading from the single-key (`imageFolderHandle`) layout are migrated once on first post-upgrade load; no user action required.

### Habit filter

Canonical habit vocabulary: `tree`, `shrub`, `herb`, `liana`, `epiphyte` (lowercase singular). Each species carries `traits.habit` as an array of canonical values — a row with `tree;shrub` in the CSV becomes `['tree', 'shrub']`. Normalisation at parse time (`csv.js:normalizeHabits`) splits on `;`, trims + lowercases each token, remaps via `HABIT_ALIASES` (currently `{ climber: 'liana' }` — extend this table when new synonyms appear), then `startsWith`-matches against `KNOWN_HABITS` so `Tree`/`trees`/`TREES` all collapse to `tree`. Unknown tokens pass through unchanged to avoid silent miscategorisation.

UI is a multi-select pill row (`HabitPills.svelte`) rendered even when the dataset has no `Habit` column. The `filterStore.habits` default is `['tree', 'shrub']` (exported as `DEFAULT_HABITS`); "Clear filters" and dataset switches reset to this default.

A species matches when **any** of its habits is in the selected set (so `['climber;shrub;tree']` shows under Tree, Shrub, or Liana). Species with an empty habit array always pass the filter — this keeps the grid non-empty when the `Habit` column is missing or partially populated.

### Vernacular name filter

The sidebar vernacular field (between Genus and Habit) is a native `<input list>` + `<datalist>` typeahead — no combobox library. Options come from the `vernacularOptions` derived store in `stores/taxa.js`, which returns the sorted, de-duplicated set of non-empty `vernacularName` values in the current dataset. Filter semantics mirror the taxonomy selects: exact-match on `$filter.vernacular`, and species with a blank `VernacularName` are **excluded** while the filter is active (deliberately stricter than the Habit filter's blank-pass-through — a botanist picking "fig" wants matches, not noise). Multiple species can share one vernacular name; the filter returns all of them.

The input is rendered even when the dataset has no `VernacularName` column — the datalist just has no options. The vernacular name is also shown on each species card on the metadata line as `Vernacular name: <name>` (next to `Family:`), only when present.

- Do not add a service worker or PWA manifest
- Do not add virtual scrolling — DOM size is manageable for ~500 species
- Do not add debounce on filters — all filtering is synchronous in-memory
- Do not bundle herbarium images into the build — they're loaded via File System Access API
- Do not add Firefox/Safari File System Access polyfills
- Do not introduce TypeScript, CSS modules, or component libraries
- Do not add Google Fonts or self-hosted webfonts — offline-first. Use system font stacks only.
- Do not add per-dataset theme colours — emerald is the single accent.

## v2 Roadmap (scaffolded but not active)

- **Text search**: `species.searchText` is precomputed (includes TaxonomicName, Family, Genus, VernacularName). Wire up a search input to filter against it.
