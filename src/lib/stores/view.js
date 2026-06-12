import { writable } from 'svelte/store';

/**
 * Top-level UI mode:
 *   'browse' — the species grid (the original checklist/ID view).
 *   'curate' — the per-specimen table (Phase B curation mode).
 *   'map'    — the Madagascar specimen map (curation step D). Only reachable for
 *              datasets with georeferenced specimens; the toggle hides it otherwise,
 *              and +page.svelte falls back to 'browse' if the active dataset has none.
 * Session-only (not persisted) — every reload starts in Browse, which is the
 * safe default for the field-botanist audience who never touch curation.
 */
export const viewModeStore = writable('browse');

export function setViewMode(mode) {
	viewModeStore.set(mode);
}

/**
 * The specimen currently open in the determination/edit window (SpecimenEditModal),
 * or null. Set from any view — a Browse thumbnail's edit affordance or a Curate row
 * — to open the single modal mounted at the top level in +page.svelte. Session-only,
 * cleared on dataset switch. MapView keeps its own local edit state because it also
 * drives the map-placement props (onPickLocation / pendingLocation / hidden).
 */
export const editingSpecimenStore = writable(null);
