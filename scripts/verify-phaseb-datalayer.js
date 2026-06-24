#!/usr/bin/env node
/**
 * Phase B — data-layer verification (parity + round-trip + currentDetermination).
 *
 * Self-contained: imports BOTH the working-tree csv.js and the `main` baseline
 * (extracted via `git show main:...`) so the parity assertion is a real diff
 * against pre-Phase-B behaviour, not a tautology. Run with: npm run check:phaseb
 *
 * Asserts:
 *   1. Species-view parity — speciesByName + every allXxx option array are
 *      byte-identical to main for every shipped dataset (the five new lossless
 *      fields live only on specimens, so the species view must be untouched).
 *   2. Lossless retention — the new fields are populated where the source has
 *      them and '' where blank.
 *   3. Round-trip fixed point — parse → serializeSpecimensCsv → parse reproduces
 *      an identical barcoded-specimen Map.
 *   4. currentDetermination derivation — an in-memory identifications log
 *      overlays determinations (latest-wins) and buildSpeciesView regroups.
 */
import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { datasets } from '../src/lib/datasets.js';
import {
	parseSpeciesCsv,
	serializeSpecimensCsv,
	buildSpeciesView,
	parseIdentificationLog,
	applyIdentifications,
	buildFoldEntries
} from '../src/lib/utils/csv.js';

let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => { console.error(`  ✗ ${msg}`); failures++; };
function assert(cond, msg) { cond ? ok(msg) : fail(msg); }

// Keys produced by buildSpeciesView — the species "view" whose parity we guard.
const VIEW_KEYS = [
	'speciesByName', 'sortedByName', 'sortedByFamily', 'sortedByOrder',
	'allOrders', 'allFamilies', 'allGenera', 'allClades', 'allHabits',
	'allLeafArrangements', 'allLeafForms', 'allLeafVenations', 'allLeafMargins',
	'allStipules', 'allExudates', 'allStemArmatures', 'allTendrils'
];
const viewFingerprint = (v) => JSON.stringify(Object.fromEntries(VIEW_KEYS.map((k) => [k, v[k]])));

// Barcoded specimens only (the serialiser drops barcode-less placeholders), as
// an ordered list of [key, JSON] so both content and order are compared.
const barcodedFingerprint = (map) =>
	[...map.values()].filter((s) => s.catalogueNumber).map((s) => JSON.stringify(s));

async function importMainParser() {
	const src = execFileSync('git', ['show', 'main:src/lib/utils/csv.js'], { encoding: 'utf8' });
	// Written inside the project tree (not /tmp) so its `papaparse` import
	// resolves against the repo's node_modules. Cleaned up after the run.
	const tmp = join('src', 'lib', 'utils', `.csv-main-baseline-${process.pid}.mjs`);
	await writeFile(tmp, src);
	try {
		return { mod: await import(pathToFileURL(tmp).href), tmp };
	} catch (e) {
		await rm(tmp, { force: true });
		throw e;
	}
}

async function main() {
	const { mod: mainMod, tmp } = await importMainParser();
	const texts = {};
	for (const ds of datasets) {
		try {
			texts[ds.id] = await readFile(join('static', ds.csvPath.replace(/^\//, '')), 'utf8');
		} catch {
			console.log(`(skipping ${ds.id}: ${ds.csvPath} not present)`);
		}
	}

	console.log('\n1. Species-view parity vs main');
	for (const [id, text] of Object.entries(texts)) {
		const a = viewFingerprint(parseSpeciesCsv(text));
		const b = viewFingerprint(mainMod.parseSpeciesCsv(text));
		assert(a === b, `${id}: species view byte-identical to main`);
	}

	console.log('\n2. Lossless retention (Macaranga)');
	const mac = texts.macaranga && parseSpeciesCsv(texts.macaranga);
	if (mac) {
		const specimens = [...mac.specimensByCatalogue.values()].filter((s) => s.catalogueNumber);
		// Retained lossless fields with data in this dataset must carry through.
		for (const f of ['fullName', 'typeStatus', 'typeName', 'country']) {
			assert(specimens.some((s) => s[f] !== ''), `at least one specimen carries a non-empty ${f}`);
		}
		// Dropped columns (PowoID, OccurrenceID) must NOT appear on the specimen.
		assert(specimens.every((s) => !('powoId' in s) && !('occurrenceId' in s)),
			'powoId and occurrenceId are absent from the specimen model');
		const withCountry = specimens.filter((s) => s.country !== '').length;
		ok(`Country populated on ${withCountry}/${specimens.length} barcoded specimens`);
	} else {
		fail('Macaranga dataset not found — cannot test lossless retention');
	}

	console.log('\n3. Round-trip fixed point (parse → serialize → parse)');
	for (const [id, text] of Object.entries(texts)) {
		const first = parseSpeciesCsv(text);
		const second = parseSpeciesCsv(serializeSpecimensCsv(first.specimensByCatalogue));
		const fa = barcodedFingerprint(first.specimensByCatalogue);
		const fb = barcodedFingerprint(second.specimensByCatalogue);
		assert(
			fa.length === fb.length && fa.every((v, i) => v === fb[i]),
			`${id}: ${fa.length} barcoded specimens round-trip identically`
		);
	}

	console.log('\n4. currentDetermination derivation');
	if (mac) {
		const barcoded = [...mac.specimensByCatalogue.values()].filter((s) => s.catalogueNumber);
		const target = barcoded[0];
		const untouched = barcoded[1];
		const log = parseIdentificationLog(
			['CatalogueNumber,ScientificName,Identifier,IdentificationDate,Remarks',
				`${target.catalogueNumber},Macaranga oldidea,A. Botanist,2020-05-01,first pass`,
				`${target.catalogueNumber},Macaranga newidea,B. Botanist,2024-09-01,corrected`
			].join('\n')
		);
		assert(log.length === 2, 'log parsed: 2 entries');
		const before = target.currentDetermination;
		applyIdentifications(mac.specimensByCatalogue, log);
		assert(target.currentDetermination === 'Macaranga newidea',
			`re-identified target to latest entry (was "${before}" → now "${target.currentDetermination}")`);
		assert(untouched.currentDetermination === untouched.taxonomicName,
			'un-logged specimen keeps its original determination');
		const regrouped = buildSpeciesView(mac.specimensByCatalogue);
		assert(!!regrouped.speciesByName['Macaranga newidea'],
			'rebuilt species view contains the new determination as a group');

		// Tie on date → last-appended entry wins.
		const tie = parseIdentificationLog(
			['CatalogueNumber,ScientificName,Identifier,IdentificationDate,Remarks',
				`${target.catalogueNumber},Name C,X,,`,
				`${target.catalogueNumber},Name D,X,,`
			].join('\n')
		);
		applyIdentifications(mac.specimensByCatalogue, tie);
		assert(target.currentDetermination === 'Name D', 'equal-date tie resolves to last-appended entry');
	}

	console.log('\n5. Synonymy fold round-trip (X → Y)');
	// A self-contained 3-sheet dataset: 2 sheets of X (coursii) + 1 of Z (lanceolata).
	const foldCsv = [
		'TaxonomicName,CatalogueNumber,Genus',
		'Macaranga coursii,K1,Macaranga',
		'Macaranga coursii,K2,Macaranga',
		'Macaranga lanceolata,K3,Macaranga'
	].join('\r\n');
	const fp = parseSpeciesCsv(foldCsv);
	const foldEntries = buildFoldEntries(
		fp.specimensByCatalogue, 'Macaranga coursii', 'Macaranga sphaerophylla',
		{ identifier: 'S. Cable', herbarium: 'K', identificationDate: '2026-06-24', remarks: 'syn., DNA' }
	);
	assert(foldEntries.length === 2, 'fold enumerates exactly the 2 sheets currently determined as X');
	assert(foldEntries.every((e) => e.scientificName === 'Macaranga sphaerophylla' && e.changeType === 'synonymy'),
		'every fold entry targets Y and is flagged changeType=synonymy');
	// Selective fold: includeBarcodes folds only the chosen subset (K1), leaving K2 under X.
	const subEntries = buildFoldEntries(
		fp.specimensByCatalogue, 'Macaranga coursii', 'Macaranga sphaerophylla', {}, new Set(['K1'])
	);
	assert(subEntries.length === 1 && subEntries[0].catalogueNumber === 'K1',
		'includeBarcodes folds only the chosen subset');
	// A selected barcode not currently named X is excluded (currentDetermination guard).
	assert(buildFoldEntries(fp.specimensByCatalogue, 'Macaranga coursii', 'Y', {}, new Set(['K1', 'K3'])).length === 1,
		'a selected barcode not currently named X is excluded (safety guard)');
	// Apply via the same overlay path a reload uses, then regroup.
	applyIdentifications(fp.specimensByCatalogue, foldEntries);
	const foldView = buildSpeciesView(fp.specimensByCatalogue);
	assert('Macaranga sphaerophylla' in foldView.speciesByName && !('Macaranga coursii' in foldView.speciesByName),
		'after fold, X is gone and Y absorbs its sheets');
	assert(fp.specimensByCatalogue.get('K3').currentDetermination === 'Macaranga lanceolata',
		'unrelated sheet (Z) untouched');
	assert(fp.specimensByCatalogue.get('K1').taxonomicName === 'Macaranga coursii',
		'original TaxonomicName retained for audit');
	// Sheets already folded off X are invisible to a further fold; an absent name yields none.
	assert(buildFoldEntries(fp.specimensByCatalogue, 'Macaranga coursii', 'Y', {}).length === 0,
		'sheets already re-ID\'d off X are not re-enumerated');
	assert(buildFoldEntries(fp.specimensByCatalogue, 'Nonexistent', 'Y', {}).length === 0,
		'folding an absent name yields no entries (no-op)');

	await rm(tmp, { force: true });

	console.log(`\n${failures === 0 ? '✅ all checks passed' : `❌ ${failures} check(s) failed`}`);
	process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
