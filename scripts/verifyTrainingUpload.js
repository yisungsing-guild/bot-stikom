/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

function parseArgs(argv) {
  const parsed = {
    filePath: null,
    envPath: null,
    skipStore: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--skip-store') {
      parsed.skipStore = true;
      continue;
    }
    if (arg === '--env' && argv[i + 1]) {
      parsed.envPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--env=')) {
      parsed.envPath = arg.slice('--env='.length);
      continue;
    }
    if (!parsed.filePath) {
      parsed.filePath = arg;
    }
  }

  return parsed;
}

function runCommand(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return {
    ok: result.status === 0,
    status: result.status,
    error: result.error ? String(result.error.message || result.error) : null,
    stdout: String(result.stdout || '').trim().slice(0, 400),
    stderr: String(result.stderr || '').trim().slice(0, 400),
  };
}

function summarizeError(err) {
  return {
    code: err && err.code ? String(err.code) : null,
    message: String(err && err.message ? err.message : err).slice(0, 800),
    meta: err && err.meta ? err.meta : null,
  };
}

async function withCapturedWarnings(fn) {
  const originalWarn = console.warn;
  const samples = [];
  let count = 0;

  console.warn = (...args) => {
    count += 1;
    if (samples.length < 5) {
      samples.push(
        args
          .map((part) => (typeof part === 'string' ? part : JSON.stringify(part)))
          .join(' ')
          .slice(0, 300)
      );
    }
  };

  try {
    const result = await fn();
    return { result, warningCount: count, warningSamples: samples };
  } finally {
    console.warn = originalWarn;
  }
}

function buildDependencySummary() {
  return {
    convert: runCommand('convert', ['-version']),
    magick: runCommand('magick', ['-version']),
    gm: runCommand('gm', ['-version']),
    gs: runCommand('gs', ['--version']),
    tesseract: runCommand('tesseract', ['--version']),
  };
}

function pickEffectiveConfig() {
  return {
    ENABLE_OCR: process.env.ENABLE_OCR || null,
    PDF_OCR_FALLBACK_MODE: process.env.PDF_OCR_FALLBACK_MODE || null,
    OCR_LANGS: process.env.OCR_LANGS || null,
    OCR_LANG_PATH: process.env.OCR_LANG_PATH || null,
    OCR_MAX_PAGES: process.env.OCR_MAX_PAGES || null,
    OCR_MIN_CONFIDENCE: process.env.OCR_MIN_CONFIDENCE || null,
    PDF_MIN_NATIVE_TEXT_CHARS: process.env.PDF_MIN_NATIVE_TEXT_CHARS || null,
    MAX_FILE_SIZE: process.env.MAX_FILE_SIZE || null,
    MAX_TRAINING_CONTENT_BYTES: process.env.MAX_TRAINING_CONTENT_BYTES || null,
  };
}

async function inspectNativePdf(pdfParse, filePath) {
  const captured = await withCapturedWarnings(async () => {
    const buffer = fs.readFileSync(filePath);
    return pdfParse(buffer);
  });

  const data = captured.result;
  const text = data && typeof data.text === 'string' ? data.text : '';
  const trimmed = text.trim();

  return {
    ok: true,
    pages: data && data.numpages ? data.numpages : null,
    rawLength: text.length,
    trimmedLength: trimmed.length,
    sample: trimmed.slice(0, 500),
    warningCount: captured.warningCount,
    warningSamples: captured.warningSamples,
  };
}

async function inspectDatabase(prisma) {
  try {
    const count = await prisma.trainingData.count();
    return {
      ok: true,
      trainingDataCount: count,
    };
  } catch (err) {
    return {
      ok: false,
      error: summarizeError(err),
    };
  }
}

async function runParsePdf(FileParser, filePath) {
  const captured = await withCapturedWarnings(async () => {
    const text = await FileParser.parsePdf(filePath);
    return {
      ok: true,
      length: text.length,
      preview: text.slice(0, 500),
    };
  });

  return {
    ...captured.result,
    warningCount: captured.warningCount,
    warningSamples: captured.warningSamples,
  };
}

async function runParseAndStore(FileParser, prisma, filePath, originalFilename) {
  const captured = await withCapturedWarnings(async () => FileParser.parseAndStoreFile(filePath, originalFilename, null, null));
  const result = captured.result;
  const summary = {
    attempted: true,
    success: Boolean(result && result.success),
    warningCount: captured.warningCount,
    warningSamples: captured.warningSamples,
  };

  if (!result || !result.success) {
    summary.errorCode = result && result.errorCode ? String(result.errorCode) : null;
    summary.error = result && result.error ? String(result.error) : 'Unknown parse/store failure';
    summary.prismaCode = result && result.prismaCode ? String(result.prismaCode) : null;
    summary.prismaMeta = result && result.prismaMeta ? result.prismaMeta : null;
    return summary;
  }

  summary.trainingDataId = result.trainingDataId;
  summary.contentLength = result.content ? result.content.length : 0;
  summary.wasTruncated = Boolean(result.wasTruncated);

  try {
    await prisma.trainingData.delete({ where: { id: result.trainingDataId } });
    summary.cleanup = { ok: true, deletedId: result.trainingDataId };
  } catch (err) {
    summary.cleanup = { ok: false, error: summarizeError(err) };
  }

  return summary;
}

function buildAssessment(summary) {
  const nativeLength = summary.nativePdf && summary.nativePdf.ok ? summary.nativePdf.trimmedLength : 0;
  const store = summary.parseAndStore;

  if (!summary.db.ok) {
    return {
      conclusion: 'Koneksi database pada environment ini gagal. Verifikasi DATABASE_URL dan akses jaringan database.',
      nextSteps: [
        'Pastikan server memuat file env yang benar (.env.production atau DOTENV_CONFIG_PATH).',
        'Jalankan ulang script ini langsung di VPS untuk memastikan env runtime sama dengan production.',
      ],
    };
  }

  if (store && store.success) {
    return {
      conclusion: 'File ini dapat diparse dan dapat disimpan ke TrainingData dengan code dan environment yang sedang diuji.',
      nextSteps: [
        'Jika upload dari web masih gagal, backend live kemungkinan belum memakai code terbaru atau belum direstart penuh.',
        'Setelah deploy, restart PM2 dengan --update-env lalu jalankan script ini langsung di VPS.',
      ],
    };
  }

  if (nativeLength >= 200 && store && store.errorCode === 'OCR_FAILED_LOW_QUALITY') {
    return {
      conclusion: 'PDF ini punya native text yang cukup, tetapi runtime yang diuji tetap jatuh ke error OCR. Ini biasanya menandakan code lama atau runtime mismatch.',
      nextSteps: [
        'Pastikan proses PM2 benar-benar restart ke code terbaru.',
        'Pastikan hanya ada satu instance backend aktif dan request tidak diarahkan ke release lama.',
      ],
    };
  }

  if (nativeLength < 200) {
    return {
      conclusion: 'PDF ini minim native text dan akan bergantung pada OCR. Dependency OCR server harus lengkap agar upload bisa lolos.',
      nextSteps: [
        'Pastikan Ghostscript dan ImageMagick atau GraphicsMagick tersedia di host produksi.',
        'Jika server tidak bisa download language data, set OCR_LANG_PATH ke folder traineddata lokal.',
      ],
    };
  }

  return {
    conclusion: 'Verifikasi belum menunjukkan kegagalan database. Fokuskan pengecekan pada backend live, environment, dan dependency OCR.',
    nextSteps: [
      'Jalankan script ini di host produksi dengan file yang sama.',
      'Cocokkan hasil script dengan requestId dari response upload browser jika masih gagal.',
    ],
  };
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (!args.filePath) {
    console.error('Usage: node scripts/verifyTrainingUpload.js "C:\\path\\to\\file.pdf" [--env .env.production] [--skip-store]');
    process.exit(1);
  }

  const filePath = path.resolve(args.filePath);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const envPath = path.resolve(args.envPath || process.env.DOTENV_CONFIG_PATH || '.env.production');
  process.env.DOTENV_CONFIG_PATH = envPath;
  process.env.NODE_ENV = process.env.NODE_ENV || 'production';
  dotenv.config({ path: envPath, override: true, quiet: true });
  process.env.LOG_LEVEL = 'silent';

  const pdfParse = require('pdf-parse');
  const prisma = require('../src/db');
  const { FileParser } = require('../src/engine/fileParser');

  const summary = {
    envPath,
    cwd: process.cwd(),
    node: process.version,
    file: {
      path: filePath,
      originalFilename: path.basename(filePath),
      sizeBytes: fs.statSync(filePath).size,
    },
    effectiveConfig: pickEffectiveConfig(),
    dependencies: buildDependencySummary(),
    db: null,
    nativePdf: null,
    parsePdf: null,
    parseAndStore: args.skipStore ? { attempted: false, skipped: true } : null,
    assessment: null,
  };

  try {
    summary.db = await inspectDatabase(prisma);
    summary.nativePdf = await inspectNativePdf(pdfParse, filePath);
    summary.parsePdf = await runParsePdf(FileParser, filePath);
    if (!args.skipStore) {
      summary.parseAndStore = await runParseAndStore(FileParser, prisma, filePath, path.basename(filePath));
    }
    summary.assessment = buildAssessment(summary);
    console.log(JSON.stringify(summary, null, 2));
  } catch (err) {
    console.log(
      JSON.stringify(
        {
          envPath,
          filePath,
          fatal: summarizeError(err),
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  } finally {
    try {
      await prisma.$disconnect();
    } catch {
      // ignore
    }
  }
})();