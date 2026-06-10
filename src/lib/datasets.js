/**
 * Dataset registry. Append to the list + drop the CSV into static/data/ to add
 * a new dataset. Image folders are remembered per-dataset at runtime.
 *
 * Shipped CSV filename convention: `<Label>_herbarium_images_<YYMMDD>.csv`.
 * Keep to it — the per-user override lookup derives its prefix from the stem
 * up to the last underscore (see getOverridePrefix below).
 */
export const datasets = [
	{
		id: 'ankarafantsika',
		label: 'Ankarafantsika',
		csvPath: '/data/Ankarafantsika_herbarium_images_260422.csv'
	},
	{
		id: 'ranomafana',
		label: 'Ranomafana',
		csvPath: '/data/Ranomafana_herbarium_images_260423.csv'
	},
	{
		id: 'macaranga',
		label: 'Macaranga',
		csvPath: '/data/Macaranga_Kew_260604.csv'
	}
];

export const DEFAULT_DATASET_ID = 'ankarafantsika';

export function getDataset(id) {
	return datasets.find((d) => d.id === id) ?? datasets[0];
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
