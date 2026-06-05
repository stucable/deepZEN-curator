#!/usr/bin/env node
/**
 * Phase B — persistence-layer verification (pure helpers only).
 *
 * The File System Access I/O in folder.js (permission escalation,
 * getFileHandle/createWritable, the folder scans) is Chrome-only and must be
 * smoke-tested in the browser. This script covers the node-testable logic that
 * underpins it: the override-vs-log filename conventions + distinct-discovery
 * predicates, identifications-log serialisation round-trip, and the append
 * text-shaping. Run with: npm run check:phaseb:persist
 */
import {
	getDataset,
	getOverridePrefix,
	getIdentificationLogPrefix,
	getOverrideFilename,
	getIdentificationLogFilename,
	isOverrideName,
	isIdentificationLogName
} from '../src/lib/datasets.js';
import {
	parseIdentificationLog,
	serializeIdentificationLog,
	appendIdentificationToLog,
	parseSpeciesCsv,
	serializeSpecimensCsv,
	applyIdentificationLog
} from '../src/lib/utils/csv.js';

let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { console.error(`  ✗ ${m}`); failures++; };
const assert = (cond, m) => (cond ? ok(m) : fail(m));
const eq = (a, b, m) => {
	const pass = JSON.stringify(a) === JSON.stringify(b);
	assert(pass, `${m}${pass ? '' : ` (got ${JSON.stringify(a)})`}`);
};

const mac = getDataset('macaranga');

console.log('\n1. Filename conventions (Macaranga)');
eq(getOverridePrefix(mac), 'Macaranga_Kew_', 'override prefix');
eq(getIdentificationLogPrefix(mac), 'Macaranga_Kew_identifications_', 'log prefix');
eq(getOverrideFilename(mac, 'Stuart'), 'Macaranga_Kew_Stuart.csv', 'override filename');
eq(getIdentificationLogFilename(mac, 'Stuart'), 'Macaranga_Kew_identifications_Stuart.csv', 'log filename');
eq(getOverrideFilename(mac, 'Stuart Cable!'), 'Macaranga_Kew_StuartCable.csv', 'override filename sanitises punctuation/spaces');
eq(getOverrideFilename(mac, '   '), 'Macaranga_Kew_curator.csv', 'blank user falls back to "curator"');

console.log('\n2. Distinct discovery: override vs identifications log');
const cases = [
	['Macaranga_Kew_Stuart.csv', true, false, 'a user override'],
	['Macaranga_Kew_identifications_Stuart.csv', false, true, 'an identifications log'],
	['Macaranga_Kew_260604.csv', false, false, 'the shipped CSV (a backup) is neither'],
	['macaranga_kew_johny.CSV', true, false, 'override match is case-insensitive'],
	['MACARANGA_KEW_IDENTIFICATIONS_JOHNY.CSV', false, true, 'log match is case-insensitive'],
	['Ankarafantsika_herbarium_images_Stuart.csv', false, false, "another dataset's file is neither"],
	['Macaranga_Kew_Stuart.txt', false, false, 'non-.csv is neither'],
	['notes.csv', false, false, 'unrelated csv is neither']
];
for (const [name, wantOverride, wantLog, desc] of cases) {
	const o = isOverrideName(mac, name);
	const l = isIdentificationLogName(mac, name);
	assert(o === wantOverride && l === wantLog,
		`${desc}: ${name} → override=${o}, log=${l}`);
}
// The load-bearing invariant: a log file is NEVER picked up as an override.
assert(
	cases.filter(([, , wantLog]) => wantLog).every(([n]) => isIdentificationLogName(mac, n) && !isOverrideName(mac, n)),
	'every identifications log is excluded from override discovery'
);

console.log('\n3. Identifications-log serialisation round-trip');
const entries = [
	{ catalogueNumber: 'K004152211', scientificName: 'Macaranga alpina', identifier: 'S. Cable', identificationDate: '2024-09-01', remarks: 'plain' },
	{ catalogueNumber: 'K004152212', scientificName: 'Macaranga cuspidata', identifier: 'J. Razafi', identificationDate: '2025-01-15', remarks: 'corrected, see note "A"' },
	{ catalogueNumber: 'K004152213', scientificName: 'Macaranga sp.', identifier: '', identificationDate: '', remarks: '' }
];
eq(parseIdentificationLog(serializeIdentificationLog(entries)), entries,
	'parse(serialize(entries)) === entries (commas + quotes survive escaping)');

console.log('\n4. Append text-shaping (append-only, byte-preserving)');
const base = serializeIdentificationLog([entries[0], entries[1]]);
const appended = appendIdentificationToLog(base, entries[2]);
eq(parseIdentificationLog(appended), entries, 'appending a row yields all three entries in order');
assert(appended.startsWith(base), 'prior log content is preserved verbatim (literal append)');

const fromEmpty = appendIdentificationToLog('', entries[0]);
eq(parseIdentificationLog(fromEmpty), [entries[0]], 'appending to an absent log creates it with a header');

// A log whose last line lacks a trailing newline must not merge with the new row.
const noNewline = serializeIdentificationLog([entries[0]]); // Papa.unparse adds no trailing \n
assert(!noNewline.endsWith('\n'), 'precondition: serialised log has no trailing newline');
eq(parseIdentificationLog(appendIdentificationToLog(noNewline, entries[1])), [entries[0], entries[1]],
	'append inserts a separating newline so rows never merge');

console.log('\n5. Load-time overlay + correction round-trip (step 3b save semantics)');
const baseCsv = [
	'TaxonomicName,CatalogueNumber,Family,Genus,DecimalLatitude,DecimalLongitude,Country,RecordedBy',
	'Macaranga alpina,K1,Euphorbiaceae,Macaranga,-18.5,47.2,Madagascar,Cable',
	'Macaranga sp.,K2,Euphorbiaceae,Macaranga,,,Madagascar,Razafi'
].join('\r\n');

// (a) Overlaying an ID log re-determines a specimen and regroups the species view.
const logText = serializeIdentificationLog([
	{ catalogueNumber: 'K2', scientificName: 'Macaranga cuspidata', identifier: 'S. Cable', identificationDate: '2025-02-01', remarks: '' }
]);
const { data: overlaid, entries: overlaidEntries } = applyIdentificationLog(parseSpeciesCsv(baseCsv), logText);
eq(overlaidEntries.length, 1, 'overlay returns the parsed log entries (for the history panel)');
eq(overlaid.specimensByCatalogue.get('K2').currentDetermination, 'Macaranga cuspidata',
	'currentDetermination follows the latest log entry');
assert('Macaranga cuspidata' in overlaid.speciesByName && !('Macaranga sp.' in overlaid.speciesByName),
	'species view regroups under the new determination (old key gone)');
assert(applyIdentificationLog(parseSpeciesCsv(baseCsv), '').entries.length === 0,
	'no log text → unchanged dataset, empty entries');

// (b) A re-ID never rewrites TaxonomicName in the override — the log owns it.
const k2 = overlaid.specimensByCatalogue.get('K2');
eq(k2.taxonomicName, 'Macaranga sp.', 'original TaxonomicName retained on the specimen after re-ID');
const reparsedAfterReID = parseSpeciesCsv(serializeSpecimensCsv(overlaid.specimensByCatalogue));
eq(reparsedAfterReID.specimensByCatalogue.get('K2').taxonomicName, 'Macaranga sp.',
	'override CSV keeps the original TaxonomicName (currentDetermination lives in the log)');

// (c) A coordinate/collector correction survives serialize → parse.
const corrected = parseSpeciesCsv(baseCsv).specimensByCatalogue;
const k1 = corrected.get('K1');
k1.lat = -19.25;
k1.lng = 47.9;
k1.recordedBy = 'Cable & Razafi';
k1.editedAt = '2025-03-04T10:00:00.000Z';
const reparsed = parseSpeciesCsv(serializeSpecimensCsv(corrected)).specimensByCatalogue.get('K1');
eq([reparsed.lat, reparsed.lng], [-19.25, 47.9], 'corrected coordinates persist through the override');
eq(reparsed.recordedBy, 'Cable & Razafi', 'corrected collector persists');
eq(reparsed.editedAt, '2025-03-04T10:00:00.000Z', 'EditedAt stamp persists');
eq(reparsed.taxonomicName, 'Macaranga alpina', 'untouched determination unchanged by a correction');

console.log(`\n${failures === 0 ? '✅ all checks passed' : `❌ ${failures} check(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
