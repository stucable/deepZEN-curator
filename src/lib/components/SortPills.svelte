<script>
	import { sortStore } from '$lib/stores/taxa.js';

	const SORTS = [
		{ id: 'name', label: 'Name' },
		{ id: 'family', label: 'Family' },
		{ id: 'order', label: 'Order' }
	];
</script>

<div class="flex flex-wrap gap-1.5">
	{#each SORTS as s (s.id)}
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
	{/each}
</div>
