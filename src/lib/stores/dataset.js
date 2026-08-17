import { writable, get as getStore } from 'svelte/store';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { findDataset, parseManifest } from '$lib/datasets.js';

const IDB_KEY = 'selectedDatasetId';
const MANIFEST_URL = '/data/datasets.json';

/**
 * Currently active dataset object. `null` until restoreDataset() completes so
 * callers can guard CSV loading until the real selection is known.
 */
export const currentDatasetStore = writable(null);

/**
 * The datasets this edition ships, from the runtime manifest — `[]` until
 * loadDatasetManifest() succeeds. A packaged single-collection edition has one entry;
 * the development build has all of them. Read by DatasetSelector.
 */
export const availableDatasetsStore = writable([]);

/** The manifest's defaultDatasetId, or null before the manifest loads. */
export const defaultDatasetIdStore = writable(null);

/**
 * Why the manifest could not be used (message string), or null. A missing or malformed
 * manifest is a hard, visible failure — the Sidebar shows it — rather than a silent
 * fallback to a built-in list, which would defeat per-edition packaging.
 */
export const manifestErrorStore = writable(null);

/**
 * Fetch and validate `/data/datasets.json`. Must complete before restoreDataset().
 * Returns true on success. `fetchImpl` is injectable for tests.
 */
export async function loadDatasetManifest(fetchImpl = fetch) {
	try {
		const res = await fetchImpl(MANIFEST_URL, { cache: 'no-store' });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const { defaultDatasetId, datasets } = parseManifest(await res.json());
		availableDatasetsStore.set(datasets);
		defaultDatasetIdStore.set(defaultDatasetId);
		manifestErrorStore.set(null);
		return true;
	} catch (err) {
		availableDatasetsStore.set([]);
		defaultDatasetIdStore.set(null);
		manifestErrorStore.set(err?.message ?? String(err));
		console.error(`Could not load dataset manifest ${MANIFEST_URL}:`, err);
		return false;
	}
}

/**
 * Restore the persisted selection into the store. A saved id that this edition does
 * not ship — a user whose IndexedDB remembers 'macaranga' now running a
 * Sarcolaenaceae-only build — falls back to the manifest default and is re-persisted,
 * so the stale id doesn't linger.
 */
export async function restoreDataset() {
	const datasets = getStore(availableDatasetsStore);
	if (datasets.length === 0) return;

	let saved = null;
	try {
		saved = await idbGet(IDB_KEY);
	} catch {
		// IndexedDB unavailable — fall through to default
	}

	const fallbackId = getStore(defaultDatasetIdStore);
	const ds = (saved && findDataset(datasets, saved)) ?? findDataset(datasets, fallbackId) ?? datasets[0];
	if (saved && saved !== ds.id) {
		try {
			await idbSet(IDB_KEY, ds.id);
		} catch {
			// Non-fatal; the corrected selection still applies this session
		}
	}
	currentDatasetStore.set(ds);
}

/** Switch the active dataset and persist the choice. */
export async function setDataset(id) {
	const datasets = getStore(availableDatasetsStore);
	const ds = findDataset(datasets, id);
	if (!ds) return;
	try {
		await idbSet(IDB_KEY, ds.id);
	} catch {
		// Persist failure is non-fatal; store still updates for this session
	}
	currentDatasetStore.set(ds);
}
