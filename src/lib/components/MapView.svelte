<script>
	import { taxaStore, filteredSpecies } from '$lib/stores/taxa.js';
	import { selectionPolygonStore, clearSelection, hiddenSpeciesStore, showAllSpecies } from '$lib/stores/map.js';
	import { currentDatasetStore } from '$lib/stores/dataset.js';
	import {
		MADAGASCAR_BBOX,
		projectedExtent,
		projectLngLat,
		unprojectXY,
		inBbox,
		pointInRing
	} from '$lib/utils/geo.js';
	import { MADAGASCAR_OUTLINE } from '$lib/data/madagascar.js';
	import { MADAGASCAR_BIOMES } from '$lib/data/madagascar-biomes.js';
	import { colourForIndex, PALETTE_SIZE } from '$lib/utils/palette.js';
	import { isUndetermined } from '$lib/utils/csv.js';
	import SpecimenEditModal from './SpecimenEditModal.svelte';

	// Single emerald used when too many species are shown to colour-code legibly.
	const FALLBACK_COLOUR = '#059669';
	// Neutral grey for the undetermined "… sp." pile — kept out of the palette so the
	// determined species get the distinct colours (a botanist's to-identify dots).
	const UNDETERMINED_COLOUR = '#9ca3af';

	// Projection extent is constant — the viewBox starts framing the whole island
	// and is then mutated by zoom/pan. y grows downward (SVG convention).
	const ext = projectedExtent();
	const base = { x: 0, y: 0, w: ext.width, h: ext.height };
	let viewBox = $state({ ...base });
	const viewBoxStr = $derived(`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);

	// User-adjustable multiplier (toolbar slider) on the occurrence-point size.
	let pointScale = $state(1);
	// Keep point radius / stroke roughly constant on screen as the user zooms.
	const pointRadius = $derived(viewBox.w * 0.0095 * pointScale);
	const thinStroke = $derived(viewBox.w * 0.003);
	const polyStroke = $derived(viewBox.w * 0.006);

	let svgEl = $state(null);
	let containerEl = $state(null);

	// Project a set of [lng,lat] rings into a single SVG path (rings concatenated,
	// each closed). Shared by the coastline outline and every biome polygon so they
	// all live in the same projected space as the points.
	function ringsToPath(rings) {
		return rings
			.map(
				(ring) =>
					ring
						.map(([lng, lat], i) => {
							const { x, y } = projectLngLat(lng, lat);
							return `${i === 0 ? 'M' : 'L'}${x.toFixed(4)} ${y.toFixed(4)}`;
						})
						.join(' ') + ' Z'
			)
			.join(' ');
	}

	const outlinePath = ringsToPath(MADAGASCAR_OUTLINE.rings);
	// Pre-project each biome's polygons once (static data → computed at module init).
	const biomePaths = MADAGASCAR_BIOMES.map((b) => ({ ...b, d: ringsToPath(b.rings) }));
	// Habitat (biome) layer visibility — view-only session state, like pointScale.
	let showBiomes = $state(true);

	// Split a taxon name at an infraspecific rank ("var." / "subsp." / "ssp.") so the
	// legend can force a line break before it: line 1 = binomial, line 2 = the rank +
	// epithet (+ count). `infra` is '' for a plain binomial, which stays on one line.
	function splitInfra(name) {
		const m = name.match(/\s(?:var\.|subsp\.|ssp\.)\s/);
		if (!m) return { primary: name, infra: '' };
		return { primary: name.slice(0, m.index), infra: name.slice(m.index + 1) };
	}

	// Plot data: which species are visible (after sidebar + polygon filters), the
	// colour assigned to each, the projected points, and how many fell off-map.
	const plot = $derived.by(() => {
		if (!$taxaStore)
			return { points: [], byCat: new Map(), legend: [], offMap: 0, tooMany: false, speciesCount: 0, missing: [] };

		const filterKeys = new Set($filteredSpecies.map((s) => s.taxonomicName));

		// Specimens to plot, grouped under their species key (currentDetermination).
		const inView = [];
		let offMap = 0;
		for (const s of $taxaStore.geolocatedSpecimens) {
			if (!filterKeys.has(s.currentDetermination)) continue;
			if (!inBbox(s.lng, s.lat)) {
				offMap++;
				continue;
			}
			inView.push(s);
		}

		// Species that actually have a point, in the filtered sort order, so the
		// legend is dense (no colours wasted on point-less species). The undetermined
		// "… sp." pile is split out: it gets a single grey, and only determined species
		// consume palette slots — so 16 determined + an undetermined group still all
		// colour distinctly instead of tripping the >16 fallback.
		const present = new Set(inView.map((s) => s.currentDetermination));
		const orderedKeys = $filteredSpecies
			.map((s) => s.taxonomicName)
			.filter((k) => present.has(k));
		const determinedKeys = orderedKeys.filter((k) => !isUndetermined(k));
		const undetKeys = orderedKeys.filter((k) => isUndetermined(k));

		// Per-species "(mapped / total)" tallies for the legend.
		//  total — every barcoded specimen of the species in the dataset (skips the
		//          barcode-less name placeholders, matching the geolocatedSpecimens basis).
		//  mapped — specimens shown on the map: in-bbox plotted points normally, or, when a
		//           region polygon is drawn, only the specimens inside it (per-point test).
		//           The dataset total is unaffected by the polygon.
		const totalByKey = new Map();
		for (const s of $taxaStore.specimensByCatalogue.values()) {
			if (!s.catalogueNumber) continue;
			totalByKey.set(s.currentDetermination, (totalByKey.get(s.currentDetermination) ?? 0) + 1);
		}
		const polygon = $selectionPolygonStore;
		const mappedByKey = new Map();
		if (polygon && polygon.length >= 3) {
			for (const s of $taxaStore.geolocatedSpecimens) {
				if (!pointInRing(s.lng, s.lat, polygon)) continue;
				mappedByKey.set(s.currentDetermination, (mappedByKey.get(s.currentDetermination) ?? 0) + 1);
			}
		} else {
			for (const s of inView) {
				mappedByKey.set(s.currentDetermination, (mappedByKey.get(s.currentDetermination) ?? 0) + 1);
			}
		}
		const tally = (k) => ({ mapped: mappedByKey.get(k) ?? 0, total: totalByKey.get(k) ?? 0 });

		const tooMany = determinedKeys.length > PALETTE_SIZE;
		const colourByKey = new Map();
		determinedKeys.forEach((k, i) =>
			colourByKey.set(k, tooMany ? FALLBACK_COLOUR : colourForIndex(i))
		);
		undetKeys.forEach((k) => colourByKey.set(k, UNDETERMINED_COLOUR));

		const points = inView.map((s) => {
			const { x, y } = projectLngLat(s.lng, s.lat);
			return { x, y, colour: colourByKey.get(s.currentDetermination), specimen: s };
		});
		// Catalogue → specimen lookup so a pointerdown's target (which carries
		// data-cat) resolves back to the specimen for tap-to-open.
		const byCat = new Map(inView.map((s) => [s.catalogueNumber, s]));

		// Legend: coloured determined species first, then grey undetermined rows. Empty
		// when there are too many determined species to colour-code (the "too many" note
		// shows instead; points still render — fallback colour + grey undetermined).
		const legend = tooMany
			? []
			: [
					...determinedKeys.map((k) => ({ name: k, colour: colourByKey.get(k), undetermined: false, ...tally(k) })),
					...undetKeys.map((k) => ({ name: k, colour: UNDETERMINED_COLOUR, undetermined: true, ...tally(k) }))
				];

		// Filtered species with no plottable point — either un-georeferenced or with
		// coordinates that fell off-map. Listed in the legend's "Without coordinates"
		// section (in the filtered sort order) so the map's species count reconciles
		// with the sidebar's filtered count.
		const missing = $filteredSpecies
			.map((s) => s.taxonomicName)
			.filter((k) => !present.has(k))
			.map((k) => ({ name: k, undetermined: isUndetermined(k), ...tally(k) }));

		return { points, byCat, legend, offMap, tooMany, speciesCount: determinedKeys.length, missing };
	});

	// ---- Legend selection (app-wide show/hide) -------------------------------
	// Species toggled off via the legend live in the shared hiddenSpeciesStore — a
	// map-drawn narrowing like the region polygon: it removes them from the points
	// here AND from the Browse grid, the Curate table, and the sidebar counts. The
	// legend still lists hidden species (greyed) so they can be restored.
	const visiblePoints = $derived(
		plot.points.filter((p) => !$hiddenSpeciesStore.has(p.specimen.currentDetermination))
	);
	const visibleSpeciesCount = $derived(
		new Set(visiblePoints.map((p) => p.specimen.currentDetermination)).size
	);
	// True when every species currently in the legend is hidden — drives the
	// header toggle's label (Show all ⇄ Hide all).
	const allHidden = $derived(
		plot.legend.length > 0 && plot.legend.every((i) => $hiddenSpeciesStore.has(i.name))
	);

	function toggleSpecies(name) {
		const next = new Set($hiddenSpeciesStore);
		next.has(name) ? next.delete(name) : next.add(name);
		hiddenSpeciesStore.set(next);
	}
	function hideAllSpecies() {
		hiddenSpeciesStore.set(new Set(plot.legend.map((i) => i.name)));
	}

	// ---- Specimen search (whole dataset → locate + open modal) ---------------
	let query = $state('');
	let searchFocus = $state(null); // last-selected match, kept ringed until next search

	const SEARCH_LIMIT = 25;
	// A specimen is "locatable" if it has valid in-bbox coordinates (so it plots and
	// can be panned to). Un-georeferenced specimens are still searchable — they're the
	// ones a curator georeferences via the modal's "Set location on map".
	const isLocatable = (s) => s.lat != null && s.lng != null && inBbox(s.lng, s.lat);
	const searchMatches = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q || !$taxaStore) return [];
		const tokens = q.split(/\s+/);
		const out = [];
		let truncated = false;
		for (const s of $taxaStore.specimensByCatalogue.values()) {
			const hay = `${s.catalogueNumber} ${s.recordedBy} ${s.recordNumber}`.toLowerCase();
			if (tokens.every((t) => hay.includes(t))) {
				if (out.length >= SEARCH_LIMIT) {
					truncated = true;
					break;
				}
				out.push(s);
			}
		}
		out.truncated = truncated;
		return out;
	});

	function panTo(lng, lat) {
		const { x, y } = projectLngLat(lng, lat);
		const w = base.w * 0.25;
		const h = base.h * 0.25;
		viewBox = { x: x - w / 2, y: y - h / 2, w, h };
	}
	function selectSearchResult(s) {
		if (isLocatable(s)) {
			panTo(s.lng, s.lat);
			searchFocus = s;
		} else {
			searchFocus = null; // nothing to pan to / ring; open the modal to georeference it
		}
		editing = s;
		query = '';
	}
	function clearSearch() {
		query = '';
		searchFocus = null;
	}

	// Reset the local search when the dataset changes (lastDatasetId is a plain variable
	// so reading it doesn't re-trigger the effect). Legend hides are NOT reset here: this
	// effect also fires on every remount (e.g. switching back from Browse to Map), which
	// would wipe hides the user expects to persist across views. The hide-set is cleared
	// centrally on a real dataset switch by +page.svelte (showAllSpecies()).
	let lastDatasetId;
	$effect(() => {
		const id = $currentDatasetStore?.id;
		if (id !== lastDatasetId) {
			lastDatasetId = id;
			query = '';
			searchFocus = null;
		}
	});

	// ---- Hover tooltip -------------------------------------------------------
	let hovered = $state(null); // specimen or null
	let tipPos = $state({ x: 0, y: 0 });

	function showTip(specimen, e) {
		if (drawing || placing) return;
		hovered = specimen;
		moveTip(e);
	}
	function moveTip(e) {
		const rect = containerEl?.getBoundingClientRect();
		if (!rect) return;
		tipPos = { x: e.clientX - rect.left + 12, y: e.clientY - rect.top + 12 };
	}
	function hideTip() {
		hovered = null;
	}

	// ---- Edit modal ----------------------------------------------------------
	let editing = $state(null);
	// Click-to-georeference: `placing` tucks the modal away while the next map click
	// sets the open specimen's coordinates; `pendingLocation` is the {lng, lat} pushed
	// back into the modal (by a placement click or a point drag-drop).
	let placing = $state(false);
	let pendingLocation = $state(null);

	function pickLocation() {
		placing = true; // modal hides (hidden={placing}); next svg click sets coords
	}
	function cancelPlacing() {
		placing = false;
	}
	function closeEditing() {
		editing = null;
		pendingLocation = null;
		placing = false;
	}
	function onWindowKeydown(e) {
		if (e.key === 'Escape' && placing) cancelPlacing();
	}

	// ---- Zoom / pan ----------------------------------------------------------
	function svgPoint(e) {
		const pt = svgEl.createSVGPoint();
		pt.x = e.clientX;
		pt.y = e.clientY;
		const ctm = svgEl.getScreenCTM();
		if (!ctm) return null;
		const p = pt.matrixTransform(ctm.inverse());
		return { x: p.x, y: p.y };
	}

	let panning = $state(false); // read in the svg cursor class, so must be reactive
	let panStart = null;
	// The specimen whose point the press started on (read from pointerdown's target).
	// We open its modal on pointerup-without-drag rather than via the circle's own
	// `click`: on an SVG, if mousedown and mouseup resolve to different targets the
	// `click` retargets to the parent <svg>, so a point's own click is unreliable.
	// Handling the whole gesture at the svg level sidesteps that entirely.
	let pressedSpecimen = null;
	// Dragging an existing point to reposition it: `draggingPoint` once a press on a
	// point crosses the threshold, `dragPos` the live SVG position (preview marker),
	// `dragResult` the dropped {specimen, lng, lat} handed to the click phase to open
	// the modal pre-filled (opening on click, not pointerup, dodges the trailing-click
	// backdrop-close hazard the tap path documents below).
	let draggingPoint = $state(false);
	let dragPos = $state(null);
	let dragResult = null;
	// Pixels the pointer must travel before a press becomes a pan (not a tap).
	const PAN_THRESHOLD = 4;

	function specimenForTarget(target) {
		const cat = target?.getAttribute?.('data-cat');
		return cat ? plot.byCat.get(cat) : null;
	}

	function onPointerDown(e) {
		pressedSpecimen = null;
		dragResult = null; // clears any uncollected drag (e.g. a drag with no trailing click)
		if (drawing || placing) return; // clicks add vertices / set location instead
		// Deliberately NOT using setPointerCapture: it would retarget pointer events
		// to the svg. Panning works without capture while the pointer stays over the
		// map; onpointerleave ends a drag that wanders off.
		pressedSpecimen = specimenForTarget(e.target);
		panStart = {
			cx: e.clientX,
			cy: e.clientY,
			vbx: viewBox.x,
			vby: viewBox.y,
			rect: svgEl.getBoundingClientRect()
		};
	}
	function onPointerMove(e) {
		if (!panStart) return;
		// Already dragging a point → keep tracking its position (the preview marker).
		if (draggingPoint) {
			dragPos = svgPoint(e);
			return;
		}
		const dxPx = e.clientX - panStart.cx;
		const dyPx = e.clientY - panStart.cy;
		if (!panning && Math.hypot(dxPx, dyPx) < PAN_THRESHOLD) return;
		// First time over threshold: a press that began on a point drags the point;
		// a press on empty map pans.
		if (!panning && pressedSpecimen) {
			draggingPoint = true;
			dragPos = svgPoint(e);
			return;
		}
		panning = true;
		pressedSpecimen = null; // a pan is not a tap
		const dx = (dxPx * viewBox.w) / panStart.rect.width;
		const dy = (dyPx * viewBox.h) / panStart.rect.height;
		viewBox = { ...viewBox, x: panStart.vbx - dx, y: panStart.vby - dy };
	}
	function onPointerUp() {
		// Modal opening happens in onSvgClick (the click phase), not here: opening it
		// on pointerup lets the trailing `click` land on the freshly-rendered backdrop
		// and close it again. A drag-drop stashes its result for that same click phase;
		// a tap carries pressedSpecimen through.
		if (draggingPoint && dragPos && pressedSpecimen) {
			const { lng, lat } = unprojectXY(dragPos.x, dragPos.y);
			dragResult = { specimen: pressedSpecimen, lng, lat };
		}
		draggingPoint = false;
		dragPos = null;
		panning = false;
		panStart = null;
	}

	function handleWheel(e) {
		e.preventDefault();
		const rect = svgEl.getBoundingClientRect();
		const fx = (e.clientX - rect.left) / rect.width;
		const fy = (e.clientY - rect.top) / rect.height;
		const cursorX = viewBox.x + fx * viewBox.w;
		const cursorY = viewBox.y + fy * viewBox.h;
		const factor = e.deltaY < 0 ? 0.85 : 1.18;
		const minW = base.w * 0.04;
		const newW = Math.min(base.w, Math.max(minW, viewBox.w * factor));
		const newH = viewBox.h * (newW / viewBox.w);
		viewBox = { x: cursorX - fx * newW, y: cursorY - fy * newH, w: newW, h: newH };
	}

	// Attach wheel non-passively so preventDefault works (Svelte may register it
	// passive otherwise, which would let the page scroll instead of zooming).
	$effect(() => {
		const el = svgEl;
		if (!el) return;
		el.addEventListener('wheel', handleWheel, { passive: false });
		return () => el.removeEventListener('wheel', handleWheel);
	});

	function resetView() {
		viewBox = { ...base };
	}

	// ---- Scale bar -----------------------------------------------------------
	// The cos-latitude correction in geo.js makes one projected unit ≈ the same ground
	// distance on both axes, so 1 unit ≈ 111.32 km (one degree of longitude). The bar
	// length follows the on-screen scale (preserveAspectRatio="meet" → uniform fit, so
	// px-per-unit is the smaller of the width/height ratios).
	const KM_PER_UNIT = 111.32;
	const NICE_KM = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000];
	let containerWidth = $state(0);
	let containerHeight = $state(0);
	$effect(() => {
		const el = containerEl;
		if (!el) return;
		const ro = new ResizeObserver((entries) => {
			const r = entries[0].contentRect;
			containerWidth = r.width;
			containerHeight = r.height;
		});
		ro.observe(el);
		const r = el.getBoundingClientRect();
		containerWidth = r.width;
		containerHeight = r.height;
		return () => ro.disconnect();
	});
	const scaleBar = $derived.by(() => {
		if (!containerWidth || !containerHeight) return null;
		const pxPerUnit = Math.min(containerWidth / viewBox.w, containerHeight / viewBox.h);
		const targetKm = ((0.22 * containerWidth) / pxPerUnit) * KM_PER_UNIT;
		let km = NICE_KM[0];
		for (const s of NICE_KM) if (s <= targetKm) km = s;
		return { km, px: (km / KM_PER_UNIT) * pxPerUnit };
	});

	// ---- Polygon drawing -----------------------------------------------------
	let drawing = $state(false);
	let vertices = $state([]); // [{x, y}] in SVG user space

	const inProgressPoints = $derived(vertices.map((v) => `${v.x},${v.y}`).join(' '));

	const committedPoints = $derived.by(() => {
		if (!$selectionPolygonStore) return '';
		return $selectionPolygonStore
			.map(([lng, lat]) => {
				const { x, y } = projectLngLat(lng, lat);
				return `${x},${y}`;
			})
			.join(' ');
	});

	function startDrawing() {
		hovered = null;
		vertices = [];
		drawing = true;
	}
	function cancelDrawing() {
		drawing = false;
		vertices = [];
	}
	function finishDrawing() {
		if (vertices.length < 3) return;
		const polygon = vertices.map((v) => {
			const { lng, lat } = unprojectXY(v.x, v.y);
			return [lng, lat];
		});
		selectionPolygonStore.set(polygon);
		drawing = false;
		vertices = [];
	}

	function onSvgClick(e) {
		// A point was just dragged-and-dropped: open it pre-filled with the new coords.
		if (dragResult) {
			pendingLocation = { lng: dragResult.lng, lat: dragResult.lat };
			editing = dragResult.specimen;
			dragResult = null;
			pressedSpecimen = null;
			return;
		}
		// Placement mode: this click sets the open specimen's coordinates.
		if (placing) {
			const p = svgPoint(e);
			if (!p) return;
			const { lng, lat } = unprojectXY(p.x, p.y);
			pendingLocation = { lng, lat };
			placing = false; // modal reappears with the coordinate fields filled
			return;
		}
		if (!drawing) {
			// A tap on a point (pressedSpecimen captured at pointerdown, not panned away).
			if (pressedSpecimen) {
				editing = pressedSpecimen;
				pressedSpecimen = null;
			}
			return;
		}
		const p = svgPoint(e);
		if (!p) return;
		// Click near the first vertex closes the polygon.
		if (vertices.length >= 3) {
			const first = vertices[0];
			const d = Math.hypot(p.x - first.x, p.y - first.y);
			if (d < viewBox.w * 0.025) {
				finishDrawing();
				return;
			}
		}
		vertices = [...vertices, p];
	}

	function clearMapSelection() {
		clearSelection();
	}
</script>

<div class="flex h-full flex-col gap-3">
	<!-- Toolbar -->
	<div class="flex flex-wrap items-center gap-2 text-sm">
		{#if placing}
			<div
				class="flex w-full items-center gap-2 rounded bg-emerald-50 px-3 py-1.5 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
			>
				<span>
					Click the map to set the location for
					<span class="font-mono">{editing?.catalogueNumber}</span>
				</span>
				<button
					type="button"
					onclick={cancelPlacing}
					class="ml-auto cursor-pointer rounded border border-emerald-600 px-3 py-1 font-medium text-emerald-700 hover:bg-emerald-100 dark:text-emerald-300 dark:hover:bg-emerald-900"
				>
					Cancel
				</button>
			</div>
		{/if}
		{#if !drawing}
			<button
				type="button"
				onclick={startDrawing}
				class="cursor-pointer rounded border border-emerald-600 px-3 py-1 font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950"
			>
				Draw region
			</button>
		{:else}
			<span class="text-gray-600 dark:text-gray-300">
				Click to add points; click the first point (or “Finish”) to close.
			</span>
			<button
				type="button"
				onclick={finishDrawing}
				disabled={vertices.length < 3}
				class="cursor-pointer rounded bg-emerald-600 px-3 py-1 font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
			>
				Finish
			</button>
			<button
				type="button"
				onclick={cancelDrawing}
				class="cursor-pointer rounded border border-gray-300 px-3 py-1 text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
			>
				Cancel
			</button>
		{/if}

		{#if $selectionPolygonStore}
			<button
				type="button"
				onclick={clearMapSelection}
				class="cursor-pointer rounded border border-amber-500 px-3 py-1 font-medium text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950"
			>
				Clear region filter
			</button>
		{/if}

		<button
			type="button"
			onclick={resetView}
			class="cursor-pointer rounded border border-gray-300 px-3 py-1 text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
		>
			Reset view
		</button>

		<button
			type="button"
			onclick={() => (showBiomes = !showBiomes)}
			aria-pressed={showBiomes}
			title="Show vegetation zones (habitats) under the points"
			class="cursor-pointer rounded border px-3 py-1 font-medium {showBiomes
				? 'border-emerald-600 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
				: 'border-gray-300 text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800'}"
		>
			Biomes
		</button>

		<!-- Find a specimen by barcode or collector + number (whole dataset) -->
		<div class="relative">
			<input
				type="text"
				bind:value={query}
				placeholder="Find barcode or collector…"
				aria-label="Find specimen by barcode or collector and number"
				class="w-56 rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
			/>
			{#if query}
				<button
					type="button"
					onclick={clearSearch}
					aria-label="Clear search"
					class="absolute right-1 top-1/2 -translate-y-1/2 cursor-pointer px-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
				>
					✕
				</button>
				<ul
					class="absolute left-0 top-full z-20 mt-1 max-h-72 w-80 overflow-y-auto rounded-md border border-gray-300 bg-white text-xs shadow-lg dark:border-gray-600 dark:bg-gray-800"
				>
					{#if searchMatches.length === 0}
						<li class="px-3 py-2 text-gray-500 dark:text-gray-400">No matching specimens</li>
					{:else}
						{#each searchMatches as m (m.catalogueNumber)}
							<li>
								<button
									type="button"
									onclick={() => selectSearchResult(m)}
									class="block w-full cursor-pointer px-3 py-1.5 text-left hover:bg-emerald-50 dark:hover:bg-emerald-950"
								>
									<span class="font-mono text-gray-700 dark:text-gray-200">{m.catalogueNumber}</span>
									<span class="text-gray-500 dark:text-gray-400"> · {m.currentDetermination}</span>
									{#if !isLocatable(m)}
										<span class="text-amber-600 dark:text-amber-400"> · no coordinates</span>
									{/if}
									<div class="text-gray-500 dark:text-gray-400">
										{m.recordedBy || '—'}{m.recordNumber ? ` ${m.recordNumber}` : ''}
									</div>
								</button>
							</li>
						{/each}
						{#if searchMatches.truncated}
							<li class="px-3 py-1.5 text-gray-400">Showing first {SEARCH_LIMIT} — refine your search</li>
						{/if}
					{/if}
				</ul>
			{/if}
		</div>

		<label class="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
			Point size
			<input
				type="range"
				min="0.6"
				max="3"
				step="0.2"
				bind:value={pointScale}
				aria-label="Point size"
				class="h-4 w-24 cursor-pointer appearance-none bg-transparent [&::-webkit-slider-runnable-track]:h-0.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-gray-300 dark:[&::-webkit-slider-runnable-track]:bg-gray-600 [&::-webkit-slider-thumb]:-mt-[5px] [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-emerald-600"
			/>
		</label>

		<span class="ml-auto text-xs text-gray-500 dark:text-gray-400">
			{visiblePoints.length} points · {visibleSpeciesCount} species
			{#if $hiddenSpeciesStore.size > 0}
				· <span class="text-gray-400">{$hiddenSpeciesStore.size} hidden</span>
			{/if}
			{#if plot.offMap > 0}
				· <span class="text-amber-600 dark:text-amber-400">{plot.offMap} off-map (bad coordinates)</span>
			{/if}
		</span>
	</div>

	<div class="flex min-h-0 flex-1 gap-3">
		<!-- Map -->
		<div
			bind:this={containerEl}
			class="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-gray-200 bg-sky-50 dark:border-gray-700 dark:bg-gray-900"
		>
			{#if !$taxaStore}
				<div class="flex h-full items-center justify-center text-gray-400">Loading…</div>
			{:else}
				<svg
					bind:this={svgEl}
					viewBox={viewBoxStr}
					preserveAspectRatio="xMidYMid meet"
					class="h-full w-full {drawing || placing ? 'cursor-crosshair' : panning || draggingPoint ? 'cursor-grabbing' : 'cursor-grab'}"
					onpointerdown={onPointerDown}
					onpointermove={onPointerMove}
					onpointerup={onPointerUp}
					onpointerleave={onPointerUp}
					onclick={onSvgClick}
					role="application"
					aria-label="Map of Madagascar showing specimen records"
				>
					<!-- Basemap: parchment land, biome zones clipped to the coast, then a
					     crisp shoreline stroke on top so the coastline stays sharp over the fills. -->
					<defs>
						<clipPath id="coast-clip">
							<path d={outlinePath} />
						</clipPath>
					</defs>
					<path d={outlinePath} fill="#f3efe3" class="dark:fill-stone-800" pointer-events="none" />
					{#if showBiomes}
						<g clip-path="url(#coast-clip)" pointer-events="none">
							{#each biomePaths as b (b.id)}
								<path d={b.d} fill={b.colour} fill-opacity="0.42" class="dark:[fill-opacity:0.3]" />
							{/each}
						</g>
					{/if}
					<path
						d={outlinePath}
						fill="none"
						stroke="#9aa7b5"
						stroke-width={thinStroke}
						class="dark:stroke-stone-500"
						pointer-events="none"
					/>

					<!-- Committed selection polygon -->
					{#if committedPoints}
						<polygon
							points={committedPoints}
							fill="#f59e0b"
							fill-opacity="0.12"
							stroke="#d97706"
							stroke-width={polyStroke}
							stroke-dasharray="{polyStroke * 2} {polyStroke * 2}"
							pointer-events="none"
						/>
					{/if}

					<!-- In-progress drawing -->
					{#if drawing && vertices.length > 0}
						<polyline
							points={inProgressPoints}
							fill="none"
							stroke="#d97706"
							stroke-width={polyStroke}
							pointer-events="none"
						/>
						{#each vertices as v, i (i)}
							<circle cx={v.x} cy={v.y} r={pointRadius} fill="#d97706" pointer-events="none" />
						{/each}
					{/if}

					<!-- Live preview while dragging an existing point to reposition it -->
					{#if draggingPoint && dragPos}
						<circle
							cx={dragPos.x}
							cy={dragPos.y}
							r={pointRadius * 1.3}
							fill="#d97706"
							fill-opacity="0.9"
							stroke="#1f2937"
							stroke-width={thinStroke}
							pointer-events="none"
						/>
					{/if}

					<!-- Specimen points. Click handling lives on the svg (pointerdown +
					     pointerup) via data-cat, not on the circle's own click. -->
					{#each visiblePoints as p, i (i)}
						<circle
							cx={p.x}
							cy={p.y}
							r={pointRadius}
							fill={p.colour}
							fill-opacity="0.95"
							stroke="#1f2937"
							stroke-width={thinStroke}
							data-cat={p.specimen.catalogueNumber}
							style:pointer-events={drawing || placing ? 'none' : 'auto'}
							class={drawing || placing ? '' : 'cursor-pointer'}
							role="button"
							aria-label={`${p.specimen.currentDetermination} ${p.specimen.catalogueNumber}`}
							onmouseenter={(e) => showTip(p.specimen, e)}
							onmousemove={moveTip}
							onmouseleave={hideTip}
						/>
					{/each}

					<!-- Search highlight rings (live matches + last-selected), drawn on top
					     and locatable even if a filter or legend toggle hid their points. -->
					{#each searchMatches as m (m.catalogueNumber)}
						{#if isLocatable(m)}
							{@const pt = projectLngLat(m.lng, m.lat)}
							<circle
								cx={pt.x}
								cy={pt.y}
								r={pointRadius * 2.2}
								fill="none"
								stroke="#d97706"
								stroke-width={polyStroke}
								pointer-events="none"
							/>
						{/if}
					{/each}
					{#if searchFocus && inBbox(searchFocus.lng, searchFocus.lat)}
						{@const pf = projectLngLat(searchFocus.lng, searchFocus.lat)}
						<circle
							cx={pf.x}
							cy={pf.y}
							r={pointRadius * 2.8}
							fill="none"
							stroke="#d97706"
							stroke-width={polyStroke * 1.4}
							pointer-events="none"
						/>
					{/if}
				</svg>

				<!-- Tooltip -->
				{#if hovered}
					<div
						class="pointer-events-none absolute z-10 max-w-xs rounded-md border border-gray-300 bg-white/95 px-3 py-2 text-xs shadow-lg dark:border-gray-600 dark:bg-gray-800/95"
						style:left="{tipPos.x}px"
						style:top="{tipPos.y}px"
					>
						<div class="text-sm text-gray-900 dark:text-gray-100">
							{hovered.currentDetermination}
						</div>
						<div class="text-gray-600 dark:text-gray-300">Barcode: {hovered.catalogueNumber}</div>
						<div class="text-gray-600 dark:text-gray-300">
							Herbarium: {hovered.institutionCode || '—'}{hovered.typeStatus ? ` · ${hovered.typeStatus}` : ''}
						</div>
						<div class="text-gray-600 dark:text-gray-300">
							{hovered.recordedBy || '—'}{hovered.recordNumber ? ` ${hovered.recordNumber}` : ''}
						</div>
					</div>
				{/if}

				<!-- Biome key (top-left), shown when the habitat layer is on -->
				{#if showBiomes}
					<div
						class="pointer-events-none absolute left-2 top-2 z-10 rounded-md border border-gray-200 bg-white/85 px-2.5 py-2 text-[11px] shadow-sm dark:border-gray-700 dark:bg-gray-800/85"
					>
						<div class="mb-1 font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
							Habitats
						</div>
						<ul class="flex flex-col gap-0.5">
							{#each biomePaths as b (b.id)}
								<li class="flex items-center gap-1.5">
									<span
										class="inline-block size-2.5 shrink-0 rounded-sm"
										style:background-color={b.colour}
									></span>
									<span class="text-gray-700 dark:text-gray-200">{b.label}</span>
								</li>
							{/each}
						</ul>
					</div>
				{/if}

				<!-- Scale bar (bottom-left) -->
				{#if scaleBar}
					<div class="pointer-events-none absolute bottom-2 left-2 z-10">
						<div
							class="border-b-2 border-l-2 border-r-2 border-gray-500 dark:border-gray-300"
							style:width="{scaleBar.px}px"
							style:height="5px"
						></div>
						<div
							class="text-center text-[11px] leading-tight text-gray-600 dark:text-gray-300"
							style:width="{scaleBar.px}px"
						>
							{scaleBar.km} km
						</div>
					</div>
				{/if}
			{/if}
		</div>

		<!-- Legend (click a mapped species to show/hide its points) + a list of
		     filtered species that have no point on the map. -->
		{#if plot.legend.length > 0 || plot.tooMany || plot.missing.length > 0}
			<div
				class="flex w-72 shrink-0 flex-col rounded-lg border border-gray-200 p-3 text-xs dark:border-gray-700"
			>
				{#if plot.legend.length > 0}
					<div class="mb-2 flex shrink-0 items-center justify-between">
						<h3 class="font-semibold uppercase text-gray-500 dark:text-gray-400">
							Species ({plot.speciesCount})
						</h3>
						<button
							type="button"
							onclick={allHidden ? showAllSpecies : hideAllSpecies}
							class="cursor-pointer text-emerald-700 hover:underline dark:text-emerald-400"
						>
							{allHidden ? 'Show all' : 'Hide all'}
						</button>
					</div>
				{/if}

				<div class="thin-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
					{#if plot.legend.length > 0}
						<ul class="flex flex-col gap-1">
							{#each plot.legend as item (item.name)}
								{@const hidden = $hiddenSpeciesStore.has(item.name)}
								{@const parts = splitInfra(item.name)}
								<li>
									<button
										type="button"
										onclick={() => toggleSpecies(item.name)}
										aria-pressed={!hidden}
										title={hidden ? 'Show on map' : 'Hide from map'}
										class="flex w-full cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-gray-100 dark:hover:bg-gray-800 {hidden ? 'opacity-40' : ''}"
									>
										<span
											class="inline-block size-3 shrink-0 rounded-full border border-gray-700"
											style:background-color={item.colour}
										></span>
										<span class="text-sm text-gray-800 dark:text-gray-200">
											{#if parts.infra}
												<span class="block whitespace-nowrap">{parts.primary}</span>
												<span class="block whitespace-nowrap">{parts.infra} <span class="text-gray-400 dark:text-gray-500">({item.mapped}/{item.total})</span></span>
											{:else}
												<span class="whitespace-nowrap">{parts.primary} <span class="text-gray-400 dark:text-gray-500">({item.mapped}/{item.total})</span></span>
											{/if}
										</span>
									</button>
								</li>
							{/each}
						</ul>
					{:else if plot.tooMany}
						<p class="text-gray-500 dark:text-gray-400">
							{plot.speciesCount} species shown — too many to colour-code. Filter to {PALETTE_SIZE} or
							fewer species (sidebar) to see distinct colours and a legend.
						</p>
					{/if}

					{#if plot.missing.length > 0}
						<div
							class={plot.legend.length > 0 || plot.tooMany
								? 'border-t border-gray-200 pt-3 dark:border-gray-700'
								: ''}
						>
							<h3 class="mb-2 font-semibold uppercase text-gray-500 dark:text-gray-400">
								Without coordinates ({plot.missing.length})
							</h3>
							<ul class="flex flex-col gap-1">
								{#each plot.missing as item (item.name)}
									{@const parts = splitInfra(item.name)}
									<li class="flex items-center gap-2 px-1 py-0.5">
										<span
											class="inline-block size-[11px] shrink-0 rounded-full border border-gray-400 dark:border-gray-500"
										></span>
										<span class="text-sm text-gray-500 dark:text-gray-400">
											{#if parts.infra}
												<span class="block whitespace-nowrap">{parts.primary}</span>
												<span class="block whitespace-nowrap">{parts.infra} <span class="text-gray-400 dark:text-gray-500">({item.mapped}/{item.total})</span></span>
											{:else}
												<span class="whitespace-nowrap">{parts.primary} <span class="text-gray-400 dark:text-gray-500">({item.mapped}/{item.total})</span></span>
											{/if}
										</span>
									</li>
								{/each}
							</ul>
						</div>
					{/if}
				</div>
			</div>
		{/if}
	</div>
</div>

{#if editing}
	<SpecimenEditModal
		specimen={editing}
		onClose={closeEditing}
		onPickLocation={pickLocation}
		{pendingLocation}
		hidden={placing}
	/>
{/if}

<svelte:window onkeydown={onWindowKeydown} />
