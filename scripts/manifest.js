/**
 * Node-side access to the runtime dataset manifest (`static/data/datasets.json`).
 * Validation is shared with the browser through parseManifest, so the packaging
 * script, the validators and the app all agree on what a valid manifest is.
 */
import { readFile } from 'node:fs/promises';
import { parseManifest } from '../src/lib/datasets.js';

export const MANIFEST_PATH = 'static/data/datasets.json';

/** Read and validate a manifest file. Throws ManifestError on invalid content. */
export async function loadManifest(path = MANIFEST_PATH) {
	let text;
	try {
		text = await readFile(path, 'utf8');
	} catch (err) {
		throw new Error(`Could not read dataset manifest ${path}: ${err.message}`);
	}
	try {
		return parseManifest(JSON.parse(text));
	} catch (err) {
		throw new Error(`${path}: ${err.message}`);
	}
}

/** The manifest's dataset entries. Convenience for scripts that don't need the rest. */
export async function loadDatasets(path = MANIFEST_PATH) {
	return (await loadManifest(path)).datasets;
}
