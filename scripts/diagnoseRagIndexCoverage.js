/* eslint-disable no-console */

/**
 * Diagnose whether TrainingData rows exist in the local rag_index.json, and optionally re-ingest.
 *
 * Usage:
 *   node scripts/diagnoseRagIndexCoverage.js "Pedoman RPL" "Penjelasan Semua Program Studi" "hobi-sesuai-program-studi"
 *   node scripts/diagnoseRagIndexCoverage.js --reingest "Pedoman RPL"
 *   node scripts/diagnoseRagIndexCoverage.js --prod --reingest "Pedoman RPL"
 */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
	const out = { flags: new Set(), values: {} };
	const booleanFlags = new Set(['prod', 'reingest', 'includeInactive']);
	for (let i = 2; i < argv.length; i += 1) {
		const a = argv[i];
		if (!a.startsWith('--')) continue;
		const key = a.slice(2);
		if (booleanFlags.has(key)) {
			out.flags.add(key);
			continue;
		}
		const next = argv[i + 1];
		if (!next || next.startsWith('--')) {
			out.flags.add(key);
		} else {
			out.values[key] = next;
			i += 1;
		}
	}
	return out;
}

const args = parseArgs(process.argv);
const forceProd = args.flags.has('prod');
const doReingest = args.flags.has('reingest');
const includeInactive = args.flags.has('includeInactive');

const projectRoot = path.resolve(__dirname, '..');

function resolveFromProjectRoot(p) {
	const s = String(p || '').trim();
	if (!s) return s;
	return path.isAbsolute(s) ? s : path.resolve(projectRoot, s);
}

function pickEnvPath() {
	if (process.env.DOTENV_CONFIG_PATH) return resolveFromProjectRoot(process.env.DOTENV_CONFIG_PATH);
	const isProd = forceProd || (String(process.env.NODE_ENV || '').toLowerCase() === 'production');
	if (!isProd) return resolveFromProjectRoot('.env');
	if (fs.existsSync(resolveFromProjectRoot('.env.production.local'))) return resolveFromProjectRoot('.env.production.local');
	return resolveFromProjectRoot('.env.production');
}

function safeReadIndex(indexPath) {
	try {
		const raw = fs.readFileSync(indexPath, 'utf8');
		const parsed = JSON.parse(raw || '[]');
		return Array.isArray(parsed) ? parsed : [];
	} catch (e) {
		return [];
	}
}

function countIndexItemsForTrainingId(index, trainingId) {
	const tid = String(trainingId || '').trim();
	if (!tid) return 0;
	let n = 0;
	for (const it of index) {
		if (!it || typeof it !== 'object') continue;
		if (String(it.trainingId || '').trim() === tid) n += 1;
	}
	return n;
}

function pickSearchTerms(argv) {
	// Keep non-flag args as search terms.
	const booleanFlags = new Set(['--prod', '--reingest', '--includeInactive']);
	const terms = [];
	for (let i = 2; i < argv.length; i += 1) {
		const a = argv[i];
		if (a.startsWith('--')) {
			// Skip boolean flags (no value)
			if (booleanFlags.has(a)) continue;
			// Otherwise treat as a value flag and skip its value if any.
			if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) i += 1;
			continue;
		}
		terms.push(a);
	}
	return terms.filter(Boolean);
}

async function main() {
	const envPath = pickEnvPath();
	require('dotenv').config({ path: envPath, quiet: true, override: true });

	const prisma = require('../src/db');
	const { ingestTrainingData, getIndexPath } = require('../src/engine/ragEngine');
	const indexPath = getIndexPath();

	const terms = pickSearchTerms(process.argv);
	if (terms.length === 0) {
		console.log('Usage: node scripts/diagnoseRagIndexCoverage.js [--reingest] [--prod] [--includeInactive] <filename substring...>');
		process.exitCode = 2;
		return;
	}

	if (!fs.existsSync(indexPath)) {
		console.warn('WARN: rag_index.json not found at', indexPath);
	}

	let index = safeReadIndex(indexPath);
	const indexMeta = (() => {
		try {
			const stat = fs.statSync(indexPath);
			return { bytes: stat.size, mtime: stat.mtime.toISOString() };
		} catch {
			return { bytes: null, mtime: null };
		}
	})();

	console.log(JSON.stringify({ ok: true, envPath, indexPath, indexMeta, doReingest, includeInactive }, null, 2));

	for (const term of terms) {
		const where = {
			filename: { contains: term, mode: 'insensitive' },
			...(includeInactive ? {} : { active: true })
		};

		const rows = await prisma.trainingData.findMany({
			where,
			orderBy: { createdAt: 'desc' },
			select: {
				id: true,
				filename: true,
				storedFilename: true,
				divisionKey: true,
				active: true,
				source: true,
				uploadedById: true,
				createdAt: true,
				updatedAt: true,
				content: true
			}
		});

		console.log(`\n=== SEARCH: ${term} (dbMatches=${rows.length}) ===`);
		if (rows.length === 0) continue;

		for (const r of rows) {
			const content = r && typeof r.content === 'string' ? r.content : '';
			const len = content.length;
			const hasRPL = /\bRPL\b|rekognisi/i.test(content);
			const hasSI = /sistem\s+informasi/i.test(content);
			const hasProdi = /program\s+studi|\bprodi\b|jurusan/i.test(content);
			const chunksInIndex = countIndexItemsForTrainingId(index, r.id);

			console.log(JSON.stringify({
				id: r.id,
				filename: r.filename,
				storedFilename: r.storedFilename,
				divisionKey: r.divisionKey,
				active: r.active,
				source: r.source,
				len,
				hasRPL,
				hasSI,
				hasProdi,
				createdAt: r.createdAt,
				updatedAt: r.updatedAt,
				chunksInIndex
			}, null, 2));

			if (doReingest) {
				if (!content.trim()) {
					console.warn('SKIP_REINGEST_EMPTY_CONTENT', r.id);
					continue;
				}
				const ing = await ingestTrainingData(r.id, content, r.source, {
					divisionKey: r.divisionKey || null,
					filename: r.filename,
					uploadedById: r.uploadedById || null,
					trainingCreatedAt: r.createdAt ? new Date(r.createdAt).toISOString() : null
				});
				console.log('REINGEST_RESULT', r.id, ing);

				// Refresh index view so subsequent lines reflect latest counts.
				index = safeReadIndex(indexPath);
				const after = countIndexItemsForTrainingId(index, r.id);
				console.log('INDEX_COUNT_AFTER', r.id, after);
			}
		}
	}

	await prisma.$disconnect();
}

main().catch((err) => {
	console.error('DIAGNOSE_RAG_INDEX_COVERAGE_ERROR', err && err.message ? err.message : String(err));
	process.exitCode = 1;
});
