import Papa from 'papaparse';

/** Canonical growth-habit vocabulary (lowercase singular). CSV values are matched against this. */
export const KNOWN_HABITS = ['tree', 'shrub', 'herb', 'liana', 'epiphyte'];

/** CSV synonyms mapped onto canonical habits. Extend here when new aliases appear. */
const HABIT_ALIASES = { climber: 'liana' };

export const IGNORED_HABIT_TOKENS = new Set([
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

function cleanHabitToken(token) {
	return token
		.trim()
		.toLowerCase()
		.replace(/^"+|"+$/g, '')
		.trim();
}

/**
 * Splits a raw CSV habit cell into cleaned (trimmed, lowercased, de-quoted)
 * tokens without canonicalising them — the shared split/clean step. Multi-habit
 * cells like 'tree;shrub', 'climber, shrub' or 'lithophyte or epiphyte' split on
 * ';', ',' or ' or '. Exported so scripts/validate-data.js splits habit cells
 * identically (it needs the raw tokens to name unknown ones); normalizeHabits
 * builds on it.
 */
export function splitHabitTokens(raw) {
	if (!raw) return [];
	return String(raw)
		.split(/\s*(?:;|,|\bor\b)\s*/i)
		.map(cleanHabitToken)
		.filter(Boolean);
}

/**
 * Canonicalises one already-cleaned habit token to a KNOWN_HABITS value, or
 * null. Remaps via HABIT_ALIASES (e.g. 'climber' → 'liana'), then matches
 * KNOWN_HABITS so 'tree'/'trees'/'tree-like' all collapse to 'tree'; ignored
 * and unsupported tokens drop out so the UI vocabulary and filter predicates
 * stay aligned.
 */
function canonicalizeHabitToken(cleaned) {
	if (IGNORED_HABIT_TOKENS.has(cleaned)) return null;

	const aliased = HABIT_ALIASES[cleaned] ?? cleaned;
	const known = KNOWN_HABITS.find((habit) =>
		aliased === habit ||
		aliased === `${habit}s` ||
		aliased.startsWith(`${habit} `) ||
		aliased.startsWith(`${habit}-`)
	);
	return known ?? null;
}

/**
 * Normalises a raw CSV habit cell into a deduped array of canonical habits
 * (e.g. 'climber;shrub;tree' → ['liana', 'shrub', 'tree']). Splits via
 * splitHabitTokens then canonicalises each token; order preserved, dupes removed.
 */
export function normalizeHabits(raw) {
	const canonical = splitHabitTokens(raw).map(canonicalizeHabitToken).filter(Boolean);
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

export const parseLat = (raw) => parseCoord(raw, -90, 90);
export const parseLng = (raw) => parseCoord(raw, -180, 180);

/** Coerces a raw yes/no cell to 'yes' or '' (blank). Tolerates yes/y/true/1, any case. */
export const parseYesNo = (raw) => (/^(yes|y|true|1)$/i.test(String(raw ?? '').trim()) ? 'yes' : '');

/**
 * Splits an ImageFile cell into de-duplicated file basenames. A specimen carries
 * 0-2 images in one cell, separated by ';' (e.g. "K004152211; K004152211_a").
 */
function splitImageFiles(raw) {
	if (!raw) return [];
	return [...new Set(raw.split(';').map((s) => s.trim()).filter(Boolean))];
}

/** Known herbarium codes → display names, for tooltips. Storage uses the code. */
export const INSTITUTION_NAMES = { K: 'Kew', P: 'Paris', TAN: 'Antananarivo (TAN)' };

/**
 * Derives the holding herbarium's institution code from a barcode (CatalogueNumber).
 * Specimen barcodes lead with the institution code — `K004152003` → `K`,
 * `P00012345` → `P`. Returns '' when there's no leading alphabetic prefix (e.g. a
 * purely numeric accession), in which case an explicit InstitutionCode column or a
 * manual edit supplies it instead.
 */
export function deriveInstitutionCode(catalogueNumber) {
	return String(catalogueNumber ?? '').match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? '';
}

/**
 * Trailing tokens that mark a determination as unresolved to species level. Kept
 * deliberately narrow: "cf."/"aff." tentative IDs carry a real epithet (their last
 * word) and are NOT in here, so they stay determined.
 */
const UNDETERMINED_MARKERS = new Set(['sp', 'sp.', 'spp', 'spp.', 'indet', 'indet.', '?']);

/**
 * True for a determination that hasn't been resolved to a species — a bare genus
 * or one whose last word is an undetermined rank marker (e.g. "Macaranga sp.",
 * "Psychotria indet."). These cards are the curator's to-identify pile and sort to
 * the very end of the grid, after every named species, in all sort modes.
 * "cf."/"aff." tentative IDs keep a specific epithet and are NOT treated as
 * undetermined.
 */
export function isUndetermined(name) {
	const words = String(name).trim().split(/\s+/);
	if (words.length < 2) return true;
	return UNDETERMINED_MARKERS.has(words[words.length - 1].toLowerCase());
}

/**
 * Canonical form for an undetermined determination: "<Genus> sp." Determined names
 * (incl. cf./aff. tentative IDs) pass through unchanged. The genus token comes from
 * the Genus column, falling back to the first word of the name; if neither exists the
 * raw name is kept (avoids a bare " sp."). Idempotent: "Grewia sp." → "Grewia sp.".
 */
export function normalizeDetermination(name, genus) {
	if (!isUndetermined(name)) return name;
	const g = (genus || '').trim() || String(name).trim().split(/\s+/)[0] || '';
	return g ? `${g} sp.` : String(name).trim();
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
 * Wraps a specimensByCatalogue Map into the full dataset object the UI consumes:
 * the species view (buildSpeciesView) plus the Map itself and the derived
 * geolocated-specimen list. Used both by the initial parse and after a curation
 * mutation (re-identification or coordinate correction) so the view, dropdowns,
 * and map points re-derive consistently from one place.
 * @param {Map<string, object>} specimensByCatalogue
 */
export function rebuildView(specimensByCatalogue) {
	const view = buildSpeciesView(specimensByCatalogue);
	// Only real (barcoded) specimens can anchor a map point to an image, so the
	// barcode-less placeholders are excluded even if they carry coordinates.
	const geolocatedSpecimens = [...specimensByCatalogue.values()].filter(
		(s) => s.catalogueNumber && s.lat != null && s.lng != null
	);
	return { ...view, specimensByCatalogue, geolocatedSpecimens };
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
		const key = catalogueNumber || ` nobarcode:${syntheticSeq++}`;
		seededNames.add(name);
		specimensByCatalogue.set(key, {
			catalogueNumber,
			taxonomicName: name,
			// Display/grouping determination, normalised to the "<Genus> sp." convention
			// for undetermined specimens (raw taxonomicName above is kept for CSV
			// write-back). Re-set by the ID-log overlay (applyIdentifications).
			currentDetermination: normalizeDetermination(name, genus),
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
			country: row.Country?.trim() || '',
			institutionCode: row.InstitutionCode?.trim() || deriveInstitutionCode(catalogueNumber),
				editedAt: row.EditedAt?.trim() || '',
			// Lossless passthrough: never read by the species view / filters / map,
			// but retained on the specimen so the curation override CSV can be
			// written back without shedding columns (Phase B). Deliberately kept off
			// the species object and out of searchText to preserve byte-for-byte
			// parity of the species view with the pre-Phase-B parser.
			fullName: row.FullName?.trim() || '',
			typeStatus: row.TypeStatus?.trim() || '',
			typeName: row.TypeName?.trim() || '',
			// DNA-sampling workflow, per physical sheet. Like the type / editedAt fields
			// above: lossless passthrough, kept off the species view and out of searchText
			// so species-view parity with the pre-DNA parser holds.
			leafSample: parseYesNo(row.LeafSample),
			dnaExtraction: row.DNAextracted?.trim() || '',
			dnaSequenced: parseYesNo(row.DNAsequenced),
			dnaNotes: row.DNAnotes?.trim() || ''
		});
	}

	const result = rebuildView(specimensByCatalogue);

	if (Object.keys(result.speciesByName).length === 0) {
		throw new CsvSchemaError('No rows with a TaxonomicName column were found');
	}

	return result;
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

/**
 * Fixed column order for the curation override CSV. Covers the full lossless
 * schema so a serialised specimen round-trips through parseSpeciesCsv with no
 * field loss. Kept explicit (not derived from the data) so output is
 * deterministic and diff-friendly regardless of which fields a dataset uses.
 */
const OVERRIDE_COLUMNS = [
	'TaxonomicName', 'CatalogueNumber', 'Clade', 'Order', 'Family', 'Genus',
	'FullName', 'VernacularName', 'TypeStatus', 'TypeName',
	'DecimalLatitude', 'DecimalLongitude', 'Locality', 'RecordedBy',
	'RecordNumber', 'CollectionDate', 'Country', 'InstitutionCode',
	'ImageFile', 'Habit', 'LeafArrangement', 'LeafForm', 'LeafVenation',
	'LeafMargin', 'Stipules', 'Exudate', 'StemArmature', 'Tendrils',
	'LeafSample', 'DNAextracted', 'DNAsequenced', 'DNAnotes', 'EditedAt'
];

/**
 * Serialises a specimensByCatalogue Map back into override-CSV text. Inverse of
 * the row-parsing in parseSpeciesCsv at the specimen level: parse → serialize →
 * parse reproduces an identical specimen Map. It does NOT reproduce the original
 * CSV text byte-for-byte — the parser legitimately collapses multi-row-same-
 * barcode specimens and drops barcode-less placeholders, both of which this
 * serialiser emits in their already-merged, one-row-per-specimen form.
 *
 * Only barcoded (curatable) specimens are written; synthetic ` nobarcode:*`
 * placeholders carry no specimen identity and are skipped.
 * @param {Map<string, object>} specimensByCatalogue
 * @returns {string} CSV text
 */
export function serializeSpecimensCsv(specimensByCatalogue) {
	const rows = [];
	for (const s of specimensByCatalogue.values()) {
		if (!s.catalogueNumber) continue;
		rows.push({
			TaxonomicName: s.taxonomicName,
			CatalogueNumber: s.catalogueNumber,
			Clade: s.clade,
			Order: s.order,
			Family: s.family,
			Genus: s.genus,
			FullName: s.fullName,
			VernacularName: s.vernacularName,
			TypeStatus: s.typeStatus,
			TypeName: s.typeName,
			DecimalLatitude: s.lat == null ? '' : s.lat,
			DecimalLongitude: s.lng == null ? '' : s.lng,
			Locality: s.locality,
			RecordedBy: s.recordedBy,
			RecordNumber: s.recordNumber,
			CollectionDate: s.collectionDate,
			Country: s.country,
			InstitutionCode: s.institutionCode,
			ImageFile: s.imageFiles.join('; '),
			Habit: s.traits.habit.join(';'),
			LeafArrangement: s.traits.leafArrangement,
			LeafForm: s.traits.leafForm,
			LeafVenation: s.traits.leafVenation,
			LeafMargin: s.traits.leafMargin,
			Stipules: s.traits.stipules,
			Exudate: s.traits.exudate,
			StemArmature: s.traits.stemArmature,
			Tendrils: s.traits.tendrils,
			LeafSample: s.leafSample,
			DNAextracted: s.dnaExtraction,
			DNAsequenced: s.dnaSequenced,
			DNAnotes: s.dnaNotes,
			EditedAt: s.editedAt
		});
	}
	return Papa.unparse({ fields: OVERRIDE_COLUMNS, data: rows });
}

/**
 * Parses an append-only identifications-log CSV into entries. Columns follow
 * Darwin Core: CatalogueNumber, ScientificName, Identifier, Herbarium,
 * IdentificationDate, Remarks. `Herbarium` is the determiner's institution
 * (e.g. "K"); it reads as blank from older 5-column logs that predate it, so
 * parsing stays backward-compatible. Rows missing a barcode or a name are
 * skipped (they can't re-identify a specimen). No I/O — discovery of the log
 * file in the image folder is the persistence layer's job — but it emits a
 * `console.warn` for PapaParse errors and for skipped rows so a field user who
 * hand-edits the log can see why entries vanished instead of failing silently.
 * @param {string} text - raw CSV text
 * @returns {Array<{catalogueNumber: string, scientificName: string, identifier: string, herbarium: string, identificationDate: string, remarks: string}>}
 */
export function parseIdentificationLog(text) {
	// A fresh/absent log is the normal empty case (e.g. appending the first
	// entry) — return early so it never trips PapaParse's empty-input warning.
	if (!text || !text.trim()) return [];
	const { data, errors } = Papa.parse(text, {
		header: true,
		skipEmptyLines: true,
		transformHeader: (header) => header.trim().replace(/^\uFEFF/, '')
	});
	// PapaParse's benign empty/single-token "UndetectableDelimiter" is filtered
	// out; what remains (mismatched fields, bad quoting) signals real corruption.
	const parseErrors = (errors ?? []).filter((e) => e.code !== 'UndetectableDelimiter');
	if (parseErrors.length) {
		const first = parseErrors[0];
		const where = first.row != null ? ` (row ${first.row})` : '';
		console.warn(
			`parseIdentificationLog: ${parseErrors.length} CSV parse error(s); first: "${first.message}"${where}`
		);
	}
	const entries = [];
	const skippedRows = [];
	for (const [index, row] of data.entries()) {
		const catalogueNumber = row.CatalogueNumber?.trim() || '';
		const scientificName = row.ScientificName?.trim() || '';
		if (!catalogueNumber || !scientificName) {
			// Report the 1-based position among parsed data rows (header excluded).
			skippedRows.push(index + 1);
			continue;
		}
		entries.push({
			catalogueNumber,
			scientificName,
			identifier: row.Identifier?.trim() || '',
			herbarium: row.Herbarium?.trim() || '',
			identificationDate: row.IdentificationDate?.trim() || '',
			remarks: row.Remarks?.trim() || ''
		});
	}
	if (skippedRows.length) {
		console.warn(
			`parseIdentificationLog: skipped ${skippedRows.length} row(s) missing CatalogueNumber or ScientificName (data row ${skippedRows.join(', ')})`
		);
	}
	return entries;
}

/** Fixed column order for the identifications log — the inverse of parseIdentificationLog. */
const IDENTIFICATION_LOG_FIELDS = [
	'CatalogueNumber', 'ScientificName', 'Identifier', 'Herbarium', 'IdentificationDate', 'Remarks'
];

/** The header line a freshly-written log carries; used to spot an older-schema log on append. */
const IDENTIFICATION_LOG_HEADER = IDENTIFICATION_LOG_FIELDS.join(',');

const identificationEntryToValues = (e) => [
	e.catalogueNumber, e.scientificName, e.identifier ?? '', e.herbarium ?? '', e.identificationDate ?? '', e.remarks ?? ''
];

/**
 * Serialises identification-log entries to CSV text (header + rows). Used to
 * create a fresh log file. parseIdentificationLog(serializeIdentificationLog(x))
 * reproduces x. Persistence appends to an existing log with
 * serializeIdentificationRow instead, to preserve the file's prior bytes.
 * @param {Array<object>} entries
 * @returns {string} CSV text
 */
export function serializeIdentificationLog(entries) {
	return Papa.unparse({ fields: IDENTIFICATION_LOG_FIELDS, data: entries.map(identificationEntryToValues) });
}

/**
 * Serialises a single log entry as one CSV line (no header, no trailing
 * newline) for append-only writes onto an existing log. Column order matches
 * serializeIdentificationLog so an appended row aligns with the header.
 * @param {object} entry
 * @returns {string} one CSV row
 */
export function serializeIdentificationRow(entry) {
	return Papa.unparse([identificationEntryToValues(entry)]);
}

/**
 * Returns the new full text of an identifications log after appending `entry` to
 * `existingText`. Append-only and byte-preserving: an existing log keeps its
 * prior content verbatim (a normalising newline is added only if missing) and
 * gains one headerless row; an empty/absent log is created with a header. Pure —
 * folder.js wraps this with the file read/write.
 *
 * Exception — schema upgrade: if the existing log's header predates a column
 * (e.g. a 5-column log written before `Herbarium`), a byte-appended row would
 * misalign against the new column order. In that one case the log is re-parsed
 * and rewritten with the current schema (older rows gain blank values for the
 * new column). Still append-only in meaning — no entries are dropped or
 * reordered — just not byte-preserving for that first post-upgrade write.
 * @param {string} existingText - current log text ('' if the file doesn't exist)
 * @param {object} entry
 * @returns {string} the full text to write back
 */
export function appendIdentificationToLog(existingText, entry) {
	if (!existingText || existingText.trim() === '') {
		return serializeIdentificationLog([entry]) + '\r\n';
	}
	// Older-schema log (header doesn't match the current columns) → migrate by
	// re-serialising every entry under the current schema, then add the new one.
	const headerLine = existingText.slice(0, existingText.search(/\r?\n|$/)).trim().replace(/^﻿/, '');
	if (headerLine !== IDENTIFICATION_LOG_HEADER) {
		// Rewritten body is CRLF (Papa.unparse default), so terminate it the same way.
		return serializeIdentificationLog([...parseIdentificationLog(existingText), entry]) + '\r\n';
	}
	// Match the existing file's newline. PapaParse emits (and, on parse, expects)
	// CRLF by default, and treats a lone LF as in-field data when the document is
	// CRLF — so a mismatched separator would merge the appended row into the last
	// field. Reuse the file's own convention; default to CRLF (what we write).
	const nl = existingText.includes('\r\n') ? '\r\n' : '\n';
	const body = existingText.endsWith(nl) ? existingText : existingText + nl;
	return body + serializeIdentificationRow(entry) + nl;
}

/**
 * Overlays identification-log entries onto specimens, setting each specimen's
 * currentDetermination to the LATEST entry for its barcode. "Latest" = highest
 * IdentificationDate (ISO strings compare lexically); ties — and the append-only
 * common case of blank/equal dates — resolve to the entry appearing last in the
 * log. Specimens with no matching entry keep currentDetermination === their
 * original taxonomicName. Mutates the passed Map in place and returns it; the
 * caller re-runs buildSpeciesView(map) to regroup the species view by the new
 * determinations (buildSpeciesView already groups on currentDetermination).
 * @param {Map<string, object>} specimensByCatalogue
 * @param {Array<{catalogueNumber: string, scientificName: string, identificationDate: string}>} logEntries
 * @returns {Map<string, object>} the same Map, mutated
 */
export function applyIdentifications(specimensByCatalogue, logEntries) {
	// Winning entry per barcode: replace when the candidate's date is >= the
	// current best, so among equal dates the last-iterated (latest appended) wins.
	const latestByBarcode = new Map();
	for (const entry of logEntries) {
		const best = latestByBarcode.get(entry.catalogueNumber);
		if (!best || entry.identificationDate >= best.identificationDate) {
			latestByBarcode.set(entry.catalogueNumber, entry);
		}
	}
	for (const specimen of specimensByCatalogue.values()) {
		const winner = latestByBarcode.get(specimen.catalogueNumber);
		specimen.currentDetermination = normalizeDetermination(
			winner ? winner.scientificName : specimen.taxonomicName,
			specimen.genus
		);
	}
	return specimensByCatalogue;
}

/**
 * Overlays an identifications-log CSV onto an already-parsed dataset. Parses the
 * log, applies it to the dataset's specimens (currentDetermination ← latest entry
 * per barcode), and re-runs rebuildView so the species view regroups by the new
 * determinations. Returns the (possibly unchanged) dataset object plus the parsed
 * entries — the curation modal's ID-history panel consumes the entries. Pure;
 * discovering the log file in the image folder is folder.js's job (readIdentificationLog).
 * @param {object} parsed - result of parseSpeciesCsv (has specimensByCatalogue)
 * @param {string} logText - identifications-log CSV text ('' when no log present)
 * @returns {{ data: object, entries: Array<object> }}
 */
export function applyIdentificationLog(parsed, logText) {
	const entries = logText ? parseIdentificationLog(logText) : [];
	if (entries.length === 0) return { data: parsed, entries };
	applyIdentifications(parsed.specimensByCatalogue, entries);
	return { data: rebuildView(parsed.specimensByCatalogue), entries };
}
