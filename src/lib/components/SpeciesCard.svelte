<script>
	import { folderHandleStore } from '$lib/stores/folder.js';
	import { typeStatusByImageFile } from '$lib/stores/taxa.js';
	import { openImageViewer } from '$lib/utils/viewerWindow.js';
	import HerbariumImage from './HerbariumImage.svelte';

	let { species } = $props();

	function openViewer(index) {
		openImageViewer({
			images: species.images,
			startIndex: index,
			speciesName: species.taxonomicName
		});
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
			<div class="relative">
				<HerbariumImage
					catalogueNumber={cat}
					folderHandle={$folderHandleStore}
					onclick={() => openViewer(i)}
					isType={$typeStatusByImageFile.has(cat)}
				/>
				{#if $typeStatusByImageFile.has(cat)}
					<span
						class="pointer-events-none absolute left-1 top-1 rounded bg-emerald-600/90 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white shadow"
						title={$typeStatusByImageFile.get(cat)}
					>
						Type
					</span>
				{/if}
			</div>
		{/each}
	</div>
</article>
