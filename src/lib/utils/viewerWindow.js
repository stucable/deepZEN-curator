import { get } from 'svelte/store';
import { folderHandleStore } from '$lib/stores/folder.js';

/**
 * Opener-side bridge for the standalone image viewer window.
 *
 * The full-resolution images live behind the dataset's FileSystemDirectoryHandle,
 * and File System Access permission does not carry into a new window — so the
 * viewer window never touches the folder itself. Instead this (main) window keeps
 * the granted handle and answers the viewer's per-image requests over postMessage:
 * viewer asks for a catalogue → we read the file and post the Blob back. The viewer
 * is a dumb display fed Blobs; permission stays here, with no second prompt.
 *
 * A single reusable window (fixed name 'zen-viewer') is shared across all cards —
 * later clicks update it and bring it to front rather than spawning more windows.
 */

const WINDOW_NAME = 'zen-viewer';
const VIEWER_URL = '/viewer';

let listenerInstalled = false;
/** Most recent init payload, replayed when a freshly-loaded viewer says it's ready. */
let pendingInit = null;

function handleMessage(event) {
	if (event.origin !== location.origin) return;
	const data = event.data;
	if (!data || typeof data !== 'object') return;

	if (data.type === 'zen-viewer:ready') {
		// A freshly-loaded viewer announces itself — hand it the current images.
		if (pendingInit && event.source) {
			event.source.postMessage({ type: 'zen-viewer:init', ...pendingInit }, location.origin);
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
 * Opens (or reuses) the shared viewer window and shows `images[startIndex]` for
 * `speciesName`. Reuse relies on the fixed window name: Chrome returns the existing
 * window without reloading it, so we post the init payload immediately (delivered
 * when it's already loaded; harmlessly dropped while a fresh window is still loading,
 * in which case the 'ready' handshake replays it).
 */
export function openImageViewer({ images, startIndex = 0, speciesName = '' }) {
	ensureListener();
	pendingInit = { images, startIndex, speciesName };
	const win = window.open(VIEWER_URL, WINDOW_NAME);
	if (!win) return; // popup blocked — nothing more we can do from here
	win.postMessage({ type: 'zen-viewer:init', ...pendingInit }, location.origin);
	win.focus();
}
