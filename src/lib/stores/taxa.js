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
 * Derived: species array filtered by current family/genus selection,
 * sorted taxonomically (Family → Genus → TaxonomicName).
 */
export const filteredSpecies = derived(
	[taxaStore, filterStore],
	([$taxa, $filter]) => {
		if (!$taxa) return [];

		let species = Object.values($taxa.speciesByName);

		if ($filter.order) {
			species = species.filter((s) => s.order === $filter.order);
		}
		if ($filter.family) {
			species = species.filter((s) => s.family === $filter.family);
		}
		if ($filter.genus) {
			species = species.filter((s) => s.genus === $filter.genus);
		}
		if ($filter.vernacular) {
			species = species.filter((s) => s.vernacularName === $filter.vernacular);
		}
		if ($filter.habits?.length > 0) {
			species = species.filter(
				(s) =>
					s.traits.habit.length === 0 ||
					s.traits.habit.some((h) => $filter.habits.includes(h))
			);
		}
		if ($filter.leafArrangement) {
			species = species.filter((s) => s.traits.leafArrangement === $filter.leafArrangement);
		}
		if ($filter.leafForm) {
			species = species.filter((s) => s.traits.leafForm === $filter.leafForm);
		}
		if ($filter.leafVenation) {
			species = species.filter((s) => s.traits.leafVenation === $filter.leafVenation);
		}
		if ($filter.leafMargin) {
			species = species.filter((s) => s.traits.leafMargin === $filter.leafMargin);
		}
		if ($filter.stipules) {
			// Caducous stipules fall off early, so a field observer may record
			// them as either 'caducous' or 'absent'. Treat the two as one bucket
			// when 'caducous' is selected.
			species = species.filter((s) => {
				if ($filter.stipules === 'caducous') {
					return s.traits.stipules === 'caducous' || s.traits.stipules === 'absent';
				}
				return s.traits.stipules === $filter.stipules;
			});
		}
		if ($filter.exudate) {
			species = species.filter((s) => s.traits.exudate === $filter.exudate);
		}
		if ($filter.stemArmature) {
			species = species.filter((s) => s.traits.stemArmature === $filter.stemArmature);
		}
		if ($filter.tendrils) {
			species = species.filter((s) => s.traits.tendrils === $filter.tendrils);
		}

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
