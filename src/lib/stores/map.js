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
 * Whether a map narrowing also surfaces specimens/species that have no coordinates.
 * Governs BOTH map narrowings (the user wants one shared control for both):
 *   - region polygon: drives `browseSpecies` in stores/taxa.js — keeps no-coordinate
 *     specimen sheets of in-region species (sheet-level).
 *   - legend hide: drives `visibleSpecies` — keeps species that have no coordinates
 *     anywhere (species-level), which the legend can't hide since they're never plotted.
 * No effect unless a region polygon is drawn or species have been hidden via the map
 * legend. Default on; session-only, like `selectionPolygonStore`.
 */
export const includeUnlocatedStore = writable(true);

/**
 * Species (currentDetermination keys) the user has hidden via the map legend. A
 * map-drawn narrowing like `selectionPolygonStore`: when non-empty it removes those
 * species from the Browse grid, the Curate table, and the sidebar counts — not just the
 * map points. The legend still lists hidden species (greyed) so they can be restored,
 * and the sidebar offers a "Show all species" escape hatch in Browse/Curate. Session-only;
 * reset on dataset switch.
 */
export const hiddenSpeciesStore = writable(new Set());

/**
 * Which basemap extent the map frames: 'auto' (detect from the dataset's points),
 * or an explicit 'madagascar' | 'wio' | 'global' chosen via the map toolbar's
 * extent selector. 'auto' re-resolves per dataset (see effectiveMapExtent in
 * stores/taxa.js); a manual pick holds until the next dataset switch. Session-only,
 * reset to 'auto' on dataset switch by the effect in +page.svelte.
 */
export const mapExtentStore = writable('auto');

export function clearSelection() {
	selectionPolygonStore.set(null);
}

/** Un-hide every legend-hidden species. Used by the sidebar and the legend header. */
export function showAllSpecies() {
	hiddenSpeciesStore.set(new Set());
}
