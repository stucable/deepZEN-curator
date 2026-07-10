#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Papa from 'papaparse';
import { datasets } from '../src/lib/datasets.js';
import {
	IGNORED_HABIT_TOKENS,
	KNOWN_HABITS,
	normalizeHabits,
	parseSpeciesCsv,
	splitHabitTokens,
	splitImageFiles
} from '../src/lib/utils/csv.js';
import { inBbox, MADAGASCAR_BBOX } from '../src/lib/utils/geo.js';
import { KNOWN_COORDINATE_ISSUES } from './data-quality-notes.js';

function increment(map, key) {
	map.set(key, (map.get(key) ?? 0) + 1);
}

function imageFilesForRow(row, catalogueNumber) {
	if (row.ImageFile !== undefined) return splitImageFiles(row.ImageFile);
	if (row.Barcode !== undefined) return splitImageFiles(row.Barcode);
	return catalogueNumber ? [catalogueNumber] : [];
}

function rowIdentity(row) {
	return [
		row.TaxonomicName,
		row.DecimalLatitude,
		row.DecimalLongitude,
		row.Country,
		row.RecordedBy,
		row.RecordNumber
	].map((value) => String(value ?? '').trim()).join('\u001f');
}

function sample(values, limit = 8) {
	const list = [...values];
	return `${list.slice(0, limit).join(', ')}${list.length > limit ? `, ... (+${list.length - limit})` : ''}`;
}

let failed = false;

for (const dataset of datasets) {
	const errors = [];
	const warnings = [];
	const dataPath = join('static', dataset.csvPath.replace(/^\//, ''));
	const text = await readFile(dataPath, 'utf8');
	let parsedData;

	try {
		parsedData = parseSpeciesCsv(text);
	} catch (err) {
		failed = true;
		console.error(`${dataset.label}: ${err.message}`);
		continue;
	}

	const parsed = Papa.parse(text, {
		header: true,
		skipEmptyLines: true,
		transformHeader: (header) => header.trim().replace(/^\uFEFF/, '')
	});

	const unknownHabits = new Map();
	const rowsByBarcode = new Map();
	const imageOwners = new Map();
	const barcodeLessTaxa = new Set();

	for (const row of parsed.data) {
		for (const token of splitHabitTokens(row.Habit)) {
			if (normalizeHabits(token).length === 0 && !IGNORED_HABIT_TOKENS.has(token)) {
				increment(unknownHabits, token);
			}
		}

		const name = row.TaxonomicName?.trim() || '';
		const catalogue = row.CatalogueNumber?.trim() || '';
		if (name && !catalogue) barcodeLessTaxa.add(name);
		if (!catalogue) continue;

		if (!rowsByBarcode.has(catalogue)) rowsByBarcode.set(catalogue, []);
		rowsByBarcode.get(catalogue).push(row);
		for (const file of imageFilesForRow(row, catalogue)) {
			if (!imageOwners.has(file)) imageOwners.set(file, new Set());
			imageOwners.get(file).add(catalogue);
		}
	}

	if (unknownHabits.size) {
		const details = [...unknownHabits]
			.sort((a, b) => a[0].localeCompare(b[0]))
			.map(([habit, count]) => `${habit} (${count})`)
			.join(', ');
		errors.push(`Unknown raw habit token(s): ${details}`);
	}

	const invalidParsedHabits = parsedData.allHabits.filter((habit) => !KNOWN_HABITS.includes(habit));
	if (invalidParsedHabits.length) {
		errors.push(`Parsed habit(s) outside UI vocabulary: ${invalidParsedHabits.join(', ')}`);
	}

	if (barcodeLessTaxa.size) {
		const message = `${barcodeLessTaxa.size} checklist taxon/taxa without a CatalogueNumber: ${sample(barcodeLessTaxa)}`;
		if (dataset.allowBarcodeLess) warnings.push(message);
		else errors.push(message);
	}

	const duplicateBarcodes = [...rowsByBarcode].filter(([, rows]) => rows.length > 1);
	if (duplicateBarcodes.length) {
		warnings.push(`${duplicateBarcodes.length} barcode(s) span multiple rows: ${sample(duplicateBarcodes.map(([barcode]) => barcode))}`);
	}
	const conflictingBarcodes = duplicateBarcodes.filter(([, rows]) => new Set(rows.map(rowIdentity)).size > 1);
	if (conflictingBarcodes.length) {
		warnings.push(`${conflictingBarcodes.length} duplicate barcode(s) have conflicting specimen metadata: ${sample(conflictingBarcodes.map(([barcode]) => barcode))}`);
	}

	const duplicateImages = [...imageOwners].filter(([, owners]) => owners.size > 1);
	if (duplicateImages.length) {
		warnings.push(`${duplicateImages.length} image filename(s) belong to multiple specimens: ${sample(duplicateImages.map(([file]) => file))}`);
	}

	const imagelessBarcoded = [...parsedData.specimensByCatalogue.values()]
		.filter((specimen) => specimen.catalogueNumber && specimen.imageFiles.length === 0)
		.map((specimen) => specimen.catalogueNumber);
	if (imagelessBarcoded.length) {
		warnings.push(`${imagelessBarcoded.length} barcoded specimen(s) have no image file but remain valid Data/Map records: ${sample(imagelessBarcoded)}`);
	}

	const coordinateIssues = [...parsedData.specimensByCatalogue.values()].filter(
		(specimen) => specimen.catalogueNumber &&
			specimen.coordinateSource === 'gps' &&
			specimen.country.trim().toLowerCase() === 'madagascar' &&
			!inBbox(specimen.lng, specimen.lat, MADAGASCAR_BBOX)
	);
	const notes = KNOWN_COORDINATE_ISSUES[dataset.id] ?? {};
	for (const specimen of coordinateIssues) {
		const note = notes[specimen.catalogueNumber] ?? 'Unannotated country/coordinate inconsistency; verify against the source record.';
		warnings.push(`${specimen.catalogueNumber} has Madagascar country but coordinates ${specimen.lat}, ${specimen.lng}. ${note}`);
	}

	const count = Object.keys(parsedData.speciesByName).length;
	console.log(`${dataset.label}: ${count} species, ${parsedData.allHabits.length} habit categories`);
	for (const warning of warnings) console.log(`  warning: ${warning}`);
	for (const error of errors) console.error(`  error: ${error}`);
	if (errors.length) failed = true;
}

if (failed) process.exit(1);
