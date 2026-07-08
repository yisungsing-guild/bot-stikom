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

const axios = require('axios');

function mask(s, keep = 4) {
	const str = typeof s === 'string' ? s : '';
	if (!str) return '';
	if (str.length <= keep) return '*'.repeat(str.length);
	return '*'.repeat(Math.max(0, str.length - keep)) + str.slice(-keep);
}

async function main() {
	const baseUrl = process.argv[2] || 'https://marketing-stikom.my.id';
	const token = (process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '').trim();
	if (!token) throw new Error(`WHATSAPP_WEBHOOK_VERIFY_TOKEN is empty in ${envPath}`);

	const url = `${baseUrl.replace(/\/$/, '')}/wati/webhook?token=${encodeURIComponent(token)}`;

	const payload = {
		waId: '6281234567890',
		text: `ping ${new Date().toISOString()}`,
		id: `test-${Date.now()}`
	};

	const resp = await axios.post(url, payload, {
		timeout: 20000,
		headers: { 'Content-Type': 'application/json' }
	});

	console.log('WATI_POST_OK', {
		status: resp.status,
		baseUrl,
		envPath,
		tokenTail: mask(token),
		responseBody: typeof resp.data === 'string' ? resp.data : resp.data
	});
}

main().catch((err) => {
	const status = err?.response?.status;
	const data = err?.response?.data;
	console.error('WATI_POST_ERR', { status, data, message: err?.message || err });
	process.exitCode = 1;
});
