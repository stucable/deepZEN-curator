<script>
	import { folderHandleStore } from '$lib/stores/folder.js';
	import HerbariumImage from './HerbariumImage.svelte';
	import Lightbox from './Lightbox.svelte';

	let { species } = $props();
	let lightboxIndex = $state(null);

	function openLightbox(index) {
		lightboxIndex = index;
	}

	function closeLightbox() {
		lightboxIndex = null;
	}
</script>

<article class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition-shadow duration-150 hover:border-gray-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600">
	<div class="mb-2">
		<h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
			<span class="font-species">{species.taxonomicName}</span>
		</h2>
		<p class="text-sm text-gray-500 dark:text-gray-400">
			Family: {species.family}{#if species.vernacularName} &nbsp;|&nbsp; Vernacular name: {species.vernacularName}{/if}
		</p>
	</div>

	<div class="flex flex-wrap gap-2">
		{#each species.images as cat, i}
			<HerbariumImage
				catalogueNumber={cat}
				folderHandle={$folderHandleStore}
				onclick={() => openLightbox(i)}
			/>
		{/each}
	</div>
</article>

{#if lightboxIndex !== null}
	<Lightbox
		images={species.images}
		startIndex={lightboxIndex}
		folderHandle={$folderHandleStore}
		speciesName={species.taxonomicName}
		onClose={closeLightbox}
	/>
{/if}
