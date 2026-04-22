<script>
	import { datasets } from '$lib/datasets.js';
	import { currentDatasetStore, setDataset } from '$lib/stores/dataset.js';

	function handleChange(e) {
		setDataset(e.target.value);
	}
</script>

{#if datasets.length <= 2}
	<div class="inline-flex w-full rounded-md border border-gray-300 bg-white p-0.5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
		{#each datasets as ds (ds.id)}
			<button
				type="button"
				onclick={() => setDataset(ds.id)}
				class="flex-1 cursor-pointer rounded px-2 py-1 text-xs font-medium transition-colors {$currentDatasetStore?.id === ds.id
					? 'bg-emerald-600 text-white'
					: 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'}"
				aria-pressed={$currentDatasetStore?.id === ds.id}
			>
				{ds.label}
			</button>
		{/each}
	</div>
{:else}
	<select
		value={$currentDatasetStore?.id ?? ''}
		onchange={handleChange}
		class="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
		aria-label="Select dataset"
	>
		{#each datasets as ds (ds.id)}
			<option value={ds.id}>{ds.label}</option>
		{/each}
	</select>
{/if}
