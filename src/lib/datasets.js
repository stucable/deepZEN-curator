/**
 * Dataset registry helpers. The registry itself is no longer compiled in: it is a
 * runtime manifest (`static/data/datasets.json` → `build/data/datasets.json`) so one
 * application build can be packaged as several editions — a Sarcolaenaceae-only
 * install, a Macaranga + Sarcolaenaceae install, the full development build — via
 * `npm run package`. See scripts/package-release.js.
 *
 * The manifest is the single source of truth for both the browser (fetched by
 * stores/dataset.js) and the Node tooling (read by scripts/manifest.js); both
 * validate it through `parseManifest` below.
 *
 * Shipped CSV filename convention: `<Label>_herbarium_images_<YYMMDD>.csv`.
 * Keep to it — the per-user override lookup derives its prefix from the stem
 * up to the last underscore (see getOverridePrefix below).
 */
import { KNOWN_HABITS } from './utils/csv.js';

/** Manifest schema version this build understands. */
export const MANIFEST_VERSION = 1;

/** Vocabularies the manifest's per-dataset defaults are validated against. */
const SORT_MODES = ['family', 'order', 'name'];
const MAP_EXTENTS = ['madagascar', 'wio', 'global', 'auto'];

/**
 * Opening state implied by a dataset's `kind`, overridable per entry via an optional
 * `defaults` block in the manifest.
 *
 *  - `checklist` — a site flora (Ankarafantsika, Ranomafana): many families, trait data,
 *    no specimen coordinates. Family sort and the woody-habit default are what a field
 *    botanist wants, and the Madagascar extent is the only sensible frame.
 *  - `monograph` — a taxon revision (Macaranga, Sarcolaenaceae): one family or genus,
 *    no trait data, rich specimen data. Family sort is degenerate and the habit default
 *    would silently hide material in a mixed-habit genus.
 *
 * Both kinds default to the Madagascar frame; a taxon with out-of-island material sets
 * `defaults.mapExtent` explicitly (Macaranga → 'wio' for its Comoros and Mascarene
 * sheets). The manifest also accepts 'auto', which resolves the narrowest fitting extent
 * from the specimens via detectExtent (utils/geo.js) — but only use it on a dataset with
 * clean coordinates, because one bad record drags the whole frame outwards. Sarcolaenaceae
 * is the cautionary case: its nine known-bad coordinates (scripts/data-quality-notes.js)
 * include points in India and South America, so 'auto' resolves it to the world map.
 *
 * `habits: null` means "use the app's DEFAULT_HABITS" (stores/taxa.js); an array is
 * used verbatim, and `[]` leaves the habit filter inactive.
 */
export const KIND_DEFAULTS = {
	checklist: { sort: 'family', mapExtent: 'madagascar', habits: null },
	monograph: { sort: 'name', mapExtent: 'madagascar', habits: [] }
};

export const DATASET_KINDS = Object.keys(KIND_DEFAULTS);

/** Thrown by parseManifest for any malformed or inconsistent manifest. */
export class ManifestError extends Error {
	constructor(message) {
		super(message);
		this.name = 'ManifestError';
	}
}

function requireString(value, field, where) {
	const text = typeof value === 'string' ? value.trim() : '';
	if (!text) throw new ManifestError(`${where}: "${field}" is required and must be a non-empty string`);
	return text;
}

/** Validates one entry's optional `defaults` block against its kind's implied values. */
function parseDefaults(raw, kind, where) {
	const implied = KIND_DEFAULTS[kind];
	if (raw === undefined || raw === null) return { ...implied };
	if (typeof raw !== 'object' || Array.isArray(raw)) {
		throw new ManifestError(`${where}: "defaults" must be an object`);
	}

	const sort = raw.sort ?? implied.sort;
	if (!SORT_MODES.includes(sort)) {
		throw new ManifestError(`${where}: unknown defaults.sort "${raw.sort}" (expected ${SORT_MODES.join(', ')})`);
	}

	const mapExtent = raw.mapExtent ?? implied.mapExtent;
	if (!MAP_EXTENTS.includes(mapExtent)) {
		throw new ManifestError(`${where}: unknown defaults.mapExtent "${raw.mapExtent}" (expected ${MAP_EXTENTS.join(', ')})`);
	}

	let habits = implied.habits;
	if (raw.habits !== undefined) {
		if (raw.habits !== null && !Array.isArray(raw.habits)) {
			throw new ManifestError(`${where}: "defaults.habits" must be an array or null`);
		}
		if (Array.isArray(raw.habits)) {
			const unknown = raw.habits.filter((h) => !KNOWN_HABITS.includes(h));
			if (unknown.length) {
				throw new ManifestError(`${where}: unknown defaults.habits value(s) ${unknown.join(', ')} (expected ${KNOWN_HABITS.join(', ')})`);
			}
		}
		habits = raw.habits;
	}

	return { sort, mapExtent, habits };
}

/**
 * Validate and normalise a parsed `datasets.json`, returning
 * `{ manifestVersion, defaultDatasetId, datasets }` where every dataset carries a
 * resolved `kind`, `allowBarcodeLess` and `defaults` block. Throws ManifestError with
 * a specific message on anything malformed — the browser turns it into a visible
 * banner, the packaging script into a non-zero exit.
 */
export function parseManifest(json) {
	if (!json || typeof json !== 'object' || Array.isArray(json)) {
		throw new ManifestError('Manifest must be a JSON object');
	}
	if (json.manifestVersion !== MANIFEST_VERSION) {
		throw new ManifestError(`Unsupported manifestVersion ${JSON.stringify(json.manifestVersion)} (this build reads version ${MANIFEST_VERSION})`);
	}
	if (!Array.isArray(json.datasets) || json.datasets.length === 0) {
		throw new ManifestError('Manifest "datasets" must be a non-empty array');
	}

	const seen = new Set();
	const datasets = json.datasets.map((raw, i) => {
		const where = `datasets[${i}]`;
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
			throw new ManifestError(`${where}: each dataset must be an object`);
		}
		const id = requireString(raw.id, 'id', where);
		if (seen.has(id)) throw new ManifestError(`${where}: duplicate dataset id "${id}"`);
		seen.add(id);

		const label = requireString(raw.label, 'label', where);
		const csvPath = requireString(raw.csvPath, 'csvPath', where);
		if (!csvPath.startsWith('/data/') || !csvPath.toLowerCase().endsWith('.csv')) {
			throw new ManifestError(`${where}: "csvPath" must be a /data/*.csv path (got "${csvPath}")`);
		}

		const kind = raw.kind ?? 'checklist';
		if (!DATASET_KINDS.includes(kind)) {
			throw new ManifestError(`${where}: unknown kind "${raw.kind}" (expected ${DATASET_KINDS.join(', ')})`);
		}

		return {
			id,
			label,
			csvPath,
			kind,
			allowBarcodeLess: raw.allowBarcodeLess === true,
			defaults: parseDefaults(raw.defaults, kind, where)
		};
	});

	const defaultDatasetId = requireString(json.defaultDatasetId, 'defaultDatasetId', 'Manifest');
	if (!datasets.some((d) => d.id === defaultDatasetId)) {
		throw new ManifestError(`Manifest "defaultDatasetId" is "${defaultDatasetId}", which is not one of: ${datasets.map((d) => d.id).join(', ')}`);
	}

	return { manifestVersion: json.manifestVersion, defaultDatasetId, datasets };
}

/** The dataset with `id` in `datasets`, or null. */
export function findDataset(datasets, id) {
	return datasets.find((d) => d.id === id) ?? null;
}

/**
 * Returns the filename prefix used to locate a per-user override CSV inside
 * the image folder. Derived from the shipped csvPath by stripping `.csv` and
 * taking everything up to and including the last underscore of the basename.
 *
 * Example: `/data/Ankarafantsika_herbarium_images_260420.csv`
 *       → `Ankarafantsika_herbarium_images_`
 *
 * Any file in the image folder starting with this prefix and ending `.csv`
 * (other than a literal copy of the shipped file) is treated as a user's
 * personal override — e.g. `Ankarafantsika_herbarium_images_Stuart.csv`.
 */
export function getOverridePrefix(dataset) {
	const basename = dataset.csvPath.split('/').pop();
	const stem = basename.replace(/\.csv$/i, '');
	const lastUnderscore = stem.lastIndexOf('_');
	return lastUnderscore === -1 ? stem : stem.slice(0, lastUnderscore + 1);
}

/**
 * Reserved infix that marks the append-only identifications log, distinguishing
 * it from a specimen override. A log is named `<overridePrefix>identifications_<user>.csv`
 * (e.g. `Macaranga_Kew_identifications_Stuart.csv`); an override is
 * `<overridePrefix><user>.csv` (e.g. `Macaranga_Kew_Stuart.csv`). The log shares
 * the override prefix, so override discovery must explicitly exclude it — see
 * isOverrideName / isIdentificationLogName below.
 */
const IDENTIFICATION_LOG_MARKER = 'identifications_';

export function getIdentificationLogPrefix(dataset) {
	return getOverridePrefix(dataset) + IDENTIFICATION_LOG_MARKER;
}

/** Strips characters that don't belong in the user portion of a CSV filename. */
function sanitizeUserToken(user) {
	const cleaned = String(user ?? '').trim().replace(/[^A-Za-z0-9-]/g, '');
	return cleaned || 'curator';
}

/** Default filename for a user's specimen override, e.g. `Macaranga_Kew_Stuart.csv`. */
export function getOverrideFilename(dataset, user) {
	return `${getOverridePrefix(dataset)}${sanitizeUserToken(user)}.csv`;
}

/** Default filename for a user's identifications log, e.g. `Macaranga_Kew_identifications_Stuart.csv`. */
export function getIdentificationLogFilename(dataset, user) {
	return `${getIdentificationLogPrefix(dataset)}${sanitizeUserToken(user)}.csv`;
}

/** True when `filename` is this dataset's identifications log (case-insensitive). */
export function isIdentificationLogName(dataset, filename) {
	const lower = filename.toLowerCase();
	return lower.startsWith(getIdentificationLogPrefix(dataset).toLowerCase()) && lower.endsWith('.csv');
}

/**
 * True when `filename` is a usable per-user specimen override for this dataset:
 * shares the override prefix, ends `.csv`, and is neither the shipped CSV (a
 * literal backup) nor the identifications log (which also shares the prefix).
 */
export function isOverrideName(dataset, filename) {
	const lower = filename.toLowerCase();
	const shippedBasename = dataset.csvPath.split('/').pop().toLowerCase();
	if (!lower.startsWith(getOverridePrefix(dataset).toLowerCase()) || !lower.endsWith('.csv')) return false;
	if (lower === shippedBasename) return false;
	if (isIdentificationLogName(dataset, filename)) return false;
	return true;
}
