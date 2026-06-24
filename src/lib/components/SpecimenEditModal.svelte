<script>
	import { onMount, untrack } from 'svelte';
	import { taxaStore, identificationLogStore } from '$lib/stores/taxa.js';
	import { folderHandleStore } from '$lib/stores/folder.js';
	import { currentDatasetStore } from '$lib/stores/dataset.js';
	import { curatorNameStore, curatorHerbariumStore } from '$lib/stores/curator.js';
	import { writeSpecimenOverride, appendIdentification } from '$lib/stores/folder.js';
	import { rebuildView, parseLat, parseLng } from '$lib/utils/csv.js';
	import HerbariumImage from './HerbariumImage.svelte';

	let {
		specimen,
		onClose = () => {},
		// Map-view only: a handler to enter "click the map to set coordinates" mode,
		// a {lng, lat} the map pushes back in after the click, and a flag that tucks
		// the modal away (kept mounted, state preserved) while the curator clicks.
		onPickLocation = null,
		pendingLocation = null,
		hidden = false
	} = $props();

	// Editable fields, seeded once from the specimen (the modal is keyed per row,
	// so a new instance mounts for each specimen — no need to re-sync on change).
	// untrack captures the initial values deliberately, so the compiler doesn't
	// warn that we're only reading specimen's first value.
	const seed = untrack(() => specimen);
	let det = $state(seed.currentDetermination);
	let lat = $state(seed.lat == null ? '' : String(seed.lat));
	let lng = $state(seed.lng == null ? '' : String(seed.lng));
	let country = $state(seed.country);
	let institutionCode = $state(seed.institutionCode); // holding herbarium (the sheet)
	let recordedBy = $state(seed.recordedBy);
	let recordNumber = $state(seed.recordNumber);
	let remarks = $state('');
	// Herbarium of this identification (the determiner's institution). Seeded from
	// the curator's saved default; editable per-ID and made sticky again on save.
	let herbarium = $state(untrack(() => $curatorHerbariumStore));
	// Identifier (Darwin Core Identifier) of this determination. Seeded from the
	// sidebar curator name but editable per-ID, since an ID may be made by someone
	// else. The saved-CSV *filename* owner stays the sidebar identity (see save()).
	let identifier = $state(untrack(() => $curatorNameStore));
	// Identification date — editable / backdatable; defaults to today (YYYY-MM-DD).
	let identifiedOn = $state(new Date().toISOString().slice(0, 10));
	// DNA-sampling workflow for this sheet. Checkboxes are booleans here, stored as
	// 'yes' / '' (blank) on the specimen; the two text fields are free-form.
	let leafSample = $state(seed.leafSample === 'yes');
	let dnaExtraction = $state(seed.dnaExtraction);
	let dnaSequenced = $state(seed.dnaSequenced === 'yes');
	let dnaNotes = $state(seed.dnaNotes);

	let saving = $state(false);
	let errorMsg = $state(null);
	let overlayEl;

	onMount(() => overlayEl?.focus());

	// A map click (drag-drop or "Set location on map") pushes coordinates in via
	// pendingLocation; fill the coordinate fields, leaving other in-progress edits
	// untouched. Reruns only when the parent passes a fresh object.
	$effect(() => {
		if (pendingLocation) {
			lat = pendingLocation.lat.toFixed(6);
			lng = pendingLocation.lng.toFixed(6);
		}
	});

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
	const institutionOptions = $derived.by(() => {
		if (!$taxaStore) return [];
		const set = new Set();
		for (const s of $taxaStore.specimensByCatalogue.values()) if (s.institutionCode) set.add(s.institutionCode);
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
		const remarksTrim = remarks.trim();
		const herbariumTrim = herbarium.trim();
		const identifierTrim = identifier.trim();
		const detChanged = newDet !== '' && newDet !== specimen.currentDetermination;
		// Log an identification when the name changes OR when there's a note to
		// record against the current name (a re-affirming, note-only entry).
		const logIdentification = detChanged || remarksTrim !== '';
		// DNA-sampling fields, normalised to their stored form for change-detection.
		const leafVal = leafSample ? 'yes' : '';
		const dnaSequencedVal = dnaSequenced ? 'yes' : '';
		const dnaExtractionTrim = dnaExtraction.trim();
		const dnaNotesTrim = dnaNotes.trim();
		const correctionChanged =
			latVal !== specimen.lat ||
			lngVal !== specimen.lng ||
			country.trim() !== specimen.country ||
			institutionCode.trim() !== specimen.institutionCode ||
			recordedBy.trim() !== specimen.recordedBy ||
			recordNumber.trim() !== specimen.recordNumber ||
			leafVal !== specimen.leafSample ||
			dnaExtractionTrim !== specimen.dnaExtraction ||
			dnaSequencedVal !== specimen.dnaSequenced ||
			dnaNotesTrim !== specimen.dnaNotes;

		if (!logIdentification && !correctionChanged) {
			onClose();
			return;
		}

		saving = true;
		try {
			// Re-identification (or a note-only re-affirmation) → append-only entry in
			// the identifications log. A note-only entry keeps the current name.
			if (logIdentification) {
				const scientificName = detChanged ? newDet : specimen.currentDetermination;
				const entry = {
					catalogueNumber: specimen.catalogueNumber,
					scientificName,
					identifier: identifierTrim,
					herbarium: herbariumTrim,
					identificationDate: identifiedOn || now.slice(0, 10),
					remarks: remarksTrim
				};
				await appendIdentification(folder, ds, entry, { user });
				specimen.currentDetermination = scientificName;
				identificationLogStore.update((list) => [...list, entry]);
				// Make the typed herbarium the curator's sticky default for next time.
				if (herbariumTrim) curatorHerbariumStore.set(herbariumTrim);
			}
			// Other edits → current-value correction in the specimen override CSV.
			// TaxonomicName stays the original determination (serializer writes it);
			// currentDetermination is owned by the log above.
			if (correctionChanged) {
				specimen.lat = latVal;
				specimen.lng = lngVal;
				specimen.country = country.trim();
				specimen.institutionCode = institutionCode.trim();
				specimen.recordedBy = recordedBy.trim();
				specimen.recordNumber = recordNumber.trim();
				specimen.leafSample = leafVal;
				specimen.dnaExtraction = dnaExtractionTrim;
				specimen.dnaSequenced = dnaSequencedVal;
				specimen.dnaNotes = dnaNotesTrim;
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
		if (hidden) return; // tucked away during map placement — parent owns Escape
		if (e.key === 'Escape') onClose();
	}

	function handleOverlayClick(e) {
		if (hidden) return;
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
	style:display={hidden ? 'none' : null}
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
				{#if specimen.typeStatus}
					<span class="mt-1 inline-block rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
						Type: {specimen.typeStatus}
					</span>
				{/if}
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
								{#if h.changeType === 'synonymy'}
									<span class="ml-1 inline-block rounded bg-emerald-100 px-1 py-0.5 align-middle text-[10px] font-medium text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200" title="Re-identified by folding a synonym into its accepted name">Taxonomic change · synonymy</span>
								{/if}
								<div class="text-gray-500 dark:text-gray-400">
									{h.identifier || '—'}{h.herbarium ? ` (${h.herbarium})` : ''}{h.identificationDate ? ` · ${h.identificationDate.slice(0, 10)}` : ''}
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

				<div>
					<label for="edit-identifier" class={labelClass}>Identified by</label>
					<input id="edit-identifier" type="text" bind:value={identifier} placeholder="Your name, or who identified it" class={fieldClass} />
				</div>

				<div class="grid grid-cols-2 gap-3">
					<div>
						<label for="edit-herbarium" class={labelClass}>Determiner's herbarium</label>
						<input id="edit-herbarium" type="text" bind:value={herbarium} placeholder="e.g. K" class={fieldClass} />
					</div>
					<div>
						<label for="edit-identified-on" class={labelClass}>Identification date</label>
						<input id="edit-identified-on" type="date" bind:value={identifiedOn} class={fieldClass} />
					</div>
				</div>

				<div>
					<label for="edit-remarks" class={labelClass}>ID remarks / notes (optional)</label>
					<input id="edit-remarks" type="text" bind:value={remarks} placeholder="e.g. det. from flower detail, or 'uncertain — needs checking'" class={fieldClass} />
					<p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
						A note on its own is saved as a dated identification on the current name.
					</p>
				</div>

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

				{#if onPickLocation}
					<button
						type="button"
						onclick={onPickLocation}
						class="-mt-1 cursor-pointer self-start rounded border border-emerald-600 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950"
					>
						Set location on map
					</button>
				{/if}

				<div>
					<label for="edit-country" class={labelClass}>Country</label>
					<input id="edit-country" type="text" list="country-options" bind:value={country} class={fieldClass} />
					<datalist id="country-options">
						{#each countryOptions as c}<option value={c}></option>{/each}
					</datalist>
				</div>

				<div>
					<label for="edit-institution" class={labelClass}>Holding herbarium</label>
					<input id="edit-institution" type="text" list="institution-options" bind:value={institutionCode} placeholder="e.g. K" class={fieldClass} />
					<datalist id="institution-options">
						{#each institutionOptions as h}<option value={h}></option>{/each}
					</datalist>
					<p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
						Institution holding the sheet — defaults from the barcode prefix.
					</p>
				</div>

				<div>
					<label for="edit-collector" class={labelClass}>Collector</label>
					<input id="edit-collector" type="text" bind:value={recordedBy} class={fieldClass} />
				</div>

				<div>
					<label for="edit-collno" class={labelClass}>Collection number</label>
					<input id="edit-collno" type="text" bind:value={recordNumber} class={fieldClass} />
				</div>

				<div class="mt-1 border-t border-gray-200 pt-3 dark:border-gray-700">
					<h3 class="mb-2 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">DNA sampling</h3>
					<div class="flex flex-wrap gap-x-6 gap-y-2">
						<label class="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
							<input type="checkbox" bind:checked={leafSample} class="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 dark:border-gray-600 dark:bg-gray-800" />
							Leaf sample taken
						</label>
						<label class="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
							<input type="checkbox" bind:checked={dnaSequenced} class="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 dark:border-gray-600 dark:bg-gray-800" />
							DNA sequenced
						</label>
					</div>
					<div class="mt-3 grid grid-cols-2 gap-3">
						<div>
							<label for="edit-dna-tube" class={labelClass}>DNA extraction (tube no.)</label>
							<input id="edit-dna-tube" type="text" bind:value={dnaExtraction} placeholder="e.g. BT_015" class={fieldClass} />
						</div>
						<div>
							<label for="edit-dna-notes" class={labelClass}>DNA notes</label>
							<input id="edit-dna-notes" type="text" bind:value={dnaNotes} placeholder="e.g. sequence file, or 'degraded DNA'" class={fieldClass} />
						</div>
					</div>
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
