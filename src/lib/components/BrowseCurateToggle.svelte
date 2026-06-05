<script>
	import { viewModeStore } from '$lib/stores/view.js';

	const MODES = [
		{ id: 'browse', label: 'Browse' },
		{ id: 'curate', label: 'Curate' }
	];
</script>

<div class="inline-flex w-full rounded-md border border-gray-300 bg-white p-0.5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
	{#each MODES as m (m.id)}
		<button
			type="button"
			onclick={() => viewModeStore.set(m.id)}
			class="flex-1 cursor-pointer rounded px-2 py-1 text-xs font-medium transition-colors {$viewModeStore === m.id
				? 'bg-emerald-600 text-white'
				: 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'}"
			aria-pressed={$viewModeStore === m.id}
		>
			{m.label}
		</button>
	{/each}
</div>
