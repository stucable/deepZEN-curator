# Project Review — deepZEN-curator

## Context

You asked for a best-practice review (architecture + security focus): bugs/weaknesses, redundant
files, footprint/simplification, docs freshness, branch-merge readiness, and whether CLAUDE.md is
optimised. This file is the written assessment plus a tiered, scoped action list. Evidence was
gathered by three parallel Explore agents (architecture/redundancy, security/bugs, docs/git) and
the highest-impact claims were re-verified by reading the source directly.

---

## Verdict (TL;DR)

**This is a well-built, lean, offline single-user tool with no real security holes and no real
correctness bugs.** The codebase is clean: no dead code, no circular imports, no prop-drilling,
`npm audit` clean (0 vulns), minimal runtime deps (`idb-keyval` + `papaparse` only), and a
consistently-applied "generation counter" pattern that correctly guards every async race. The
genuinely actionable items are small: doc freshness, a couple of DRY/robustness nits, and a
decision about v2 scaffolding. The `feat/wider-maps` branch is clean and mergeable.

The security agent rated several items "HIGH"; on direct inspection they assume a public
multi-tenant web threat model that does not apply to a localhost, no-network, Chrome-only,
single-user field tool. Calibrated severities are below.

---

## 1. Security — strong for the threat model

**Confirmed good:**
- No XSS sinks — zero `{@html}`, `innerHTML`, `eval`, `new Function`. All CSV-derived text renders
  through Svelte's auto-escaping `{...}`.
- `postMessage` handlers validate `event.origin === location.origin` in **both** windows
  (`viewerWindow.js:27`, `viewer/+page.svelte:47`) and match the target tab by `WindowProxy`
  identity.
- Path traversal via `CatalogueNumber` is blocked: `getFileHandle()` rejects names containing `/`
  by spec, so `${catalogue}.jpg` can't escape the chosen folder.
- `npm audit --omit=dev` → 0 vulnerabilities; dependencies current.

**Not real issues (verified false/over-rated):**
- *"Identification-date `>=` data-loss bug"* — **FALSE ALARM.** `csv.js:650-668` is intentional and
  documented; `>=` makes the last-appended entry win on equal/blank dates, and a blank date can
  never displace a real ISO date (`'' >= '2026-01-01'` is `false`).
- *"Dataset-switch torn state"* — guarded. `+page.svelte:159,177` bumps `restoreGeneration` and
  bails the async restore if a newer switch superseded it; `editingSpecimenStore` is cleared on
  switch. Not exploitable in a single-user tool.
- *"Loose postMessage type check / unvalidated catalogue / blob type"* — defense-in-depth only.
  The origin check is the correct control; a same-origin attacker would already own the page.

**Worth a small robustness touch (LOW, optional):**
- `folder.js:64-101` `restoreFolderHandle` wraps everything in one `catch {}`, so a *revoked*
  permission is indistinguishable from *no folder saved* — the user is never prompted to
  reconnect. Distinguishing the two would improve the field UX.
- `csv.js:parseIdentificationLog` silently drops rows missing barcode/name and ignores PapaParse
  `errors`. By-design for the skip, but a `console.warn` on dropped rows would aid field debugging.

---

## 2. Correctness / bugs

No real bugs found. The codebase uses generation counters (`restoreGeneration`,
`csvLoadGeneration`, thumbnail `loadGeneration`, viewer `imageLoadGeneration`) consistently and
correctly to cancel stale async work. CSV parsing surfaces fatal schema errors via `CsvSchemaError`
and tolerates `FieldMismatch` (ragged rows) — acceptable for hand-edited field CSVs.

---

## 3. Architecture — sound, with a few large files

Store/component architecture is clean (hub-and-spoke around `taxa.js`, no circular imports, stores
used in place of prop-drilling). The only smell is file size:

| File | Lines | Note |
|------|-------|------|
| `components/MapView.svelte` | 1,098 | Mixes SVG render + legend + polygon-draw + specimen search + colour logic. The one genuine extraction candidate. |
| `stores/taxa.js` | 744 / 32 exports | Deliberate data-layer hub (documented). High coupling but not a defect. |
| `utils/csv.js` | 686 | Parse + aggregate + normalise + serialise + ID-log. Cohesive and heavily docstring'd. |
| `components/Sidebar.svelte` | 627 | Filter UI. Fine. |

These are *optional* refactors, not bugs. On a working, shipped app I'd only split `MapView.svelte`
if you find it hard to modify — and only by extracting the legend, the polygon-selection logic, and
the specimen-search box into child components. Not urgent.

**Real DRY nit:** habit-token normalisation is duplicated between `utils/csv.js:39-68`
(`cleanHabitToken`/`normalizeHabits`) and `scripts/validate-data.js:9-25`. The script should import
`normalizeHabits` from `csv.js` instead of reimplementing the split/clean logic.

---

## 4. Redundancy & footprint

**The shipped app is already lean** (~300 KB gzipped; map basemaps are quantised and tiny). There
is no orphaned data: all 3 registry CSVs exist; `src/lib/data/*.js` (generated coastlines/biomes)
don't overlap `static/data/*.csv`; large sources (`scripts/geo-src/` 159 MB, `data-files/`) are
correctly `.gitignore`d.

**The one real footprint lever is v2 scaffolding** — a "knowledge base" (Phase B) toolchain that
does **not** ship and is partly non-runnable:
- Unwired scripts: `scripts/build-duckdb.js`, `import-macaranga.js`, `validate-kb.js` (~752 LOC).
  `build-duckdb.js`/`validate-kb.js` reference `duckdb`/`sqlite` that **aren't in package.json**, so
  they can't run as-is.
- Wired but experimental: `check:phaseb`, `check:phaseb:persist`
  (`verify-phaseb-datalayer.js`, `verify-phaseb-persistence.js`) — present as npm scripts but **not**
  part of `npm run check`.

**Decision: active — retained.** You confirmed Phase B is live v2 work, so the scripts and
`check:phaseb*` wiring stay in place. (One tidy-up you *could* do later: add `duckdb`/`sqlite` to
`devDependencies` so `build-duckdb.js`/`validate-kb.js` are runnable, or add a header comment noting
the required global install — otherwise they're silently non-runnable.)

Also note: several internal-notes files are present in the working tree but `.gitignore`d
(`CLAUDE.md`, `docs/curation-roadmap.md`, `Codex_architecture.md`, `AGENTS.md`,
`CODEX-branstorming.md`, `SPEC_prolog_embeddings.md`, `design-review-2026-05-14.md`, …). They don't
affect the repo or build — just a periodic-tidy note.

---

## 5. Docs & CLAUDE.md

**CLAUDE.md is effective and mostly current** — high-signal, documents non-obvious decisions, and
the "Do not" list is excellent churn-prevention. The detailed prose sections (Map view, per-user
CSV override, thumbnails) are accurate to the code, including the wider-maps work.

**Stale spot — the "Key directories" quick-reference tree** (not the prose) has drifted as files
were added:
- `stores/` lists only `dataset.js, taxa.js, folder.js, theme.js` → **missing** `curator.js`,
  `view.js`, `map.js`.
- `utils/` lists only `csv.js, thumbnails.js` → **missing** `geo.js`, `palette.js`,
  `viewerWindow.js`.
- `components/` line lists 7 → **missing** `MapView`, `CurationView`, `SpecimenEditModal`,
  `BrowseCurateToggle`, `ThemeToggle` (some are covered in prose elsewhere).

**Governance note:** CLAUDE.md *and* `docs/curation-roadmap.md` are both `.gitignore`d — a fresh
clone loses the project's design memory. Intentional (private notes), but worth a conscious
decision if the repo is ever shared/handed over.

`README.txt`, `version.js` (`v1.1`), and `package.json` (`1.1.0`) are aligned. If `feat/wider-maps`
ships as a new version, bump all three together (per prior drift) and add a README line for the
Madagascar/WIO/Global extent selector.

---

## 6. Branch merge status

`feat/wider-maps`: **3 commits ahead of main, 0 behind, working tree clean → mechanically
mergeable now.** Scope = map extent selection (Madagascar/WIO/Global) + species/clade colouring
(~529/-119 across 10 files). The feature is already documented in CLAUDE.md.

**Caveat — testing:** there are **no automated UI/E2E tests and no CI**. Verification is hand-rolled
Node scripts: `check:geo` (projection round-trip + ring-closure — relevant to this branch) and
`build`. Note `check:data` fails *environmentally* here (it checks image coverage and the images
aren't in the repo), so the real pre-merge gate is **`check:geo` + `build`**, plus a manual browser
smoke test of the three extents and the colour toggle (the only coverage this visual feature has).

---

## Outcome of this review

**You chose "just the report" — no code or git changes have been made or will be made.** The items
below are advisory, for you to action whenever you like.

**Optional future polish (low risk, in priority order):**
1. Refresh the CLAUDE.md "Key directories" tree — add `curator.js`/`view.js`/`map.js` (stores),
   `geo.js`/`palette.js`/`viewerWindow.js` (utils), and the missing components.
2. DRY the habit normalisation — `scripts/validate-data.js` should import `normalizeHabits` from
   `src/lib/utils/csv.js:39-68` rather than reimplementing the split/clean logic.
3. `console.warn` on dropped rows in `csv.js:parseIdentificationLog` (silent skips today).
4. In `folder.js:restoreFolderHandle` (64-101), distinguish a *revoked* permission from *no handle
   saved* so a returning user gets a reconnect prompt instead of an apparently-empty app.
5. If/when you find `MapView.svelte` (1,098 lines) hard to modify, extract the legend,
   polygon-selection, and specimen-search into child components. Not urgent.

**feat/wider-maps — decision: HOLD for your manual testing.** Branch is mechanically ready (3 ahead,
0 behind, clean), but you want to browser-test the visual map feature first (correct, given there's
no automated UI coverage). Self-serve checklist when you're ready:
- `npm run check:geo` and `npm run build` should both pass. (`npm run check` will fail at
  `check:data` because the herbarium images aren't in the repo — environmental, not a regression.)
- `npm run dev`, then load a regional dataset (Ankarafantsika / Ranomafana) and the Kew dataset
  (Macaranga); confirm the extent **auto-detects** correctly and the Madagascar/WIO/Global selector
  + the species⇄clade colour toggle render and switch as documented.
- When you do ship it as a new version, bump `version.js` + `package.json` + `README.txt` together
  and add a README line for the extent selector.

**Phase B scaffolding — decision: KEEP (active).** Retained as-is; see note in §4 about making the
`duckdb`/`sqlite` scripts runnable if you want.
