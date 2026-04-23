<script>
	import { taxaStore, taxaSourceStore, taxaSourceFilenameStore, csvLoadErrorStore, filterStore, filteredSpecies, totalSpeciesCount, availableFamilies, availableGenera, vernacularOptions, filterOptionCounts, DEFAULT_HABITS } from '$lib/stores/taxa.js';
	import { folderHandleStore, pendingFolderHandleStore, selectFolder, reconnectFolder } from '$lib/stores/folder.js';
	import { currentDatasetStore } from '$lib/stores/dataset.js';
	import { VERSION } from '$lib/version.js';
	import DatasetSelector from './DatasetSelector.svelte';
	import HabitPills from './HabitPills.svelte';
	import ThemeToggle from './ThemeToggle.svelte';

	function handleOrderChange(e) {
		filterStore.update((f) => ({
			...f,
			order: e.target.value,
			family: '', // reset family and genus when order changes
			genus: ''
		}));
	}

	function handleFamilyChange(e) {
		filterStore.update((f) => ({
			...f,
			family: e.target.value,
			genus: '' // reset genus when family changes
		}));
	}

	function handleGenusChange(e) {
		filterStore.update((f) => ({ ...f, genus: e.target.value }));
	}

	function handleTraitChange(field) {
		return (e) => {
			filterStore.update((f) => ({ ...f, [field]: e.target.value }));
		};
	}

	function clearFilters() {
		filterStore.set({
			order: '',
			family: '',
			genus: '',
			vernacular: '',
			habits: [...DEFAULT_HABITS],
			leafArrangement: '',
			leafForm: '',
			leafVenation: '',
			leafMargin: '',
			stipules: '',
			exudate: '',
			stemArmature: '',
			tendrils: ''
		});
	}

	function pickFolder() {
		const id = $currentDatasetStore?.id;
		if (id) selectFolder(id);
	}

	function reconnect() {
		const id = $currentDatasetStore?.id;
		if (id) reconnectFolder(id);
	}
</script>

<div class="flex flex-col gap-4">
	<h1 class="text-xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
		deepZEN-curator <span class="text-sm font-normal text-gray-400 dark:text-gray-500">{VERSION}</span>
	</h1>

	<!-- Dataset selector -->
	<div>
		<h2 class="mb-1 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Dataset</h2>
		<DatasetSelector />
	</div>

	<!-- Theme toggle -->
	<div>
		<h2 class="mb-1 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Appearance</h2>
		<ThemeToggle />
	</div>

	<hr class="border-gray-200 dark:border-gray-700" />

	<!-- Folder picker -->
	<div>
		{#if $pendingFolderHandleStore && !$folderHandleStore}
			<button
				onclick={reconnect}
				class="w-full cursor-pointer rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
				title="Reconnect to previously used folder"
			>
				Reconnect to {$pendingFolderHandleStore.name}
			</button>
			<button
				onclick={pickFolder}
				class="mt-1 w-full cursor-pointer rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
			>
				Choose a different folder
			</button>
		{:else}
			<button
				onclick={pickFolder}
				class="w-full cursor-pointer rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
			>
				Select image folder
			</button>
		{/if}
		{#if $folderHandleStore}
			<div class="mt-1 flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
				<span class="inline-block h-2 w-2 rounded-full bg-emerald-500"></span>
				{$folderHandleStore.name}
			</div>
			{#if $taxaSourceStore === 'custom'}
				<div class="mt-0.5 pl-3 text-xs text-emerald-700 dark:text-emerald-400">
					Using <code class="font-mono break-all">{$taxaSourceFilenameStore}</code> from this folder
				</div>
			{:else if $taxaSourceStore === 'shipped'}
				<div class="mt-0.5 pl-3 text-xs text-gray-500 dark:text-gray-400">
					Using shipped data
				</div>
			{/if}
		{:else}
			<div class="mt-1 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
				<span class="inline-block h-2 w-2 rounded-full bg-amber-400"></span>
				No folder selected
			</div>
		{/if}
		{#if $csvLoadErrorStore}
			<div class="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
				Could not parse <code class="font-mono">{$csvLoadErrorStore.filename}</code> — {$csvLoadErrorStore.reason}. Still showing the previous data.
			</div>
		{/if}
	</div>

	<hr class="border-gray-200 dark:border-gray-700" />

	<h2 class="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Filters</h2>

	<!-- Order filter -->
	<div>
		<label for="order-filter" class="mb-1 block text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
			Order
		</label>
		<select
			id="order-filter"
			value={$filterStore.order}
			onchange={handleOrderChange}
			class="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
		>
			<option value="">All orders</option>
			{#if $taxaStore}
				{#each $taxaStore.allOrders as ord}
					<option value={ord}>{ord} ({$filterOptionCounts.order[ord] ?? 0})</option>
				{/each}
			{/if}
		</select>
	</div>

	<!-- Family filter -->
	<div>
		<label for="family-filter" class="mb-1 block text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
			Family
		</label>
		<select
			id="family-filter"
			value={$filterStore.family}
			onchange={handleFamilyChange}
			class="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
		>
			<option value="">All families</option>
			{#each $availableFamilies as fam}
				<option value={fam}>{fam} ({$filterOptionCounts.family[fam] ?? 0})</option>
			{/each}
		</select>
	</div>

	<!-- Genus filter -->
	<div>
		<label for="genus-filter" class="mb-1 block text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
			Genus
		</label>
		<select
			id="genus-filter"
			value={$filterStore.genus}
			onchange={handleGenusChange}
			class="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
		>
			<option value="">All genera</option>
			{#each $availableGenera as gen}
				<option value={gen}>{gen} ({$filterOptionCounts.genus[gen] ?? 0})</option>
			{/each}
		</select>
	</div>

	<!-- Vernacular name filter -->
	<div>
		<label for="vernacular-filter" class="mb-1 block text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
			Vernacular name
		</label>
		<input
			id="vernacular-filter"
			type="text"
			list="vernacular-options"
			value={$filterStore.vernacular}
			oninput={handleTraitChange('vernacular')}
			placeholder="Type to search…"
			class="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
		/>
		<datalist id="vernacular-options">
			{#each $vernacularOptions as name}
				<option value={name}></option>
			{/each}
		</datalist>
	</div>

	<!-- Habit filter -->
	<div>
		<span class="mb-1 block text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Habit</span>
		<HabitPills />
	</div>

	<!-- Leaf arrangement filter -->
	<div>
		<label for="leaf-arrangement-filter" class="mb-1 block text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
			Leaf arrangement
		</label>
		<select
			id="leaf-arrangement-filter"
			value={$filterStore.leafArrangement}
			onchange={handleTraitChange('leafArrangement')}
			class="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
		>
			<option value="">All arrangements</option>
			{#if $taxaStore}
				{#each $taxaStore.allLeafArrangements as la}
					<option value={la}>{la} ({$filterOptionCounts.leafArrangement[la] ?? 0})</option>
				{/each}
			{/if}
		</select>
	</div>

	<!-- Leaf form filter -->
	<div>
		<label for="leaf-form-filter" class="mb-1 block text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
			Leaf form
		</label>
		<select
			id="leaf-form-filter"
			value={$filterStore.leafForm}
			onchange={handleTraitChange('leafForm')}
			class="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
		>
			<option value="">All forms</option>
			{#if $taxaStore}
				{#each $taxaStore.allLeafForms as lf}
					<option value={lf}>{lf} ({$filterOptionCounts.leafForm[lf] ?? 0})</option>
				{/each}
			{/if}
		</select>
	</div>

	<!-- Leaf venation filter -->
	<div>
		<label for="leaf-venation-filter" class="mb-1 block text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
			Leaf venation
		</label>
		<select
			id="leaf-venation-filter"
			value={$filterStore.leafVenation}
			onchange={handleTraitChange('leafVenation')}
			class="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
		>
			<option value="">All venations</option>
			{#if $taxaStore}
				{#each $taxaStore.allLeafVenations as lv}
					<option value={lv}>{lv} ({$filterOptionCounts.leafVenation[lv] ?? 0})</option>
				{/each}
			{/if}
		</select>
	</div>

	<!-- Leaf margin filter -->
	<div>
		<label for="leaf-margin-filter" class="mb-1 block text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
			Leaf margin
		</label>
		<select
			id="leaf-margin-filter"
			value={$filterStore.leafMargin}
			onchange={handleTraitChange('leafMargin')}
			class="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
		>
			<option value="">All margins</option>
			{#if $taxaStore}
				{#each $taxaStore.allLeafMargins as lm}
					<option value={lm}>{lm} ({$filterOptionCounts.leafMargin[lm] ?? 0})</option>
				{/each}
			{/if}
		</select>
	</div>

	<!-- Stipules filter -->
	<div>
		<label for="stipules-filter" class="mb-1 block text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
			Stipules
		</label>
		<select
			id="stipules-filter"
			value={$filterStore.stipules}
			onchange={handleTraitChange('stipules')}
			class="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
		>
			<option value="">All stipules</option>
			{#if $taxaStore}
				{#each $taxaStore.allStipules as st}
					<option value={st}>{st} ({$filterOptionCounts.stipules[st] ?? 0})</option>
				{/each}
			{/if}
		</select>
	</div>

	<!-- Exudate filter -->
	<div>
		<label for="exudate-filter" class="mb-1 block text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
			Exudate
		</label>
		<select
			id="exudate-filter"
			value={$filterStore.exudate}
			onchange={handleTraitChange('exudate')}
			class="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
		>
			<option value="">All exudates</option>
			{#if $taxaStore}
				{#each $taxaStore.allExudates as ex}
					<option value={ex}>{ex} ({$filterOptionCounts.exudate[ex] ?? 0})</option>
				{/each}
			{/if}
		</select>
	</div>

	<!-- Stem armature filter -->
	<div>
		<label for="stem-armature-filter" class="mb-1 block text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
			Stem armature
		</label>
		<select
			id="stem-armature-filter"
			value={$filterStore.stemArmature}
			onchange={handleTraitChange('stemArmature')}
			class="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
		>
			<option value="">All armatures</option>
			{#if $taxaStore}
				{#each $taxaStore.allStemArmatures as sa}
					<option value={sa}>{sa} ({$filterOptionCounts.stemArmature[sa] ?? 0})</option>
				{/each}
			{/if}
		</select>
	</div>

	<!-- Tendrils filter -->
	<div>
		<label for="tendrils-filter" class="mb-1 block text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
			Tendrils
		</label>
		<select
			id="tendrils-filter"
			value={$filterStore.tendrils}
			onchange={handleTraitChange('tendrils')}
			class="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
		>
			<option value="">All tendrils</option>
			{#if $taxaStore}
				{#each $taxaStore.allTendrils as td}
					<option value={td}>{td} ({$filterOptionCounts.tendrils[td] ?? 0})</option>
				{/each}
			{/if}
		</select>
	</div>

	<!-- Clear filters -->
	<button
		onclick={clearFilters}
		class="cursor-pointer rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
	>
		Clear filters
	</button>

	<hr class="border-gray-200 dark:border-gray-700" />

	<!-- Species count -->
	<p class="text-sm text-gray-500 dark:text-gray-400">
		Showing <span class="font-semibold text-gray-800 dark:text-gray-200">{$filteredSpecies.length}</span>
		of {$totalSpeciesCount} species
	</p>
</div>
