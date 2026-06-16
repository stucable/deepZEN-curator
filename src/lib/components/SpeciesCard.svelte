<script>
	import { folderHandleStore } from '$lib/stores/folder.js';
	import { typeStatusByImageFile, specimenByImageFile } from '$lib/stores/taxa.js';
	import { editingSpecimenStore } from '$lib/stores/view.js';
	import { openImageViewer } from '$lib/utils/viewerWindow.js';
	import HerbariumImage from './HerbariumImage.svelte';

	let { species } = $props();

	// Shared style for the corner state badges (TYPE / LEAF / DNA). A dark-green chip —
	// darker than the bright green tissue border (border-green-500) — so it stays legible
	// against it without needing a separating outline.
	const badgeClass =
		'rounded bg-emerald-700 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white shadow';

	function openViewer(index) {
		openImageViewer({
			images: species.images,
			startIndex: index,
			speciesName: species.taxonomicName
		});
	}

	// Open the determination/edit window for the specimen behind a thumbnail. The grid
	// key is an image-file basename; specimenByImageFile resolves it to the specimen.
	// Editing needs a connected folder (to save), so the affordance is gated on it —
	// without one, a right-click falls through to the browser's native menu.
	function editSpecimen(cat, e) {
		if (!$folderHandleStore) return;
		e?.preventDefault();
		const sp = $specimenByImageFile.get(cat);
		if (sp) editingSpecimenStore.set(sp);
	}
</script>

<article class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition-shadow duration-150 hover:border-gray-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600">
	<div class="mb-2">
		<h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
			<span class="font-species">{species.taxonomicName}</span>
		</h2>
		<p class="text-sm text-gray-500 dark:text-gray-400">
			Family: {species.family}{#if species.vernacularName} &nbsp;|&nbsp; Vernacular name: {species.vernacularName}{/if}
		</p>
	</div>

	<div class="flex flex-wrap gap-2">
		{#each species.images as cat, i}
			{@const sp = $specimenByImageFile.get(cat)}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="group relative" oncontextmenu={(e) => editSpecimen(cat, e)}>
				<HerbariumImage
					catalogueNumber={cat}
					folderHandle={$folderHandleStore}
					onclick={() => openViewer(i)}
					isType={$typeStatusByImageFile.has(cat)}
					isLeafSample={sp?.leafSample === 'yes'}
					isDnaSequenced={sp?.dnaSequenced === 'yes'}
				/>
				{#if $folderHandleStore}
					<button
						type="button"
						onclick={(e) => editSpecimen(cat, e)}
						class="absolute right-1 top-1 z-10 cursor-pointer rounded bg-gray-900/70 p-1 text-white opacity-0 shadow transition-opacity hover:bg-emerald-600 focus:opacity-100 focus:outline-none group-hover:opacity-100"
						aria-label="Edit determination for {cat}"
						title="Edit determination"
					>
						<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
						</svg>
					</button>
				{/if}
				{#if $typeStatusByImageFile.has(cat) || sp?.leafSample === 'yes' || sp?.dnaSequenced === 'yes'}
					<div class="pointer-events-none absolute left-1 top-1 flex flex-col items-start gap-1">
						{#if $typeStatusByImageFile.has(cat)}
							<span class={badgeClass} title={$typeStatusByImageFile.get(cat)}>Type</span>
						{/if}
						{#if sp?.leafSample === 'yes'}
							<span class={badgeClass} title="Leaf sample taken">Leaf</span>
						{/if}
						{#if sp?.dnaSequenced === 'yes'}
							<span class={badgeClass} title="DNA sequenced">DNA</span>
						{/if}
					</div>
				{/if}
			</div>
		{/each}
	</div>
</article>
