const { PrismaClient } = require('@prisma/client');

// Prisma registers process-level listeners (e.g., beforeExit/exit). If this module
// is loaded repeatedly (common in tests/hot-reload), creating a new client each time
// can exceed Node's default max listeners and emit warnings.
// Use a singleton to ensure only one client per process.
// In Jest, modules may be reloaded repeatedly; caching on `process` is more stable
// than relying on a test sandbox's global object.
const globalKey = '__system_wa_prisma__';

/** @type {import('@prisma/client').PrismaClient} */
let prisma = (process && process[globalKey]) || globalThis[globalKey];
if (!prisma) {
	prisma = new PrismaClient();
	// Cache for the lifetime of the process.
	process[globalKey] = prisma;
	if (process.env.NODE_ENV !== 'production') {
		globalThis[globalKey] = prisma;
	}
}

async function disconnect() {
	try {
		await prisma.$disconnect();
	} catch (err) {
		console.error('[Prisma] Error on disconnect:', err.message);
	}
}

module.exports = prisma;
module.exports.disconnect = disconnect;
