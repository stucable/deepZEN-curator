import { writable } from 'svelte/store';
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';
import {
	isOverrideName,
	isIdentificationLogName,
	getOverrideFilename,
	getIdentificationLogFilename
} from '../datasets.js';
import {
	serializeSpecimensCsv,
	appendIdentificationToLog,
	appendIdentificationsToLog,
	parseIdentificationLog
} from '../utils/csv.js';

const LEGACY_KEY = 'imageFolderHandle';

/**
 * The dataset a legacy single-key handle belonged to. The pre-multi-dataset layout only
 * ever shipped Ankarafantsika, so the migration target is that id — not whatever the
 * current edition's manifest calls its default. In an edition without Ankarafantsika the
 * migrated key is simply never read.
 */
const LEGACY_HANDLE_DATASET_ID = 'ankarafantsika';

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
		const defaultKey = keyFor(LEGACY_HANDLE_DATASET_ID);
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
 * `matches`, returning `{ text, filename, lastModified }` (most-recently-modified wins —
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
	return { text: await file.text(), filename: name, lastModified: file.lastModified };
}

/**
 * Looks for a per-user override CSV inside an already-permission-granted folder.
 * An override shares the dataset's prefix, ends `.csv`, and is neither the
 * shipped CSV (a backup) nor the identifications log (which also shares the
 * prefix) — see isOverrideName. Case-insensitive; newest wins.
 *
 * Returns `{ text, filename, lastModified }` when found and readable, or `null` when no
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
		await writable.close();
	} catch (err) {
		// createWritable() stages changes until close. Abort a failed stream so a
		// partial/empty replacement is never committed over the curator's CSV.
		try {
			await writable.abort?.(err);
		} catch {
			// Preserve the original write error.
		}
		throw err;
	}
	const written = await fileHandle.getFile();
	return { filename, lastModified: written.lastModified };
}

/** Raised when a correction CSV changed after the app loaded it. */
export class FileConflictError extends Error {
	constructor(filename) {
		super(`${filename} changed on disk since it was loaded. Reload the app before saving so those edits are not overwritten.`);
		this.name = 'FileConflictError';
		this.filename = filename;
	}
}

async function fileMetadata(folderHandle, filename) {
	try {
		const handle = await folderHandle.getFileHandle(filename);
		const file = await handle.getFile();
		return { filename, lastModified: file.lastModified };
	} catch (err) {
		if (err?.name === 'NotFoundError') return null;
		throw err;
	}
}

/**
 * Writes the full specimen set back to a per-user override CSV (a complete,
 * lossless personalised copy — the same kind of file a user can hand-drop). The
 * caller supplies the immutable candidate specimen Map to serialise. Targets, in
 * order: an explicit `filename`, else the user's
 * existing override file (so we overwrite it, not spawn a second), else a fresh
 * `<prefix><user>.csv`. When `expectedLastModified` is supplied, the target must
 * still have that timestamp (`null` means the caller loaded no override). This
 * prevents an externally-edited/new correction file from being overwritten.
 * @returns {Promise<{filename:string,lastModified:number}>}
 */
export async function writeSpecimenOverride(
	folderHandle,
	dataset,
	specimensByCatalogue,
	{ filename, user, expectedLastModified } = {}
) {
	const existing = filename ? null : await readCustomCsvFromFolder(folderHandle, dataset);
	const targetName = filename || existing?.filename || getOverrideFilename(dataset, user);

	if (expectedLastModified !== undefined) {
		const current = filename
			? await fileMetadata(folderHandle, targetName)
			: existing && { filename: existing.filename, lastModified: existing.lastModified };
		const unchanged = expectedLastModified === null
			? current === null
			: current?.lastModified === expectedLastModified;
		if (!unchanged) throw new FileConflictError(targetName);
	}

	return writeCsvToFolder(folderHandle, targetName, serializeSpecimensCsv(specimensByCatalogue));
}

function sameIdentification(a, b) {
	return !!a && !!b &&
		a.catalogueNumber === b.catalogueNumber &&
		a.scientificName === b.scientificName &&
		(a.identifier ?? '') === (b.identifier ?? '') &&
		(a.herbarium ?? '') === (b.herbarium ?? '') &&
		(a.identificationDate ?? '') === (b.identificationDate ?? '') &&
		(a.remarks ?? '') === (b.remarks ?? '') &&
		(a.changeType ?? '') === (b.changeType ?? '');
}

function endsWithIdentifications(existingText, entries) {
	if (!entries?.length) return true;
	const existing = parseIdentificationLog(existingText);
	if (existing.length < entries.length) return false;
	const tail = existing.slice(-entries.length);
	return tail.every((entry, index) => sameIdentification(entry, entries[index]));
}

/**
 * Appends one re-identification to the dataset's identifications log, preserving
 * the file's prior bytes (a literal text append, not a parse-rewrite, so log
 * history is never reshaped). Creates the log with a header when none exists yet.
 * `entry` is `{ catalogueNumber, scientificName, identifier, identificationDate, remarks }`.
 * An exact matching tail is treated as an already-completed retry, preventing
 * duplicate history rows after an ambiguous browser/filesystem failure.
 * @returns {Promise<{filename:string,lastModified:number,appended:boolean}>}
 */
export async function appendIdentification(folderHandle, dataset, entry, { filename, user } = {}) {
	const existing = await readIdentificationLog(folderHandle, dataset);
	const targetName = filename || existing?.filename || getIdentificationLogFilename(dataset, user);
	if (existing && endsWithIdentifications(existing.text, [entry])) {
		return { filename: targetName, lastModified: existing.lastModified, appended: false };
	}
	const text = appendIdentificationToLog(existing?.text ?? '', entry);
	return { ...(await writeCsvToFolder(folderHandle, targetName, text)), appended: true };
}

/**
 * Appends N re-identifications to the dataset's identifications log in ONE read+write
 * (the bulk analogue of appendIdentification). Used by the synonymy "fold X → Y" action,
 * which re-identifies every sheet of name X at once. Preserves prior bytes (literal
 * append) except the one-time legacy-schema migration. Same filename-target precedence as
 * appendIdentification, so the fold writes the same log file the modal uses. An exact
 * matching tail makes a retry idempotent. Must be called inside a user gesture
 * (it escalates the folder to readwrite).
 * @returns {Promise<{filename:string,lastModified:number,appended:boolean}|null>}
 */
export async function appendIdentifications(folderHandle, dataset, entries, { filename, user } = {}) {
	if (!entries || entries.length === 0) return null;
	const existing = await readIdentificationLog(folderHandle, dataset);
	const targetName = filename || existing?.filename || getIdentificationLogFilename(dataset, user);
	if (existing && endsWithIdentifications(existing.text, entries)) {
		return { filename: targetName, lastModified: existing.lastModified, appended: false };
	}
	const text = appendIdentificationsToLog(existing?.text ?? '', entries);
	return { ...(await writeCsvToFolder(folderHandle, targetName, text)), appended: true };
}
