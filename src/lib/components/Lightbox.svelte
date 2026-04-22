<script>
	import { onMount, onDestroy } from 'svelte';

	let { images = [], startIndex = 0, folderHandle = null, speciesName = '', onClose = () => {} } = $props();

	let currentIndex = $state(0);

	$effect(() => {
		currentIndex = startIndex;
	});
	let imgSrc = $state(null);
	let loading = $state(true);
	let overlayEl;
	let objectUrls = [];

	// Zoom & pan state
	const ZOOM_STEPS = [1, 1.5, 2, 3, 4, 6, 8, 10];
	let scale = $state(1);
	let translateX = $state(0);
	let translateY = $state(0);
	let isPanning = $state(false);
	let panStartX = 0;
	let panStartY = 0;
	let lastTranslateX = 0;
	let lastTranslateY = 0;
	let displayedWidth = $state(0);
	let displayedHeight = $state(0);
	let viewportWidth = $state(0);
	let viewportHeight = $state(0);

	const currentCatalogue = $derived(images[currentIndex] || '');
	const zoomLabel = $derived(scale === 1 ? '1×' : scale % 1 === 0 ? `${scale}×` : `${scale}×`);
	const isZoomed = $derived(scale > 1);

	onMount(() => {
		overlayEl?.focus();
	});

	onDestroy(() => {
		for (const url of objectUrls) {
			URL.revokeObjectURL(url);
		}
	});

	$effect(() => {
		// Load image and reset zoom whenever currentIndex changes
		void currentIndex;
		resetZoom();
		loadCurrentImage();
	});

	async function loadCurrentImage() {
		if (!folderHandle || !images[currentIndex]) {
			imgSrc = null;
			loading = false;
			return;
		}
		loading = true;
		imgSrc = null;
		try {
			const fileHandle = await folderHandle.getFileHandle(`${images[currentIndex]}.jpg`);
			const file = await fileHandle.getFile();
			const url = URL.createObjectURL(file);
			objectUrls.push(url);
			imgSrc = url;
		} catch {
			imgSrc = null;
		}
		loading = false;
	}

	function resetZoom() {
		scale = 1;
		translateX = 0;
		translateY = 0;
	}

	function zoomIn() {
		const idx = ZOOM_STEPS.indexOf(scale);
		if (idx < ZOOM_STEPS.length - 1) {
			scale = ZOOM_STEPS[idx + 1];
		}
		clampTranslate();
	}

	function zoomOut() {
		const idx = ZOOM_STEPS.indexOf(scale);
		if (idx > 0) {
			scale = ZOOM_STEPS[idx - 1];
		}
		if (scale === 1) {
			translateX = 0;
			translateY = 0;
		}
		clampTranslate();
	}

	function clampTranslate() {
		const maxPanX = Math.max(0, (displayedWidth * scale - viewportWidth) / 2);
		const maxPanY = Math.max(0, (displayedHeight * scale - viewportHeight) / 2);
		translateX = Math.max(-maxPanX, Math.min(maxPanX, translateX));
		translateY = Math.max(-maxPanY, Math.min(maxPanY, translateY));
	}

	function handleWheel(e) {
		e.preventDefault();
		if (e.deltaY < 0) zoomIn();
		else zoomOut();
	}

	function handleDblClick() {
		if (scale === 1) {
			scale = 2;
		} else {
			resetZoom();
		}
	}

	function handlePointerDown(e) {
		if (scale <= 1) return;
		isPanning = true;
		panStartX = e.clientX;
		panStartY = e.clientY;
		lastTranslateX = translateX;
		lastTranslateY = translateY;
		e.currentTarget.setPointerCapture(e.pointerId);
	}

	function handlePointerMove(e) {
		if (!isPanning) return;
		translateX = lastTranslateX + (e.clientX - panStartX);
		translateY = lastTranslateY + (e.clientY - panStartY);
		clampTranslate();
	}

	function handlePointerUp() {
		isPanning = false;
	}

	function prev() {
		if (currentIndex > 0) currentIndex--;
	}

	function next() {
		if (currentIndex < images.length - 1) currentIndex++;
	}

	function handleKeydown(e) {
		if (e.key === 'Escape') onClose();
		else if (e.key === 'ArrowLeft') prev();
		else if (e.key === 'ArrowRight') next();
		else if (e.key === '+' || e.key === '=') zoomIn();
		else if (e.key === '-') zoomOut();
		else if (e.key === '0') resetZoom();
	}

	function handleOverlayClick(e) {
		if (e.target === overlayEl) onClose();
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	bind:this={overlayEl}
	class="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
	onclick={handleOverlayClick}
	onkeydown={handleKeydown}
	tabindex="0"
	role="dialog"
	aria-label="Image lightbox for {speciesName}"
	aria-modal="true"
>
	<!-- Close button -->
	<button
		onclick={onClose}
		class="absolute top-4 right-4 z-10 cursor-pointer rounded-full bg-white/20 p-2 text-white hover:bg-white/30 focus:ring-2 focus:ring-white focus:outline-none"
		aria-label="Close lightbox"
	>
		<svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
		</svg>
	</button>

	<!-- Header info -->
	<div class="absolute top-4 left-4 z-10 text-white">
		<p class="font-species text-sm font-semibold">{speciesName}</p>
		<p class="text-xs text-white/70">
			{currentIndex + 1} / {images.length} &mdash; {currentCatalogue}
		</p>
	</div>

	<!-- Previous button -->
	{#if currentIndex > 0}
		<button
			onclick={prev}
			class="absolute left-4 z-10 cursor-pointer rounded-full bg-white/20 p-3 text-white hover:bg-white/30 focus:ring-2 focus:ring-white focus:outline-none"
			aria-label="Previous image"
		>
			<svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
			</svg>
		</button>
	{/if}

	<!-- Image -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="flex h-[85vh] w-[90vw] items-center justify-center overflow-hidden"
		onwheel={handleWheel}
		bind:clientWidth={viewportWidth}
		bind:clientHeight={viewportHeight}
	>
		{#if loading}
			<div class="h-10 w-10 animate-spin rounded-full border-4 border-white/30 border-t-white"></div>
		{:else if imgSrc}
			<img
				src={imgSrc}
				alt="{speciesName} — {currentCatalogue}"
				class="max-h-[85vh] max-w-[90vw] select-none"
				class:transition-transform={!isPanning}
				class:duration-150={!isPanning}
				class:ease-out={!isPanning}
				class:cursor-zoom-in={!isZoomed}
				class:cursor-grab={isZoomed && !isPanning}
				class:cursor-grabbing={isPanning}
				style="transform: translate({translateX}px, {translateY}px) scale({scale})"
				bind:clientWidth={displayedWidth}
				bind:clientHeight={displayedHeight}
				ondblclick={handleDblClick}
				onpointerdown={handlePointerDown}
				onpointermove={handlePointerMove}
				onpointerup={handlePointerUp}
				onpointercancel={handlePointerUp}
				draggable="false"
			/>
		{:else}
			<p class="text-white/60">Image not available</p>
		{/if}
	</div>

	<!-- Next button -->
	{#if currentIndex < images.length - 1}
		<button
			onclick={next}
			class="absolute right-4 z-10 cursor-pointer rounded-full bg-white/20 p-3 text-white hover:bg-white/30 focus:ring-2 focus:ring-white focus:outline-none"
			aria-label="Next image"
		>
			<svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
			</svg>
		</button>
	{/if}

	<!-- Zoom controls -->
	<div class="absolute right-4 bottom-4 z-10 flex flex-col items-center gap-1">
		<button
			onclick={zoomIn}
			disabled={scale === ZOOM_STEPS[ZOOM_STEPS.length - 1]}
			class="cursor-pointer rounded-full bg-white/20 p-2 text-white hover:bg-white/30 focus:ring-2 focus:ring-white focus:outline-none disabled:cursor-default disabled:opacity-30"
			aria-label="Zoom in"
		>
			<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v12M6 12h12" />
			</svg>
		</button>

		<span class="min-w-[2.5rem] rounded bg-black/50 px-1.5 py-0.5 text-center text-xs font-medium text-white/80">
			{zoomLabel}
		</span>

		<button
			onclick={zoomOut}
			disabled={scale === 1}
			class="cursor-pointer rounded-full bg-white/20 p-2 text-white hover:bg-white/30 focus:ring-2 focus:ring-white focus:outline-none disabled:cursor-default disabled:opacity-30"
			aria-label="Zoom out"
		>
			<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 12h12" />
			</svg>
		</button>

		{#if isZoomed}
			<button
				onclick={resetZoom}
				class="mt-1 cursor-pointer rounded-full bg-white/20 p-2 text-white hover:bg-white/30 focus:ring-2 focus:ring-white focus:outline-none"
				aria-label="Reset zoom"
			>
				<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h5M20 20v-5h-5M4 9a9 9 0 0 1 15.36-5.36M20 15a9 9 0 0 1-15.36 5.36" />
				</svg>
			</button>
		{/if}
	</div>
</div>
