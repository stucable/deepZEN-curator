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
		csvPath: '/data/Ankarafantsika_herbarium_images_260420.csv'
	},
	{
		id: 'ranomafana',
		label: 'Ranomafana',
		csvPath: '/data/Ranomafana_herbarium_images_260420.csv'
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
