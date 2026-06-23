import { writable } from 'svelte/store';
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';
import {
	DEFAULT_DATASET_ID,
	isOverrideName,
	isIdentificationLogName,
	getOverrideFilename,
	getIdentificationLogFilename
} from '$lib/datasets.js';
import { serializeSpecimensCsv, appendIdentificationToLog } from '$lib/utils/csv.js';

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
 * Requests permission on a directory handle if not already granted. Defaults to
 * read; pass `'readwrite'` to escalate before a save. Requesting a stronger mode
 * must happen inside a user gesture (a click handler). Returns true if granted.
 */
export async function verifyPermission(handle, mode = 'read') {
	const opts = { mode };
	if ((await handle.queryPermission(opts)) === 'granted') return true;
	if ((await handle.requestPermission(opts)) === 'granted') return true;
	return false;
}

/**
 * Attempts to restore a previously saved folder handle for the given dataset,
 * resolving to `{ folderHandle, pendingFolderHandle }`:
 * - permission already granted → folderHandle set, ready to use;
 * - a handle exists but permission needs re-granting (prompt/denied), OR the
 *   permission check throws on a stale/revoked handle → pendingFolderHandle set
 *   so the UI can offer a one-click reconnect;
 * - no handle was ever saved (or IndexedDB itself is unreadable) → both null.
 * The key distinction: a saved-but-revoked handle yields a reconnect prompt, not
 * the same apparently-empty state as a never-picked folder. `commit` (default
 * true) writes the result straight to the stores. Also runs the legacy migration
 * once per session.
 */
export async function restoreFolderHandle(datasetId, { commit = true } = {}) {
	await migrateLegacyHandle();

	const apply = (state) => {
		if (commit) {
			folderHandleStore.set(state.folderHandle);
			pendingFolderHandleStore.set(state.pendingFolderHandle);
		}
		return state;
	};

	let handle;
	try {
		handle = await idbGet(keyFor(datasetId));
	} catch {
		// IndexedDB unreadable — there's no handle to reconnect to.
		return apply({ folderHandle: null, pendingFolderHandle: null });
	}

	// Nothing was ever saved for this dataset → genuinely empty, nothing to reconnect.
	if (!handle) return apply({ folderHandle: null, pendingFolderHandle: null });

	// A handle exists. Decide whether it's live or just needs a reconnect gesture.
	let permission;
	try {
		permission = await handle.queryPermission({ mode: 'read' });
	} catch {
		// queryPermission threw (e.g. a stale/revoked handle). We still HAVE the
		// saved handle, so offer reconnect rather than showing an empty app.
		return apply({ folderHandle: null, pendingFolderHandle: handle });
	}

	if (permission === 'granted') {
		return apply({ folderHandle: handle, pendingFolderHandle: null });
	}
	// 'prompt' or 'denied' — saved handle present, permission must be re-granted.
	return apply({ folderHandle: null, pendingFolderHandle: handle });
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
 * Scans a permission-granted folder for the newest file whose name satisfies
 * `matches`, returning `{ text, filename }` (most-recently-modified wins —
 * "use my newest work") or `null` when none match. Shared by the override and
 * identifications-log discovery below.
 */
async function readNewestMatchingFile(folderHandle, matches) {
	const candidates = [];
	for await (const [name, handle] of folderHandle.entries()) {
		if (handle.kind !== 'file' || !matches(name)) continue;
		candidates.push({ name, file: await handle.getFile() });
	}
	if (candidates.length === 0) return null;
	candidates.sort((a, b) => b.file.lastModified - a.file.lastModified);
	const { name, file } = candidates[0];
	return { text: await file.text(), filename: name };
}

/**
 * Looks for a per-user override CSV inside an already-permission-granted folder.
 * An override shares the dataset's prefix, ends `.csv`, and is neither the
 * shipped CSV (a backup) nor the identifications log (which also shares the
 * prefix) — see isOverrideName. Case-insensitive; newest wins.
 *
 * Returns `{ text, filename }` when found and readable, or `null` when no
 * override is present (the normal case).
 */
export function readCustomCsvFromFolder(folderHandle, dataset) {
	return readNewestMatchingFile(folderHandle, (name) => isOverrideName(dataset, name));
}

/**
 * Looks for this dataset's append-only identifications log in the folder (a file
 * named `<overridePrefix>identifications_*.csv`). Returns `{ text, filename }` or
 * `null`. Discovered distinctly from the override so the two never collide.
 */
export function readIdentificationLog(folderHandle, dataset) {
	return readNewestMatchingFile(folderHandle, (name) => isIdentificationLogName(dataset, name));
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

/**
 * Escalates the folder handle to readwrite (this is the "read→readwrite on first
 * save" step — must run inside a user gesture) and writes `text` to `filename`,
 * creating the file or replacing its contents. Low-level; the override / log
 * helpers below build the filename and content. Throws if permission is denied.
 */
async function writeCsvToFolder(folderHandle, filename, text) {
	const granted = await verifyPermission(folderHandle, 'readwrite');
	if (!granted) throw new Error('Write permission denied for the image folder');
	const fileHandle = await folderHandle.getFileHandle(filename, { create: true });
	const writable = await fileHandle.createWritable();
	try {
		await writable.write(text);
	} finally {
		await writable.close();
	}
}

/**
 * Writes the full specimen set back to a per-user override CSV (a complete,
 * lossless personalised copy — the same kind of file a user can hand-drop). The
 * caller has already mutated specimens (corrected coords/country/collectors and
 * stamped EditedAt). Targets, in order: an explicit `filename`, else the user's
 * existing override file (so we overwrite it, not spawn a second), else a fresh
 * `<prefix><user>.csv`. Returns the filename written.
 * @returns {Promise<string>}
 */
export async function writeSpecimenOverride(folderHandle, dataset, specimensByCatalogue, { filename, user } = {}) {
	const existing = filename ? null : await readCustomCsvFromFolder(folderHandle, dataset);
	const targetName = filename || existing?.filename || getOverrideFilename(dataset, user);
	await writeCsvToFolder(folderHandle, targetName, serializeSpecimensCsv(specimensByCatalogue));
	return targetName;
}

/**
 * Appends one re-identification to the dataset's identifications log, preserving
 * the file's prior bytes (a literal text append, not a parse-rewrite, so log
 * history is never reshaped). Creates the log with a header when none exists yet.
 * `entry` is `{ catalogueNumber, scientificName, identifier, identificationDate, remarks }`.
 * Returns the log filename written.
 * @returns {Promise<string>}
 */
export async function appendIdentification(folderHandle, dataset, entry, { filename, user } = {}) {
	const existing = await readIdentificationLog(folderHandle, dataset);
	const text = appendIdentificationToLog(existing?.text ?? '', entry);
	const targetName = filename || existing?.filename || getIdentificationLogFilename(dataset, user);
	await writeCsvToFolder(folderHandle, targetName, text);
	return targetName;
}
