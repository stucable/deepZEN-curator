#!/usr/bin/env node
/**
 * One-off importer: converts a raw Kew Macaranga export into the app's CSV
 * schema and writes it to static/data/.
 *
 * Usage:
 *   node scripts/import-macaranga.js <source> [outputName.csv]
 *
 * The output is named after the source file (e.g. Macaranga_Kew_260604.csv ->
 * static/data/Macaranga_Kew_260604.csv) unless an explicit name is given; output
 * is a properly-quoted comma CSV via Papa.unparse. The delimiter of the source is
 * auto-detected (tab or comma), so collector lists with embedded commas survive.
 *
 * It reads BOTH the original spaced headers and the newer compact ones, AND its
 * own output, so it is idempotent: re-running (including in place) is safe.
 *
 * Column mapping (source -> target), aligned to Darwin Core where applicable:
 *   CatalogueNumber / "Catalogue Number"   -> CatalogueNumber  (specimen key)
 *   Clade                                  -> Clade            (filled by DNA work)
 *   Family / Genus / TaxonomicName / FullName -> same
 *   CollectionDate / "Collection Date"     -> CollectionDate   (-> ISO 8601)
 *   Collectors / "Collected By"            -> RecordedBy
 *   CollectionNumber / CollectorNumber / "Collector Number" -> RecordNumber
 *   Latitude(dd) / "Latitude (dd)"         -> DecimalLatitude
 *   Longitude(dd) / "Longitude (dd)"       -> DecimalLongitude
 *   Country / "Country ISO"                -> Country
 *   Type / TypeName                        -> TypeStatus / TypeName
 *   ImageFile / Barcode                    -> ImageFile         (0-3 basenames,
 *                                              ';' separated, e.g.
 *                                              "K004152211; K004152211_a")
 *   "Regional Information"                 -> Locality          (absent -> blank)
 *   Occurrence                             -> OccurrenceID       (absent -> blank)
 *   POWO                                   -> PowoId             (absent -> blank)
 *   ID, "Image Count"                      -> dropped
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import Papa from 'papaparse';

const [, , sourcePath, outArg] = process.argv;
if (!sourcePath) {
	console.error('Usage: node scripts/import-macaranga.js <source> [outputName.csv]');
	process.exit(1);
}

/** DD/MM/YYYY or DD-MM-YYYY -> YYYY-MM-DD. Already-ISO passes through; blank/unrecognised -> ''. */
function toIsoDate(raw) {
	const v = (raw ?? '').trim();
	if (!v) return '';
	if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
	const m = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
	if (!m) {
		console.warn(`  unrecognised date "${v}" — left blank`);
		return '';
	}
	const [, d, mo, y] = m;
	return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/**
 * Genus-only determinations arrive as a bare genus (e.g. "Macaranga"). Append an
 * explicit "sp." rank marker so the grid label reads "Macaranga sp." rather than a
 * bare genus name. A single-word name is the genus-rank signal; anything with a
 * space (a binomial, or an already-marked "Macaranga sp.") is left untouched, so
 * this is idempotent across re-imports.
 */
function normalizeDetermination(raw) {
	const v = (raw ?? '').trim();
	return v && !/\s/.test(v) ? `${v} sp.` : v;
}

/** Trim a coordinate and round to 6 dp; blank/non-numeric returns ''. */
function cleanCoord(raw) {
	const v = (raw ?? '').trim();
	if (!v) return '';
	const n = Number(v);
	return Number.isFinite(n) ? String(Math.round(n * 1e6) / 1e6) : '';
}

/** First present (non-undefined) header among `keys`, trimmed; '' if none. */
const pick = (row, ...keys) => {
	for (const k of keys) {
		if (row[k] !== undefined && row[k] !== null) return String(row[k]).trim();
	}
	return '';
};

const text = await readFile(sourcePath, 'utf8');
const { data, errors } = Papa.parse(text, {
	header: true,
	skipEmptyLines: true,
	transformHeader: (h) => h.trim().replace(/^﻿/, '')
});
if (errors.length) console.warn('Parse warnings:', errors.slice(0, 3));

const rows = data
	.filter((r) => pick(r, 'TaxonomicName'))
	.map((r) => ({
		TaxonomicName: normalizeDetermination(pick(r, 'TaxonomicName')),
		CatalogueNumber: pick(r, 'CatalogueNumber', 'Catalogue Number'),
		Clade: pick(r, 'Clade'),
		Order: '', // not provided by the source; curators can fill later
		Family: pick(r, 'Family'),
		Genus: pick(r, 'Genus'),
		FullName: pick(r, 'FullName'),
		VernacularName: '',
		TypeStatus: pick(r, 'TypeStatus', 'Type'),
		TypeName: pick(r, 'TypeName', 'Type Name'),
		DecimalLatitude: cleanCoord(pick(r, 'DecimalLatitude', 'Latitude(dd)', 'Latitude (dd)')),
		DecimalLongitude: cleanCoord(pick(r, 'DecimalLongitude', 'Longitude(dd)', 'Longitude (dd)')),
		Locality: pick(r, 'Locality', 'Regional Information'),
		RecordedBy: pick(r, 'RecordedBy', 'Collectors', 'Collected By'),
		RecordNumber: pick(r, 'RecordNumber', 'CollectionNumber', 'CollectorNumber', 'Collector Number'),
		CollectionDate: toIsoDate(pick(r, 'CollectionDate', 'Collection Date')),
		OccurrenceID: pick(r, 'OccurrenceID', 'Occurrence'),
		Country: pick(r, 'Country', 'Country ISO'),
		PowoId: pick(r, 'PowoId', 'POWO'),
		ImageFile: pick(r, 'ImageFile', 'Barcode')
	}));

if (rows.length === 0) {
	console.error('No rows with a TaxonomicName found — check the source delimiter/headers.');
	process.exit(1);
}

// Data-quality checks. Each row is one specimen: CatalogueNumber must be present
// and unique, ImageFile lists 0-3 ';'-separated basenames, and no image file
// should belong to two specimens. Warn on the offending values so they can be
// fixed at source.
const imgs = (r) => (r.ImageFile || '').split(';').map((s) => s.trim()).filter(Boolean);
// A specimen's images come from {base, base_a, base_b}. Any SUBSET may survive —
// a redundant image of a set can be deleted, keeping e.g. only base_a if it is the
// better scan — so there is no ordering or "no-gaps" rule; each name present just
// has to be one of these three (correct stem, suffix none/_a/_b).
const validNames = (base) => [base, `${base}_a`, `${base}_b`];

const blanks = rows.filter((r) => !r.CatalogueNumber);

const catCounts = new Map();
for (const r of rows) {
	if (r.CatalogueNumber) catCounts.set(r.CatalogueNumber, (catCounts.get(r.CatalogueNumber) || 0) + 1);
}
const dupCatalogues = [...catCounts].filter(([, n]) => n > 1);

// A cell with more than 3 images, or the same image listed twice, is malformed.
const badCells = rows.filter((r) => {
	const files = imgs(r);
	return files.length > 3 || new Set(files).size !== files.length;
});

// Every filename must be one of base / base_a / base_b for its own
// CatalogueNumber. This flags a wrong stem (K999_a under K006) or a bad suffix
// (_c, typos), but allows any surviving subset (a lone _a, base + _b, etc.).
const invalidNames = rows.filter((r) => {
	if (!r.CatalogueNumber) return false;
	const allowed = new Set(validNames(r.CatalogueNumber));
	return imgs(r).some((f) => !allowed.has(f));
});

// The same image file must not be assigned to two different specimens.
const fileToCatalogues = new Map();
for (const r of rows) {
	for (const f of imgs(r)) {
		if (!fileToCatalogues.has(f)) fileToCatalogues.set(f, new Set());
		fileToCatalogues.get(f).add(r.CatalogueNumber);
	}
}
const sharedFiles = [...fileToCatalogues].filter(([, cats]) => cats.size > 1);

if (blanks.length) {
	console.warn(`\n⚠ ${blanks.length} row(s) have a blank CatalogueNumber (they will NOT appear in the grid):`);
	for (const r of blanks) console.warn(`    ${[r.TaxonomicName || '(no name)', r.FullName].filter(Boolean).join('  ')}`);
}
if (dupCatalogues.length) {
	console.warn(`\n⚠ ${dupCatalogues.length} duplicate CatalogueNumber(s) — expected one row per specimen:`);
	for (const [cn, n] of dupCatalogues) console.warn(`    ${cn} ×${n}`);
}
if (badCells.length) {
	console.warn(`\n⚠ ${badCells.length} malformed ImageFile cell(s) (>3 images or a repeat):`);
	for (const r of badCells) console.warn(`    ${r.CatalogueNumber}: "${r.ImageFile}"`);
}
if (invalidNames.length) {
	console.warn(`\n⚠ ${invalidNames.length} ImageFile cell(s) contain a name that isn't base / base_a / base_b for that CatalogueNumber:`);
	for (const r of invalidNames) {
		const bad = imgs(r).filter((f) => !new Set(validNames(r.CatalogueNumber)).has(f));
		console.warn(`    ${r.CatalogueNumber}: "${r.ImageFile}"  (offending: ${bad.join(', ')})`);
	}
}
if (sharedFiles.length) {
	console.warn(`\n⚠ ${sharedFiles.length} ImageFile(s) assigned to more than one CatalogueNumber:`);
	for (const [f, cats] of sharedFiles) console.warn(`    ${f} -> ${[...cats].join(', ')}`);
}
if (blanks.length || dupCatalogues.length || badCells.length || invalidNames.length || sharedFiles.length) {
	console.warn('\nFix these in the source and re-run. The CSV was still written so you can inspect it.\n');
}

const outName = outArg || basename(sourcePath).replace(/\.[^.]*$/, '') + '.csv';
const outPath = join('static', 'data', outName);
await writeFile(outPath, Papa.unparse(rows));

const withImage = rows.filter((r) => imgs(r).length > 0).length;
const multiImage = rows.filter((r) => imgs(r).length > 1).length;
const withCoords = rows.filter((r) => r.DecimalLatitude && r.DecimalLongitude).length;
console.log(`Wrote ${outPath}`);
console.log(
	`  ${rows.length} specimens | ${withImage} with image | ${multiImage} multi-image | ${withCoords} georeferenced`
);
console.log(`Next: add to src/lib/datasets.js -> { id: 'macaranga', label: 'Macaranga', csvPath: '/data/${outName}' }`);
