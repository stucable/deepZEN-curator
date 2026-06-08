<script>
	import { onMount, untrack } from 'svelte';
	import { taxaStore, identificationLogStore } from '$lib/stores/taxa.js';
	import { folderHandleStore } from '$lib/stores/folder.js';
	import { currentDatasetStore } from '$lib/stores/dataset.js';
	import { curatorNameStore } from '$lib/stores/curator.js';
	import { writeSpecimenOverride, appendIdentification } from '$lib/stores/folder.js';
	import { rebuildView, parseLat, parseLng } from '$lib/utils/csv.js';
	import HerbariumImage from './HerbariumImage.svelte';

	let { specimen, onClose = () => {} } = $props();

	// Editable fields, seeded once from the specimen (the modal is keyed per row,
	// so a new instance mounts for each specimen — no need to re-sync on change).
	// untrack captures the initial values deliberately, so the compiler doesn't
	// warn that we're only reading specimen's first value.
	const seed = untrack(() => specimen);
	let det = $state(seed.currentDetermination);
	let lat = $state(seed.lat == null ? '' : String(seed.lat));
	let lng = $state(seed.lng == null ? '' : String(seed.lng));
	let country = $state(seed.country);
	let recordedBy = $state(seed.recordedBy);
	let recordNumber = $state(seed.recordNumber);
	let remarks = $state('');

	let saving = $state(false);
	let errorMsg = $state(null);
	let overlayEl;

	onMount(() => overlayEl?.focus());

	// Typeahead option sources, drawn from the loaded dataset.
	const determinationOptions = $derived.by(() => {
		if (!$taxaStore) return [];
		const set = new Set();
		for (const s of $taxaStore.specimensByCatalogue.values()) {
			if (s.currentDetermination) set.add(s.currentDetermination);
			if (s.taxonomicName) set.add(s.taxonomicName);
		}
		return [...set].sort((a, b) => a.localeCompare(b));
	});
	const countryOptions = $derived.by(() => {
		if (!$taxaStore) return [];
		const set = new Set();
		for (const s of $taxaStore.specimensByCatalogue.values()) if (s.country) set.add(s.country);
		return [...set].sort((a, b) => a.localeCompare(b));
	});

	// Re-ID history for this barcode, newest first. The append-only log keeps
	// insertion order, so the last-appended entry is the current determination.
	const history = $derived(
		$identificationLogStore.filter((e) => e.catalogueNumber === specimen.catalogueNumber).slice().reverse()
	);

	const canSave = $derived(!!$folderHandleStore && !saving);
	const imageName = $derived(specimen.imageFiles?.[0] ?? specimen.catalogueNumber);

	async function save() {
		errorMsg = null;
		const latTrim = lat.trim();
		const lngTrim = lng.trim();
		const latVal = latTrim === '' ? null : parseLat(latTrim);
		const lngVal = lngTrim === '' ? null : parseLng(lngTrim);
		if (latTrim !== '' && latVal === null) {
			errorMsg = 'Latitude must be a number between −90 and 90.';
			return;
		}
		if (lngTrim !== '' && lngVal === null) {
			errorMsg = 'Longitude must be a number between −180 and 180.';
			return;
		}

		const folder = $folderHandleStore;
		const ds = $currentDatasetStore;
		const user = $curatorNameStore;
		const now = new Date().toISOString();

		const newDet = det.trim();
		const detChanged = newDet !== '' && newDet !== specimen.currentDetermination;
		const correctionChanged =
			latVal !== specimen.lat ||
			lngVal !== specimen.lng ||
			country.trim() !== specimen.country ||
			recordedBy.trim() !== specimen.recordedBy ||
			recordNumber.trim() !== specimen.recordNumber;

		if (!detChanged && !correctionChanged) {
			onClose();
			return;
		}

		saving = true;
		try {
			// Re-identification → append-only entry in the identifications log.
			if (detChanged) {
				const entry = {
					catalogueNumber: specimen.catalogueNumber,
					scientificName: newDet,
					identifier: user,
					identificationDate: now,
					remarks: remarks.trim()
				};
				await appendIdentification(folder, ds, entry, { user });
				specimen.currentDetermination = newDet;
				identificationLogStore.update((list) => [...list, entry]);
			}
			// Other edits → current-value correction in the specimen override CSV.
			// TaxonomicName stays the original determination (serializer writes it);
			// currentDetermination is owned by the log above.
			if (correctionChanged) {
				specimen.lat = latVal;
				specimen.lng = lngVal;
				specimen.country = country.trim();
				specimen.recordedBy = recordedBy.trim();
				specimen.recordNumber = recordNumber.trim();
				specimen.editedAt = now;
				await writeSpecimenOverride(folder, ds, $taxaStore.specimensByCatalogue, { user });
			}
			// Regroup the species view + refresh dropdowns/map from the mutated map.
			taxaStore.set(rebuildView($taxaStore.specimensByCatalogue));
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
	aria-label="Edit specimen {specimen.catalogueNumber}"
>
	<div class="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white shadow-xl dark:bg-gray-900">
		<!-- Header -->
		<div class="flex items-start justify-between border-b border-gray-200 px-5 py-3 dark:border-gray-700">
			<div>
				<p class="font-mono text-xs text-gray-500 dark:text-gray-400">{specimen.catalogueNumber}</p>
				<p class="font-species text-lg text-gray-900 dark:text-gray-100">{specimen.currentDetermination}</p>
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

		<div class="grid gap-5 p-5 md:grid-cols-[200px_1fr]">
			<!-- Image + history -->
			<div class="flex flex-col gap-4">
				<div class="aspect-square w-full overflow-hidden rounded border border-gray-200 dark:border-gray-700">
					{#if imageName}
						<HerbariumImage catalogueNumber={imageName} folderHandle={$folderHandleStore} />
					{:else}
						<div class="flex h-full items-center justify-center text-xs text-gray-400">No image</div>
					{/if}
				</div>

				<div>
					<h3 class="mb-1 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">ID history</h3>
					<ul class="space-y-1.5 text-xs">
						{#each history as h}
							<li class="rounded bg-gray-50 px-2 py-1 dark:bg-gray-800">
								<span class="font-species text-gray-900 dark:text-gray-100">{h.scientificName}</span>
								<div class="text-gray-500 dark:text-gray-400">
									{h.identifier || '—'}{h.identificationDate ? ` · ${h.identificationDate.slice(0, 10)}` : ''}
								</div>
								{#if h.remarks}<div class="text-gray-400 italic">{h.remarks}</div>{/if}
							</li>
						{/each}
						<li class="px-2 py-1 text-gray-400 dark:text-gray-500">
							Original: <span class="font-species">{specimen.taxonomicName}</span>
						</li>
					</ul>
				</div>
			</div>

			<!-- Edit fields -->
			<div class="flex flex-col gap-3">
				<div>
					<label for="edit-det" class={labelClass}>Determination</label>
					<input id="edit-det" type="text" list="det-options" bind:value={det} class="{fieldClass} font-species" />
					<datalist id="det-options">
						{#each determinationOptions as d}<option value={d}></option>{/each}
					</datalist>
				</div>

				{#if det.trim() !== specimen.currentDetermination}
					<div>
						<label for="edit-remarks" class={labelClass}>ID remarks (optional)</label>
						<input id="edit-remarks" type="text" bind:value={remarks} placeholder="e.g. det. from flower detail" class={fieldClass} />
					</div>
				{/if}

				<div class="grid grid-cols-2 gap-3">
					<div>
						<label for="edit-lat" class={labelClass}>Latitude</label>
						<input id="edit-lat" type="text" inputmode="decimal" bind:value={lat} class={fieldClass} />
					</div>
					<div>
						<label for="edit-lng" class={labelClass}>Longitude</label>
						<input id="edit-lng" type="text" inputmode="decimal" bind:value={lng} class={fieldClass} />
					</div>
				</div>

				<div>
					<label for="edit-country" class={labelClass}>Country</label>
					<input id="edit-country" type="text" list="country-options" bind:value={country} class={fieldClass} />
					<datalist id="country-options">
						{#each countryOptions as c}<option value={c}></option>{/each}
					</datalist>
				</div>

				<div>
					<label for="edit-collector" class={labelClass}>Collector</label>
					<input id="edit-collector" type="text" bind:value={recordedBy} class={fieldClass} />
				</div>

				<div>
					<label for="edit-collno" class={labelClass}>Collection number</label>
					<input id="edit-collno" type="text" bind:value={recordNumber} class={fieldClass} />
				</div>

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
						{saving ? 'Saving…' : 'Save'}
					</button>
				</div>
			</div>
		</div>
	</div>
</div>
