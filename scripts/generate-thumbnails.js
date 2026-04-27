#!/usr/bin/env node
// Generate downscaled JPEG thumbnails for every .jpg in a folder.
// Output goes to <folder>/thumbnails/<basename>.jpg.
// Idempotent: skips files where a thumb already exists with mtime >= source mtime.
//
// Usage:
//   node scripts/generate-thumbnails.js <folder> [--max-edge 384] [--quality 80]
//   npm run prep-thumbs -- <folder>

import { readdir, mkdir, stat } from 'node:fs/promises';
import { join, parse } from 'node:path';
import sharp from 'sharp';

function parseArgs(argv) {
	const args = { folder: null, maxEdge: 384, quality: 80 };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--max-edge') args.maxEdge = Number(argv[++i]);
		else if (a === '--quality') args.quality = Number(argv[++i]);
		else if (!args.folder) args.folder = a;
	}
	return args;
}

async function main() {
	const { folder, maxEdge, quality } = parseArgs(process.argv.slice(2));

	if (!folder) {
		console.error('Usage: node scripts/generate-thumbnails.js <folder> [--max-edge 384] [--quality 80]');
		process.exit(1);
	}

	const folderStat = await stat(folder).catch(() => null);
	if (!folderStat?.isDirectory()) {
		console.error(`Not a directory: ${folder}`);
		process.exit(1);
	}

	const thumbsDir = join(folder, 'thumbnails');
	await mkdir(thumbsDir, { recursive: true });

	const entries = await readdir(folder, { withFileTypes: true });
	const jpegs = entries
		.filter((e) => e.isFile() && /\.jpe?g$/i.test(e.name))
		.map((e) => e.name);

	if (jpegs.length === 0) {
		console.log(`No .jpg files found directly in ${folder}`);
		return;
	}

	console.log(`Found ${jpegs.length} JPEGs. Output: ${thumbsDir}`);

	let generated = 0;
	let skipped = 0;
	let failed = 0;

	for (let i = 0; i < jpegs.length; i++) {
		const name = jpegs[i];
		const src = join(folder, name);
		const out = join(thumbsDir, `${parse(name).name}.jpg`);
		const tag = `[${i + 1}/${jpegs.length}]`;

		try {
			const [srcStat, outStat] = await Promise.all([
				stat(src),
				stat(out).catch(() => null)
			]);
			if (outStat && outStat.mtimeMs >= srcStat.mtimeMs) {
				skipped++;
				continue;
			}

			await sharp(src)
				.resize(maxEdge, maxEdge, { fit: 'inside', withoutEnlargement: true })
				.jpeg({ quality, mozjpeg: true })
				.toFile(out);

			generated++;
			console.log(`${tag} ${name} -> thumbnails/${parse(name).name}.jpg`);
		} catch (err) {
			failed++;
			console.warn(`${tag} ${name}: ${err.message}`);
		}
	}

	console.log(`\nDone. generated=${generated} skipped=${skipped} failed=${failed}`);
	if (failed > 0) process.exit(2);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
