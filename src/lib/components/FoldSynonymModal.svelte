<script>
	import { onMount, untrack } from 'svelte';
	import { taxaStore, identificationLogStore } from '$lib/stores/taxa.js';
	import { folderHandleStore, appendIdentifications } from '$lib/stores/folder.js';
	import { currentDatasetStore } from '$lib/stores/dataset.js';
	import { curatorNameStore, curatorHerbariumStore } from '$lib/stores/curator.js';
	import { buildFoldEntries, rebuildView, normalizeDetermination } from '$lib/utils/csv.js';

	let {
		// The current determination being folded away (the "X" of fold X → Y).
		fromName,
		onClose = () => {}
	} = $props();

	// The accepted name to fold into (Y). Seeded blank — the curator picks/types it.
	let toName = $state('');
	let remarks = $state('');
	// Determiner's institution + identifier + date — confirm/override, defaulting from
	// the curator's saved identity (sticky herbarium re-saved on fold), today's date.
	let herbarium = $state(untrack(() => $curatorHerbariumStore));
	let identifier = $state(untrack(() => $curatorNameStore));
	let identifiedOn = $state(new Date().toISOString().slice(0, 10));

	// Scope: fold every sheet of X (default, no list — scales to 100s), or hand-pick a
	// subset. `selected` holds the chosen catalogue numbers; `listFilter` searches the list.
	let scope = $state('all'); // 'all' | 'choose'
	let selected = $state(new Set());
	let listFilter = $state('');

	let saving = $state(false);
	let errorMsg = $state(null);
	let overlayEl;

	onMount(() => overlayEl?.focus());

	// Accepted-name typeahead — every determination/name across the dataset (reused
	// from SpecimenEditModal), so the curator can pick an existing name or type a new one.
	const determinationOptions = $derived.by(() => {
		if (!$taxaStore) return [];
		const set = new Set();
		for (const s of $taxaStore.specimensByCatalogue.values()) {
			if (s.currentDetermination) set.add(s.currentDetermination);
			if (s.taxonomicName) set.add(s.taxonomicName);
		}
		return [...set].sort((a, b) => a.localeCompare(b));
	});

	// The sheets a fold would touch: barcoded specimens currently determined as X.
	const affected = $derived.by(() => {
		if (!$taxaStore) return [];
		return [...$taxaStore.specimensByCatalogue.values()].filter(
			(s) => s.catalogueNumber && s.currentDetermination === fromName
		);
	});
	const count = $derived(affected.length);

	// The affected list narrowed by the search box (only shown in 'choose' scope).
	const visibleAffected = $derived.by(() => {
		const q = listFilter.trim().toLowerCase();
		if (!q) return affected;
		return affected.filter((s) =>
			[s.catalogueNumber, s.recordedBy, s.recordNumber, s.locality].some(
				(v) => v && v.toLowerCase().includes(q)
			)
		);
	});

	// How many sheets the fold will actually touch: all of X, or the ticked subset.
	const effectiveCount = $derived(scope === 'all' ? count : selected.size);

	// Sets aren't deeply reactive in runes — reassign a fresh Set so derivations re-run.
	function chooseScope() {
		selected = new Set(affected.map((s) => s.catalogueNumber)); // pre-tick all; trim exceptions
		scope = 'choose';
	}
	function allScope() {
		scope = 'all';
	}
	function toggle(barcode) {
		const next = new Set(selected);
		next.has(barcode) ? next.delete(barcode) : next.add(barcode);
		selected = next;
	}
	function selectAll() {
		selected = new Set(affected.map((s) => s.catalogueNumber));
	}
	function selectNone() {
		selected = new Set();
	}

	const trimmedTo = $derived(toName.trim());
	const isNoop = $derived(trimmedTo === '' || trimmedTo === fromName);
	const canSave = $derived(!!$folderHandleStore && !saving && !isNoop && effectiveCount > 0);

	async function save() {
		errorMsg = null;
		if (isNoop || effectiveCount === 0) {
			onClose();
			return;
		}
		const folder = $folderHandleStore;
		if (!folder) {
			errorMsg = 'Select an image folder to save edits.';
			return;
		}
		const ds = $currentDatasetStore;
		const user = $curatorNameStore;
		const map = $taxaStore.specimensByCatalogue;
		const meta = {
			identifier: identifier.trim(),
			herbarium: herbarium.trim(),
			identificationDate: identifiedOn || new Date().toISOString().slice(0, 10),
			remarks: remarks.trim()
		};
		// Pure enumeration of the fold entries (one per sheet of X — all, or the ticked
		// subset), each tagged changeType:'synonymy'. Rest mirrors SpecimenEditModal's save.
		const includeBarcodes = scope === 'choose' ? selected : null;
		const entries = buildFoldEntries(map, fromName, trimmedTo, meta, includeBarcodes);
		if (entries.length === 0) {
			onClose();
			return;
		}
		saving = true;
		try {
			// One read + one write of the append-only log (the whole fold).
			await appendIdentifications(folder, ds, entries, { user });
			// Mirror onto the in-memory specimens directly (don't re-run
			// applyIdentifications). Normalize so a bare-genus Y collapses to
			// "<Genus> sp." the same way the reload overlay would.
			const folded = new Set(entries.map((e) => e.catalogueNumber));
			for (const s of map.values()) {
				if (folded.has(s.catalogueNumber)) {
					s.currentDetermination = normalizeDetermination(trimmedTo, s.genus);
				}
			}
			identificationLogStore.update((list) => [...list, ...entries]);
			// Make the typed herbarium the curator's sticky default for next time.
			if (meta.herbarium) curatorHerbariumStore.set(meta.herbarium);
			// Regroup the species view + refresh dropdowns/map from the mutated map.
			taxaStore.set(rebuildView(map));
			onClose();
		} catch (err) {
			errorMsg = err?.message || 'Could not save — check folder write permission.';
			saving = false;
		}
	}

	function handleKeydown(e) {
		if (e.key === 'Escape') onClose();
	}
	function handleOverlayClick(e) {
		if (e.target === overlayEl) onClose();
	}

	const fieldClass =
		'w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100';
	const labelClass = 'mb-1 block text-xs font-semibold uppercase text-gray-500 dark:text-gray-400';
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	bind:this={overlayEl}
	class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
	onclick={handleOverlayClick}
	onkeydown={handleKeydown}
	tabindex="0"
	role="dialog"
	aria-modal="true"
	aria-label="Fold synonym {fromName}"
>
	<div class="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white shadow-xl dark:bg-gray-900">
		<!-- Header -->
		<div class="flex items-start justify-between border-b border-gray-200 px-5 py-3 dark:border-gray-700">
			<div>
				<p class="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Fold synonym</p>
				<p class="font-species text-lg text-gray-900 dark:text-gray-100">{fromName}</p>
			</div>
			<button
				onclick={onClose}
				class="cursor-pointer rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-200"
				aria-label="Close"
			>
				<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>
		</div>

		<div class="flex flex-col gap-3 p-5">
			<div>
				<label for="fold-to" class={labelClass}>Accepted name</label>
				<input id="fold-to" type="text" list="fold-det-options" bind:value={toName} placeholder="e.g. Macaranga sphaerophylla" class="{fieldClass} font-species" />
				<datalist id="fold-det-options">
					{#each determinationOptions as d}<option value={d}></option>{/each}
				</datalist>
			</div>

			<!-- Scope: fold every sheet of X, or hand-pick a subset (some may be a different taxon). -->
			<div>
				<span class={labelClass}>Which specimens</span>
				<div class="inline-flex overflow-hidden rounded border border-gray-300 text-sm dark:border-gray-700">
					<button
						type="button"
						onclick={allScope}
						class="cursor-pointer px-3 py-1.5 {scope === 'all' ? 'bg-emerald-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'}"
					>
						Fold all {count}
					</button>
					<button
						type="button"
						onclick={chooseScope}
						class="cursor-pointer border-l border-gray-300 px-3 py-1.5 dark:border-gray-700 {scope === 'choose' ? 'bg-emerald-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'}"
					>
						Choose specimens…
					</button>
				</div>
			</div>

			{#if scope === 'choose'}
				<div>
					<div class="mb-1 flex items-center justify-between">
						<span class={labelClass}>Specimens to fold</span>
						<span class="text-xs text-gray-500 dark:text-gray-400">{selected.size} of {count} selected</span>
					</div>
					<div class="mb-2 flex items-center gap-2">
						<input type="search" bind:value={listFilter} placeholder="Filter by barcode, collector, locality…" class="{fieldClass} flex-1" aria-label="Filter specimens" />
						<button type="button" onclick={selectAll} class="shrink-0 cursor-pointer rounded border border-gray-300 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">All</button>
						<button type="button" onclick={selectNone} class="shrink-0 cursor-pointer rounded border border-gray-300 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">None</button>
					</div>
					<div class="max-h-64 overflow-auto rounded border border-gray-200 dark:border-gray-700">
						{#each visibleAffected as s (s.catalogueNumber)}
							<label class="flex cursor-pointer items-center gap-2 border-b border-gray-100 px-2 py-1.5 text-sm last:border-b-0 hover:bg-emerald-50 dark:border-gray-800 dark:hover:bg-emerald-950/40">
								<input type="checkbox" checked={selected.has(s.catalogueNumber)} onchange={() => toggle(s.catalogueNumber)} class="h-4 w-4 shrink-0 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 dark:border-gray-600 dark:bg-gray-800" />
								<span class="shrink-0 font-mono text-xs text-gray-700 dark:text-gray-300">{s.catalogueNumber}</span>
								<span class="truncate text-gray-500 dark:text-gray-400">
									{[s.recordedBy, s.recordNumber, s.locality].filter(Boolean).join(' · ') || '—'}
								</span>
							</label>
						{/each}
						{#if visibleAffected.length === 0}
							<div class="px-2 py-3 text-center text-xs text-gray-400 dark:text-gray-500">No specimens match the filter.</div>
						{/if}
					</div>
				</div>
			{/if}

			<!-- Headline: the act, stated plainly with the live effective count. -->
			<div class="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
				{#if isNoop}
					Re-identify <strong>{effectiveCount}</strong> specimen{effectiveCount === 1 ? '' : 's'} determined as
					<span class="font-species">{fromName}</span> to an accepted name.
				{:else}
					Re-identify <strong>{effectiveCount}</strong> specimen{effectiveCount === 1 ? '' : 's'}:
					<span class="font-species">{fromName}</span> → <span class="font-species">{trimmedTo}</span>.
				{/if}
			</div>

			<div>
				<label for="fold-remarks" class={labelClass}>Justification / remarks</label>
				<input id="fold-remarks" type="text" bind:value={remarks} placeholder="e.g. syn. of M. sphaerophylla — DNA + sheet study, Smith 2024" class={fieldClass} />
			</div>

			<div class="grid grid-cols-2 gap-3">
				<div>
					<label for="fold-identifier" class={labelClass}>Identified by</label>
					<input id="fold-identifier" type="text" bind:value={identifier} placeholder="Your name, or who identified it" class={fieldClass} />
				</div>
				<div>
					<label for="fold-herbarium" class={labelClass}>Determiner's herbarium</label>
					<input id="fold-herbarium" type="text" bind:value={herbarium} placeholder="e.g. K" class={fieldClass} />
				</div>
			</div>

			<div>
				<label for="fold-date" class={labelClass}>Identification date</label>
				<input id="fold-date" type="date" bind:value={identifiedOn} class={fieldClass} />
			</div>

			<p class="text-xs text-gray-400 dark:text-gray-500">
				Appends one dated identification per folded sheet to the log, flagged as a taxonomic
				change; the original determination and full ID history are kept. Sheets that belong to a
				<em>different</em> name should instead be re-identified individually from the table (click
				the row). Applies to sheets <em>currently</em> determined as {fromName}; sheets added later
				would need re-folding. To undo, fold back the other way.
			</p>

			{#if errorMsg}
				<div class="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
					{errorMsg}
				</div>
			{/if}
			{#if !$folderHandleStore}
				<div class="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
					Select an image folder to save edits.
				</div>
			{/if}

			<div class="mt-1 flex justify-end gap-2">
				<button
					onclick={onClose}
					class="cursor-pointer rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
				>
					Cancel
				</button>
				<button
					onclick={save}
					disabled={!canSave}
					class="cursor-pointer rounded bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-default disabled:opacity-40"
				>
					{saving ? 'Folding…' : 'Fold synonym'}
				</button>
			</div>
		</div>
	</div>
</div>
