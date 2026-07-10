#!/usr/bin/env node

import { get } from 'svelte/store';
import { getDataset, getIdentificationLogFilename, getOverrideFilename } from '../src/lib/datasets.js';
import { parseIdentificationLog, parseSpeciesCsv, serializeSpecimensCsv } from '../src/lib/utils/csv.js';
import {
	taxaStore,
	filterStore,
	filteredSpecies,
	specimenPassesRegion
} from '../src/lib/stores/taxa.js';
import {
	appendIdentification,
	readIdentificationLog,
	writeSpecimenOverride,
	FileConflictError
} from '../src/lib/stores/folder.js';

let failures = 0;
const ok = (message) => console.log(`  [ok] ${message}`);
const fail = (message) => { console.error(`  [FAIL] ${message}`); failures++; };
const assert = (condition, message) => condition ? ok(message) : fail(message);

function notFound(name) {
	const error = new Error(`${name} not found`);
	error.name = 'NotFoundError';
	return error;
}

class MemoryFileHandle {
	kind = 'file';

	constructor(directory, name) {
		this.directory = directory;
		this.name = name;
	}

	async getFile() {
		const record = this.directory.files.get(this.name);
		if (!record) throw notFound(this.name);
		return {
			lastModified: record.lastModified,
			text: async () => record.text
		};
	}

	async createWritable() {
		const directory = this.directory;
		const name = this.name;
		let staged = '';
		return {
			write: async (text) => {
				if (directory.failNextWrite) {
					directory.failNextWrite = false;
					throw new Error('simulated write failure');
				}
				staged = String(text);
			},
			close: async () => {
				directory.clock++;
				directory.files.set(name, { text: staged, lastModified: directory.clock });
			},
			abort: async () => {
				directory.abortCount++;
			}
		};
	}
}

class MemoryDirectoryHandle {
	constructor() {
		this.files = new Map();
		this.clock = 100;
		this.abortCount = 0;
		this.failNextWrite = false;
	}

	put(name, text, lastModified = ++this.clock) {
		this.files.set(name, { text, lastModified });
	}

	async queryPermission() { return 'granted'; }
	async requestPermission() { return 'granted'; }

	async getFileHandle(name, { create = false } = {}) {
		if (!create && !this.files.has(name)) throw notFound(name);
		return new MemoryFileHandle(this, name);
	}

	async *entries() {
		for (const name of this.files.keys()) {
			yield [name, new MemoryFileHandle(this, name)];
		}
	}
}

const csv = [
	'TaxonomicName,CatalogueNumber,Family,Genus,Country,DecimalLatitude,DecimalLongitude,ImageFile',
	'Macaranga imaged,K0001,Euphorbiaceae,Macaranga,Madagascar,-18,47,K0001',
	'Macaranga imageless,K0002,Euphorbiaceae,Macaranga,Madagascar,-19,48,'
].join('\n');
const parsed = parseSpeciesCsv(csv);

console.log('\n1. Specimen-level filtering includes imageless mapped records');
taxaStore.set(parsed);
filterStore.update((filter) => ({ ...filter, specimenSearch: 'K0002' }));
assert(get(filteredSpecies).some((species) => species.taxonomicName === 'Macaranga imageless'),
	'barcode search qualifies a species through an imageless specimen');
filterStore.update((filter) => ({ ...filter, specimenSearch: '' }));

console.log('\n2. Region filtering uses display coordinates');
const polygon = [[56, -21], [59, -21], [59, -19], [56, -19]];
const anchored = {
	currentDetermination: 'Island species',
	lat: null,
	lng: null,
	mapLat: -20.2,
	mapLng: 57.5
};
assert(specimenPassesRegion(anchored, polygon, false, new Set()),
	'an island-anchored record inside the polygon passes even when unlocated records are excluded');
const unlocated = { ...anchored, mapLat: null, mapLng: null };
assert(!specimenPassesRegion(unlocated, polygon, false, new Set(['Island species'])),
	'a genuinely unlocated record is excluded when include-unlocated is off');
assert(specimenPassesRegion(unlocated, polygon, true, new Set(['Island species'])),
	'a genuinely unlocated record of an in-region species passes when include-unlocated is on');

console.log('\n3. Correction writes detect conflicts and abort failed streams');
const dataset = getDataset('macaranga');
const overrideName = getOverrideFilename(dataset, 'Tester');
const folder = new MemoryDirectoryHandle();
folder.put(overrideName, serializeSpecimensCsv(parsed.specimensByCatalogue), 50);

const originalSpecimen = parsed.specimensByCatalogue.get('K0001');
const candidateMap = new Map(parsed.specimensByCatalogue);
candidateMap.set('K0001', { ...originalSpecimen, country: 'Mauritius' });
const writeResult = await writeSpecimenOverride(folder, dataset, candidateMap, {
	filename: overrideName,
	expectedLastModified: 50,
	user: 'Tester'
});
assert(writeResult.filename === overrideName && writeResult.lastModified > 50,
	'a correction writes when the loaded timestamp still matches');
assert(originalSpecimen.country === 'Madagascar',
	'writing a candidate Map does not mutate the original specimen');

folder.put(overrideName, 'external edit', writeResult.lastModified + 10);
let conflict = null;
try {
	await writeSpecimenOverride(folder, dataset, candidateMap, {
		filename: overrideName,
		expectedLastModified: writeResult.lastModified,
		user: 'Tester'
	});
} catch (err) {
	conflict = err;
}
assert(conflict instanceof FileConflictError,
	'an externally-modified correction file is rejected');
assert(folder.files.get(overrideName).text === 'external edit',
	'conflict detection leaves the external edit untouched');

const unexpectedFolder = new MemoryDirectoryHandle();
unexpectedFolder.put(overrideName, 'appeared after load', 70);
let unexpectedConflict = null;
try {
	await writeSpecimenOverride(unexpectedFolder, dataset, candidateMap, {
		expectedLastModified: null,
		user: 'Tester'
	});
} catch (err) {
	unexpectedConflict = err;
}
assert(unexpectedConflict instanceof FileConflictError,
	'a correction file that appeared after shipped data loaded is rejected');

const beforeFailure = folder.files.get(overrideName).text;
const currentTimestamp = folder.files.get(overrideName).lastModified;
folder.failNextWrite = true;
let writeFailed = false;
try {
	await writeSpecimenOverride(folder, dataset, candidateMap, {
		filename: overrideName,
		expectedLastModified: currentTimestamp,
		user: 'Tester'
	});
} catch {
	writeFailed = true;
}
assert(writeFailed && folder.abortCount === 1, 'a failed write aborts its staged stream');
assert(folder.files.get(overrideName).text === beforeFailure,
	'a failed write does not replace the existing correction file');

console.log('\n4. Identification retries are idempotent');
const logFolder = new MemoryDirectoryHandle();
const entry = {
	catalogueNumber: 'K0002',
	scientificName: 'Macaranga resolved',
	identifier: 'Tester',
	herbarium: 'K',
	identificationDate: '2026-07-10',
	remarks: 'retry fixture'
};
const firstAppend = await appendIdentification(logFolder, dataset, entry, { user: 'Tester' });
const secondAppend = await appendIdentification(logFolder, dataset, entry, { user: 'Tester' });
const log = await readIdentificationLog(logFolder, dataset);
assert(firstAppend.appended && !secondAppend.appended,
	'an exact matching log tail is recognised as an already-completed retry');
assert(parseIdentificationLog(log.text).length === 1,
	'retrying an identification does not duplicate the history row');
assert(log.filename === getIdentificationLogFilename(dataset, 'Tester'),
	'the retry continues to use the expected identification-log filename');

if (failures) {
	console.error(`\n${failures} reliability check(s) failed`);
	process.exit(1);
}
console.log('\nAll reliability checks passed');
