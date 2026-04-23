<script>
	import { onMount } from 'svelte';
	import { loadSpeciesData, parseSpeciesCsv, CsvSchemaError } from '$lib/utils/csv.js';
	import { taxaStore, taxaSourceStore, taxaSourceFilenameStore, csvLoadErrorStore, filterStore, filteredSpecies, DEFAULT_HABITS } from '$lib/stores/taxa.js';
	import {
		folderHandleStore,
		pendingFolderHandleStore,
		restoreFolderHandle,
		readCustomCsvFromFolder
	} from '$lib/stores/folder.js';
	import { currentDatasetStore, restoreDataset } from '$lib/stores/dataset.js';
	import { restoreTheme } from '$lib/stores/theme.js';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import SpeciesGrid from '$lib/components/SpeciesGrid.svelte';

	let loadedDatasetId = $state(null);
	// False while restoreFolderHandle is in flight — gates CSV loading so we
	// don't briefly load the shipped CSV before a custom override CSV has had
	// a chance to be discovered in the restored folder.
	let folderRestored = $state(false);

	onMount(async () => {
		await restoreTheme();
		await restoreDataset();
	});

	function defaultFilterState() {
		return {
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
		};
	}

	async function loadFromSource(ds, folder) {
		if (folder) {
			try {
				const custom = await readCustomCsvFromFolder(folder, ds);
				if (custom) {
					try {
						const data = parseSpeciesCsv(custom.text);
						taxaStore.set(data);
						taxaSourceStore.set('custom');
						taxaSourceFilenameStore.set(custom.filename);
						csvLoadErrorStore.set(null);
						console.log(`[${ds.id} | custom ${custom.filename}] CSV loaded:`, Object.keys(data.speciesByName).length, 'species,', data.allFamilies.length, 'families');
						return;
					} catch (err) {
						const reason = err instanceof CsvSchemaError
							? err.message
							: 'Parse error — check the file is a valid CSV';
						csvLoadErrorStore.set({ filename: custom.filename, reason });
						console.error(`[${ds.id} | custom ${custom.filename}] Parse failed:`, err);
						// Leave taxaStore intact so the grid doesn't empty.
						return;
					}
				}
			} catch (err) {
				console.warn(`[${ds.id}] Could not scan folder for override CSV:`, err);
				// Fall through to bundled CSV.
			}
		}

		try {
			const data = await loadSpeciesData(ds.csvPath);
			taxaStore.set(data);
			taxaSourceStore.set('shipped');
			taxaSourceFilenameStore.set(null);
			csvLoadErrorStore.set(null);
			console.log(`[${ds.id} | shipped] CSV loaded:`, Object.keys(data.speciesByName).length, 'species,', data.allFamilies.length, 'families');
		} catch (err) {
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
			loadedDatasetId = ds.id;
			folderRestored = false;
			taxaStore.set(null);
			taxaSourceStore.set(null);
			taxaSourceFilenameStore.set(null);
			csvLoadErrorStore.set(null);
			filterStore.set(defaultFilterState());
			folderHandleStore.set(null);
			pendingFolderHandleStore.set(null);
			(async () => {
				await restoreFolderHandle(ds.id);
				folderRestored = true;
			})();
			return;
		}

		// Wait for folder restore before loading CSV on dataset switch, so a
		// custom override CSV doesn't get briefly overridden by the shipped fetch.
		if (!ready) return;

		loadFromSource(ds, folder);
	});
</script>

<div class="flex h-screen overflow-hidden bg-white dark:bg-gray-950">
	<aside class="w-65 shrink-0 overflow-y-auto border-r border-l-2 border-gray-200 border-l-emerald-600 bg-gray-50 p-4 dark:border-gray-700 dark:border-l-emerald-600 dark:bg-gray-900">
		<Sidebar />
	</aside>

	<main class="flex-1 overflow-y-auto p-6 dark:bg-gray-950">
		<SpeciesGrid species={$filteredSpecies} />
	</main>
</div>
