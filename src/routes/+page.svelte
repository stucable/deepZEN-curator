<script>
	import { onMount } from 'svelte';
	import { loadSpeciesData, parseSpeciesCsv, applyIdentificationLog, CsvSchemaError } from '$lib/utils/csv.js';
	import { taxaStore, taxaSourceStore, taxaSourceFilenameStore, csvLoadErrorStore, identificationLogStore, filterStore, filteredSpecies, DEFAULT_HABITS } from '$lib/stores/taxa.js';
	import {
		folderHandleStore,
		pendingFolderHandleStore,
		restoreFolderHandle,
		readCustomCsvFromFolder,
		readIdentificationLog
	} from '$lib/stores/folder.js';
	import { currentDatasetStore, restoreDataset } from '$lib/stores/dataset.js';
	import { restoreTheme } from '$lib/stores/theme.js';
	import { restoreCuratorName } from '$lib/stores/curator.js';
	import { viewModeStore } from '$lib/stores/view.js';
	import { clearSelection } from '$lib/stores/map.js';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import SpeciesGrid from '$lib/components/SpeciesGrid.svelte';
	import CurationView from '$lib/components/CurationView.svelte';
	import MapView from '$lib/components/MapView.svelte';

	let loadedDatasetId = $state(null);
	// False while restoreFolderHandle is in flight — gates CSV loading so we
	// don't briefly load the shipped CSV before a custom override CSV has had
	// a chance to be discovered in the restored folder.
	let folderRestored = $state(false);
	let restoreGeneration = 0;
	let csvLoadGeneration = 0;

	onMount(async () => {
		await restoreTheme();
		await restoreCuratorName();
		await restoreDataset();
	});

	/**
	 * Overlays the dataset's append-only identifications log (if a folder is
	 * connected) onto a freshly parsed base CSV, so saved re-identifications drive
	 * currentDetermination after a reload. Updates identificationLogStore with the
	 * parsed entries for the curation history panel. Returns the (possibly
	 * regrouped) dataset, or null if the load generation went stale mid-read.
	 */
	async function overlayIdentifications(ds, folder, data, generation) {
		if (!folder) {
			identificationLogStore.set([]);
			return data;
		}
		let logText = '';
		try {
			const log = await readIdentificationLog(folder, ds);
			if (!isCurrentCsvLoad(generation)) return null;
			logText = log?.text ?? '';
		} catch (err) {
			if (!isCurrentCsvLoad(generation)) return null;
			console.warn(`[${ds.id}] Could not read identifications log:`, err);
		}
		const { data: overlaid, entries } = applyIdentificationLog(data, logText);
		identificationLogStore.set(entries);
		return overlaid;
	}

	function defaultFilterState() {
		return {
			order: '',
			family: '',
			genus: '',
			clade: '',
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
		};
	}

	function isCurrentCsvLoad(generation) {
		return generation === csvLoadGeneration;
	}

	async function loadFromSource(ds, folder, generation) {
		let customLoadError = null;

		if (folder) {
			try {
				const custom = await readCustomCsvFromFolder(folder, ds);
				if (!isCurrentCsvLoad(generation)) return;
				if (custom) {
					try {
						const data = parseSpeciesCsv(custom.text);
						if (!isCurrentCsvLoad(generation)) return;
						const overlaid = await overlayIdentifications(ds, folder, data, generation);
						if (overlaid === null) return;
						taxaStore.set(overlaid);
						taxaSourceStore.set('custom');
						taxaSourceFilenameStore.set(custom.filename);
						csvLoadErrorStore.set(null);
						console.log(`[${ds.id} | custom ${custom.filename}] CSV loaded:`, Object.keys(data.speciesByName).length, 'species,', data.allFamilies.length, 'families');
						return;
					} catch (err) {
						const reason = err instanceof CsvSchemaError
							? err.message
							: 'Parse error — check the file is a valid CSV';
						customLoadError = { filename: custom.filename, reason };
						if (isCurrentCsvLoad(generation)) {
							csvLoadErrorStore.set(customLoadError);
						}
						console.error(`[${ds.id} | custom ${custom.filename}] Parse failed:`, err);
						// Fall through to bundled CSV so initial loads do not get stuck.
					}
				}
			} catch (err) {
				if (!isCurrentCsvLoad(generation)) return;
				console.warn(`[${ds.id}] Could not scan folder for override CSV:`, err);
				// Fall through to bundled CSV.
			}
		}

		try {
			const data = await loadSpeciesData(ds.csvPath);
			if (!isCurrentCsvLoad(generation)) return;
			const overlaid = await overlayIdentifications(ds, folder, data, generation);
			if (overlaid === null) return;
			taxaStore.set(overlaid);
			taxaSourceStore.set('shipped');
			taxaSourceFilenameStore.set(null);
			csvLoadErrorStore.set(customLoadError);
			console.log(`[${ds.id} | shipped] CSV loaded:`, Object.keys(data.speciesByName).length, 'species,', data.allFamilies.length, 'families');
		} catch (err) {
			if (!isCurrentCsvLoad(generation)) return;
			const reason = err instanceof CsvSchemaError
				? err.message
				: 'Could not load shipped CSV';
			csvLoadErrorStore.set(customLoadError ?? { filename: ds.csvPath.split('/').pop(), reason });
			console.error(`[${ds.id} | shipped] Failed to load species data:`, err);
		}
	}

	$effect(() => {
		const ds = $currentDatasetStore;
		const folder = $folderHandleStore;
		const ready = folderRestored;
		if (!ds) return;

		// Dataset switch: reset view state and kick off folder restore.
		if (ds.id !== loadedDatasetId) {
			const generation = ++restoreGeneration;
			csvLoadGeneration++;
			loadedDatasetId = ds.id;
			folderRestored = false;
			taxaStore.set(null);
			taxaSourceStore.set(null);
			taxaSourceFilenameStore.set(null);
			csvLoadErrorStore.set(null);
			identificationLogStore.set([]);
			filterStore.set(defaultFilterState());
			clearSelection();
			folderHandleStore.set(null);
			pendingFolderHandleStore.set(null);
			(async () => {
				const restored = await restoreFolderHandle(ds.id, { commit: false });
				if (generation !== restoreGeneration) return;
				folderHandleStore.set(restored.folderHandle);
				pendingFolderHandleStore.set(restored.pendingFolderHandle);
				folderRestored = true;
			})();
			return;
		}

		// Wait for folder restore before loading CSV on dataset switch, so a
		// custom override CSV doesn't get briefly overridden by the shipped fetch.
		if (!ready) return;

		const generation = ++csvLoadGeneration;
		loadFromSource(ds, folder, generation);
	});

	// If the loaded dataset has no georeferenced specimens, the Map mode isn't
	// reachable (the toggle hides it) — fall back to Browse so we never render an
	// empty map. Mirrors the active-sort fallback for degenerate datasets.
	$effect(() => {
		if ($viewModeStore === 'map' && $taxaStore && !$taxaStore.geolocatedSpecimens?.length) {
			viewModeStore.set('browse');
		}
	});
</script>

<div class="flex h-screen overflow-hidden bg-white dark:bg-gray-950">
	<aside class="w-65 shrink-0 overflow-y-auto border-r border-l-2 border-gray-200 border-l-emerald-600 bg-gray-50 p-4 dark:border-gray-700 dark:border-l-emerald-600 dark:bg-gray-900">
		<Sidebar />
	</aside>

	<main class="flex-1 overflow-y-auto p-6 dark:bg-gray-950">
		{#if $viewModeStore === 'curate'}
			<CurationView />
		{:else if $viewModeStore === 'map'}
			<MapView />
		{:else}
			<SpeciesGrid species={$filteredSpecies} />
		{/if}
	</main>
</div>
