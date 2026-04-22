<script>
	import { filterStore } from '$lib/stores/taxa.js';

	const HABITS = [
		{ id: 'tree', label: 'Tree' },
		{ id: 'shrub', label: 'Shrub' },
		{ id: 'herb', label: 'Herb' },
		{ id: 'liana', label: 'Liana' },
		{ id: 'epiphyte', label: 'Epiphyte' }
	];

	function toggle(id) {
		filterStore.update((f) => {
			const current = f.habits ?? [];
			const next = current.includes(id) ? current.filter((h) => h !== id) : [...current, id];
			return { ...f, habits: next };
		});
	}
</script>

<div class="flex flex-wrap gap-1.5">
	{#each HABITS as h (h.id)}
		{@const active = ($filterStore.habits ?? []).includes(h.id)}
		<button
			type="button"
			onclick={() => toggle(h.id)}
			aria-pressed={active}
			class="cursor-pointer rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors {active
				? 'bg-emerald-600 text-white'
				: 'border border-gray-300 bg-white text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'}"
		>
			{h.label}
		</button>
	{/each}
</div>
