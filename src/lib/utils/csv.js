import Papa from 'papaparse';

/** Canonical growth-habit vocabulary (lowercase singular). CSV values are matched against this. */
export const KNOWN_HABITS = ['tree', 'shrub', 'herb', 'liana', 'epiphyte'];

/** CSV synonyms mapped onto canonical habits. Extend here when new aliases appear. */
const HABIT_ALIASES = { climber: 'liana' };

const IGNORED_HABIT_TOKENS = new Set([
	// Source spreadsheets occasionally contain taxonomic-rank placeholders here.
	'species',
	// Lithophyte is not exposed as a UI habit; mixed values like
	// "lithophyte or epiphyte" still retain the epiphyte token.
	'lithophyte'
]);

const REQUIRED_COLUMNS = ['TaxonomicName', 'CatalogueNumber'];

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
 * remapped via HABIT_ALIASES (e.g. 'climber' → 'liana'), then matched against
 * KNOWN_HABITS so 'Tree'/'Trees'/'TREES' all collapse to 'tree'. Unsupported
 * tokens are ignored so the UI vocabulary and filter predicates stay aligned.
 */
function cleanHabitToken(token) {
	return token
		.trim()
		.toLowerCase()
		.replace(/^"+|"+$/g, '')
		.trim();
}

function normalizeHabitToken(token) {
	const cleaned = cleanHabitToken(token);
	if (!cleaned || IGNORED_HABIT_TOKENS.has(cleaned)) return null;

	const aliased = HABIT_ALIASES[cleaned] ?? cleaned;
	const known = KNOWN_HABITS.find((habit) =>
		aliased === habit ||
		aliased === `${habit}s` ||
		aliased.startsWith(`${habit} `) ||
		aliased.startsWith(`${habit}-`)
	);
	return known ?? null;
}

export function normalizeHabits(raw) {
	if (!raw) return [];
	const canonical = raw
		.split(/\s*(?:;|,|\bor\b)\s*/i)
		.map(normalizeHabitToken)
		.filter(Boolean);
	return [...new Set(canonical)];
}

/**
 * Parses a single coordinate cell into a finite number within [min, max], or
 * null for blank / non-numeric / out-of-range. Specimens are only ~partially
 * georeferenced, so a null here is the normal case, not an error.
 */
function parseCoord(raw, min, max) {
	if (raw == null) return null;
	const trimmed = String(raw).trim();
	if (!trimmed) return null;
	const n = Number(trimmed);
	if (Number.isNaN(n) || n < min || n > max) return null;
	return n;
}

const parseLat = (raw) => parseCoord(raw, -90, 90);
const parseLng = (raw) => parseCoord(raw, -180, 180);

/**
 * Splits an ImageFile cell into de-duplicated file basenames. A specimen carries
 * 0-2 images in one cell, separated by ';' (e.g. "K004152211; K004152211_a").
 */
function splitImageFiles(raw) {
	if (!raw) return [];
	return [...new Set(raw.split(';').map((s) => s.trim()).filter(Boolean))];
}

/**
 * True for a determination that hasn't been resolved to a species — a bare genus
 * or one carrying the explicit "sp." rank marker (e.g. "Macaranga sp."). These
 * cards are the curator's to-identify pile and sort to the very end of the grid,
 * after every named species, in all sort modes. "cf."/"aff." tentative IDs keep a
 * specific epithet and are NOT treated as undetermined.
 */
export function isUndetermined(name) {
	const words = String(name).trim().split(/\s+/);
	if (words.length < 2) return true;
	const last = words[words.length - 1].toLowerCase();
	return last === 'sp.' || last === 'sp';
}

/**
 * Builds the species-grouped view (the structure the grid + filters consume)
 * from a Map of specimens keyed by catalogue number. Groups specimens by their
 * `currentDetermination` — in the absence of a determination log this equals
 * `taxonomicName`, so the result matches a plain group-by-name. Kept separate
 * from row parsing so curation re-identification (a later phase) can re-run
 * just this step after mutating a specimen's currentDetermination.
 *
 * The first specimen encountered for a determination seeds that species'
 * taxonomic attributes + traits (first-wins, matching legacy parse behaviour);
 * every specimen contributes its catalogue number to images[] in insertion
 * order, and its attributes to the option Sets.
 */
export function buildSpeciesView(specimensByCatalogue) {
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

	for (const specimen of specimensByCatalogue.values()) {
		const name = specimen.currentDetermination;
		const {
			family, genus, clade, order, vernacularName, traits, searchText, imageFiles
		} = specimen;

		orderSet.add(order);
		familySet.add(family);
		genusSet.add(genus);
		if (clade) cladeSet.add(clade);
		traits.habit.forEach((h) => habitSet.add(h));
		if (traits.leafArrangement) leafArrangementSet.add(traits.leafArrangement);
		if (traits.leafForm) leafFormSet.add(traits.leafForm);
		if (traits.leafVenation) leafVenationSet.add(traits.leafVenation);
		if (traits.leafMargin) leafMarginSet.add(traits.leafMargin);
		if (traits.stipules) stipulesSet.add(traits.stipules);
		if (traits.exudate) exudateSet.add(traits.exudate);
		if (traits.stemArmature) stemArmatureSet.add(traits.stemArmature);
		if (traits.tendrils) tendrilsSet.add(traits.tendrils);

		if (!speciesByName[name]) {
			speciesByName[name] = {
				taxonomicName: name,
				vernacularName,
				family,
				genus,
				clade,
				order,
				traits,
				searchText,
				images: []
			};
		}

		// Each of the specimen's image files becomes one grid thumbnail; images[]
		// holds file basenames, which may differ from the accession (e.g.
		// K004152211_a) and number more than one per sheet. Imageless-but-
		// georeferenced specimens contribute nothing here yet still appear on the
		// map (they keep their catalogue number + coordinates).
		for (const file of imageFiles) {
			speciesByName[name].images.push(file);
		}
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
	// Undetermined species (bare genus / "… sp.") always sort after named ones,
	// as the primary key in every mode, so the to-identify pile sits at the very
	// end of the grid regardless of family/genus/name tiers below.
	const undetRank = (s) => (isUndetermined(s.taxonomicName) ? 1 : 0);
	const cmpName = (a, b) =>
		undetRank(a) - undetRank(b) ||
		collator.compare(a.taxonomicName, b.taxonomicName);
	const cmpFamily = (a, b) =>
		undetRank(a) - undetRank(b) ||
		collator.compare(a.family, b.family) ||
		collator.compare(a.genus, b.genus) ||
		cmpName(a, b);
	const cmpOrder = (a, b) =>
		undetRank(a) - undetRank(b) ||
		collator.compare(a.order, b.order) ||
		cmpFamily(a, b);
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
 * Parses a CSV text blob into the species structure. Pure — no fetching.
 * Throws CsvSchemaError if zero rows contain a usable TaxonomicName.
 * @param {string} text - raw CSV text
 */
export function parseSpeciesCsv(text) {
	const parsed = Papa.parse(text, {
		header: true,
		skipEmptyLines: true,
		transformHeader: (header) => header.trim().replace(/^\uFEFF/, '')
	});
	const { data, errors, meta } = parsed;

	const fatalErrors = errors.filter((e) => e.type !== 'FieldMismatch');
	if (fatalErrors.length > 0) {
		const first = fatalErrors[0];
		const atRow = typeof first.row === 'number' ? ` at row ${first.row + 1}` : '';
		throw new CsvSchemaError(`${first.message}${atRow}`);
	}

	const fields = new Set(meta.fields ?? []);
	const missing = REQUIRED_COLUMNS.filter((name) => !fields.has(name));
	if (missing.length > 0) {
		throw new CsvSchemaError(`Missing required column(s): ${missing.join(', ')}`);
	}

	// One record per physical specimen, keyed by catalogue (barcode) number.
	// A Map preserves insertion (row) order — important because catalogue
	// numbers are numeric-looking strings that a plain object would reorder,
	// which would scramble image display order.
	const specimensByCatalogue = new Map();
	// Determinations already represented. Rows with a name but no catalogue
	// number aren't curatable specimens, yet they historically still listed the
	// species (with an empty image set) and populated the family/genus/trait
	// dropdowns. We keep exactly one barcode-less placeholder per name not
	// otherwise represented so the species view stays byte-identical.
	const seededNames = new Set();
	let syntheticSeq = 0;

	for (const row of data) {
		const name = row.TaxonomicName?.trim();
		if (!name) continue;

		const catalogueNumber = row.CatalogueNumber?.trim() || '';

		// Image file basenames for this specimen. A sheet carries 0-2 images in one
		// ImageFile (or legacy-named Barcode) cell, separated by ';' (e.g.
		// "K004152211; K004152211_a"). These basenames are NOT always the catalogue
		// number: when one image of a pair is deleted the survivor may keep a suffix
		// (file K004152211_a.jpg for accession K004152211). The older datasets have
		// neither column and name their files by catalogue number.
		const rowImageFiles =
			row.ImageFile !== undefined ? splitImageFiles(row.ImageFile) :
			row.Barcode !== undefined ? splitImageFiles(row.Barcode) :
			catalogueNumber ? [catalogueNumber] : [];

		// One barcode = one physical sheet. The canonical form is a single row per
		// specimen (its images listed in one cell), but we also tolerate the same
		// barcode spanning several rows: the first row wins for taxonomy / coords /
		// metadata, and later rows only contribute additional image files.
		if (catalogueNumber && specimensByCatalogue.has(catalogueNumber)) {
			const existing = specimensByCatalogue.get(catalogueNumber);
			for (const f of rowImageFiles) {
				if (!existing.imageFiles.includes(f)) existing.imageFiles.push(f);
			}
			existing.hasImage = existing.imageFiles.length > 0;
			continue;
		}
		// Rows with a name but no barcode aren't curatable specimens; keep exactly
		// one barcode-less placeholder per name (legacy parity for the dropdowns).
		if (!catalogueNumber && seededNames.has(name)) continue;

		const family = row.Family?.trim() || '';
		const genus = row.Genus?.trim() || '';
		const clade = row.Clade?.trim() || '';
		const order = row.Order?.trim() || '';
		const vernacularName = row.VernacularName?.trim() || '';

		// Barcode-less rows get a synthetic, collision-proof key (the leading
		// space can't appear in a trimmed catalogue number) so they survive in
		// the Map without masquerading as a real specimen.
		const key = catalogueNumber || ` nobarcode:${syntheticSeq++}`;
		seededNames.add(name);
		specimensByCatalogue.set(key, {
			catalogueNumber,
			taxonomicName: name,
			// Equals taxonomicName until a determination log overlays it (later phase).
			currentDetermination: name,
			family,
			genus,
			clade,
			order,
			vernacularName,
			traits: {
				habit: normalizeHabits(row.Habit),
				leafArrangement: row.LeafArrangement?.trim() || '',
				leafForm: row.LeafForm?.trim() || '',
				leafVenation: row.LeafVenation?.trim() || '',
				leafMargin: row.LeafMargin?.trim() || '',
				stipules: row.Stipules?.trim() || '',
				exudate: row.Exudate?.trim() || '',
				stemArmature: row.StemArmature?.trim() || '',
				tendrils: row.Tendrils?.trim() || ''
			},
			searchText: [name, family, genus, clade, vernacularName].join(' ').toLowerCase(),
			// Image file basenames for this specimen (0-2); each renders one grid
			// thumbnail. hasImage mirrors imageFiles.length > 0 (a flag for the map).
			imageFiles: [...rowImageFiles],
			hasImage: rowImageFiles.length > 0 && !!catalogueNumber,
			lat: parseLat(row.DecimalLatitude),
			lng: parseLng(row.DecimalLongitude),
			locality: row.Locality?.trim() || '',
			// Collection metadata for map hover tips (Darwin Core terms).
			recordedBy: row.RecordedBy?.trim() || '',
			recordNumber: row.RecordNumber?.trim() || '',
			collectionDate: row.CollectionDate?.trim() || '',
			occurrenceId: row.OccurrenceID?.trim() || '',
			editedAt: row.EditedAt?.trim() || ''
		});
	}

	const view = buildSpeciesView(specimensByCatalogue);

	if (Object.keys(view.speciesByName).length === 0) {
		throw new CsvSchemaError('No rows with a TaxonomicName column were found');
	}

	// Only real (barcoded) specimens can anchor a map point to an image, so the
	// barcode-less placeholders are excluded even if they carry coordinates.
	const geolocatedSpecimens = [...specimensByCatalogue.values()].filter(
		(s) => s.catalogueNumber && s.lat != null && s.lng != null
	);

	return { ...view, specimensByCatalogue, geolocatedSpecimens };
}

/**
 * Fetches and parses a dataset CSV.
 * @param {string} csvPath - absolute URL path to the CSV under /static (e.g. '/data/foo.csv')
 */
export async function loadSpeciesData(csvPath) {
	const res = await fetch(csvPath);
	if (!res.ok) {
		throw new CsvSchemaError(`Could not load ${csvPath} (${res.status} ${res.statusText})`);
	}
	const text = await res.text();
	return parseSpeciesCsv(text);
}
