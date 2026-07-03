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
 * the old WIO extent so the islands aren't lost at the edges. The eastern edge reaches 64.5°E so
 * Rodrigues (~63.4°E) sits inside the opening frame alongside Réunion and Mauritius.
 */
export const WIO_DEFAULT_VIEW = { latMin: -27, latMax: -1, lngMin: 31, lngMax: 64.5 };

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
 * Reads the display coordinate (mapLng/mapLat — real GPS or an island anchor) so an
 * anchored Mascarene out-group switches the dataset to the WIO extent; falls back to
 * the raw lng/lat so plain `{lng, lat}` points (e.g. the unit tests) still work.
 * @param {{lng:number, lat:number, mapLng?:number, mapLat?:number}[]} points
 */
export function detectExtent(points) {
	if (!points || points.length === 0) return 'madagascar';
	let extent = 'madagascar';
	for (const s of points) {
		const lng = s.mapLng ?? s.lng;
		const lat = s.mapLat ?? s.lat;
		if (inBbox(lng, lat, MADAGASCAR_BBOX)) continue;
		if (inBbox(lng, lat, WIO_BBOX)) {
			extent = 'wio';
			continue;
		}
		return 'global';
	}
	return extent;
}

/**
 * True when a specimen is an island-anchored (approximate) sheet being viewed on the Madagascar
 * extent. The anchored WIO islands aren't drawn on the Madagascar basemap — Mayotte's centroid
 * even falls inside the rectangular MADAGASCAR_BBOX — so such sheets must be hidden there: the
 * Madagascar view shows only real Madagascar records. Shared by the map plot, the search locator,
 * and the sidebar's mapped-species count so the dots and the "Showing X of N" total agree.
 * @param {{approximate?:boolean}} s
 * @param {string} extentId 'madagascar' | 'wio' | 'global'
 */
export function isOffMadagascarAnchor(s, extentId) {
	return extentId === 'madagascar' && s.approximate === true;
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

// ---- Island anchors (display-only placement of coordinate-less island sheets) ----

/**
 * Normalise a string for tolerant matching: strip diacritics (so "Réunion" === "Reunion"),
 * trim, lowercase. Non-strings fold to ''.
 */
function fold(s) {
	return typeof s === 'string'
		? s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
		: '';
}

/**
 * Resolve a specimen's text fields to a bundled island anchor, or null. Field-agnostic,
 * but `Country` is the live path for these datasets (it holds the island itself — e.g.
 * "Reunion", not "France"). Match order, first hit wins:
 *   1. a dedicated `island` field (exact, against folded synonyms);
 *   2. `country` (exact, against folded synonyms);
 *   3. `locality` (substring — the island named inside free text; tokens <4 chars skipped
 *      so a short synonym can't false-match a longer word).
 * Pure: reads only the passed strings, never coordinates. Callers should only invoke this
 * for a specimen with no real GPS (see resolveMapCoords). Madagascar / mainland names match
 * nothing because the gazetteer deliberately omits them.
 * @param {{island?:string, country?:string, locality?:string}} fields
 * @param {{id:string,label:string,names:string[],lat:number,lng:number}[]} anchors
 * @returns {object|null}
 */
export function resolveIslandAnchor(fields, anchors) {
	if (!fields || !anchors) return null;
	const island = fold(fields.island);
	const country = fold(fields.country);
	const locality = fold(fields.locality);

	for (const key of [island, country]) {
		if (!key) continue;
		for (const a of anchors) if (a.names.includes(key)) return a;
	}
	if (locality) {
		for (const a of anchors)
			if (a.names.some((n) => n.length >= 4 && locality.includes(n))) return a;
	}
	return null;
}

/**
 * Display coordinate + provenance for a specimen, WITHOUT touching its recorded lat/lng.
 * Real GPS always wins; else a Mascarene island anchor; else nothing. Returns the fields the
 * map needs — callers spread them onto the specimen as mapLat/mapLng/coordinateSource/
 * approximate/anchorLabel. Recorded lat/lng stay untouched, so the edit modal and the CSV
 * serializer stay honest (an anchored sheet keeps blank recorded coordinates on disk).
 * @param {{lat:number|null, lng:number|null, island?:string, country?:string, locality?:string}} s
 * @param {object[]} anchors gazetteer (ISLAND_ANCHORS)
 * @returns {{mapLat:number|null, mapLng:number|null, coordinateSource:('gps'|'island'|null), approximate:boolean, anchorLabel:string}}
 */
export function resolveMapCoords(s, anchors) {
	if (s.lat != null && s.lng != null) {
		return { mapLat: s.lat, mapLng: s.lng, coordinateSource: 'gps', approximate: false, anchorLabel: '' };
	}
	const a = resolveIslandAnchor(s, anchors);
	if (a) {
		return { mapLat: a.lat, mapLng: a.lng, coordinateSource: 'island', approximate: true, anchorLabel: a.label };
	}
	return { mapLat: null, mapLng: null, coordinateSource: null, approximate: false, anchorLabel: '' };
}

// ---- Co-located point grouping (display-only) ----

/**
 * Partition projected points into lone singles and exact-coincident stacks (≥2 sharing one
 * x,y). Island-anchored sheets place every specimen on a single island centroid, so they
 * project to an identical x,y and group here; genuinely-distinct GPS points never collide,
 * so dense maps are untouched and the result is zoom-independent (unlike the old grid-cell
 * spread, whose cell scaled with zoom and fanned distinct points into the sea). Pure; reads
 * only x/y; preserves input order; point objects (and their specimen/colour) pass through by
 * reference, never mutated.
 * @param {{x:number,y:number}[]} points projected points (each carries specimen, colour…)
 * @returns {{singles:object[], stacks:{x:number,y:number,members:object[]}[]}}
 */
export function groupColocated(points) {
	const buckets = new Map();
	for (const p of points ?? []) {
		const key = `${p.x},${p.y}`;
		let b = buckets.get(key);
		if (!b) buckets.set(key, (b = []));
		b.push(p);
	}
	const singles = [];
	const stacks = [];
	for (const b of buckets.values()) {
		if (b.length === 1) singles.push(b[0]);
		else stacks.push({ x: b[0].x, y: b[0].y, members: b });
	}
	return { singles, stacks };
}

/**
 * Even ring of n offsets at the given radius (projected map units), for the click-to-expand
 * "spiderfy" burst around a stack centre. angle = 2π·i/n starting at the top; each entry is the
 * offset to ADD to the centre. Pure and deterministic.
 * @param {number} n number of members
 * @param {number} radius ring radius in projected map units
 * @returns {{dx:number, dy:number}[]}
 */
export function burstRing(n, radius) {
	return Array.from({ length: n }, (_, i) => {
		const a = (2 * Math.PI * i) / n - Math.PI / 2;
		return { dx: radius * Math.cos(a), dy: radius * Math.sin(a) };
	});
}
