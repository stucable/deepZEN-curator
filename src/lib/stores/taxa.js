import { writable, derived } from 'svelte/store';
import { selectionPolygonStore, includeUnlocatedStore } from './map.js';
import { pointInRing } from '$lib/utils/geo.js';
import { isUndetermined } from '$lib/utils/csv.js';

/** Raw data loaded from CSV. null until loadSpeciesData() completes. */
export const taxaStore = writable(null);

/**
 * Map of image-file basename → that specimen's type status (e.g. "holotype"),
 * for every type specimen in the dataset. Lets the browse grid badge the exact
 * thumbnail that is a type. Specimen-level + derived separately from the species
 * view, so it doesn't touch buildSpeciesView (or its parity guarantees).
 */
export const typeStatusByImageFile = derived(taxaStore, ($taxa) => {
	const map = new Map();
	if (!$taxa) return map;
	for (const s of $taxa.specimensByCatalogue.values()) {
		if (!s.typeStatus) continue;
		for (const file of s.imageFiles) map.set(file, s.typeStatus);
	}
	return map;
});

/**
 * Map of image-file basename → that specimen's { lat, lng }, for every image of a
 * georeferenced specimen. Powers the region-polygon image filter (browseSpecies):
 * a file's absence from this map means its specimen has no coordinates. Built like
 * typeStatusByImageFile — specimen-level, separate from the species view. Specimens
 * with a null lat or lng are deliberately skipped (absence == "no coordinates").
 */
export const imageFileLatLng = derived(taxaStore, ($taxa) => {
	const map = new Map();
	if (!$taxa) return map;
	for (const s of $taxa.specimensByCatalogue.values()) {
		if (s.lat == null || s.lng == null) continue;
		for (const file of s.imageFiles) map.set(file, { lat: s.lat, lng: s.lng });
	}
	return map;
});

/**
 * Parsed identifications-log entries for the active dataset (the append-only
 * re-ID history overlaid on the base CSV at load). Empty array when no log file
 * is present. The curation edit modal reads this to show a specimen's ID history
 * and pushes onto it after a re-identification is appended.
 */
export const identificationLogStore = writable([]);

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
	search: '',
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
 * Set of species keys (taxonomicName == buildSpeciesView's grouping key, which is
 * the specimen's currentDetermination) that have at least one geolocated specimen
 * inside the drawn polygon. Returns null when no polygon is active. This is the one
 * specimen-derived predicate; species-level filters stay in applyFilters.
 */
function speciesKeysInPolygon($taxa, polygon) {
	if (!polygon || polygon.length < 3) return null;
	const keys = new Set();
	for (const s of $taxa.geolocatedSpecimens) {
		if (pointInRing(s.lng, s.lat, polygon)) keys.add(s.currentDetermination);
	}
	return keys;
}

/**
 * Derived: the set of species (currentDetermination keys) that have at least one
 * geolocated specimen inside the drawn region polygon, or null when no polygon is
 * active. The single definition of "which species occur in the region" — consumed by
 * `filteredSpecies` (so the Browse grid + map narrow to it) and by the Curate view (to
 * gate which no-coordinate specimens it shows), keeping the two views in lock-step.
 */
export const regionSpeciesKeys = derived(
	[taxaStore, selectionPolygonStore],
	([$taxa, $polygon]) => ($taxa ? speciesKeysInPolygon($taxa, $polygon) : null)
);

/**
 * Derived: species array filtered by current filter selection, sorted per the
 * active `sortStore` mode. Sources from one of three pre-sorted arrays built
 * at parse time; Array.filter preserves order so no runtime sort is needed.
 * A free-text search (substring match over the precomputed `searchText`, AND
 * across whitespace-separated tokens) narrows further. A map polygon, when drawn,
 * narrows the result to species occurring in that region (a species with no
 * geolocated specimen inside is dropped). Search is applied here rather than via
 * `matchesField`/`FILTER_FIELDS` so it stays out of the option-count machinery —
 * the dropdown "(N)" labels keep counting only the dropdown filters.
 */
export const filteredSpecies = derived(
	[taxaStore, filterStore, sortStore, regionSpeciesKeys],
	([$taxa, $filter, $sort, $regionKeys]) => {
		if (!$taxa) return [];

		const source =
			$sort === 'name' ? $taxa.sortedByName :
			$sort === 'family' ? $taxa.sortedByFamily :
			$taxa.sortedByOrder;

		let result = applyFilters(source, $filter);

		const q = $filter.search?.trim().toLowerCase();
		if (q) {
			const tokens = q.split(/\s+/);
			result = result.filter((s) => tokens.every((t) => s.searchText.includes(t)));
		}

		if (!$regionKeys) return result;
		return result.filter((s) => $regionKeys.has(s.taxonomicName));
	}
);

/**
 * Derived: the species the Browse grid renders. Identical to `filteredSpecies`
 * unless a region polygon is active, in which case each species is cloned with its
 * `images` narrowed to the specimen sheets whose coordinates fall inside the polygon
 * — plus, when `includeUnlocatedStore` is on (default), images of specimens that have
 * no coordinates at all. Species left with no images are dropped, so empty cards never
 * render. Kept separate from `filteredSpecies` on purpose: the map and the sidebar
 * species count read `filteredSpecies` and must stay at species-occurrence granularity
 * (a species with an in-region but imageless specimen still maps and still counts), so
 * only the grid applies this image-level narrowing.
 */
export const browseSpecies = derived(
	[filteredSpecies, selectionPolygonStore, includeUnlocatedStore, imageFileLatLng],
	([$filtered, $polygon, $includeUnlocated, $latLng]) => {
		if (!$polygon || $polygon.length < 3) return $filtered;

		const out = [];
		for (const s of $filtered) {
			const images = s.images.filter((file) => {
				const ll = $latLng.get(file);
				return ll ? pointInRing(ll.lng, ll.lat, $polygon) : $includeUnlocated;
			});
			if (images.length) out.push({ ...s, images });
		}
		return out;
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
 * Derived: total determined species in the dataset (unfiltered), excluding the
 * undetermined "to-identify" pile (bare genus / "Genus sp." entries). This is the
 * headline "of N species" total — undetermined entries are surfaced separately.
 */
export const determinedSpeciesCount = derived(taxaStore, ($taxa) => {
	if (!$taxa) return 0;
	return Object.values($taxa.speciesByName).filter((s) => !isUndetermined(s.taxonomicName)).length;
});

/**
 * Derived: the currently-filtered species split into determined vs undetermined,
 * so the sidebar footer can show a determined-only "showing X of N" count plus a
 * separate tally of how many "Genus sp." to-identify cards are also in view.
 */
export const filteredSpeciesCounts = derived(filteredSpecies, ($fs) => {
	let determined = 0;
	let undetermined = 0;
	for (const s of $fs) {
		if (isUndetermined(s.taxonomicName)) undetermined++;
		else determined++;
	}
	return { determined, undetermined };
});

/**
 * Derived: count of individual undetermined specimens (barcoded sheets in the
 * "Genus sp." to-identify pile) currently in view — not the number of "Genus sp."
 * groups. Powers the sidebar footer's "and N unidentified specimens" line. The
 * in-view undetermined *species* come from `filteredSpecies` (which already applies
 * the sidebar filters + in-region species gate); for each, specimens are counted at
 * the specimen level, honouring the region polygon the same way the Curate table does
 * (inside the polygon, or — when includeUnlocatedStore is on — no-coordinate ones).
 */
export const unidentifiedSpecimenCount = derived(
	[taxaStore, filteredSpecies, selectionPolygonStore, includeUnlocatedStore],
	([$taxa, $filtered, $polygon, $inc]) => {
		if (!$taxa) return 0;
		const undet = new Set(
			$filtered.filter((s) => isUndetermined(s.taxonomicName)).map((s) => s.taxonomicName)
		);
		if (undet.size === 0) return 0;
		const hasPoly = $polygon && $polygon.length >= 3;
		let n = 0;
		for (const s of $taxa.specimensByCatalogue.values()) {
			if (!s.catalogueNumber) continue;
			if (!undet.has(s.currentDetermination)) continue;
			if (hasPoly) {
				const inPoly = s.lat != null && s.lng != null && pointInRing(s.lng, s.lat, $polygon);
				const noCoords = s.lat == null || s.lng == null;
				if (!(inPoly || ($inc && noCoords))) continue;
			}
			n++;
		}
		return n;
	}
);

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
