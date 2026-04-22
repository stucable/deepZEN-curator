import Papa from 'papaparse';

/** Canonical growth-habit vocabulary (lowercase singular). CSV values are matched against this. */
const KNOWN_HABITS = ['tree', 'shrub', 'herb', 'liana', 'epiphyte'];

/**
 * Thrown by parseSpeciesCsv when the input doesn't look like our schema
 * (no rows with a TaxonomicName). Caught by the UI to show a banner instead
 * of silently emptying the grid.
 */
export class CsvSchemaError extends Error {
	constructor(message) {
		super(message);
		this.name = 'CsvSchemaError';
	}
}

/**
 * Normalises a raw CSV habit value to the canonical singular lowercase form.
 * Uses startsWith so 'Tree'/'Trees'/'TREES' all collapse to 'tree'. Unknown
 * values pass through unchanged to avoid silent miscategorisation.
 */
function normalizeHabit(raw) {
	if (!raw) return '';
	const lower = raw.trim().toLowerCase();
	return KNOWN_HABITS.find((h) => lower.startsWith(h)) ?? lower;
}

/**
 * Parses a CSV text blob into the species structure. Pure — no fetching.
 * Throws CsvSchemaError if zero rows contain a usable TaxonomicName.
 * @param {string} text - raw CSV text
 */
export function parseSpeciesCsv(text) {
	const { data } = Papa.parse(text, {
		header: true,
		skipEmptyLines: true
	});

	const speciesByName = {};
	const orderSet = new Set();
	const familySet = new Set();
	const genusSet = new Set();
	const habitSet = new Set();
	const leafArrangementSet = new Set();
	const leafFormSet = new Set();
	const leafVenationSet = new Set();
	const leafMarginSet = new Set();
	const stipulesSet = new Set();
	const exudateSet = new Set();

	for (const row of data) {
		const name = row.TaxonomicName?.trim();
		if (!name) continue;

		const family = row.Family?.trim() || '';
		const genus = row.Genus?.trim() || '';
		const catalogueNumber = row.CatalogueNumber?.trim() || '';
		const order = row.Order?.trim() || '';
		const habit = normalizeHabit(row.Habit);
		const leafArrangement = row.LeafArrangement?.trim() || '';
		const leafForm = row.LeafForm?.trim() || '';
		const leafVenation = row.LeafVenation?.trim() || '';
		const leafMargin = row.LeafMargin?.trim() || '';
		const stipules = row.Stipules?.trim() || '';
		const exudate = row.Exudate?.trim() || '';
		const vernacularName = row.VernacularName?.trim() || '';

		orderSet.add(order);
		familySet.add(family);
		genusSet.add(genus);
		if (habit) habitSet.add(habit);
		if (leafArrangement) leafArrangementSet.add(leafArrangement);
		if (leafForm) leafFormSet.add(leafForm);
		if (leafVenation) leafVenationSet.add(leafVenation);
		if (leafMargin) leafMarginSet.add(leafMargin);
		if (stipules) stipulesSet.add(stipules);
		if (exudate) exudateSet.add(exudate);

		if (!speciesByName[name]) {
			speciesByName[name] = {
				taxonomicName: name,
				vernacularName,
				family,
				genus,
				clade: row.Clade?.trim() || '',
				order,
				traits: {
					habit,
					leafArrangement,
					leafForm,
					leafVenation,
					leafMargin,
					stipules,
					exudate
				},
				searchText: [name, family, genus, vernacularName].join(' ').toLowerCase(),
				images: []
			};
		}

		if (catalogueNumber) {
			speciesByName[name].images.push(catalogueNumber);
		}
	}

	if (Object.keys(speciesByName).length === 0) {
		throw new CsvSchemaError('No rows with a TaxonomicName column were found');
	}

	const allOrders = [...orderSet].filter(Boolean).sort();
	const allFamilies = [...familySet].filter(Boolean).sort();
	const allGenera = [...genusSet].filter(Boolean).sort();
	const allHabits = [...habitSet].sort();
	const allLeafArrangements = [...leafArrangementSet].sort();
	const allLeafForms = [...leafFormSet].sort();
	const allLeafVenations = [...leafVenationSet].sort();
	const allLeafMargins = [...leafMarginSet].sort();
	const allStipules = [...stipulesSet].sort();
	const allExudates = [...exudateSet].sort();

	return {
		speciesByName,
		allOrders,
		allFamilies,
		allGenera,
		allHabits,
		allLeafArrangements,
		allLeafForms,
		allLeafVenations,
		allLeafMargins,
		allStipules,
		allExudates
	};
}

/**
 * Fetches and parses a dataset CSV.
 * @param {string} csvPath - absolute URL path to the CSV under /static (e.g. '/data/foo.csv')
 */
export async function loadSpeciesData(csvPath) {
	const res = await fetch(csvPath);
	const text = await res.text();
	return parseSpeciesCsv(text);
}
