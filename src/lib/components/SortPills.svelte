<script>
	import { sortStore, taxaStore } from '$lib/stores/taxa.js';

	const SORTS = [
		{ id: 'name', label: 'Name' },
		{ id: 'family', label: 'Family' },
		{ id: 'order', label: 'Order' }
	];

	function isVisible(id, $taxa) {
		if (id === 'name') return true;
		if (!$taxa) return true;
		if (id === 'family') return $taxa.allFamilies.length > 1;
		if (id === 'order') return $taxa.allOrders.length > 1;
		return true;
	}

	// If a dataset switch hides the active sort mode, fall back to 'name'.
	$effect(() => {
		if (!$taxaStore) return;
		if (!isVisible($sortStore, $taxaStore)) {
			sortStore.set('name');
		}
	});
</script>

<div class="flex flex-wrap gap-1.5">
	{#each SORTS as s (s.id)}
		{#if isVisible(s.id, $taxaStore)}
			{@const active = $sortStore === s.id}
			<button
				type="button"
				onclick={() => sortStore.set(s.id)}
				aria-pressed={active}
				class="cursor-pointer rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors {active
					? 'bg-emerald-600 text-white'
					: 'border border-gray-300 bg-white text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'}"
			>
				{s.label}
			</button>
		{/if}
	{/each}
</div>
