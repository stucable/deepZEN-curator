<script>
	import { taxaStore, filteredSpecies } from '$lib/stores/taxa.js';
	import { selectionPolygonStore, clearSelection } from '$lib/stores/map.js';
	import { currentDatasetStore } from '$lib/stores/dataset.js';
	import {
		MADAGASCAR_BBOX,
		projectedExtent,
		projectLngLat,
		unprojectXY,
		inBbox
	} from '$lib/utils/geo.js';
	import { MADAGASCAR_OUTLINE } from '$lib/data/madagascar.js';
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

	let svgEl;
	let containerEl;

	// Basemap outline as one SVG path (multiple rings concatenated).
	const outlinePath = MADAGASCAR_OUTLINE.rings
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

	// Plot data: which species are visible (after sidebar + polygon filters), the
	// colour assigned to each, the projected points, and how many fell off-map.
	const plot = $derived.by(() => {
		if (!$taxaStore)
			return { points: [], byCat: new Map(), legend: [], offMap: 0, tooMany: false, speciesCount: 0 };

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
					...determinedKeys.map((k) => ({ name: k, colour: colourByKey.get(k), undetermined: false })),
					...undetKeys.map((k) => ({ name: k, colour: UNDETERMINED_COLOUR, undetermined: true }))
				];

		return { points, byCat, legend, offMap, tooMany, speciesCount: determinedKeys.length };
	});

	// ---- Legend selection (map-only show/hide) -------------------------------
	// Species names the user has toggled off via the legend. Map display only —
	// the grid and counts in other views are untouched.
	let hiddenSpecies = $state(new Set());

	const visiblePoints = $derived(
		plot.points.filter((p) => !hiddenSpecies.has(p.specimen.currentDetermination))
	);
	const visibleSpeciesCount = $derived(
		new Set(visiblePoints.map((p) => p.specimen.currentDetermination)).size
	);
	// True when every species currently in the legend is hidden — drives the
	// header toggle's label (Show all ⇄ Hide all).
	const allHidden = $derived(
		plot.legend.length > 0 && plot.legend.every((i) => hiddenSpecies.has(i.name))
	);

	function toggleSpecies(name) {
		const next = new Set(hiddenSpecies);
		next.has(name) ? next.delete(name) : next.add(name);
		hiddenSpecies = next;
	}
	function showAllSpecies() {
		hiddenSpecies = new Set();
	}
	function hideAllSpecies() {
		hiddenSpecies = new Set(plot.legend.map((i) => i.name));
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

	// Reset legend hides + search when the dataset changes (lastDatasetId is a plain
	// variable so reading it doesn't re-trigger the effect).
	let lastDatasetId;
	$effect(() => {
		const id = $currentDatasetStore?.id;
		if (id !== lastDatasetId) {
			lastDatasetId = id;
			hiddenSpecies = new Set();
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

	let panning = false;
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
			{#if hiddenSpecies.size > 0}
				· <span class="text-gray-400">{hiddenSpecies.size} hidden</span>
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
					<!-- Basemap -->
					<path
						d={outlinePath}
						fill="#d1fae5"
						fill-opacity="0.5"
						stroke="#10b981"
						stroke-width={thinStroke}
						class="dark:fill-emerald-900/30"
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
							fill-opacity="0.85"
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
							{hovered.recordedBy || '—'}{hovered.recordNumber ? ` ${hovered.recordNumber}` : ''}
						</div>
					</div>
				{/if}
			{/if}
		</div>

		<!-- Legend (click a species to show/hide its points on the map) -->
		{#if plot.legend.length > 0}
			<div
				class="flex w-56 shrink-0 flex-col rounded-lg border border-gray-200 p-3 text-xs dark:border-gray-700"
			>
				<div class="mb-2 flex items-center justify-between">
					<h3 class="font-semibold uppercase text-gray-500 dark:text-gray-400">Species</h3>
					<button
						type="button"
						onclick={allHidden ? showAllSpecies : hideAllSpecies}
						class="cursor-pointer text-emerald-700 hover:underline dark:text-emerald-400"
					>
						{allHidden ? 'Show all' : 'Hide all'}
					</button>
				</div>
				<ul class="flex flex-col gap-1 overflow-y-auto">
					{#each plot.legend as item (item.name)}
						{@const hidden = hiddenSpecies.has(item.name)}
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
									{item.name}{item.undetermined ? ' (indet.)' : ''}
								</span>
							</button>
						</li>
					{/each}
				</ul>
			</div>
		{:else if plot.tooMany}
			<div class="w-56 shrink-0 rounded-lg border border-gray-200 p-3 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
				{plot.speciesCount} species shown — too many to colour-code. Filter to {PALETTE_SIZE} or fewer
				species (sidebar) to see distinct colours and a legend.
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
