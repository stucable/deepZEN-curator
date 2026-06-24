<script>
	import { taxaStore } from '$lib/stores/taxa.js';
	import { selectionPolygonStore, includeUnlocatedStore, clearSelection, hiddenSpeciesStore, showAllSpecies } from '$lib/stores/map.js';
	import SpeciesCard from './SpeciesCard.svelte';

	let { species = [] } = $props();
</script>

{#if $taxaStore === null}
	<div class="flex items-center justify-center py-20">
		<div class="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-emerald-600 dark:border-gray-600"></div>
		<span class="ml-3 text-gray-500 dark:text-gray-400">Loading species data…</span>
	</div>
{:else if species.length === 0}
	<div class="py-20 text-center text-gray-400 dark:text-gray-500">
		{#if $selectionPolygonStore && !$includeUnlocatedStore}
			<p>No specimen images with coordinates fall inside the selected region.</p>
			<p class="mt-1">The species here are imaged only on specimens without coordinates.</p>
			<button
				type="button"
				onclick={() => includeUnlocatedStore.set(true)}
				class="mt-3 cursor-pointer rounded border border-emerald-600 px-3 py-1 text-sm font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950"
			>
				Include specimens without coordinates
			</button>
			<button
				type="button"
				onclick={clearSelection}
				class="mt-3 ml-2 cursor-pointer text-sm text-gray-500 underline hover:text-gray-700 dark:hover:text-gray-300"
			>
				Clear region
			</button>
		{:else if $selectionPolygonStore}
			<p>No specimen images fall inside the selected region.</p>
			<button
				type="button"
				onclick={clearSelection}
				class="mt-3 cursor-pointer rounded border border-amber-500 px-3 py-1 text-sm font-medium text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950"
			>
				Clear region
			</button>
		{:else if $hiddenSpeciesStore.size > 0 && !$includeUnlocatedStore}
			<p>No species with coordinates remain after your map selection.</p>
			<p class="mt-1">The remaining species are imaged only on specimens without coordinates.</p>
			<button
				type="button"
				onclick={() => includeUnlocatedStore.set(true)}
				class="mt-3 cursor-pointer rounded border border-emerald-600 px-3 py-1 text-sm font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950"
			>
				Include species without coordinates
			</button>
			<button
				type="button"
				onclick={showAllSpecies}
				class="mt-3 ml-2 cursor-pointer text-sm text-gray-500 underline hover:text-gray-700 dark:hover:text-gray-300"
			>
				Show all species
			</button>
		{:else}
			No species match the current filters.
		{/if}
	</div>
{:else}
	<div class="flex flex-col gap-4">
		{#each species as sp (sp.taxonomicName)}
			<SpeciesCard species={sp} />
		{/each}
	</div>
{/if}
