/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const args = new Set(process.argv.slice(2));
const forceProd = args.has('--prod');

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

const envPath = pickEnvPath();

require('dotenv').config({ path: envPath, quiet: true, override: true });

const prisma = require('../src/db');

function safeParseDbUrl(databaseUrl) {
	if (!databaseUrl) {
		return {
			protocol: null,
			host: null,
			hostname: null,
			port: null,
			database: null,
			username: null,
			sslmode: null,
			hasHash: false,
			isSupabasePooler: false
		};
	}

	try {
		const parsed = new URL(databaseUrl);
		const database = (parsed.pathname || '').replace(/^\//, '') || null;
		const hostname = parsed.hostname || null;
		const sslmode = parsed.searchParams.get('sslmode') || null;
		const hasHash = Boolean(parsed.hash);
		const isSupabasePooler = Boolean(hostname && /(?:^|\.)pooler\.supabase\.com$/i.test(hostname));

		return {
			protocol: parsed.protocol || null,
			host: parsed.host || null,
			hostname,
			port: parsed.port || null,
			database,
			username: parsed.username || null,
			sslmode,
			hasHash,
			isSupabasePooler
		};
	} catch {
		return {
			protocol: null,
			host: null,
			hostname: null,
			port: null,
			database: null,
			username: null,
			sslmode: null,
			hasHash: false,
			isSupabasePooler: false
		};
	}
}

function buildHints({ target, errorMessage }) {
	const hints = [];
	const msg = String(errorMessage || '');

	if (target?.isSupabasePooler && target?.username === 'postgres') {
		hints.push(
			"Supabase session pooler requires username like 'postgres.<project_ref>' (not just 'postgres'). Copy the Session pooler connection string from Supabase Dashboard → Connect."
		);
	}

	if (target?.hasHash) {
		hints.push(
			'DATABASE_URL contains a URL fragment (#...). This often means your password has an unencoded #; URL-encode it as %23 or copy the connection string from Supabase dashboard.'
		);
	}

	if (/circuit breaker open: too many authentication errors/i.test(msg)) {
		hints.push(
			'Supabase pooler circuit breaker is open due to repeated failed logins. Stop the app to avoid retries, fix DATABASE_URL credentials, then wait ~1–5 minutes before testing again.'
		);
	}

	if (/password authentication failed/i.test(msg) || /authentication failed/i.test(msg)) {
		hints.push('Credentials rejected: re-check DATABASE_URL username/password (and URL-encoding for special characters).');
	}

	return hints;
}

async function main() {
	if (!process.env.DATABASE_URL || !/^postgres(ql)?:\/\//i.test(String(process.env.DATABASE_URL))) {
		throw new Error(`DATABASE_URL is missing or invalid in ${envPath}`);
	}

	const target = safeParseDbUrl(process.env.DATABASE_URL);

	const rows = await prisma.$queryRawUnsafe(
		"SELECT now() as now, current_database() as db, inet_server_addr() as server_addr, inet_server_port() as server_port"
	);

	console.log('DB_OK', { envPath, target, rows });
}

main()
	.catch((err) => {
		const target = safeParseDbUrl(process.env.DATABASE_URL);
		const message = err?.message || String(err);
		const hints = buildHints({ target, errorMessage: message });
		console.error('DB_ERR', {
			envPath,
			target,
			message,
			hints: hints.length ? hints : undefined
		});
		process.exitCode = 1;
	})
	.finally(async () => {
		try {
			await prisma.$disconnect();
		} catch {}
	});
