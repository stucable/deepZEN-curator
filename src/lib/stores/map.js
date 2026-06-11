import { writable } from 'svelte/store';

/**
 * Polygon selection drawn on the map, as an array of [lng, lat] vertices, or null
 * when nothing is selected. Stored in geographic coordinates (not screen space) so
 * it survives zoom/pan. When set, it narrows the whole app: filteredSpecies keeps
 * only species with at least one specimen inside the polygon (see stores/taxa.js).
 *
 * Session-only, like viewModeStore — a reload starts with no selection. Cleared on
 * dataset switch by the effect in +page.svelte.
 */
export const selectionPolygonStore = writable(null);

/**
 * When a region polygon is active, whether the Browse grid also shows images of
 * specimens that have no coordinates (they may occur in the region, unconfirmed).
 * Drives `browseSpecies` in stores/taxa.js — no effect when no polygon is drawn.
 * Default on; session-only, like `selectionPolygonStore`.
 */
export const includeUnlocatedStore = writable(true);

export function clearSelection() {
	selectionPolygonStore.set(null);
}
