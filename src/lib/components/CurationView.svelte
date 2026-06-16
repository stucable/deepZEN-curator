<script>
	import { taxaStore, regionSpeciesKeys, filterStore, specimenSearchPredicate } from '$lib/stores/taxa.js';
	import { selectionPolygonStore, includeUnlocatedStore, hiddenSpeciesStore } from '$lib/stores/map.js';
	import { editingSpecimenStore } from '$lib/stores/view.js';
	import { pointInRing } from '$lib/utils/geo.js';
	import { INSTITUTION_NAMES } from '$lib/utils/csv.js';

	// Every control that narrows this table lives in the shared filterStore, so the Browse
	// grid, this table, and the Map narrow in lock-step (the Map mirrors the table's
	// selection). `genus` is the species-level filterStore.genus; specimenSearch / country /
	// herbarium are specimen-level, applied (with collector series / collection no. / type)
	// via specimenSearchPredicate. handleFilter writes a field from an input/select event.
	const handleFilter = (field) => (e) => filterStore.update((f) => ({ ...f, [field]: e.target.value }));

	// Reset everything that narrows this table. Region and hidden-species have their own
	// dedicated clears (like the Browse "Clear filters", which also leaves them be).
	function clearFilters() {
		filterStore.update((f) => ({
			...f,
			specimenSearch: '',
			country: '',
			genus: '',
			herbarium: '',
			collectorSeries: '',
			collectionNumber: '',
			typeStatus: ''
		}));
	}

	// Clicking a row opens the shared edit modal (mounted at the top level in
	// +page.svelte) by setting editingSpecimenStore. The modal mutates the shared
	// specimen map + resets taxaStore on save, so the derived rows below recompute.

	// Barcoded specimens only — the synthetic barcode-less placeholders that keep
	// the species view's dropdowns complete aren't curatable rows.
	const specimens = $derived(
		$taxaStore ? [...$taxaStore.specimensByCatalogue.values()].filter((s) => s.catalogueNumber) : []
	);

	const countryOptions = $derived(
		[...new Set(specimens.map((s) => s.country).filter(Boolean))].sort((a, b) => a.localeCompare(b))
	);

	// Genus options — specimen-level, like Country. A quick taxonomic narrow for the
	// table; the sidebar's species-level Genus filter only applies in Browse/Map.
	const genusOptions = $derived(
		[...new Set(specimens.map((s) => s.genus).filter(Boolean))].sort((a, b) => a.localeCompare(b))
	);

	// Holding herbarium (institution) options — specimen-level, like Country. The
	// filter only appears once the dataset spans more than one herbarium.
	const herbariumOptions = $derived(
		[...new Set(specimens.map((s) => s.institutionCode).filter(Boolean))].sort((a, b) => a.localeCompare(b))
	);

	const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

	const rows = $derived.by(() => {
		let out = specimens;
		// Genus is a species-level filter (shared filterStore.genus); each specimen carries
		// its genus, so apply it directly here.
		if ($filterStore.genus) out = out.filter((s) => s.genus === $filterStore.genus);
		// Species hidden via the map legend are removed app-wide (like the region
		// polygon), so the Curate table drops their specimens too.
		const hidden = $hiddenSpeciesStore;
		if (hidden.size) out = out.filter((s) => !hidden.has(s.currentDetermination));
		// Region polygon (drawn in Map mode): keep specimens inside it, plus — when
		// includeUnlocatedStore is on (default) — no-coordinate specimens *of species that
		// occur in the region*. The species gate (regionSpeciesKeys) mirrors the Browse
		// grid, so the Images and Curate views show the same species under a region; without
		// it, every no-coordinate specimen of every species would leak in.
		const polygon = $selectionPolygonStore;
		if (polygon && polygon.length >= 3) {
			const includeUnlocated = $includeUnlocatedStore;
			const keys = $regionSpeciesKeys;
			out = out.filter((s) =>
				s.lat != null && s.lng != null
					? pointInRing(s.lng, s.lat, polygon)
					: includeUnlocated && !!keys?.has(s.currentDetermination)
			);
		}
		// All specimen-level filters — the toolbar Search box / Country / Herbarium plus the
		// sidebar Collector series / Collection number / Type — shared with the Browse grid
		// and the Map, so the three views narrow to the same specimens.
		const matchSpecimen = specimenSearchPredicate($filterStore);
		if (matchSpecimen) out = out.filter(matchSpecimen);
		return [...out].sort(
			(a, b) =>
				collator.compare(a.currentDetermination, b.currentDetermination) ||
				collator.compare(a.catalogueNumber, b.catalogueNumber)
		);
	});

	const coords = (s) => (s.lat != null && s.lng != null ? `${s.lat}, ${s.lng}` : '—');
	const dash = (v) => v || '—';
	const institutionName = (code) => INSTITUTION_NAMES[code] || code || '';
</script>

{#if $taxaStore === null}
	<div class="flex items-center justify-center py-20">
		<div class="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-emerald-600 dark:border-gray-600"></div>
		<span class="ml-3 text-gray-500 dark:text-gray-400">Loading specimen data…</span>
	</div>
{:else}
	<!-- Fill the main area as a column so the table scrolls inside a height-bounded
	     region — that pins its horizontal scrollbar to the bottom of the window rather
	     than letting it sink below a long table. -->
	<div class="flex h-full flex-col">
		<!-- Toolbar -->
		<div class="mb-4 flex shrink-0 flex-wrap items-center gap-3">
			<input
				type="search"
				value={$filterStore.specimenSearch}
				oninput={handleFilter('specimenSearch')}
				placeholder="Search barcode, determination, collector, collection number…"
				class="min-w-64 max-w-xl flex-1 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
				aria-label="Search specimens"
			/>
			{#if countryOptions.length > 1}
				<select
					value={$filterStore.country}
					onchange={handleFilter('country')}
					class="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
					aria-label="Filter by country"
				>
					<option value="">All countries</option>
					{#each countryOptions as c}
						<option value={c}>{c}</option>
					{/each}
				</select>
			{/if}
			{#if genusOptions.length > 1}
				<select
					value={$filterStore.genus}
					onchange={handleFilter('genus')}
					class="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
					aria-label="Filter by genus"
				>
					<option value="">All genera</option>
					{#each genusOptions as g}
						<option value={g}>{g}</option>
					{/each}
				</select>
			{/if}
			{#if herbariumOptions.length > 1}
				<select
					value={$filterStore.herbarium}
					onchange={handleFilter('herbarium')}
					class="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
					aria-label="Filter by holding herbarium"
				>
					<option value="">All herbaria</option>
					{#each herbariumOptions as h}
						<option value={h}>{h}</option>
					{/each}
				</select>
			{/if}
			<button
				onclick={clearFilters}
				class="cursor-pointer rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
			>
				Clear filters
			</button>
			<span class="text-sm text-gray-500 dark:text-gray-400">
				<span class="font-semibold text-gray-800 dark:text-gray-200">{rows.length}</span>
				of {specimens.length} specimens
			</span>
		</div>

		{#if rows.length === 0}
			<div class="py-20 text-center text-gray-400 dark:text-gray-500">No specimens match.</div>
		{:else}
			<!-- overflow-auto + min-h-0 flex-1: scrolls both ways within the column, so the
			     subtle horizontal scrollbar sits at the bottom of the window only when the
			     table is wider than the view. thin-scrollbar matches the sidebar's style. -->
			<div class="thin-scrollbar min-h-0 flex-1 overflow-auto rounded border border-gray-200 dark:border-gray-700">
				<table class="w-full border-collapse text-left text-sm">
					<thead class="sticky top-0 bg-gray-100 text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-800 dark:text-gray-400">
						<tr>
							<th class="px-3 py-2 font-semibold">Barcode</th>
							<th class="px-3 py-2 font-semibold">Herbarium</th>
							<th class="px-3 py-2 font-semibold">Type</th>
							<th class="px-3 py-2 font-semibold">Family</th>
							<th class="px-3 py-2 font-semibold">Determination</th>
							<th class="px-3 py-2 font-semibold">Country</th>
							<th class="px-3 py-2 font-semibold">Collector</th>
							<th class="px-3 py-2 font-semibold">Coll. no.</th>
							<th class="px-3 py-2 font-semibold">Coordinates</th>
							<th class="px-3 py-2 font-semibold">Leaf</th>
							<th class="px-3 py-2 font-semibold">DNA tube</th>
							<th class="px-3 py-2 font-semibold">Seq</th>
							<th class="px-3 py-2 font-semibold">DNA notes</th>
						</tr>
					</thead>
					<tbody>
						{#each rows as s (s.catalogueNumber)}
							<tr
								onclick={() => editingSpecimenStore.set(s)}
								class="cursor-pointer border-t border-gray-100 odd:bg-white even:bg-gray-50 hover:bg-emerald-50 focus-within:bg-emerald-50 dark:border-gray-800 dark:odd:bg-gray-900 dark:even:bg-gray-950 dark:hover:bg-emerald-950/40 dark:focus-within:bg-emerald-950/40"
							>
								<td class="px-3 py-2 font-mono text-xs whitespace-nowrap text-gray-700 dark:text-gray-300">
									<button
										type="button"
										onclick={() => editingSpecimenStore.set(s)}
										aria-label="Edit {s.catalogueNumber}"
										class="cursor-pointer rounded text-left hover:underline focus:ring-2 focus:ring-emerald-500 focus:outline-none"
									>
										{s.catalogueNumber}
									</button>
								</td>
								<td class="px-3 py-2 whitespace-nowrap text-gray-600 dark:text-gray-400" title={institutionName(s.institutionCode)}>{dash(s.institutionCode)}</td>
								<td class="px-3 py-2 whitespace-nowrap">
									{#if s.typeStatus}
										<span class="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200" title={s.typeStatus}>{s.typeStatus}</span>
									{:else}
										<span class="text-gray-400 dark:text-gray-500">—</span>
									{/if}
								</td>
								<td class="px-3 py-2 whitespace-nowrap text-gray-600 dark:text-gray-400">{dash(s.family)}</td>
								<td class="font-species px-3 py-2 whitespace-nowrap text-gray-900 dark:text-gray-100">{s.currentDetermination}</td>
								<td class="px-3 py-2 whitespace-nowrap text-gray-600 dark:text-gray-400">{dash(s.country)}</td>
								<td class="max-w-xs truncate px-3 py-2 text-gray-600 dark:text-gray-400" title={s.recordedBy}>{dash(s.recordedBy)}</td>
								<td class="px-3 py-2 whitespace-nowrap text-gray-600 dark:text-gray-400">{dash(s.recordNumber)}</td>
								<td class="px-3 py-2 whitespace-nowrap text-gray-600 dark:text-gray-400">{coords(s)}</td>
								<td class="px-3 py-2 text-center">
									{#if s.leafSample === 'yes'}<span class="text-emerald-600 dark:text-emerald-400">✓</span>{:else}<span class="text-gray-400 dark:text-gray-500">—</span>{/if}
								</td>
								<td class="px-3 py-2 whitespace-nowrap font-mono text-xs text-gray-600 dark:text-gray-400">{dash(s.dnaExtraction)}</td>
								<td class="px-3 py-2 text-center">
									{#if s.dnaSequenced === 'yes'}<span class="text-emerald-600 dark:text-emerald-400">✓</span>{:else}<span class="text-gray-400 dark:text-gray-500">—</span>{/if}
								</td>
								<td class="max-w-xs truncate px-3 py-2 text-gray-600 dark:text-gray-400" title={s.dnaNotes}>{dash(s.dnaNotes)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
{/if}
