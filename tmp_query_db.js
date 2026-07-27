const Database = require('better-sqlite3');
const db = new Database('C:\\Users\\TSC-AKA\\Videos\\MARKETING\\BOTAI\\system_wa\\prisma\\dev.db');
const rows = db.prepare('SELECT id, filename, storedFilename, source, divisionKey, ragIngestStatus, ragChunkCount FROM TrainingData').all();
console.log(JSON.stringify(rows, null, 2));
