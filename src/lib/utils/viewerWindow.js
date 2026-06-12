import { get } from 'svelte/store';
import { folderHandleStore } from '$lib/stores/folder.js';

/**
 * Opener-side bridge for the standalone image viewer windows.
 *
 * The full-resolution images live behind the dataset's FileSystemDirectoryHandle,
 * and File System Access permission does not carry into a new window — so viewer
 * windows never touch the folder themselves. Instead this (main) window keeps the
 * granted handle and answers each viewer's per-image requests over postMessage:
 * viewer asks for a catalogue → we read the file and post the Blob back. Viewers
 * are dumb displays fed Blobs; permission stays here, with no second prompt.
 *
 * Every click opens a fresh tab ('_blank') so specimens can be compared side by
 * side. Each window's init payload is kept here and matched by WindowProxy
 * identity when that viewer posts 'ready' — so an F5 of a viewer tab
 * re-initialises it with its own images, not the most recently clicked ones.
 */

const VIEWER_URL = '/viewer';

let listenerInstalled = false;
/** One entry per opened viewer window: { win, payload }. Pruned once the window closes. */
let viewers = [];

function handleMessage(event) {
	if (event.origin !== location.origin) return;
	const data = event.data;
	if (!data || typeof data !== 'object') return;

	if (data.type === 'zen-viewer:ready') {
		// A freshly-loaded viewer announces itself — hand it its own images.
		const entry = viewers.find((v) => v.win === event.source);
		if (entry) {
			event.source.postMessage({ type: 'zen-viewer:init', ...entry.payload }, location.origin);
		}
		return;
	}

	if (data.type === 'zen-viewer:request') {
		serveImage(event.source, data.catalogue, data.generation);
	}
}

async function serveImage(source, catalogue, generation) {
	if (!source) return;
	const folder = get(folderHandleStore);
	if (!folder || !catalogue) {
		source.postMessage(
			{ type: 'zen-viewer:image', catalogue, generation, error: 'no-folder' },
			location.origin
		);
		return;
	}
	try {
		const fileHandle = await folder.getFileHandle(`${catalogue}.jpg`);
		const file = await fileHandle.getFile();
		source.postMessage(
			{ type: 'zen-viewer:image', catalogue, generation, blob: file },
			location.origin
		);
	} catch {
		source.postMessage(
			{ type: 'zen-viewer:image', catalogue, generation, error: 'not-found' },
			location.origin
		);
	}
}

function ensureListener() {
	if (listenerInstalled) return;
	window.addEventListener('message', handleMessage);
	listenerInstalled = true;
}

/**
 * Opens a new viewer tab showing `images[startIndex]` for `speciesName`.
 * The payload can't be posted directly — a fresh window is still loading and
 * would drop it — so it's stored and delivered on the viewer's 'ready' handshake.
 */
export function openImageViewer({ images, startIndex = 0, speciesName = '' }) {
	ensureListener();
	viewers = viewers.filter((v) => !v.win.closed);
	const win = window.open(VIEWER_URL, '_blank');
	if (!win) return; // popup blocked — nothing more we can do from here
	viewers.push({ win, payload: { images, startIndex, speciesName } });
}
