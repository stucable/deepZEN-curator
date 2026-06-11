import { writable } from 'svelte/store';
import { get as idbGet, set as idbSet } from 'idb-keyval';

const IDB_KEY = 'curatorName';
const HERBARIUM_IDB_KEY = 'curatorHerbarium';

/**
 * The curator's name. Tags each re-identification (Darwin Core `Identifier`) and
 * supplies the `<user>` token in the per-user override / identifications-log
 * filenames (e.g. `Macaranga_Kew_Stuart.csv`). Persisted across sessions so a
 * curator sets it once. Blank until restored / entered, in which case the
 * filename helpers fall back to the default `curator` token.
 */
export const curatorNameStore = writable('');

/**
 * The curator's home herbarium (the determiner's institution, e.g. "K"). Pre-fills
 * the Herbarium field on each identification and is written to the `Herbarium`
 * column of the identifications log. Sticky: the edit modal updates it after a
 * save, so it usually only needs setting once. Persisted across sessions.
 */
export const curatorHerbariumStore = writable('');

// Don't persist before the restores have run, so the empty defaults can't
// overwrite saved values during hydration.
let hydrated = false;

/** Read the persisted curator name + herbarium. Safe to call once onMount. */
export async function restoreCuratorName() {
	try {
		const [savedName, savedHerbarium] = await Promise.all([
			idbGet(IDB_KEY),
			idbGet(HERBARIUM_IDB_KEY)
		]);
		if (typeof savedName === 'string') curatorNameStore.set(savedName);
		if (typeof savedHerbarium === 'string') curatorHerbariumStore.set(savedHerbarium);
	} catch {
		// IndexedDB unavailable — keep the empty defaults
	} finally {
		hydrated = true;
	}
}

// Persist every edit after hydration. `bind:value` in the sidebar drives these.
curatorNameStore.subscribe((name) => {
	if (!hydrated) return;
	idbSet(IDB_KEY, name).catch(() => {});
});

curatorHerbariumStore.subscribe((herbarium) => {
	if (!hydrated) return;
	idbSet(HERBARIUM_IDB_KEY, herbarium).catch(() => {});
});
