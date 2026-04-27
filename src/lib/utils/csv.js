import Papa from 'papaparse';

/** Canonical growth-habit vocabulary (lowercase singular). CSV values are matched against this. */
const KNOWN_HABITS = ['tree', 'shrub', 'herb', 'liana', 'epiphyte'];

/** CSV synonyms mapped onto canonical habits. Extend here when new aliases appear. */
const HABIT_ALIASES = { climber: 'liana' };

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
 * Normalises a raw CSV habit cell into a deduped array of canonical habits.
 * Splits on ';' so multi-habit rows like 'tree;shrub' or 'climber;shrub;tree'
 * yield every relevant canonical value. Each token is trimmed + lowercased,
 * remapped via HABIT_ALIASES (e.g. 'climber' → 'liana'), then startsWith-matched
 * against KNOWN_HABITS so 'Tree'/'Trees'/'TREES' all collapse to 'tree'.
 * Unknown tokens pass through unchanged to avoid silent miscategorisation.
 */
function normalizeHabits(raw) {
	if (!raw) return [];
	const canonical = raw
		.split(';')
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean)
		.map((token) => HABIT_ALIASES[token] ?? KNOWN_HABITS.find((h) => token.startsWith(h)) ?? token);
	return [...new Set(canonical)];
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
	const cladeSet = new Set();
	const habitSet = new Set();
	const leafArrangementSet = new Set();
	const leafFormSet = new Set();
	const leafVenationSet = new Set();
	const leafMarginSet = new Set();
	const stipulesSet = new Set();
	const exudateSet = new Set();
	const stemArmatureSet = new Set();
	const tendrilsSet = new Set();

	for (const row of data) {
		const name = row.TaxonomicName?.trim();
		if (!name) continue;

		const family = row.Family?.trim() || '';
		const genus = row.Genus?.trim() || '';
		const clade = row.Clade?.trim() || '';
		const catalogueNumber = row.CatalogueNumber?.trim() || '';
		const order = row.Order?.trim() || '';
		const habit = normalizeHabits(row.Habit);
		const leafArrangement = row.LeafArrangement?.trim() || '';
		const leafForm = row.LeafForm?.trim() || '';
		const leafVenation = row.LeafVenation?.trim() || '';
		const leafMargin = row.LeafMargin?.trim() || '';
		const stipules = row.Stipules?.trim() || '';
		const exudate = row.Exudate?.trim() || '';
		const stemArmature = row.StemArmature?.trim() || '';
		const tendrils = row.Tendrils?.trim() || '';
		const vernacularName = row.VernacularName?.trim() || '';

		orderSet.add(order);
		familySet.add(family);
		genusSet.add(genus);
		if (clade) cladeSet.add(clade);
		habit.forEach((h) => habitSet.add(h));
		if (leafArrangement) leafArrangementSet.add(leafArrangement);
		if (leafForm) leafFormSet.add(leafForm);
		if (leafVenation) leafVenationSet.add(leafVenation);
		if (leafMargin) leafMarginSet.add(leafMargin);
		if (stipules) stipulesSet.add(stipules);
		if (exudate) exudateSet.add(exudate);
		if (stemArmature) stemArmatureSet.add(stemArmature);
		if (tendrils) tendrilsSet.add(tendrils);

		if (!speciesByName[name]) {
			speciesByName[name] = {
				taxonomicName: name,
				vernacularName,
				family,
				genus,
				clade,
				order,
				traits: {
					habit,
					leafArrangement,
					leafForm,
					leafVenation,
					leafMargin,
					stipules,
					exudate,
					stemArmature,
					tendrils
				},
				searchText: [name, family, genus, clade, vernacularName].join(' ').toLowerCase(),
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
	const allClades = [...cladeSet].sort();
	const allHabits = [...habitSet].sort();
	const allLeafArrangements = [...leafArrangementSet].sort();
	const allLeafForms = [...leafFormSet].sort();
	const allLeafVenations = [...leafVenationSet].sort();
	const allLeafMargins = [...leafMarginSet].sort();
	const allStipules = [...stipulesSet].sort();
	const allExudates = [...exudateSet].sort();
	const allStemArmatures = [...stemArmatureSet].sort();
	const allTendrils = [...tendrilsSet].sort();

	// Pre-sort once at parse time so the filtered-species derived store can
	// just pick a source and filter it (Array.filter preserves order). A single
	// reused Intl.Collator is ~10× faster than naked localeCompare which
	// allocates a fresh collator per call.
	const collator = new Intl.Collator(undefined, { sensitivity: 'variant' });
	const speciesArray = Object.values(speciesByName);
	const cmpName = (a, b) => collator.compare(a.taxonomicName, b.taxonomicName);
	const cmpFamily = (a, b) =>
		collator.compare(a.family, b.family) ||
		collator.compare(a.genus, b.genus) ||
		cmpName(a, b);
	const cmpOrder = (a, b) => collator.compare(a.order, b.order) || cmpFamily(a, b);
	const sortedByName = [...speciesArray].sort(cmpName);
	const sortedByFamily = [...speciesArray].sort(cmpFamily);
	const sortedByOrder = [...speciesArray].sort(cmpOrder);

	return {
		speciesByName,
		sortedByName,
		sortedByFamily,
		sortedByOrder,
		allOrders,
		allFamilies,
		allGenera,
		allClades,
		allHabits,
		allLeafArrangements,
		allLeafForms,
		allLeafVenations,
		allLeafMargins,
		allStipules,
		allExudates,
		allStemArmatures,
		allTendrils
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
