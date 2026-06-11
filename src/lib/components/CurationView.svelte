<script>
	import { taxaStore } from '$lib/stores/taxa.js';
	import { INSTITUTION_NAMES } from '$lib/utils/csv.js';
	import SpecimenEditModal from './SpecimenEditModal.svelte';

	// Specimen-level controls, local to the curation view (the sidebar's
	// species-level filters don't apply here). Country is a specimen attribute
	// with multiple values across a dataset, so it filters per specimen.
	let search = $state('');
	let country = $state('');
	let herbarium = $state('');

	// The specimen currently open in the edit modal, or null. Clicking a row sets
	// it; the modal mutates the shared specimen map + resets taxaStore on save, so
	// the derived rows below recompute automatically.
	let editing = $state(null);

	// Barcoded specimens only — the synthetic barcode-less placeholders that keep
	// the species view's dropdowns complete aren't curatable rows.
	const specimens = $derived(
		$taxaStore ? [...$taxaStore.specimensByCatalogue.values()].filter((s) => s.catalogueNumber) : []
	);

	const countryOptions = $derived(
		[...new Set(specimens.map((s) => s.country).filter(Boolean))].sort((a, b) => a.localeCompare(b))
	);

	// Holding herbarium (institution) options — specimen-level, like Country. The
	// filter only appears once the dataset spans more than one herbarium.
	const herbariumOptions = $derived(
		[...new Set(specimens.map((s) => s.institutionCode).filter(Boolean))].sort((a, b) => a.localeCompare(b))
	);

	const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

	// Search matches the specimen-identity fields a curator scans by: barcode,
	// current determination, collector, and collection number.
	const rows = $derived.by(() => {
		const q = search.trim().toLowerCase();
		let out = specimens;
		if (country) out = out.filter((s) => s.country === country);
		if (herbarium) out = out.filter((s) => s.institutionCode === herbarium);
		if (q) {
			out = out.filter(
				(s) =>
					s.catalogueNumber.toLowerCase().includes(q) ||
					s.currentDetermination.toLowerCase().includes(q) ||
					s.recordedBy.toLowerCase().includes(q) ||
					s.recordNumber.toLowerCase().includes(q) ||
					s.institutionCode.toLowerCase().includes(q)
			);
		}
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
	<!-- Toolbar -->
	<div class="mb-4 flex flex-wrap items-center gap-3">
		<input
			type="search"
			bind:value={search}
			placeholder="Search barcode, determination, collector, collection no.…"
			class="min-w-64 flex-1 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
			aria-label="Search specimens"
		/>
		{#if countryOptions.length > 1}
			<select
				bind:value={country}
				class="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
				aria-label="Filter by country"
			>
				<option value="">All countries</option>
				{#each countryOptions as c}
					<option value={c}>{c}</option>
				{/each}
			</select>
		{/if}
		{#if herbariumOptions.length > 1}
			<select
				bind:value={herbarium}
				class="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
				aria-label="Filter by holding herbarium"
			>
				<option value="">All herbaria</option>
				{#each herbariumOptions as h}
					<option value={h}>{h}</option>
				{/each}
			</select>
		{/if}
		<span class="text-sm text-gray-500 dark:text-gray-400">
			<span class="font-semibold text-gray-800 dark:text-gray-200">{rows.length}</span>
			of {specimens.length} specimens
		</span>
	</div>

	{#if rows.length === 0}
		<div class="py-20 text-center text-gray-400 dark:text-gray-500">No specimens match.</div>
	{:else}
		<div class="overflow-x-auto rounded border border-gray-200 dark:border-gray-700">
			<table class="w-full border-collapse text-left text-sm">
				<thead class="sticky top-0 bg-gray-100 text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-800 dark:text-gray-400">
					<tr>
						<th class="px-3 py-2 font-semibold">Barcode</th>
						<th class="px-3 py-2 font-semibold">Herbarium</th>
						<th class="px-3 py-2 font-semibold">Type</th>
						<th class="px-3 py-2 font-semibold">Determination</th>
						<th class="px-3 py-2 font-semibold">Family</th>
						<th class="px-3 py-2 font-semibold">Genus</th>
						<th class="px-3 py-2 font-semibold">Country</th>
						<th class="px-3 py-2 font-semibold">Locality</th>
						<th class="px-3 py-2 font-semibold">Collector</th>
						<th class="px-3 py-2 font-semibold">Coll. no.</th>
						<th class="px-3 py-2 font-semibold">Coordinates</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as s (s.catalogueNumber)}
						<tr
							onclick={() => (editing = s)}
							class="cursor-pointer border-t border-gray-100 odd:bg-white even:bg-gray-50 hover:bg-emerald-50 focus-within:bg-emerald-50 dark:border-gray-800 dark:odd:bg-gray-900 dark:even:bg-gray-950 dark:hover:bg-emerald-950/40 dark:focus-within:bg-emerald-950/40"
						>
							<td class="px-3 py-2 font-mono text-xs whitespace-nowrap text-gray-700 dark:text-gray-300">
								<button
									type="button"
									onclick={() => (editing = s)}
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
							<td class="font-species px-3 py-2 whitespace-nowrap text-gray-900 dark:text-gray-100">{s.currentDetermination}</td>
							<td class="px-3 py-2 whitespace-nowrap text-gray-600 dark:text-gray-400">{dash(s.family)}</td>
							<td class="px-3 py-2 whitespace-nowrap text-gray-600 dark:text-gray-400">{dash(s.genus)}</td>
							<td class="px-3 py-2 whitespace-nowrap text-gray-600 dark:text-gray-400">{dash(s.country)}</td>
							<td class="max-w-xs truncate px-3 py-2 text-gray-600 dark:text-gray-400" title={s.locality}>{dash(s.locality)}</td>
							<td class="max-w-xs truncate px-3 py-2 text-gray-600 dark:text-gray-400" title={s.recordedBy}>{dash(s.recordedBy)}</td>
							<td class="px-3 py-2 whitespace-nowrap text-gray-600 dark:text-gray-400">{dash(s.recordNumber)}</td>
							<td class="px-3 py-2 whitespace-nowrap text-gray-600 dark:text-gray-400">{coords(s)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
{/if}

{#if editing}
	<SpecimenEditModal specimen={editing} onClose={() => (editing = null)} />
{/if}
