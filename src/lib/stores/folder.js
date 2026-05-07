import { writable } from 'svelte/store';
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';
import { DEFAULT_DATASET_ID, getOverridePrefix } from '$lib/datasets.js';

const LEGACY_KEY = 'imageFolderHandle';

function keyFor(datasetId) {
	return `imageFolderHandle:${datasetId}`;
}

/** The FileSystemDirectoryHandle for the active dataset's image folder (permission granted). */
export const folderHandleStore = writable(null);

/**
 * Handle that was restored from IndexedDB but still needs a user gesture to
 * re-grant permission. Presence means: "user previously picked this folder,
 * show a one-click reconnect button".
 */
export const pendingFolderHandleStore = writable(null);

/**
 * One-time migration: move any single-key legacy handle into the default
 * dataset's per-dataset slot. Idempotent — guarded so re-runs are no-ops.
 */
async function migrateLegacyHandle() {
	try {
		const legacy = await idbGet(LEGACY_KEY);
		if (!legacy) return;
		const defaultKey = keyFor(DEFAULT_DATASET_ID);
		if (!(await idbGet(defaultKey))) {
			await idbSet(defaultKey, legacy);
		}
		await idbDel(LEGACY_KEY);
	} catch {
		// Migration failures are non-fatal — worst case the user re-picks the folder
	}
}

/**
 * Requests read permission on a directory handle if not already granted.
 * Returns true if permission is granted.
 */
export async function verifyPermission(handle) {
	const opts = { mode: 'read' };
	if ((await handle.queryPermission(opts)) === 'granted') return true;
	if ((await handle.requestPermission(opts)) === 'granted') return true;
	return false;
}

/**
 * Attempts to restore a previously saved folder handle for the given dataset.
 * If permission is already granted → sets folderHandleStore directly.
 * Otherwise → sets pendingFolderHandleStore so the UI can offer reconnect.
 * Also runs the legacy migration once per session.
 */
export async function restoreFolderHandle(datasetId, { commit = true } = {}) {
	await migrateLegacyHandle();
	try {
		const handle = await idbGet(keyFor(datasetId));
		if (!handle) {
			const state = { folderHandle: null, pendingFolderHandle: null };
			if (commit) {
				folderHandleStore.set(state.folderHandle);
				pendingFolderHandleStore.set(state.pendingFolderHandle);
			}
			return state;
		}
		const state = await handle.queryPermission({ mode: 'read' });
		if (state === 'granted') {
			const result = { folderHandle: handle, pendingFolderHandle: null };
			if (commit) {
				folderHandleStore.set(result.folderHandle);
				pendingFolderHandleStore.set(result.pendingFolderHandle);
			}
			return result;
		} else {
			const result = { folderHandle: null, pendingFolderHandle: handle };
			if (commit) {
				folderHandleStore.set(result.folderHandle);
				pendingFolderHandleStore.set(result.pendingFolderHandle);
			}
			return result;
		}
	} catch {
		// IndexedDB or permission check failed — silently ignore
		const state = { folderHandle: null, pendingFolderHandle: null };
		if (commit) {
			folderHandleStore.set(state.folderHandle);
			pendingFolderHandleStore.set(state.pendingFolderHandle);
		}
		return state;
	}
}

/**
 * Re-requests permission on the previously saved folder handle for this dataset.
 * Must be called from a user gesture (click handler).
 */
export async function reconnectFolder(datasetId) {
	try {
		const handle = await idbGet(keyFor(datasetId));
		if (!handle) return;
		const granted = await verifyPermission(handle);
		if (granted) {
			folderHandleStore.set(handle);
			pendingFolderHandleStore.set(null);
		}
	} catch (err) {
		console.warn('Failed to reconnect folder:', err);
	}
}

/**
 * Looks for a per-user override CSV inside an already-permission-granted
 * folder handle. Scans for files matching `<prefix>*.csv` where the prefix
 * is derived from the dataset's shipped CSV name (everything up to the last
 * underscore of the stem). A literal copy of the shipped filename is ignored
 * so backups don't accidentally trigger override mode. Matching is
 * case-insensitive. When multiple overrides are present the most recently
 * modified wins — matches "use my newest work".
 *
 * Returns `{ text, filename }` when found and readable, or `null` when no
 * override is present (the normal case).
 */
export async function readCustomCsvFromFolder(folderHandle, dataset) {
	const prefix = getOverridePrefix(dataset).toLowerCase();
	const shippedBasename = dataset.csvPath.split('/').pop().toLowerCase();
	const candidates = [];
	for await (const [name, handle] of folderHandle.entries()) {
		if (handle.kind !== 'file') continue;
		const lower = name.toLowerCase();
		if (!lower.startsWith(prefix) || !lower.endsWith('.csv')) continue;
		if (lower === shippedBasename) continue;
		const file = await handle.getFile();
		candidates.push({ name, file });
	}
	if (candidates.length === 0) return null;
	candidates.sort((a, b) => b.file.lastModified - a.file.lastModified);
	const { name, file } = candidates[0];
	return { text: await file.text(), filename: name };
}

/**
 * Opens the directory picker, saves the handle for this dataset, and updates the store.
 */
export async function selectFolder(datasetId) {
	try {
		const handle = await window.showDirectoryPicker();
		const granted = await verifyPermission(handle);
		if (granted) {
			await idbSet(keyFor(datasetId), handle);
			folderHandleStore.set(handle);
			pendingFolderHandleStore.set(null);
		}
	} catch (err) {
		// User cancelled the picker — do nothing
		if (err.name !== 'AbortError') {
			console.warn('Failed to select folder:', err);
		}
	}
}
