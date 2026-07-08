/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const projectRoot = path.resolve(__dirname, '..');

function resolveFromProjectRoot(p) {
	const s = String(p || '').trim();
	if (!s) return s;
	return path.isAbsolute(s) ? s : path.resolve(projectRoot, s);
}

function pickEnvPath() {
	if (process.env.DOTENV_CONFIG_PATH) return resolveFromProjectRoot(process.env.DOTENV_CONFIG_PATH);
	const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
	if (!isProd) return resolveFromProjectRoot('.env');
	if (fs.existsSync(resolveFromProjectRoot('.env.production.local'))) return resolveFromProjectRoot('.env.production.local');
	return resolveFromProjectRoot('.env.production');
}

const envPath = pickEnvPath();
dotenv.config({ path: envPath, quiet: true });

const prisma = require('../src/db');

const DIAG_KEYS = [
	'wati_last_webhook_accepted_at',
	'wati_last_webhook_rejected_at',
	'wati_last_webhook_rejected_meta',
	'wati_last_webhook_ignored_at',
	'wati_last_webhook_ignored_reason',
	'wati_last_webhook_payload_shape',
	'wati_last_webhook_extracted',
	'wati_last_webhook_forwarded_at',
	'wati_last_webhook_forward_result'
];

function redactTokens(raw) {
	const s = typeof raw === 'string' ? raw : '';
	if (!s) return s;
	return s
		.replace(/([?&]token=)[^&"\s]+/ig, '$1<redacted>')
		.replace(/([?&]verify_token=)[^&"\s]+/ig, '$1<redacted>');
}

async function main() {
	console.log('ENV_PATH', envPath);
	const total = await prisma.setting.count();
	const sample = await prisma.setting.findMany({
		select: { key: true },
		orderBy: { key: 'asc' },
		take: 20
	});
	console.log('SETTING_TOTAL', total);
	console.log('SETTING_SAMPLE_KEYS', sample.map((r) => r.key));

	const rows = await prisma.setting.findMany({
		where: { key: { in: DIAG_KEYS } },
		select: { key: true, value: true }
	});

	const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
	for (const k of DIAG_KEYS) {
		const v = byKey[k];
		if (!v) console.log(k, '(missing)');
		else {
			const safe = redactTokens(v);
			console.log(k, safe.length > 800 ? safe.slice(0, 800) + '…' : safe);
		}
	}
}

main()
	.catch((err) => {
		console.error('DIAG_ERR', err?.message || err);
		process.exitCode = 1;
	})
	.finally(async () => {
		try {
			await prisma.$disconnect();
		} catch {}
	});
