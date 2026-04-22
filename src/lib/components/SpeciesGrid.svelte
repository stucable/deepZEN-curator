<script>
	import { taxaStore } from '$lib/stores/taxa.js';
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
		No species match the current filters.
	</div>
{:else}
	<div class="flex flex-col gap-4">
		{#each species as sp (sp.taxonomicName)}
			<SpeciesCard species={sp} />
		{/each}
	</div>
{/if}
