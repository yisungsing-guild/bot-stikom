/* eslint-disable no-console */

/**
 * Sync missing TrainingData rows into the local RAG index.
 *
 * Why: If TrainingData rows were inserted via backup/DB restore/manual scripts,
 * the DB may contain active training, but rag_index.json may not.
 *
 * Usage:
 *   node scripts/syncMissingRagIndex.js
 *   node scripts/syncMissingRagIndex.js --dryRun
 *   node scripts/syncMissingRagIndex.js --since 2026-04-01T00:00:00Z --limit 200
 *   node scripts/syncMissingRagIndex.js --onlyDivision pmb
 *   node scripts/syncMissingRagIndex.js --includeInactive
 *   node scripts/syncMissingRagIndex.js --prod
 */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
	const out = { flags: new Set(), values: {} };
	const booleanFlags = new Set(['prod', 'includeInactive', 'dryRun']);
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

function resolveFromProjectRoot(projectRoot, p) {
	const s = String(p || '').trim();
	if (!s) return s;
	return path.isAbsolute(s) ? s : path.resolve(projectRoot, s);
}

function pickEnvPath(projectRoot, forceProd) {
	if (process.env.DOTENV_CONFIG_PATH) return resolveFromProjectRoot(projectRoot, process.env.DOTENV_CONFIG_PATH);
	const isProd = forceProd || (String(process.env.NODE_ENV || '').toLowerCase() === 'production');
	if (!isProd) return resolveFromProjectRoot(projectRoot, '.env');
	if (fs.existsSync(resolveFromProjectRoot(projectRoot, '.env.production.local'))) return resolveFromProjectRoot(projectRoot, '.env.production.local');
	return resolveFromProjectRoot(projectRoot, '.env.production');
}

function safeReadIndex(indexPath) {
	try {
		const raw = fs.readFileSync(indexPath, 'utf8');
		const parsed = JSON.parse(raw || '[]');
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function normalizeDivisionKey(raw) {
	const k = String(raw || '').toLowerCase().trim();
	if (!k) return null;
	const allowed = new Set(['akademik', 'keuangan', 'pmb', 'prodi', 'beasiswa', 'lainnya']);
	return allowed.has(k) ? k : null;
}

function parseSince(value) {
	if (!value) return null;
	const d = new Date(String(value));
	if (Number.isNaN(d.getTime())) return null;
	return d;
}

async function sleep(ms) {
	if (!ms || ms <= 0) return;
	await new Promise((r) => setTimeout(r, ms));
}

async function main() {
	const projectRoot = path.resolve(__dirname, '..');
	const args = parseArgs(process.argv);
	const forceProd = args.flags.has('prod');
	const includeInactive = args.flags.has('includeInactive');
	const dryRun = args.flags.has('dryRun');

	const envPath = pickEnvPath(projectRoot, forceProd);
	require('dotenv').config({ path: envPath, quiet: true, override: true });

	const prisma = require('../src/db');
	const { ingestTrainingData, getIndexPath } = require('../src/engine/ragEngine');

	const onlyDivision = normalizeDivisionKey(args.values.onlyDivision);
	const since = parseSince(args.values.since);
	const limitRaw = args.values.limit ? parseInt(args.values.limit, 10) : 500;
	const limit = Math.max(1, Math.min(Number.isFinite(limitRaw) ? limitRaw : 500, 5000));
	const delayMsRaw = args.values.delayMs ? parseInt(args.values.delayMs, 10) : 0;
	const delayMs = Math.max(0, Math.min(Number.isFinite(delayMsRaw) ? delayMsRaw : 0, 2000));

	const indexPath = getIndexPath();
	const index = safeReadIndex(indexPath);
	const indexedTrainingIds = new Set();
	for (const it of index) {
		if (!it || typeof it !== 'object') continue;
		if (it.trainingId) indexedTrainingIds.add(String(it.trainingId));
	}

	const where = { ...(includeInactive ? {} : { active: true }) };
	if (onlyDivision) where.divisionKey = onlyDivision;
	if (since) where.createdAt = { gte: since };

	console.log(JSON.stringify({
		ok: true,
		envPath,
		indexPath,
		mode: dryRun ? 'dryRun' : 'apply',
		filter: { includeInactive, onlyDivision, since: since ? since.toISOString() : null, limit, delayMs },
		indexedTrainingIds: indexedTrainingIds.size
	}, null, 2));

	const rows = await prisma.trainingData.findMany({
		where,
		orderBy: { createdAt: 'asc' },
		take: limit,
		select: {
			id: true,
			filename: true,
			storedFilename: true,
			divisionKey: true,
			active: true,
			source: true,
			uploadedById: true,
			createdAt: true,
			content: true
		}
	});

	let missing = 0;
	let ingestedOk = 0;
	let ingestedFail = 0;

	for (let i = 0; i < rows.length; i += 1) {
		const r = rows[i];
		const isIndexed = indexedTrainingIds.has(String(r.id));
		if (isIndexed) continue;
		missing += 1;

		const label = `${missing} missing: ${r.id} div=${r.divisionKey || 'global'} active=${r.active} file=${r.filename}`;
		if (dryRun) {
			console.log('MISSING', label);
			continue;
		}

		const content = typeof r.content === 'string' ? r.content : '';
		if (!content.trim()) {
			console.warn('SKIP_EMPTY_CONTENT', label);
			continue;
		}

		try {
			const result = await ingestTrainingData(r.id, content, r.source, {
				divisionKey: r.divisionKey || null,
				filename: r.filename,
				uploadedById: r.uploadedById || null,
				trainingCreatedAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
				allowDuplicateTrainingAlias: true
			});
			if (result && result.success) {
				ingestedOk += 1;
				indexedTrainingIds.add(String(r.id));
				console.log('INGEST_OK', label, JSON.stringify({ ingested: result.ingested, skippedDuplicates: result.skippedDuplicates, aliasedDuplicates: result.aliasedDuplicates || 0, indexedChunkCount: result.indexedChunkCount || result.ingested || 0 }, null, 0));
			} else {
				ingestedFail += 1;
				console.warn('INGEST_FAIL', label, result && result.error ? result.error : result);
			}
		} catch (e) {
			ingestedFail += 1;
			console.warn('INGEST_ERROR', label, e && e.message ? e.message : String(e));
		}

		if (delayMs) await sleep(delayMs);
	}

	console.log(JSON.stringify({
		ok: true,
		finished: true,
		scanned: rows.length,
		missing,
		ingestedOk,
		ingestedFail,
		dryRun
	}, null, 2));

	await prisma.$disconnect();
}

main().catch((err) => {
	console.error('SYNC_MISSING_RAG_INDEX_ERROR', err && err.message ? err.message : String(err));
	process.exitCode = 1;
});
