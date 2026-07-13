const fs = require('fs');
const path = require('path');
const os = require('os');
const prisma = require('../db');
const logger = require('../logger');

// File Parser - extract training data dari berbagai format file
class FileParser {
  static isImageExtension(ext) {
    return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tif', '.tiff'].includes(String(ext || '').toLowerCase());
  }

  static buildImageTrainingContent(originalFilename, ocrText = '', options = {}) {
    const safeFilename = this.sanitizeFilenameForStorage(originalFilename || 'gambar-training');
    const ext = path.extname(safeFilename).toLowerCase().replace(/^\./, '') || 'image';
    const text = String(ocrText || '').trim();
    const status = text
      ? 'OCR berhasil mengekstrak teks dari gambar.'
      : 'OCR tidak menemukan teks yang cukup jelas pada gambar ini.';
    const visualContext = options && typeof options.visualContext === 'string' ? this.sanitizeTextForStorage(options.visualContext).slice(0, 2000) : '';

    const parts = [
      'Dokumen gambar/desain: ' + safeFilename + '.',
      'Format file: ' + ext.toUpperCase() + '.',
      status,
      'File ini disimpan sebagai referensi visual supaya gambar, brosur, screenshot, poster, denah, kalender, atau materi promosi tetap bisa digunakan sebagai sumber informasi meskipun teks OCR pendek.',
      'Gunakan nama file, caption, atau input manual tambahan untuk memberi konteks spesifik seperti prodi, biaya, jadwal, lokasi, fasilitas, beasiswa, kontak, atau informasi PMB yang ada pada gambar.',
    ];

    if (visualContext) {
      parts.push('', 'Keterangan visual:', visualContext);
    }

    const publicUrl = options && typeof options.publicUrl === 'string' ? options.publicUrl.trim() : '';
    if (publicUrl) {
      parts.push('Marker gambar WhatsApp: [[image:' + publicUrl + '|' + safeFilename + ']]');
    }

    if (text) {
      parts.push('', 'Teks hasil OCR gambar:', text);
    } else {
      parts.push('', 'Catatan OCR: tidak ada teks terbaca. Tambahkan input manual jika gambar berisi detail penting yang harus dijawab bot secara tekstual.');
    }

    return parts.join('\n');
  }

  static limitTextToUtf8Bytes(text, maxBytes) {
    const s = String(text || '');
    const limit = Number.isFinite(maxBytes) ? Math.max(1, Math.floor(maxBytes)) : 1;
    const bytes = Buffer.byteLength(s, 'utf8');
    if (bytes <= limit) {
      return { text: s, wasTruncated: false, originalBytes: bytes, finalBytes: bytes };
    }
    const truncated = Buffer.from(s, 'utf8').subarray(0, limit).toString('utf8');
    const finalBytes = Buffer.byteLength(truncated, 'utf8');
    return { text: truncated, wasTruncated: true, originalBytes: bytes, finalBytes };
  }

  static sanitizeFilenameForStorage(originalFilename) {
    const raw = String(originalFilename || '');
    // Remove NUL + control chars, keep printable.
    let name = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s{2,}/g, ' ').trim();

    // Common user mistake: whitespace before extension (e.g. "file .docx").
    name = name.replace(/\s+(\.[A-Za-z0-9]{1,10})$/g, '$1');

    // Defensive: strip surrogate code units to avoid driver/query escaping issues.
    // (Some extracted/odd filenames can include unpaired surrogates.)
    name = name.replace(/[\uD800-\uDFFF]/g, ' ');

    // Normalize to a UTF-8 safe string.
    name = Buffer.from(name, 'utf8').toString('utf8');
    if (!name) name = 'training-data';

    // Cap to 255 chars (common FS/DB limit). Preserve extension when possible.
    const ext = path.extname(name);
    const base = path.basename(name, ext);
    const maxLen = 255;
    if (name.length > maxLen) {
      const keepExt = ext && ext.length < 16 ? ext : '';
      const maxBase = Math.max(1, maxLen - keepExt.length);
      name = base.slice(0, maxBase) + keepExt;
    }
    return name;
  }

  static sanitizeTextForStorage(text) {
    const raw = String(text || '');
    if (!raw) return '';

    // Postgres does not allow NUL (\u0000) in text. Also drop other control chars
    // except common whitespace (\n, \r, \t).
    let out = raw
      .replace(/\u0000/g, '')
      .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');

    // Remove any surrogate code units (can break DB driver escaping / UTF-8).
    out = out.replace(/[\uD800-\uDFFF]/g, '');

    // Normalize line endings and collapse excessive blank lines.
    out = out.replace(/\r\n/g, '\n');
    out = out.replace(/\n{4,}/g, '\n\n\n');

    // Normalize to a UTF-8-safe string (drops/replaces invalid surrogate sequences).
    // This helps avoid DB write failures due to encoding issues.
    out = Buffer.from(out, 'utf8').toString('utf8');

    // Trim but avoid stripping meaningful leading whitespace inside tables.
    out = out.trim();
    return out;
  }

  static toSafePersistError(err) {
    const msg = err && err.message ? String(err.message) : String(err);

    // Prisma known request error codes (do not leak details).
    const code = err && err.code ? String(err.code) : '';
    if (code === 'P2000') {
      return {
        errorCode: 'DB_VALUE_TOO_LONG',
        error: 'Gagal menyimpan training data: ada field yang terlalu panjang untuk database. Coba pecah dokumen atau ringkas konten.'
      };
    }
    if (code === 'P2003') {
      return {
        errorCode: 'DB_FK_FAILED',
        error: 'Gagal menyimpan training data: referensi user/metadata tidak valid. Coba login ulang atau hubungi admin.'
      };
    }
    if (code === 'P2023') {
      return {
        errorCode: 'DB_INCONSISTENT',
        error: 'Gagal menyimpan training data: database mengembalikan error. Coba upload ulang atau hubungi admin.'
      };
    }

    // Prisma can throw InvalidArg for problematic string escaping.
    if (code === 'InvalidArg' || /hex escape/i.test(msg)) {
      return {
        errorCode: 'DB_TEXT_ENCODING',
        error: 'Gagal menyimpan training data: teks/nama file mengandung karakter tidak valid untuk database. Coba rename file (nama sederhana) atau export ulang dokumen lalu upload ulang.'
      };
    }

    // Prisma often dumps the full invocation including content; never return that to UI.
    const isPrismaInvocationDump =
      msg.includes('Invalid `prisma.trainingData.create()` invocation') ||
      msg.includes('Invalid prisma.trainingData.create() invocation') ||
      (msg.includes('prisma.trainingData.create') && msg.toLowerCase().includes('invocation'));

    if (isPrismaInvocationDump) {
      const lower = msg.toLowerCase();

      const mapPgMessage = (pgCodeRaw, pgMessageRaw) => {
        const pgCode = pgCodeRaw ? String(pgCodeRaw).trim() : '';
        const pgMessage = pgMessageRaw ? String(pgMessageRaw).trim() : '';

        if (/row-level security|violates row-level security/i.test(pgMessage)) {
          return {
            errorCode: 'DB_RLS_DENIED',
            error: 'Gagal menyimpan training data: ditolak oleh Row Level Security (RLS) database. Pastikan user DB untuk Prisma punya akses INSERT ke tabel TrainingData.'
          };
        }
        if (/permission denied/i.test(pgMessage)) {
          return {
            errorCode: 'DB_PERMISSION_DENIED',
            error: 'Gagal menyimpan training data: database menolak akses (permission denied). Pastikan role user DB untuk Prisma punya hak INSERT/UPDATE di TrainingData.'
          };
        }
        if (/does not exist|unknown column|column .* does not exist|relation .* does not exist/i.test(pgMessage)) {
          return {
            errorCode: 'DB_SCHEMA_OUTDATED',
            error: 'Gagal menyimpan training data: schema database production belum sesuai. Jalankan migrasi Prisma (mis. prisma migrate deploy) di environment production.'
          };
        }
        if (/invalid\s+byte\s+sequence|unsupported\s+unicode|utf-?8|character\s+not\s+in\s+repertoire/i.test(pgMessage)) {
          return {
            errorCode: 'DB_TEXT_ENCODING',
            error: 'Gagal menyimpan training data: teks mengandung karakter yang tidak didukung database. Coba export ulang dokumen atau convert ke TXT sebelum upload.'
          };
        }

        const short = `${pgCode ? `(${pgCode}) ` : ''}${pgMessage}`.slice(0, 220);
        return {
          errorCode: pgCode ? `DB_PG_${pgCode}` : 'DB_WRITE_FAILED',
          error: `Gagal menyimpan training data ke database: ${short}`
        };
      };

      // Try to extract underlying Postgres error code/message from Prisma dump.
      // Example snippet contains: PostgresError { code: "22P05", message: "..." }
      const pgMatch = msg.match(
        /PostgresError\s*\{[\s\S]*?\bcode:\s*\\?"([^"\\]+)\\?"[\s\S]*?\bmessage:\s*\\?"((?:[^"\\]|\\.){1,800})\\?"/m
      );
      if (pgMatch) {
        const code = pgMatch[1];
        const rawMsg = pgMatch[2];
        const unescaped = String(rawMsg || '')
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
        return mapPgMessage(code, unescaped);
      }

      // Heuristic extraction: look for a "code:" and "message:" pair anywhere near PostgresError.
      const pgIdx = lower.indexOf('postgreserror');
      if (pgIdx >= 0) {
        const window = msg.slice(pgIdx, pgIdx + 4000);
        const codeMatch = window.match(/\bcode\s*:\s*\\?"([0-9a-zA-Z]{4,8})\\?"/);
        const messageMatch = window.match(/\bmessage\s*:\s*\\?"([^"\\]{1,800})\\?"/);
        if (codeMatch || messageMatch) {
          return mapPgMessage(codeMatch ? codeMatch[1] : '', messageMatch ? messageMatch[1] : '');
        }
      }

      // Fallback: Prisma dumps often contain plain "ERROR:" lines.
      const errorLineMatch = msg.match(/\bERROR:\s*([^\n\r]+)/i);
      if (errorLineMatch) {
        const pgMessage = String(errorLineMatch[1] || '').trim();
        if (/row-level security|violates row-level security/i.test(pgMessage)) {
          return {
            errorCode: 'DB_RLS_DENIED',
            error: 'Gagal menyimpan training data: ditolak oleh Row Level Security (RLS) database. Pastikan user DB untuk Prisma punya akses INSERT ke tabel TrainingData.'
          };
        }
        if (/permission denied/i.test(pgMessage)) {
          return {
            errorCode: 'DB_PERMISSION_DENIED',
            error: 'Gagal menyimpan training data: database menolak akses (permission denied). Pastikan role user DB untuk Prisma punya hak INSERT/UPDATE di TrainingData.'
          };
        }
        if (/relation .* does not exist/i.test(pgMessage)) {
          return {
            errorCode: 'DB_SCHEMA_OUTDATED',
            error: 'Gagal menyimpan training data: tabel belum ada di database production. Jalankan migrasi Prisma (mis. prisma migrate deploy).' 
          };
        }
        if (/column .* does not exist/i.test(pgMessage)) {
          return {
            errorCode: 'DB_SCHEMA_OUTDATED',
            error: 'Gagal menyimpan training data: schema database production belum update (kolom tidak ditemukan). Jalankan migrasi Prisma (mis. prisma migrate deploy).' 
          };
        }
        if (/invalid\s+byte\s+sequence|unsupported\s+unicode|utf-?8|character\s+not\s+in\s+repertoire/i.test(pgMessage)) {
          return {
            errorCode: 'DB_TEXT_ENCODING',
            error: 'Gagal menyimpan training data: teks mengandung karakter yang tidak didukung database. Coba export ulang dokumen atau convert ke TXT sebelum upload.'
          };
        }
        const short = pgMessage.slice(0, 220);
        return {
          errorCode: 'DB_WRITE_FAILED',
          error: `Gagal menyimpan training data ke database: ${short}`
        };
      }

      // Other common phrases inside Prisma dumps.
      if (lower.includes('row-level security')) {
        return {
          errorCode: 'DB_RLS_DENIED',
          error: 'Gagal menyimpan training data: ditolak oleh Row Level Security (RLS) database. Pastikan user DB untuk Prisma punya akses INSERT ke tabel TrainingData.'
        };
      }
      if (lower.includes('permission denied')) {
        return {
          errorCode: 'DB_PERMISSION_DENIED',
          error: 'Gagal menyimpan training data: database menolak akses (permission denied). Pastikan role user DB untuk Prisma punya hak INSERT/UPDATE di TrainingData.'
        };
      }
      if (lower.includes('does not exist') && (lower.includes('column') || lower.includes('relation'))) {
        return {
          errorCode: 'DB_SCHEMA_OUTDATED',
          error: 'Gagal menyimpan training data: schema database production belum sesuai. Jalankan migrasi Prisma (mis. prisma migrate deploy) di environment production.'
        };
      }
      if (lower.includes('invalid byte sequence') || lower.includes('utf8') || lower.includes('utf-8')) {
        return {
          errorCode: 'DB_TEXT_ENCODING',
          error: 'Gagal menyimpan training data: teks mengandung karakter yang tidak didukung database. Coba export ulang dokumen atau convert ke TXT sebelum upload.'
        };
      }

      return {
        errorCode: 'DB_WRITE_FAILED',
        error: 'Gagal menyimpan training data ke database (konten dokumen mengandung karakter tidak valid atau metadata tidak sesuai).'
      };
    }
    if (/invalid\s+byte\s+sequence|unsupported\s+Unicode|UTF-?8/i.test(msg)) {
      return {
        errorCode: 'DB_TEXT_ENCODING',
        error: 'Gagal menyimpan training data: teks mengandung karakter yang tidak didukung database. Coba export ulang dokumen atau gunakan format TXT.'
      };
    }
    return {
      errorCode: err && err.code ? String(err.code) : 'PARSE_ERROR',
      error: msg
    };
  }

  // Parse file berdasarkan extension dan simpan ke database
  static async parseAndStoreFile(filePath, originalFilename, uploadedById = null, divisionKey = null, storedFilename = null, options = {}) {
    try {
      // Check file size first (prevent large files from causing memory issues)
      const stats = fs.statSync(filePath);
      const maxSize = parseInt(process.env.MAX_FILE_SIZE || String(15 * 1024 * 1024), 10); // 15MB default
      
      if (stats.size > maxSize) {
        throw new Error(`File terlalu besar (${(stats.size / 1024 / 1024).toFixed(2)}MB). Maksimal ${(maxSize / 1024 / 1024).toFixed(2)}MB`);
      }

      const ext = path.extname(originalFilename).toLowerCase();
      let content = '';

      switch (ext) {
        case '.txt':
          content = await this.parseTxt(filePath);
          break;
        case '.csv':
          content = await this.parseCsv(filePath);
          break;
        case '.pdf':
          content = await this.parsePdf(filePath);
          break;
        case '.doc':
          // DOC format lama membutuhkan konversi khusus
          throw new Error('File .DOC tidak didukung secara langsung. Silakan convert ke .DOCX terlebih dahulu menggunakan Microsoft Word atau LibreOffice.');
        case '.docx':
          content = await this.parseDocx(filePath);
          break;
        case '.xlsx':
        case '.xls':
          content = await this.parseExcel(filePath);
          break;
        case '.jpg':
        case '.jpeg':
        case '.png':
        case '.gif':
        case '.webp':
        case '.bmp':
        case '.tif':
        case '.tiff':
          try {
            content = this.buildImageTrainingContent(originalFilename, await this.parseImage(filePath), options);
          } catch (imageErr) {
            const imageMsg = imageErr && imageErr.message ? String(imageErr.message) : String(imageErr);
            const looksLikeNoReadableText =
              /tidak ada teks|no text|empty|kosong|kualitas terlalu rendah|could not read/i.test(imageMsg) &&
              !/requires|butuh|install|traineddata|language data|download|dependency|tesseract/i.test(imageMsg);

            if (!looksLikeNoReadableText) throw imageErr;

            logger.warn(
              { filename: originalFilename, err: imageMsg },
              '[FileParser] Image OCR produced no readable text; storing visual fallback content'
            );
            content = this.buildImageTrainingContent(originalFilename, '', options);
          }
          break;
        default:
          throw new Error(`Unsupported file format: ${ext}`);
      }

      if (!content || content.trim().length === 0) {
        if (ext === '.pdf') {
          throw new Error('PDF tidak memiliki teks (kemungkinan hasil scan). Silakan OCR/convert ke teks terlebih dulu.');
        }
        throw new Error('File is empty or could not be parsed');
      }

      const safeFilename = this.sanitizeFilenameForStorage(originalFilename);
      const sanitized = this.sanitizeTextForStorage(content);

      if (!sanitized || sanitized.trim().length === 0) {
        throw new Error('Konten hasil parsing kosong setelah normalisasi. Coba export ulang dokumen atau gunakan input manual.');
      }

      const maxStoredBytes = parseInt(process.env.MAX_TRAINING_CONTENT_BYTES || String(15 * 1024 * 1024), 10);
      const limited = this.limitTextToUtf8Bytes(sanitized, maxStoredBytes);
      const contentToStore = limited.text;

      const now = new Date();

      // Simpan ke database
      let training;
      try {
        training = await prisma.trainingData.create({
          data: {
            filename: safeFilename,
            storedFilename: storedFilename || null,
            content: contentToStore,
            source: 'upload',
            active: true,
            uploadedById: uploadedById || null,
            divisionKey: divisionKey || null,
            createdAt: now,
            updatedAt: now,
          }
        });
      } catch (e) {
        const isUploaderFkViolation =
          e &&
          String(e.code || '') === 'P2003' &&
          e.meta &&
          typeof e.meta.field_name === 'string' &&
          e.meta.field_name.toLowerCase().includes('uploadedbyid');

        if (isUploaderFkViolation) {
          logger.warn(
            { err: 'uploadedById FK violation; storing training without uploadedById' },
            '[FileParser] DB/schema fallback'
          );
          training = await prisma.trainingData.create({
            data: {
              filename: safeFilename,
              storedFilename: storedFilename || null,
              content: contentToStore,
              source: 'upload',
              active: true,
              uploadedById: null,
              divisionKey: divisionKey || null,
              createdAt: now,
              updatedAt: now,
            }
          });
        } else {
        // Backward compatibility: Prisma client OR production DB schema may not have optional fields.
        const msg = (e && e.message) ? String(e.message) : '';
        const missingOptionalFields =
          // Prisma client-side validation errors (schema mismatch)
          ((msg.includes('Unknown field') || msg.includes('Unknown argument')) &&
            (msg.includes('uploadedById') || msg.includes('uploadedBy') || msg.includes('divisionKey') || msg.includes('storedFilename'))) ||
          // Postgres/schema mismatch errors
          /column\s+"?(uploadedById|divisionKey|storedFilename)"?\s+does\s+not\s+exist/i.test(msg) ||
          /Unknown column\s+'(uploadedById|divisionKey|storedFilename)'/i.test(msg);

        if (missingOptionalFields) {
          logger.warn({ err: 'optional fields not available; creating training without metadata' }, '[FileParser] DB/schema fallback');
          logger.warn({ err: 'optional fields not available; creating training without metadata' }, '[FileParser] DB/schema fallback');
          training = await prisma.trainingData.create({
            data: {
              filename: safeFilename,
              content: contentToStore,
              source: 'upload',
              active: true,
              createdAt: now,
              updatedAt: now,
            }
          });
        } else {
          throw e;
        }
        }
      }

      logger.info({ trainingId: training.id }, '[FileParser] File parsed and stored');
      return {
        success: true,
        trainingDataId: training.id,
        content: contentToStore,
        wasTruncated: limited.wasTruncated,
        originalBytes: limited.originalBytes,
        finalBytes: limited.finalBytes,
      };
    } catch (err) {
      const rawMessage = err && err.message ? String(err.message) : String(err);
      const looksLikeInvocationDump =
        rawMessage.includes('Invalid `prisma.') ||
        rawMessage.includes('Invalid prisma.') ||
        rawMessage.includes('prisma.trainingData.create');
      const safeMsg = looksLikeInvocationDump
        ? 'DB write failed (Prisma invocation dump suppressed)'
        : (rawMessage.length > 400 ? rawMessage.slice(0, 400) + '…' : rawMessage);

      logger.error({ err: safeMsg, code: err && err.code ? String(err.code) : undefined }, '[FileParser] Error');
      const safe = this.toSafePersistError(err);
      return { 
        success: false, 
        error: safe.error,
        errorCode: safe.errorCode,
        prismaCode: err && err.code ? String(err.code) : null,
        prismaMeta: err && err.meta ? err.meta : null,
      };
    }
  }

  // Parse TXT file
  static async parseTxt(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    return content;
  }

  // Parse CSV file - convert to readable format
  static async parseCsv(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    
    // Format CSV ke readable text
    // Asumsi format: Question,Answer atau Key,Value
    const formatted = lines.map(line => {
      const parts = line.split(',');
      if (parts.length >= 2) {
        return `Q: ${parts[0].trim()}\nA: ${parts.slice(1).join(' ').trim()}`;
      }
      return line;
    }).join('\n\n');

    return formatted;
  }

  static buildPdfParsePageRenderer({ normalizeWhitespace = false, disableCombineTextItems = false } = {}) {
    return function renderPage(pageData) {
      return pageData
        .getTextContent({ normalizeWhitespace, disableCombineTextItems })
        .then((textContent) => {
          let lastY;
          let text = '';

          for (const item of textContent.items || []) {
            const str = item && typeof item.str === 'string' ? item.str : '';
            if (str) {
              if (lastY === item.transform[5] || !lastY) text += str;
              else text += `\n${str}`;
              lastY = item.transform[5];
            }

            if (item && item.hasEOL) text += '\n';
          }

          return text;
        });
    };
  }

  static async extractPdfTextWithPdfParse(filePath, options = {}, source = 'pdf-parse') {
    const pdfParse = require('pdf-parse');
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer, options);
    return {
      source,
      text: data && typeof data.text === 'string' ? data.text : '',
      numPages: data && data.numpages ? data.numpages : null,
    };
  }

  static async extractNativePdfText(filePath) {
    const attempts = [];

    const strategies = [
      {
        source: 'pdf-parse',
        options: {},
      },
      {
        source: 'pdf-parse:v1.10.100:loose',
        options: {
          version: 'v1.10.100',
          pagerender: this.buildPdfParsePageRenderer({ normalizeWhitespace: true, disableCombineTextItems: true }),
        },
      },
      {
        source: 'pdf-parse:v2.0.550:loose',
        options: {
          version: 'v2.0.550',
          pagerender: this.buildPdfParsePageRenderer({ normalizeWhitespace: true, disableCombineTextItems: true }),
        },
      },
    ];

    for (const strategy of strategies) {
      try {
        const parsed = await this.extractPdfTextWithPdfParse(filePath, strategy.options, strategy.source);
        const trimmed = parsed && parsed.text ? parsed.text.trim() : '';
        attempts.push({ source: parsed.source, ok: true, length: trimmed.length, numPages: parsed.numPages || null });
        if (trimmed.length > 0) return { ...parsed, attempts };
      } catch (err) {
        attempts.push({ source: strategy.source, ok: false, error: err && err.message ? String(err.message) : String(err) });
        logger.warn({ err: err.message, source: strategy.source }, '[FileParser] PDF native parsing strategy failed');
      }
    }

    const error = new Error('PDF native parsing failed with all extractors');
    error.attempts = attempts;
    throw error;
  }

  // Parse PDF file - simple text extraction (production: gunakan pdfparse)
  static async parsePdf(filePath) {
    try {
      const nativeResult = await this.extractNativePdfText(filePath);
      if (nativeResult && typeof nativeResult.text === 'string' && nativeResult.text.trim().length > 0) {
        const native = nativeResult.text;
        const sanitized = this.sanitizeTextForStorage(native);
        const nativeLength = sanitized ? sanitized.length : 0;
        const minNativeChars = Math.max(10, parseInt(process.env.PDF_MIN_NATIVE_TEXT_CHARS || '200', 10));
        const ocrFallbackMode = String(process.env.PDF_OCR_FALLBACK_MODE || 'empty-only').trim().toLowerCase();

        // Default behavior: only use OCR when native text is empty.
        // This keeps uploads working even if OCR runtime is flaky but the PDF still has a text layer.
        // Set PDF_OCR_FALLBACK_MODE=short-text to restore the older behavior.
        const shouldTryOcrFallback =
          process.env.ENABLE_OCR === 'true' &&
          (nativeLength === 0 || (ocrFallbackMode === 'short-text' && nativeLength < minNativeChars));

        if (!shouldTryOcrFallback) {
          logger.info({ length: native.length, source: nativeResult.source }, '[FileParser] PDF text extracted (native)');
          return native;
        }

        logger.info(
          {
            nativeLength: native.length,
            sanitizedLength: nativeLength,
            minNativeChars,
            source: nativeResult.source,
            ocrFallbackMode,
          },
          '[FileParser] PDF native text low-quality; attempting OCR fallback'
        );

        try {
          const ocrText = await this.ocrPdf(filePath);
          if (ocrText && ocrText.trim().length > 0) {
            logger.info('[FileParser] OCR fallback berhasil ekstrak teks dari PDF');
            return ocrText;
          }
        } catch (ocrErr) {
          logger.warn({ err: ocrErr.message }, '[FileParser] OCR fallback failed; using native text');
        }

        logger.info({ length: native.length, source: nativeResult.source }, '[FileParser] PDF text extracted (native)');
        return native;
      }
    } catch (err) {
      logger.warn({ err: err.message, attempts: err.attempts || undefined }, '[FileParser] PDF native parsing failed');
    }

    // Try OCR for scanned PDFs
    if (process.env.ENABLE_OCR === 'true') {
      logger.info('[FileParser] PDF seems to be scan, attempting OCR...');
      try {
        const ocrText = await this.ocrPdf(filePath);
        if (ocrText && ocrText.trim().length > 0) {
          logger.info('[FileParser] OCR berhasil ekstrak teks dari PDF scan');
          return ocrText;
        }
      } catch (ocrErr) {
        const ocrMsg = ocrErr && ocrErr.message ? String(ocrErr.message) : String(ocrErr);
        const ocrCode = ocrErr && ocrErr.code ? String(ocrErr.code) : '';
        logger.error({ err: ocrMsg, code: ocrCode || undefined }, '[FileParser] OCR gagal');

        // If OCR layer already classified the failure, propagate it.
        if (ocrCode && ocrCode.startsWith('OCR_') && ocrCode !== 'OCR_FAILED_LOW_QUALITY') {
          const error = new Error(ocrMsg);
          error.code = ocrCode;
          throw error;
        }

        // Throw error dengan tipe khusus untuk handling di admin
        const error = new Error('PDF adalah hasil scan berkualitas rendah. OCR tidak dapat membaca dengan baik. Solusi: (1) Gunakan form "Input Manual Teks", (2) Export/convert PDF ke format yang lebih baik (DOCX/TXT), atau (3) Ambil text manual dari dokumen asli dan paste di form manual input.');
        error.code = 'OCR_FAILED_LOW_QUALITY';
        throw error;
      }
    }

    // OCR disabled dan tidak ada text
    const error = new Error('PDF adalah hasil scan namun OCR tidak diaktifkan. Aktifkan OCR di .env atau gunakan PDF dengan embedded text.');
    error.code = 'OCR_DISABLED_FOR_SCAN';
    throw error;
  }

  // OCR PDF (scan) -> render ke gambar, lalu ekstrak teks
  static async ocrPdf(filePath) {
    let fromPath = null;
    let createWorker = null;
    try {
      ({ fromPath } = require('pdf2pic'));
    } catch (err) {
      const e = new Error('OCR butuh pdf2pic + ImageMagick/GraphicsMagick + Ghostscript. Install dependency terlebih dulu.');
      e.code = 'OCR_DEPS_MISSING';
      throw e;
    }

    try {
      ({ createWorker } = require('tesseract.js'));
    } catch (err) {
      const e = new Error('OCR butuh tesseract.js. Install dependency terlebih dulu.');
      e.code = 'OCR_DEPS_MISSING';
      throw e;
    }

    const maxPages = Math.max(1, parseInt(process.env.OCR_MAX_PAGES || '5', 10));
    const minConfidence = parseInt(process.env.OCR_MIN_CONFIDENCE || '5', 10);
    const scalesStr = process.env.OCR_SCALES || '1.5,2.0,2.5';
    const scales = scalesStr
      .split(',')
      .map(s => parseFloat(s.trim()))
      .filter(n => Number.isFinite(n) && n > 0);

    // IMPORTANT: pdf2pic `width/height` acts like a resize. If these are constant,
    // increasing `density`/`scale` will not actually improve the final pixel detail.
    // We scale the output size with `scale` so small fonts become OCR-readable.
    const baseDensity = Math.max(150, parseInt(process.env.OCR_DENSITY_BASE || '300', 10));
    const baseSize = Math.max(1200, parseInt(process.env.OCR_RENDER_BASE_SIZE || '2200', 10));
    const maxSize = Math.max(baseSize, parseInt(process.env.OCR_RENDER_MAX_SIZE || '3600', 10));
    const enablePreprocessing = String(process.env.OCR_PREPROCESSING || 'true').trim().toLowerCase() === 'true';

    let pageCount = 1;
    try {
      const pdfParse = require('pdf-parse');
      const dataBuffer = fs.readFileSync(filePath);
      const meta = await pdfParse(dataBuffer);
      if (meta && meta.numpages) {
        pageCount = meta.numpages;
      }
    } catch (err) {
      logger.warn({ err: err.message }, '[FileParser] OCR page count fallback');
    }

    const langs = process.env.OCR_LANGS || 'eng+ind';

    // Prefer local traineddata to avoid relying on CDN/network.
    // If OCR_LANG_PATH is not set but traineddata exists in project root, use it.
    const requestedLangPathRaw = process.env.OCR_LANG_PATH ? String(process.env.OCR_LANG_PATH) : '';
    const projectRootLangPath = path.resolve(process.cwd());
    const langCodes = String(langs)
      .split('+')
      .map(s => s.trim())
      .filter(Boolean);

    const normalizeLangPath = p => String(p || '').replace(/[\\/]+$/, '');
    const requestedLangPath = normalizeLangPath(requestedLangPathRaw);
    const candidateLocalLangPath = normalizeLangPath(projectRootLangPath);

    const isUrl = v => /^https?:\/\//i.test(String(v || ''));

    let workerOptions = {};
    if (requestedLangPath) {
      if (isUrl(requestedLangPath)) {
        workerOptions = { langPath: requestedLangPath };
      } else {
        const missing = langCodes.filter(code => !fs.existsSync(path.join(requestedLangPath, `${code}.traineddata`)));
        if (missing.length) {
          const e = new Error(
            `OCR language data tidak ditemukan di OCR_LANG_PATH (${requestedLangPath}): ${missing
              .map(m => `${m}.traineddata`)
              .join(', ')}`
          );
          e.code = 'OCR_LANG_DATA_MISSING';
          throw e;
        }
        workerOptions = { langPath: requestedLangPath, gzip: false };
      }
    } else {
      const allExistInRoot = langCodes.length > 0 && langCodes.every(code => fs.existsSync(path.join(candidateLocalLangPath, `${code}.traineddata`)));
      if (allExistInRoot) {
        workerOptions = { langPath: candidateLocalLangPath, gzip: false };
      }
    }

    let worker;
    try {
      worker = await createWorker(langs, 1, workerOptions);

      try {
        await worker.setParameters({
          preserve_interword_spaces: '1',
        });
      } catch {
        // ignore
      }

      let combined = '';
      const limit = Math.min(pageCount, maxPages);
      if (pageCount > limit) {
        logger.warn({ limit, pageCount }, '[FileParser] OCR page limit applied');
      }

      for (let page = 1; page <= limit; page += 1) {
        logger.info({ page, limit }, '[FileParser] OCR processing page');

        let bestScaleResult = { text: '', length: 0, scale: scales[0] };

        for (const scale of (scales.length ? scales : [1.0])) {
          try {
            const density = Math.min(1200, Math.round(baseDensity * scale));
            const size = Math.min(maxSize, Math.round(baseSize * scale));
            logger.info({ page, scale, density, size }, '[FileParser] Rendering PDF page for OCR');

            const converter = fromPath(filePath, {
              format: 'png',
              quality: 100,
              density,
              width: size,
              height: size,
              preserveAspectRatio: true,
              savePath: os.tmpdir(),
              saveFilename: `pdf-ocr-${Date.now()}-${page}`,
            });

            // Use ImageMagick instead of GraphicsMagick to reduce system deps.
            // NOTE: ImageMagick still needs Ghostscript to read PDFs.
            try {
              converter.setGMClass(true);
            } catch {
              // ignore
            }

            const rendered = await converter(page, { responseType: 'buffer' });
            const imageBuffer = rendered && rendered.buffer ? rendered.buffer : null;
            if (!imageBuffer || imageBuffer.length === 0) {
              throw new Error('pdf2pic produced empty buffer');
            }

            let preprocessedBuffer = null;
            if (enablePreprocessing) {
              try {
                const sharp = require('sharp');
                preprocessedBuffer = await sharp(imageBuffer)
                  .rotate()
                  .grayscale()
                  .normalize()
                  .sharpen()
                  .linear(1.25, -(0.25 * 128))
                  .threshold(140)
                  .png()
                  .toBuffer();
              } catch (preprocessErr) {
                logger.warn({ err: preprocessErr.message }, '[FileParser] OCR preprocessing failed; continuing');
              }
            }

            const buffersToTry = preprocessedBuffer ? [preprocessedBuffer, imageBuffer] : [imageBuffer];
            let scaleText = '';
            for (const buf of buffersToTry) {
              // Quick win: if we already got decent text, skip more attempts.
              if (scaleText.length >= 400) break;

              for (const psmMode of [6, 3, 11]) {
                try {
                  await worker.setParameters({
                    tessedit_pageseg_mode: String(psmMode),
                    user_defined_dpi: String(density),
                  });
                  const { data } = await worker.recognize(buf, { rotateAuto: true });
                  const text = (data && data.text ? String(data.text) : '').trim();
                  if (text.length > scaleText.length) scaleText = text;
                } catch (psmErr) {
                  logger.warn({ err: psmErr.message, page, scale, psmMode }, '[FileParser] OCR recognize failed for mode');
                }
              }
            }

            if (scaleText.length > bestScaleResult.length) {
              bestScaleResult = { text: scaleText, length: scaleText.length, scale };
            }
          } catch (scaleErr) {
            const msg = scaleErr && scaleErr.message ? String(scaleErr.message) : String(scaleErr);
            const lower = msg.toLowerCase();
            if (
              lower.includes('gm') ||
              lower.includes('graphicsmagick') ||
              lower.includes('imagemagick') ||
              lower.includes('convert') ||
              lower.includes('magick') ||
              lower.includes('ghostscript') ||
              lower.includes('gs') ||
              lower.includes('not authorized') ||
              lower.includes('attempt to perform an operation not allowed by the security policy')
            ) {
              const e = new Error(
                `OCR gagal render PDF ke gambar. Pastikan ImageMagick/GraphicsMagick + Ghostscript ter-install dan ImageMagick policy mengizinkan baca PDF. Detail: ${msg.slice(
                  0,
                  240
                )}`
              );
              e.code = 'OCR_DEPS_MISSING';
              throw e;
            }

            logger.warn({ err: msg, page, scale }, '[FileParser] OCR render failed; trying next scale');
          }
        }

        if (bestScaleResult.text && bestScaleResult.text.trim().length > 0) {
          combined += bestScaleResult.text + '\n';
        }
      }

      if (combined && combined.trim().length >= minConfidence) {
        logger.info({ length: combined.length }, '[FileParser] OCR success');
        return combined;
      }

      const low = new Error(`OCR extracted < ${minConfidence} characters. Terlalu sedikit untuk training data.`);
      low.code = 'OCR_FAILED_LOW_QUALITY';
      throw low;
    } catch (err) {
      const msg = err && err.message ? String(err.message) : String(err);
      const lower = msg.toLowerCase();
      if (
        lower.includes('network error while fetching') ||
        lower.includes('enotfound') ||
        lower.includes('eai_again') ||
        lower.includes('ecconnreset')
      ) {
        const e = new Error(
          'OCR gagal karena tidak bisa mengambil language data (network/CDN). Solusi: set `OCR_LANG_PATH` ke folder yang berisi `eng.traineddata`/`ind.traineddata`, atau pastikan server bisa akses internet.'
        );
        e.code = 'OCR_LANG_DOWNLOAD_FAILED';
        throw e;
      }
      throw err;
    } finally {
      try {
        if (worker) await worker.terminate();
      } catch {
        // ignore
      }
    }
  }

  // Parse DOCX file - simple extraction (production: gunakan docx parser)
  static async parseDocx(filePath) {
    try {
      // Check file size untuk prevent memory issues
      const stats = fs.statSync(filePath);
      const maxDocxSize = parseInt(process.env.MAX_FILE_SIZE || String(15 * 1024 * 1024), 10); // default 15MB
      
      if (stats.size > maxDocxSize) {
        throw new Error(`DOCX file terlalu besar (${(stats.size / 1024 / 1024).toFixed(2)}MB). Maksimal ${(maxDocxSize / 1024 / 1024).toFixed(2)}MB. Silakan compress atau split file.`);
      }

      // Try using docx-parser first (more memory efficient)
      try {
        const docx = require('docx-parser');
        const data = await docx.parseFile(filePath);
        if (data && data.text) {
          return data.text;
        }
      } catch (err) {
        console.warn('[FileParser] docx-parser not available, using fallback method');
      }
      
      // Fallback: DOCX is actually a ZIP, extract document.xml
      const AdmZip = require('adm-zip');
      try {
        const zip = new AdmZip(filePath);
        const docEntry = zip.getEntry('word/document.xml');
        if (docEntry) {
          const xmlContent = zip.readAsText(docEntry);
          
          // Limit content size untuk prevent memory overflow
          if (xmlContent.length > 15 * 1024 * 1024) { // 15MB XML limit
            throw new Error('Dokumen terlalu kompleks. Silakan gunakan file yang lebih sederhana.');
          }
          
          // Simple regex to extract text from XML
          // Remove all XML tags
          let text = xmlContent.replace(/<[^>]+>/g, ' ');
          // Clean up multiple spaces
          text = text.replace(/\s+/g, ' ').trim();
          
          // Limit output size
          const maxOutputSize = maxDocxSize; // cap output roughly to configured max
          if (text.length > maxOutputSize) {
            console.warn('[FileParser] DOCX output truncated due to size');
            text = text.substring(0, maxOutputSize) + '... [truncated]';
          }
          
          return text;
        }
      } catch (zipErr) {
        console.error('[FileParser] DOCX ZIP parsing failed:', zipErr.message);
        throw new Error(`Gagal membaca file DOCX: ${zipErr.message}. File mungkin corrupt atau terlalu kompleks.`);
      }
      
      throw new Error('File DOCX tidak memiliki konten teks yang dapat dibaca');
    } catch (err) {
      if (err.message.includes('terlalu besar') || err.message.includes('terlalu kompleks')) {
        throw err;
      }
      throw new Error(`Error parsing DOCX: ${err.message}`);
    }
  }

  // Parse Excel file (.xlsx, .xls)
  static async parseExcel(filePath) {
    try {
      // Try menggunakan node-xlsx atau xlsx package
      let XLSX;
      try {
        XLSX = require('xlsx');
      } catch (err) {
        throw new Error('Excel parsing requires "xlsx" package. Run: npm install xlsx');
      }

      const workbook = XLSX.readFile(filePath, {
        // Reduce work / features we don't need.
        cellHTML: false,
        cellNF: false,
        cellStyles: false,
        cellFormula: false
      });

      const maxSheetsRaw = parseInt(process.env.EXCEL_MAX_SHEETS || '10', 10);
      const maxSheets = (Number.isFinite(maxSheetsRaw) && maxSheetsRaw > 0) ? maxSheetsRaw : 10;
      const maxOutputCharsRaw = parseInt(process.env.EXCEL_MAX_OUTPUT_CHARS || String(2 * 1024 * 1024), 10);
      const maxOutputChars = (Number.isFinite(maxOutputCharsRaw) && maxOutputCharsRaw > 0) ? maxOutputCharsRaw : (2 * 1024 * 1024);

      let content = '';

      // Loop through all sheets and produce structured rows using sheet_to_json
      workbook.SheetNames.slice(0, maxSheets).forEach(sheetName => {
        content += `\n[Sheet: ${sheetName}]\n`;
        const worksheet = workbook.Sheets[sheetName];

        // Convert sheet to JSON rows preserving empty cells (defval: '')
        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
        if (rows && rows.length) {
          // If first row looks like headers, use them; otherwise produce positional columns
          const headerRow = rows[0].map(h => String(h || '').trim());
          const hasHeaders = headerRow.some(h => /prodi|program|penjelasan|yang dipelajari|cocok untuk|peluang kerja|hobi/i.test(h));

          for (let r = 1; r < rows.length; r += 1) {
            const row = rows[r] || [];
            if (row.every(cell => String(cell || '').trim() === '')) continue;

            if (hasHeaders) {
              // Map header -> value for clearer chunks
              const pairs = [];
              for (let c = 0; c < headerRow.length; c += 1) {
                const key = headerRow[c] || `col${c + 1}`;
                const val = typeof row[c] !== 'undefined' ? String(row[c]).trim() : '';
                if (val) pairs.push(`${key} : ${val}`);
              }
              if (pairs.length) content += pairs.join(' | ') + '\n';
            } else {
              // Fallback: join all non-empty cells with pipe
              const parts = row.map(cell => String(cell || '').trim()).filter(p => p);
              if (parts.length) content += parts.join(' | ') + '\n';
            }
            if (content.length > maxOutputChars) {
              content = content.slice(0, maxOutputChars) + '... [truncated]';
              break;
            }
          }
        }

        content += '\n';
      });

      if (workbook.SheetNames.length > maxSheets) {
        content += `\n... [truncated: only first ${maxSheets} sheets processed]\n`;
      }

      return content.trim();
    } catch (err) {
      console.error('[FileParser] Excel parsing failed:', err.message);
      throw new Error(`Failed to parse Excel file: ${err.message}`);
    }
  }

  // Parse Image file (JPG, PNG, GIF, WebP) menggunakan OCR
  static async parseImage(filePath) {
    try {
      let createWorker;
      try {
        ({ createWorker } = require('tesseract.js'));
      } catch (err) {
        throw new Error('Image OCR requires tesseract.js. Run: npm install tesseract.js');
      }

      console.log('[FileParser] Starting OCR on image:', path.basename(filePath));
      
      const langs = process.env.OCR_LANGS || 'eng+ind'; // English + Indonesian
      const worker = await createWorker(langs);
      
      // Recognize text from image dengan auto-rotation dan konfigurasi optimal
      const { data } = await worker.recognize(filePath, {
        rotateAuto: true,
        rotateRadians: 0,
      }, {
        tessedit_pageseg_mode: '1',     // PSM 1: Auto with OSD (Orientation Detection)
        tessedit_ocr_engine_mode: '1',  // OEM 1: Neural nets LSTM
      });
      
      let imageText = data.text || '';
      
      // Jika hasil OCR kosong atau sangat sedikit, coba rotasi manual
      if (imageText.trim().length < 10) {
        console.log(`[FileParser] OCR hasil minimal (${imageText.length} chars), mencoba rotasi manual...`);
        
        const rotations = [
          { angle: 90, radians: Math.PI / 2 },
          { angle: 180, radians: Math.PI },
          { angle: 270, radians: -Math.PI / 2 }
        ];
        
        let bestResult = { text: imageText, length: imageText.trim().length, angle: 0 };
        
        for (const rotation of rotations) {
          try {
            const rotatedData = await worker.recognize(filePath, {
              rotateRadians: rotation.radians,
            });
            
            const rotatedText = rotatedData.data.text || '';
            const rotatedLength = rotatedText.trim().length;
            
            console.log(`[FileParser] Image rotation ${rotation.angle}°: ${rotatedLength} characters`);
            
            if (rotatedLength > bestResult.length) {
              bestResult = { text: rotatedText, length: rotatedLength, angle: rotation.angle };
            }
          } catch (rotErr) {
            console.warn(`[FileParser] Image rotation ${rotation.angle}° failed:`, rotErr.message);
          }
        }
        
        if (bestResult.length > imageText.trim().length) {
          console.log(`[FileParser] Menggunakan hasil rotasi ${bestResult.angle}° (${bestResult.length} chars)`);
          imageText = bestResult.text;
        }
      }
      
      await worker.terminate();
      
      if (!imageText || imageText.trim().length === 0) {
        throw new Error('Tidak ada teks ditemukan di gambar. Gambar mungkin kosong, terbalik, atau kualitas terlalu rendah.');
      }

      console.log(`[FileParser] OCR completed. Extracted ${imageText.length} characters from image.`);
      
      return imageText.trim();
    } catch (err) {
      console.error('[FileParser] Image OCR failed:', err.message);
      throw new Error(`Failed to extract text from image: ${err.message}`);
    }
  }

  // Get all active training data (untuk AI engine)
  static async getAllTrainingData() {
    try {
      const data = await prisma.trainingData.findMany({
        where: { active: true },
        orderBy: { createdAt: 'desc' }
      });
      
      // Combine all content
      const combined = data.map(d => `[From ${d.filename}]\n${d.content}`).join('\n\n---\n\n');
      return combined;
    } catch (err) {
      console.error('[FileParser] getAllTrainingData error:', err.message);
      return '';
    }
  }

  // Deactivate training data
  static async deactivateTrainingData(trainingDataId) {
    try {
      await prisma.trainingData.update({
        where: { id: trainingDataId },
        data: { active: false }
      });

      try {
        const { removeTrainingFromIndex } = require('./ragEngine');
        if (typeof removeTrainingFromIndex === 'function') {
          const purge = removeTrainingFromIndex(trainingDataId);
          logger.info({ trainingDataId, purge }, '[FileParser] Purged deactivated training from RAG index');
        }
      } catch (e) {
        logger.warn({ err: e.message, trainingDataId }, '[FileParser] Failed to purge deactivated training from RAG index');
      }

      console.log(`[FileParser] Training data deactivated: ${trainingDataId}`);
      return { success: true };
    } catch (err) {
      console.error('[FileParser] deactivateTrainingData error:', err.message);
      return { success: false, error: err.message };
    }
  }

  // List all training data
  static async listTrainingData() {
    try {
      const isOptionalFieldUnavailable = (err) => {
        const msg = err && err.message ? String(err.message) : String(err || '');
        const code = err && err.code ? String(err.code) : '';
        return (
          code === 'P2022' ||
          /Unknown field|Unknown arg|Unknown argument/i.test(msg) ||
          /column .*does not exist/i.test(msg) ||
          /uploadedById|uploadedBy|divisionKey|ragIngest/i.test(msg)
        );
      };

      try {
        const data = await prisma.trainingData.findMany({
          select: {
            id: true,
            filename: true,
            divisionKey: true,
            active: true,
            createdAt: true,
            source: true,
            uploadedById: true,
            uploadedBy: { select: { id: true, username: true, displayName: true, role: true } }
          }
        });
        return data;
      } catch (e) {
        // Backward compatibility: older Prisma client/schema may not have uploadedById yet.
        const msg = (e && e.message) ? String(e.message) : '';
        if (isOptionalFieldUnavailable(e)) {
          logger.warn({ err: msg }, '[FileParser] uploader/division fields not available; listing training without extra metadata');
          const data = await prisma.trainingData.findMany({
            select: {
              id: true,
              filename: true,
              active: true,
              createdAt: true,
              source: true
            }
          });
          return data;
        }
        throw e;
      }
    } catch (err) {
      console.error('[FileParser] listTrainingData error:', err.message);
      return [];
    }
  }
}

module.exports = { FileParser };
