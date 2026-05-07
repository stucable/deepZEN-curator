<script>
	import { onMount, onDestroy } from 'svelte';
	import { currentDatasetStore } from '$lib/stores/dataset.js';
	import { loadThumbnail } from '$lib/utils/thumbnails.js';

	let { catalogueNumber, folderHandle = null, onclick = () => {} } = $props();

	let imgSrc = $state(null);
	let error = $state(false);
	let loading = $state(false);
	let visible = $state(false);
	let containerEl;
	let observer;
	let objectUrl = null;
	let loadGeneration = 0;

	onMount(() => {
		observer = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting) {
					visible = true;
					observer.disconnect();
				}
			},
			{ rootMargin: '200px' }
		);
		observer.observe(containerEl);
	});

	onDestroy(() => {
		loadGeneration++;
		observer?.disconnect();
		clearImageUrl();
	});

	$effect(() => {
		const datasetId = $currentDatasetStore?.id;
		const folder = folderHandle;
		const cat = catalogueNumber;
		const generation = ++loadGeneration;

		clearImageUrl();
		error = false;
		loading = false;

		if (visible && folder && datasetId && cat) {
			loadImage({ folder, datasetId, cat, generation });
		}
	});

	function clearImageUrl() {
		if (objectUrl) {
			URL.revokeObjectURL(objectUrl);
			objectUrl = null;
		}
		imgSrc = null;
	}

	function isCurrentLoad(generation) {
		return generation === loadGeneration;
	}

	async function loadImage({ folder, datasetId, cat, generation }) {
		loading = true;
		try {
			const blob = await loadThumbnail(folder, datasetId, cat);
			const url = URL.createObjectURL(blob);
			if (!isCurrentLoad(generation)) {
				URL.revokeObjectURL(url);
				return;
			}
			objectUrl = url;
			imgSrc = url;
		} catch {
			if (!isCurrentLoad(generation)) return;
			error = true;
			console.warn(`Image not found: ${cat}.jpg`);
		} finally {
			if (isCurrentLoad(generation)) {
				loading = false;
			}
		}
	}
</script>

<button
	bind:this={containerEl}
	type="button"
	class="relative h-48 w-48 shrink-0 cursor-pointer overflow-hidden rounded border border-gray-200 bg-gray-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800"
	onclick={onclick}
	aria-label="View {catalogueNumber}"
>
	{#if imgSrc}
		<img
			src={imgSrc}
			alt={catalogueNumber}
			decoding="async"
			class="h-full w-full object-cover"
		/>
	{:else if error}
		<!-- File not found -->
		<div class="flex h-full w-full flex-col items-center justify-center text-gray-400 dark:text-gray-500">
			<svg class="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01" />
			</svg>
			<span class="mt-1 text-xs">Not found</span>
		</div>
	{:else if !folderHandle}
		<!-- No folder selected -->
		<div class="flex h-full w-full flex-col items-center justify-center text-gray-300 dark:text-gray-600">
			<svg class="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M18.364 5.636l-12.728 12.728" />
			</svg>
			<span class="mt-1 text-xs">No folder</span>
		</div>
	{:else if loading}
		<!-- Loading placeholder -->
		<div class="flex h-full w-full items-center justify-center">
			<div class="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-emerald-500 dark:border-gray-600 dark:border-t-emerald-400"></div>
		</div>
	{:else}
		<div class="h-full w-full bg-gray-100 dark:bg-gray-800"></div>
	{/if}
</button>
