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

/**
 * Card sort order. 'family' (Family→Genus→Name) is the default — botanists
 * scanning a field-flora dataset typically know the family before the order;
 * 'order' adds an Order tier above Family for cross-order comparisons; 'name'
 * is plain alphabetical by TaxonomicName.
 */
export const sortStore = writable('family');

/** Active filter state. */
export const filterStore = writable({
	order: '',
	family: '',
	genus: '',
	clade: '',
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
		case 'clade': return species.clade === value;
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
	'order', 'family', 'genus', 'clade', 'vernacular', 'habits',
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
 * Derived: species array filtered by current filter selection, sorted per the
 * active `sortStore` mode. Sources from one of three pre-sorted arrays built
 * at parse time; Array.filter preserves order so no runtime sort is needed.
 */
export const filteredSpecies = derived(
	[taxaStore, filterStore, sortStore],
	([$taxa, $filter, $sort]) => {
		if (!$taxa) return [];

		const source =
			$sort === 'name' ? $taxa.sortedByName :
			$sort === 'family' ? $taxa.sortedByFamily :
			$taxa.sortedByOrder;

		return applyFilters(source, $filter);
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
	clade: 'allClades',
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

/** Read the species's value for a given filter field. Returns '' for traits we don't track. */
function fieldValue(s, field) {
	switch (field) {
		case 'order': return s.order;
		case 'family': return s.family;
		case 'genus': return s.genus;
		case 'clade': return s.clade;
		case 'leafArrangement': return s.traits.leafArrangement;
		case 'leafForm': return s.traits.leafForm;
		case 'leafVenation': return s.traits.leafVenation;
		case 'leafMargin': return s.traits.leafMargin;
		case 'stipules': return s.traits.stipules;
		case 'exudate': return s.traits.exudate;
		case 'stemArmature': return s.traits.stemArmature;
		case 'tendrils': return s.traits.tendrils;
		default: return '';
	}
}

/**
 * Yield the option keys this species contributes to under `field`. Mirrors the
 * quirks in `matchesField`: a species with empty habits matches every habit
 * selection, and a species with stipules='absent' counts under both 'absent'
 * and 'caducous' (since selecting 'caducous' surfaces 'absent' species too).
 */
function* optionsForSpecies(s, field) {
	if (field === 'habits') {
		if (s.traits.habit.length === 0) {
			yield* HABIT_IDS;
			return;
		}
		for (const h of s.traits.habit) yield h;
		return;
	}
	const v = fieldValue(s, field);
	if (!v) return;
	if (field === 'stipules' && v === 'absent') {
		yield 'absent';
		yield 'caducous';
		return;
	}
	yield v;
}

/**
 * Derived: per-field, per-option count of species that would be visible if
 * this option were the sole selection for its field (all other filters still
 * applied). Powers the "(N)" labels next to each sidebar dropdown option and
 * habit pill. `_all` is the count if the field's filter were cleared.
 *
 * Single-pass O(N × F) over species. For each species, count how many active
 * filters it fails: if 0 it contributes to every counted field's `_all` and
 * matching option(s); if exactly 1 it contributes only to the failing field
 * (and only if that field is itself counted); if ≥2 it contributes to nothing.
 */
export const filterOptionCounts = derived(
	[taxaStore, filterStore],
	([$taxa, $filter]) => {
		const result = { habits: {} };
		for (const field of Object.keys(FIELD_TO_OPTION_SOURCE)) {
			result[field] = { _all: 0 };
		}
		if (!$taxa) return result;

		// Pre-create option buckets so dropdowns still show options with zero matches.
		for (const [field, sourceKey] of Object.entries(FIELD_TO_OPTION_SOURCE)) {
			for (const value of $taxa[sourceKey] ?? []) {
				result[field][value] = 0;
			}
		}
		for (const h of HABIT_IDS) result.habits[h] = 0;

		const activeFields = FILTER_FIELDS.filter((f) => isFilterActive(f, $filter[f]));
		const countedFields = [...Object.keys(FIELD_TO_OPTION_SOURCE), 'habits'];

		for (const s of Object.values($taxa.speciesByName)) {
			let failCount = 0;
			let failedField = null;
			for (const f of activeFields) {
				if (!matchesField(s, f, $filter[f])) {
					failCount++;
					if (failCount > 1) break;
					failedField = f;
				}
			}
			if (failCount > 1) continue;

			for (const cf of countedFields) {
				if (failCount === 1 && cf !== failedField) continue;
				const bucket = result[cf];
				if (cf !== 'habits') bucket._all++;
				for (const opt of optionsForSpecies(s, cf)) {
					if (opt in bucket) bucket[opt]++;
				}
			}
		}

		return result;
	}
);
