import { writable } from 'svelte/store';
import { get as idbGet, set as idbSet } from 'idb-keyval';

const IDB_KEY = 'curatorName';

/**
 * The curator's name. Tags each re-identification (Darwin Core `Identifier`) and
 * supplies the `<user>` token in the per-user override / identifications-log
 * filenames (e.g. `Macaranga_Kew_Stuart.csv`). Persisted across sessions so a
 * curator sets it once. Blank until restored / entered, in which case the
 * filename helpers fall back to the default `curator` token.
 */
export const curatorNameStore = writable('');

// Don't persist before restoreCuratorName() has run, so the empty default can't
// overwrite a saved value during hydration.
let hydrated = false;

/** Read the persisted curator name. Safe to call once onMount. */
export async function restoreCuratorName() {
	try {
		const saved = await idbGet(IDB_KEY);
		if (typeof saved === 'string') curatorNameStore.set(saved);
	} catch {
		// IndexedDB unavailable — keep the empty default
	} finally {
		hydrated = true;
	}
}

// Persist every edit after hydration. `bind:value` in the sidebar drives this.
curatorNameStore.subscribe((name) => {
	if (!hydrated) return;
	idbSet(IDB_KEY, name).catch(() => {});
});
