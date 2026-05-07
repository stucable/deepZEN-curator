#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Papa from 'papaparse';
import { datasets } from '../src/lib/datasets.js';
import { KNOWN_HABITS, normalizeHabits, parseSpeciesCsv } from '../src/lib/utils/csv.js';

const IGNORED_RAW_HABIT_TOKENS = new Set(['species', 'lithophyte']);

function cleanHabitToken(token) {
	return token
		.trim()
		.toLowerCase()
		.replace(/^"+|"+$/g, '')
		.trim();
}

function splitHabitTokens(raw) {
	if (!raw) return [];
	return String(raw)
		.split(/\s*(?:;|,|\bor\b)\s*/i)
		.map(cleanHabitToken)
		.filter(Boolean);
}

function increment(map, key) {
	map.set(key, (map.get(key) ?? 0) + 1);
}

let failed = false;

for (const dataset of datasets) {
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
	for (const row of parsed.data) {
		for (const token of splitHabitTokens(row.Habit)) {
			if (normalizeHabits(token).length === 0 && !IGNORED_RAW_HABIT_TOKENS.has(token)) {
				increment(unknownHabits, token);
			}
		}
	}

	const invalidParsedHabits = parsedData.allHabits.filter((habit) => !KNOWN_HABITS.includes(habit));
	const speciesWithoutImages = Object.values(parsedData.speciesByName)
		.filter((species) => species.images.length === 0)
		.map((species) => species.taxonomicName);

	if (unknownHabits.size > 0 || invalidParsedHabits.length > 0 || speciesWithoutImages.length > 0) {
		failed = true;
		console.error(`${dataset.label}: validation failed`);
	}

	if (unknownHabits.size > 0) {
		const details = [...unknownHabits]
			.sort((a, b) => a[0].localeCompare(b[0]))
			.map(([habit, count]) => `${habit} (${count})`)
			.join(', ');
		console.error(`  Unknown raw habit token(s): ${details}`);
	}

	if (invalidParsedHabits.length > 0) {
		console.error(`  Parsed habit(s) outside UI vocabulary: ${invalidParsedHabits.join(', ')}`);
	}

	if (speciesWithoutImages.length > 0) {
		console.error(`  Species without images: ${speciesWithoutImages.join(', ')}`);
	}

	if (unknownHabits.size === 0 && invalidParsedHabits.length === 0 && speciesWithoutImages.length === 0) {
		const count = Object.keys(parsedData.speciesByName).length;
		console.log(`${dataset.label}: ${count} species, ${parsedData.allHabits.length} habit categories`);
	}
}

if (failed) process.exit(1);
