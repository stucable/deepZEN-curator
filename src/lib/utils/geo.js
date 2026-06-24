// Pure geographic helpers for the offline SVG map (curation step D).
// No DOM, no dependencies — keeps the map testable and replaces any need for
// turf.js (point-in-polygon) or a projection library.

const DEG2RAD = Math.PI / 180;

/**
 * Bounding box of Madagascar, padded a little beyond the coastline so coastal
 * specimens aren't clipped at the very edge. Used to frame the SVG viewBox and
 * to drop obviously-bad coordinates (e.g. a sign-flipped latitude landing in the
 * northern hemisphere) off the plotted map.
 */
export const MADAGASCAR_BBOX = { latMin: -25.7, latMax: -11.9, lngMin: 43.1, lngMax: 50.6 };

/**
 * Western Indian Ocean + Africa extent — sub-Saharan & Southern Africa (the Sahara
 * and Mediterranean trimmed) plus Madagascar + Mascarenes + Comoros + Seychelles. The
 * mainland fills the western ~85% of the frame; the islands sit east. Wide enough that
 * continental-African DNA outgroups plot here instead of dropping to the Global locator.
 * Latitude span 54° stays under the lngScale 60° threshold, so the cos-latitude correction
 * (and an accurate scale bar) are kept. Mirrors the WIO_CLIP rectangle in generate-basemap.js.
 * Used when a dataset has georeferenced specimens beyond Madagascar (see detectExtent).
 */
export const WIO_BBOX = { latMin: -36, latMax: 18, lngMin: -19, lngMax: 65 };

/**
 * Default *visible* framing for the WIO extent — a sub-rectangle of WIO_BBOX holding the classic
 * Western Indian Ocean view (Madagascar + the islands + the East-African coast). The map opens
 * here; zooming/panning out reveals the rest of Africa within WIO_BBOX. Kept a little squarer than
 * the old WIO extent so the islands aren't lost at the edges.
 */
export const WIO_DEFAULT_VIEW = { latMin: -27, latMax: -1, lngMin: 31, lngMax: 61 };

/**
 * Whole-world extent — Antarctica's bulk and the high Arctic trimmed — a coarse
 * locator for far-flung (Africa/Asia/Americas) outgroups. Mirrors WORLD_CLIP in
 * generate-basemap.js.
 */
export const WORLD_BBOX = { latMin: -58, latMax: 75, lngMin: -180, lngMax: 180 };

/** True if a coordinate falls inside the given bbox (defaults to Madagascar). */
export function inBbox(lng, lat, bbox = MADAGASCAR_BBOX) {
	return lng >= bbox.lngMin && lng <= bbox.lngMax && lat >= bbox.latMin && lat <= bbox.latMax;
}

/**
 * The narrowest standard extent that contains every geolocated specimen:
 * 'madagascar' if all points sit in MADAGASCAR_BBOX, else 'wio' if all sit in
 * WIO_BBOX, else 'global'. Empty input → 'madagascar' (today's default). Drives the
 * map's auto-detected default extent; the user can still override via the toolbar.
 * @param {{lng:number, lat:number}[]} points
 */
export function detectExtent(points) {
	if (!points || points.length === 0) return 'madagascar';
	let extent = 'madagascar';
	for (const s of points) {
		if (inBbox(s.lng, s.lat, MADAGASCAR_BBOX)) continue;
		if (inBbox(s.lng, s.lat, WIO_BBOX)) {
			extent = 'wio';
			continue;
		}
		return 'global';
	}
	return extent;
}

/**
 * Longitude scale factor at the bbox's mean latitude. One degree of longitude is
 * shorter than one degree of latitude away from the equator; applying cos(meanLat)
 * to x keeps the island from looking horizontally stretched.
 */
function lngScale(bbox) {
	// A single cos(meanLat) factor is only correct at the bbox's mean latitude; over a
	// near-global latitude span it over-compresses x and squashes the map. For such wide
	// extents fall back to plain equirectangular (cos 0 = 1). Regional extents
	// (Madagascar, WIO) keep the cos correction unchanged, so they're unaffected.
	if (bbox.latMax - bbox.latMin > 60) return 1;
	return Math.cos(((bbox.latMin + bbox.latMax) / 2) * DEG2RAD);
}

/**
 * Projected width/height of the bbox in map units (degrees, with x cos-corrected).
 * The map component uses this as its SVG viewBox so that the basemap and points
 * share one projection and the aspect ratio is preserved automatically.
 */
export function projectedExtent(bbox = MADAGASCAR_BBOX) {
	return {
		width: (bbox.lngMax - bbox.lngMin) * lngScale(bbox),
		height: bbox.latMax - bbox.latMin
	};
}

/**
 * Project a geographic coordinate to SVG map space (origin top-left, y down).
 * Equirectangular with cos-latitude correction; the output lives in the same
 * units as projectedExtent so it maps directly into the viewBox.
 */
export function projectLngLat(lng, lat, bbox = MADAGASCAR_BBOX) {
	return {
		x: (lng - bbox.lngMin) * lngScale(bbox),
		y: bbox.latMax - lat
	};
}

/**
 * Projected SVG viewBox `{ x, y, w, h }` for a lng/lat sub-rectangle (`viewBbox`) inside a larger
 * extent's projection (`fullBbox`). Used to open the WIO extent zoomed to WIO_DEFAULT_VIEW while
 * the basemap still spans the full WIO_BBOX (so zoom-out reveals the rest of Africa).
 */
export function viewBoxFor(viewBbox, fullBbox) {
	const nw = projectLngLat(viewBbox.lngMin, viewBbox.latMax, fullBbox);
	const se = projectLngLat(viewBbox.lngMax, viewBbox.latMin, fullBbox);
	return { x: nw.x, y: nw.y, w: se.x - nw.x, h: se.y - nw.y };
}

/**
 * Inverse of projectLngLat. Converts an SVG-space point (e.g. a polygon vertex the
 * curator clicked) back to geographic coordinates, so a drawn selection is stored
 * in lng/lat and survives zoom/pan.
 */
export function unprojectXY(x, y, bbox = MADAGASCAR_BBOX) {
	return {
		lng: bbox.lngMin + x / lngScale(bbox),
		lat: bbox.latMax - y
	};
}

/**
 * Ray-casting point-in-polygon. `ring` is a closed-or-open list of [lng, lat]
 * vertices; the boundary is treated as a single ring (no holes). Works in raw
 * lng/lat space — the cos correction doesn't change inside/outside topology.
 * @param {number} lng
 * @param {number} lat
 * @param {number[][]} ring - [[lng, lat], …]
 * @returns {boolean}
 */
export function pointInRing(lng, lat, ring) {
	if (!ring || ring.length < 3) return false;
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i];
		const [xj, yj] = ring[j];
		const intersects =
			yi > lat !== yj > lat &&
			lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
		if (intersects) inside = !inside;
	}
	return inside;
}
