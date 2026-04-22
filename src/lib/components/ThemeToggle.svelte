<script>
	import { themeStore, setTheme } from '$lib/stores/theme.js';

	const OPTIONS = [
		{ id: 'light', label: 'Light' },
		{ id: 'dark', label: 'Dark' },
		{ id: 'system', label: 'System' }
	];
</script>

<div class="inline-flex w-full rounded-md border border-gray-300 bg-white p-0.5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
	{#each OPTIONS as opt (opt.id)}
		{@const active = $themeStore === opt.id}
		<button
			type="button"
			onclick={() => setTheme(opt.id)}
			aria-pressed={active}
			class="flex flex-1 cursor-pointer items-center justify-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors {active
				? 'bg-emerald-600 text-white'
				: 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'}"
		>
			{#if opt.id === 'light'}
				<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<circle cx="12" cy="12" r="4" stroke-width="1.8" />
					<path stroke-linecap="round" stroke-width="1.8" d="M12 3v1.5M12 19.5V21M3 12h1.5M19.5 12H21M5.6 5.6l1 1M17.4 17.4l1 1M5.6 18.4l1-1M17.4 6.6l1-1" />
				</svg>
			{:else if opt.id === 'dark'}
				<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
				</svg>
			{:else}
				<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<rect x="3" y="4" width="18" height="12" rx="1.5" stroke-width="1.8" />
					<path stroke-linecap="round" stroke-width="1.8" d="M8 20h8M12 16v4" />
				</svg>
			{/if}
			{opt.label}
		</button>
	{/each}
</div>
