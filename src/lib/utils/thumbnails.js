import { get as idbGet, set as idbSet } from 'idb-keyval';

const MAX_EDGE = 384;
const JPEG_QUALITY = 0.8;
const MAX_CONCURRENT_GENERATIONS = 4;
// Hard cap on a single thumbnail generation. macOS Chrome can leave an image
// decode pending forever under memory pressure; without a ceiling a stuck
// decode holds its semaphore slot indefinitely and, after MAX_CONCURRENT
// stalls, deadlocks the whole pipeline (every other card spins forever).
// Timing out releases the slot and surfaces a per-card error instead.
const GENERATION_TIMEOUT_MS = 20000;

/**
 * Per-folderHandle cache of the `thumbnails/` subdir handle (or null if
 * the folder has none). WeakMap so a dataset switch lets the old folder
 * handle GC.
 * @type {WeakMap<FileSystemDirectoryHandle, Promise<FileSystemDirectoryHandle | null>>}
 */
const thumbsDirCache = new WeakMap();

function getThumbsDir(folderHandle) {
	let p = thumbsDirCache.get(folderHandle);
	if (!p) {
		p = folderHandle.getDirectoryHandle('thumbnails').catch(() => null);
		thumbsDirCache.set(folderHandle, p);
	}
	return p;
}

async function tryDiskThumb(folderHandle, catalogueNumber) {
	const thumbsDir = await getThumbsDir(folderHandle);
	if (!thumbsDir) return null;
	try {
		const fileHandle = await thumbsDir.getFileHandle(`${catalogueNumber}.jpg`);
		return await fileHandle.getFile();
	} catch {
		return null;
	}
}

function cacheKey(datasetId, catalogueNumber) {
	return `thumb:${datasetId}:${catalogueNumber}`;
}

async function getCachedThumb(datasetId, catalogueNumber, lastModified) {
	try {
		const entry = await idbGet(cacheKey(datasetId, catalogueNumber));
		if (!entry || entry.lastModified !== lastModified) return null;
		return entry.blob;
	} catch {
		return null;
	}
}

async function putCachedThumb(datasetId, catalogueNumber, lastModified, blob) {
	try {
		await idbSet(cacheKey(datasetId, catalogueNumber), { blob, lastModified });
	} catch {
		// Quota exhausted or IDB unavailable — fall back to live serving without cache.
	}
}

// 4-slot semaphore so 50 visible cards don't trigger 50 concurrent full-res
// decodes. Disk-thumb and IDB-cache reads are fast and don't go through this.
let inFlight = 0;
const waitQueue = [];

function acquireSlot() {
	if (inFlight < MAX_CONCURRENT_GENERATIONS) {
		inFlight++;
		return Promise.resolve();
	}
	return new Promise((resolve) => waitQueue.push(resolve)).then(() => {
		inFlight++;
	});
}

function releaseSlot() {
	inFlight--;
	const next = waitQueue.shift();
	if (next) next();
}

function withTimeout(promise, ms, label) {
	let timer;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Decode via HTMLImageElement.decode() rather than createImageBitmap. The
// latter can hang indefinitely on macOS Chrome for large JPEGs under memory
// pressure; img.decode() is markedly more reliable. OffscreenCanvas.drawImage
// accepts an HTMLImageElement, so the rest of the pipeline is unchanged.
async function generateThumb(file) {
	const url = URL.createObjectURL(file);
	try {
		const img = new Image();
		img.decoding = 'async';
		img.src = url;
		await withTimeout(img.decode(), GENERATION_TIMEOUT_MS, 'decode');
		const scale = Math.min(MAX_EDGE / img.naturalWidth, MAX_EDGE / img.naturalHeight, 1);
		const w = Math.max(1, Math.round(img.naturalWidth * scale));
		const h = Math.max(1, Math.round(img.naturalHeight * scale));
		const canvas = new OffscreenCanvas(w, h);
		const ctx = canvas.getContext('2d');
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = 'high';
		ctx.drawImage(img, 0, 0, w, h);
		return await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
	} finally {
		URL.revokeObjectURL(url);
	}
}

/**
 * Resolve a thumbnail Blob for one image. Three-step fall-through:
 *   1. `<folder>/thumbnails/<catalogueNumber>.jpg` on disk (preferred — pre-built).
 *   2. IndexedDB cache, validated by source file's `lastModified`.
 *   3. Generate locally from the full-resolution source, cache, return.
 *
 * Step 3 is gated by a 4-slot semaphore so a filter result with 50 visible
 * uncached cards doesn't overwhelm the main thread.
 *
 * @param {FileSystemDirectoryHandle} folderHandle
 * @param {string} datasetId
 * @param {string} catalogueNumber
 * @returns {Promise<Blob>}
 */
export async function loadThumbnail(folderHandle, datasetId, catalogueNumber) {
	const diskThumb = await tryDiskThumb(folderHandle, catalogueNumber);
	if (diskThumb) return diskThumb;

	const sourceHandle = await folderHandle.getFileHandle(`${catalogueNumber}.jpg`);
	const sourceFile = await sourceHandle.getFile();

	const cached = await getCachedThumb(datasetId, catalogueNumber, sourceFile.lastModified);
	if (cached) return cached;

	await acquireSlot();
	try {
		// Re-check cache: another card may have generated this thumb while we waited.
		const recheck = await getCachedThumb(datasetId, catalogueNumber, sourceFile.lastModified);
		if (recheck) return recheck;

		const blob = await generateThumb(sourceFile);
		await putCachedThumb(datasetId, catalogueNumber, sourceFile.lastModified, blob);
		return blob;
	} finally {
		releaseSlot();
	}
}
