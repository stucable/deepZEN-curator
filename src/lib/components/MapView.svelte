<script>
	import { taxaStore, filteredSpecies } from '$lib/stores/taxa.js';
	import { selectionPolygonStore, clearSelection } from '$lib/stores/map.js';
	import {
		MADAGASCAR_BBOX,
		projectedExtent,
		projectLngLat,
		unprojectXY,
		inBbox
	} from '$lib/utils/geo.js';
	import { MADAGASCAR_OUTLINE } from '$lib/data/madagascar.js';
	import { colourForIndex, PALETTE_SIZE } from '$lib/utils/palette.js';
	import SpecimenEditModal from './SpecimenEditModal.svelte';

	// Single emerald used when too many species are shown to colour-code legibly.
	const FALLBACK_COLOUR = '#059669';

	// Projection extent is constant — the viewBox starts framing the whole island
	// and is then mutated by zoom/pan. y grows downward (SVG convention).
	const ext = projectedExtent();
	const base = { x: 0, y: 0, w: ext.width, h: ext.height };
	let viewBox = $state({ ...base });
	const viewBoxStr = $derived(`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);

	// Keep point radius / stroke roughly constant on screen as the user zooms.
	const pointRadius = $derived(viewBox.w * 0.0095);
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
		if (!$taxaStore) return { points: [], legend: [], offMap: 0, tooMany: false };

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
		// legend is dense (no colours wasted on point-less species).
		const present = new Set(inView.map((s) => s.currentDetermination));
		const orderedKeys = $filteredSpecies
			.map((s) => s.taxonomicName)
			.filter((k) => present.has(k));

		const tooMany = orderedKeys.length > PALETTE_SIZE;
		const colourByKey = new Map();
		orderedKeys.forEach((k, i) => colourByKey.set(k, tooMany ? FALLBACK_COLOUR : colourForIndex(i)));

		const points = inView.map((s) => {
			const { x, y } = projectLngLat(s.lng, s.lat);
			return { x, y, colour: colourByKey.get(s.currentDetermination), specimen: s };
		});
		// Catalogue → specimen lookup so a pointerdown's target (which carries
		// data-cat) resolves back to the specimen for tap-to-open.
		const byCat = new Map(inView.map((s) => [s.catalogueNumber, s]));

		const legend = tooMany
			? []
			: orderedKeys.map((k) => ({ name: k, colour: colourByKey.get(k) }));

		return { points, byCat, legend, offMap, tooMany, speciesCount: orderedKeys.length };
	});

	// ---- Hover tooltip -------------------------------------------------------
	let hovered = $state(null); // specimen or null
	let tipPos = $state({ x: 0, y: 0 });

	function showTip(specimen, e) {
		if (drawing) return;
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
	// Pixels the pointer must travel before a press becomes a pan (not a tap).
	const PAN_THRESHOLD = 4;

	function specimenForTarget(target) {
		const cat = target?.getAttribute?.('data-cat');
		return cat ? plot.byCat.get(cat) : null;
	}

	function onPointerDown(e) {
		pressedSpecimen = null;
		if (drawing) return; // clicks add vertices instead
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
		const dxPx = e.clientX - panStart.cx;
		const dyPx = e.clientY - panStart.cy;
		if (!panning && Math.hypot(dxPx, dyPx) < PAN_THRESHOLD) return;
		panning = true;
		pressedSpecimen = null; // a drag is not a tap
		const dx = (dxPx * viewBox.w) / panStart.rect.width;
		const dy = (dyPx * viewBox.h) / panStart.rect.height;
		viewBox = { ...viewBox, x: panStart.vbx - dx, y: panStart.vby - dy };
	}
	function onPointerUp() {
		// Modal opening happens in onSvgClick (the click phase), not here: opening it
		// on pointerup lets the trailing `click` land on the freshly-rendered backdrop
		// and close it again. pressedSpecimen is carried through to the click.
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

		<span class="ml-auto text-xs text-gray-500 dark:text-gray-400">
			{plot.points.length} points · {plot.speciesCount ?? 0} species
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
					class="h-full w-full {drawing ? 'cursor-crosshair' : panning ? 'cursor-grabbing' : 'cursor-grab'}"
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

					<!-- Specimen points. Click handling lives on the svg (pointerdown +
					     pointerup) via data-cat, not on the circle's own click. -->
					{#each plot.points as p, i (i)}
						<circle
							cx={p.x}
							cy={p.y}
							r={pointRadius}
							fill={p.colour}
							fill-opacity="0.85"
							stroke="#1f2937"
							stroke-width={thinStroke}
							data-cat={p.specimen.catalogueNumber}
							style:pointer-events={drawing ? 'none' : 'auto'}
							class={drawing ? '' : 'cursor-pointer'}
							role="button"
							aria-label={`${p.specimen.currentDetermination} ${p.specimen.catalogueNumber}`}
							onmouseenter={(e) => showTip(p.specimen, e)}
							onmousemove={moveTip}
							onmouseleave={hideTip}
						/>
					{/each}
				</svg>

				<!-- Tooltip -->
				{#if hovered}
					<div
						class="pointer-events-none absolute z-10 max-w-xs rounded-md border border-gray-300 bg-white/95 px-3 py-2 text-xs shadow-lg dark:border-gray-600 dark:bg-gray-800/95"
						style:left="{tipPos.x}px"
						style:top="{tipPos.y}px"
					>
						<div class="font-species text-sm text-gray-900 dark:text-gray-100">
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

		<!-- Legend -->
		{#if plot.legend.length > 0}
			<div
				class="w-56 shrink-0 overflow-y-auto rounded-lg border border-gray-200 p-3 text-xs dark:border-gray-700"
			>
				<h3 class="mb-2 font-semibold uppercase text-gray-500 dark:text-gray-400">Species</h3>
				<ul class="flex flex-col gap-1">
					{#each plot.legend as item (item.name)}
						<li class="flex items-center gap-2">
							<span
								class="inline-block size-3 shrink-0 rounded-full border border-gray-700"
								style:background-color={item.colour}
							></span>
							<span class="font-species text-gray-800 dark:text-gray-200">{item.name}</span>
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
	<SpecimenEditModal specimen={editing} onClose={() => (editing = null)} />
{/if}
