import { writable, derived } from 'svelte/store';

/** Raw data loaded from CSV. null until loadSpeciesData() completes. */
export const taxaStore = writable(null);

/**
 * Set when a custom override CSV inside the user's folder failed to parse.
 * `{ filename, reason }` or null. Drives the sidebar's amber banner.
 * Cleared on any successful load.
 */
export const csvLoadErrorStore = writable(null);

/**
 * Which CSV the current `taxaStore` was loaded from, for user feedback.
 * One of 'shipped' | 'custom'. null until a load completes.
 */
export const taxaSourceStore = writable(null);

/**
 * Filename of the custom override CSV currently in use (e.g.
 * `Ankarafantsika_herbarium_images_Stuart.csv`). Null when the shipped CSV
 * is loaded. Drives the sidebar's "Using <file> from this folder" banner.
 */
export const taxaSourceFilenameStore = writable(null);

/**
 * Default-selected growth habits (tree + shrub). Field ID work focuses on woody
 * plants; herbs/lianas/epiphytes are opt-in via the pill UI.
 */
export const DEFAULT_HABITS = ['tree', 'shrub'];

/** Active filter state. */
export const filterStore = writable({
	order: '',
	family: '',
	genus: '',
	vernacular: '',
	habits: [...DEFAULT_HABITS],
	leafArrangement: '',
	leafForm: '',
	leafVenation: '',
	leafMargin: '',
	stipules: '',
	exudate: '',
	stemArmature: '',
	tendrils: ''
});

/**
 * Per-field predicate used by both `filteredSpecies` and the option-count
 * store. `value` is the candidate filter value (for habits, an array).
 * Keep the stipules 'caducous' → 'caducous|absent' quirk in exactly one place.
 */
function matchesField(species, fieldId, value) {
	switch (fieldId) {
		case 'order': return species.order === value;
		case 'family': return species.family === value;
		case 'genus': return species.genus === value;
		case 'vernacular': return species.vernacularName === value;
		case 'habits':
			return species.traits.habit.length === 0 ||
				species.traits.habit.some((h) => value.includes(h));
		case 'leafArrangement': return species.traits.leafArrangement === value;
		case 'leafForm': return species.traits.leafForm === value;
		case 'leafVenation': return species.traits.leafVenation === value;
		case 'leafMargin': return species.traits.leafMargin === value;
		case 'stipules':
			// Caducous stipules fall off early, so a field observer may record
			// them as either 'caducous' or 'absent'. Treat the two as one bucket
			// when 'caducous' is selected.
			if (value === 'caducous') {
				return species.traits.stipules === 'caducous' || species.traits.stipules === 'absent';
			}
			return species.traits.stipules === value;
		case 'exudate': return species.traits.exudate === value;
		case 'stemArmature': return species.traits.stemArmature === value;
		case 'tendrils': return species.traits.tendrils === value;
		default: return true;
	}
}

function isFilterActive(fieldId, filterValue) {
	if (fieldId === 'habits') return Array.isArray(filterValue) && filterValue.length > 0;
	return Boolean(filterValue);
}

const FILTER_FIELDS = [
	'order', 'family', 'genus', 'vernacular', 'habits',
	'leafArrangement', 'leafForm', 'leafVenation', 'leafMargin',
	'stipules', 'exudate', 'stemArmature', 'tendrils'
];

/** Apply every active filter except `exceptField` (null = apply all). */
function applyFilters(speciesArr, $filter, exceptField = null) {
	let out = speciesArr;
	for (const field of FILTER_FIELDS) {
		if (field === exceptField) continue;
		if (!isFilterActive(field, $filter[field])) continue;
		out = out.filter((s) => matchesField(s, field, $filter[field]));
	}
	return out;
}

/**
 * Derived: species array filtered by current family/genus selection,
 * sorted taxonomically (Family → Genus → TaxonomicName).
 */
export const filteredSpecies = derived(
	[taxaStore, filterStore],
	([$taxa, $filter]) => {
		if (!$taxa) return [];

		const species = applyFilters(Object.values($taxa.speciesByName), $filter);

		species.sort((a, b) =>
			a.order.localeCompare(b.order) ||
			a.family.localeCompare(b.family) ||
			a.genus.localeCompare(b.genus) ||
			a.taxonomicName.localeCompare(b.taxonomicName)
		);

		return species;
	}
);

/**
 * Derived: total species count (unfiltered).
 */
export const totalSpeciesCount = derived(taxaStore, ($taxa) => {
	if (!$taxa) return 0;
	return Object.keys($taxa.speciesByName).length;
});

/**
 * Derived: sorted, de-duplicated list of non-empty vernacular names in the
 * current dataset. Powers the sidebar's <datalist> typeahead.
 */
export const vernacularOptions = derived(taxaStore, ($taxa) => {
	if (!$taxa) return [];
	const names = new Set();
	for (const sp of Object.values($taxa.speciesByName)) {
		if (sp.vernacularName) names.add(sp.vernacularName);
	}
	return [...names].sort((a, b) => a.localeCompare(b));
});

/**
 * Derived: families available given current order filter.
 * If an order is selected, only families within that order are shown.
 */
export const availableFamilies = derived(
	[taxaStore, filterStore],
	([$taxa, $filter]) => {
		if (!$taxa) return [];

		if ($filter.order) {
			const families = new Set();
			for (const sp of Object.values($taxa.speciesByName)) {
				if (sp.order === $filter.order) {
					families.add(sp.family);
				}
			}
			return [...families].filter(Boolean).sort();
		}

		return $taxa.allFamilies;
	}
);

/**
 * Derived: genera available given current family filter.
 * If a family is selected, only genera within that family are shown.
 */
export const availableGenera = derived(
	[taxaStore, filterStore],
	([$taxa, $filter]) => {
		if (!$taxa) return [];

		if ($filter.family) {
			const genera = new Set();
			for (const sp of Object.values($taxa.speciesByName)) {
				if (sp.family === $filter.family) {
					genera.add(sp.genus);
				}
			}
			return [...genera].sort();
		}

		return $taxa.allGenera;
	}
);

/**
 * Maps each filter field to the taxaStore array of candidate values to count.
 * Vernacular is intentionally omitted — the sidebar input is a datalist, not a
 * <select>, and prepending counts would either break the filter value or render
 * inconsistently across browsers.
 */
const FIELD_TO_OPTION_SOURCE = {
	order: 'allOrders',
	family: 'allFamilies',
	genus: 'allGenera',
	leafArrangement: 'allLeafArrangements',
	leafForm: 'allLeafForms',
	leafVenation: 'allLeafVenations',
	leafMargin: 'allLeafMargins',
	stipules: 'allStipules',
	exudate: 'allExudates',
	stemArmature: 'allStemArmatures',
	tendrils: 'allTendrils'
};

const HABIT_IDS = ['tree', 'shrub', 'herb', 'liana', 'epiphyte'];

/**
 * Derived: per-field, per-option count of species that would be visible if
 * this option were the sole selection for its field (all other filters still
 * applied). Powers the "(N)" labels next to each sidebar dropdown option and
 * habit pill. `_all` is the count if the field's filter were cleared.
 */
export const filterOptionCounts = derived(
	[taxaStore, filterStore],
	([$taxa, $filter]) => {
		const result = { habits: {} };
		for (const field of Object.keys(FIELD_TO_OPTION_SOURCE)) {
			result[field] = { _all: 0 };
		}
		if (!$taxa) return result;

		const allSpecies = Object.values($taxa.speciesByName);

		for (const [field, sourceKey] of Object.entries(FIELD_TO_OPTION_SOURCE)) {
			const pool = applyFilters(allSpecies, $filter, field);
			const bucket = { _all: pool.length };
			for (const value of $taxa[sourceKey] ?? []) {
				bucket[value] = pool.filter((s) => matchesField(s, field, value)).length;
			}
			result[field] = bucket;
		}

		const habitPool = applyFilters(allSpecies, $filter, 'habits');
		for (const h of HABIT_IDS) {
			result.habits[h] = habitPool.filter((s) => matchesField(s, 'habits', [h])).length;
		}

		return result;
	}
);
