import { writable } from 'svelte/store';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { DEFAULT_DATASET_ID, getDataset } from '$lib/datasets.js';

const IDB_KEY = 'selectedDatasetId';

/**
 * Currently active dataset object. `null` until restoreDataset() completes so
 * callers can guard CSV loading until the real selection is known.
 */
export const currentDatasetStore = writable(null);

/** Restore persisted selection (or default) into the store. */
export async function restoreDataset() {
	let saved = null;
	try {
		saved = await idbGet(IDB_KEY);
	} catch {
		// IndexedDB unavailable — fall through to default
	}
	currentDatasetStore.set(getDataset(saved ?? DEFAULT_DATASET_ID));
}

/** Switch the active dataset and persist the choice. */
export async function setDataset(id) {
	const ds = getDataset(id);
	try {
		await idbSet(IDB_KEY, ds.id);
	} catch {
		// Persist failure is non-fatal; store still updates for this session
	}
	currentDatasetStore.set(ds);
}
