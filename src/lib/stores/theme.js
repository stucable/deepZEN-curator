import { writable, derived } from 'svelte/store';
import { get as idbGet, set as idbSet } from 'idb-keyval';

const IDB_KEY = 'userThemePreference';
const VALID = ['light', 'dark', 'system'];

/**
 * User's chosen theme preference. 'system' means "track the OS".
 * @type {import('svelte/store').Writable<'light' | 'dark' | 'system'>}
 */
export const themeStore = writable('system');

const systemDarkStore = writable(getSystemPrefersDark());

/** Whichever theme is actually applied to the DOM right now. */
export const effectiveThemeStore = derived(
	[themeStore, systemDarkStore],
	([$pref, $systemDark]) =>
		$pref === 'system' ? ($systemDark ? 'dark' : 'light') : $pref
);

let mediaQuery = null;
let mediaListener = null;

function getSystemPrefersDark() {
	if (typeof window === 'undefined') return false;
	return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyClass(effective) {
	if (typeof document === 'undefined') return;
	document.documentElement.classList.toggle('dark', effective === 'dark');
}

function attachMediaListener() {
	if (typeof window === 'undefined' || mediaQuery) return;
	mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
	mediaListener = (e) => systemDarkStore.set(e.matches);
	mediaQuery.addEventListener('change', mediaListener);
}

function detachMediaListener() {
	if (mediaQuery && mediaListener) {
		mediaQuery.removeEventListener('change', mediaListener);
		mediaQuery = null;
		mediaListener = null;
	}
}

/** Read persisted preference and activate it. Safe to call once onMount. */
export async function restoreTheme() {
	let saved = null;
	try {
		saved = await idbGet(IDB_KEY);
	} catch {
		// IDB unavailable — fall through to default
	}
	const pref = VALID.includes(saved) ? saved : 'system';
	themeStore.set(pref);
	systemDarkStore.set(getSystemPrefersDark());
	try {
		localStorage.setItem(IDB_KEY, pref);
	} catch {
		// Non-fatal (mirror for pre-hydration script on next reload)
	}
	if (pref === 'system') attachMediaListener();
	else detachMediaListener();
	applyClass(pref === 'system' ? (getSystemPrefersDark() ? 'dark' : 'light') : pref);
}

/** Switch preference, persist, and update the DOM. */
export async function setTheme(pref) {
	if (!VALID.includes(pref)) return;
	themeStore.set(pref);
	try {
		await idbSet(IDB_KEY, pref);
	} catch {
		// Non-fatal
	}
	try {
		localStorage.setItem(IDB_KEY, pref);
	} catch {
		// Non-fatal (mirror for pre-hydration script)
	}
	if (pref === 'system') {
		attachMediaListener();
		systemDarkStore.set(getSystemPrefersDark());
		applyClass(getSystemPrefersDark() ? 'dark' : 'light');
	} else {
		detachMediaListener();
		applyClass(pref);
	}
}
