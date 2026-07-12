const fs = require('fs');
const path = require('path');
const multer = require('multer');
const logger = require('../logger');

// ===== FILE UPLOAD SECURITY CONFIGURATION =====

// Allowed file types untuk training data
const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const enableExcelUpload = String(process.env.ENABLE_EXCEL_UPLOAD || '').toLowerCase() === 'true';
// Safer production default: exclude Excel types due to known upstream `xlsx` advisories.
// To allow Excel ingestion, either:
// - set ENABLE_EXCEL_UPLOAD=true, or
// - explicitly set ALLOWED_FILE_TYPES to include `xls,xlsx`.
const defaultAllowedTypes = isProduction
  ? `txt,pdf,csv,docx,jpg,jpeg,png,gif,webp,bmp,tif,tiff${enableExcelUpload ? ',xls,xlsx' : ''}`
  : 'txt,pdf,csv,docx,xls,xlsx,jpg,jpeg,png,gif,webp,bmp,tif,tiff';
const configuredAllowedTypes = (process.env.ALLOWED_FILE_TYPES || defaultAllowedTypes)
  .split(',')
  .map((t) => t.trim().toLowerCase())
  .filter(Boolean);

// If ENABLE_EXCEL_UPLOAD=true, always allow xls/xlsx (even if ALLOWED_FILE_TYPES is set).
if (enableExcelUpload) {
  if (!configuredAllowedTypes.includes('xls')) configuredAllowedTypes.push('xls');
  if (!configuredAllowedTypes.includes('xlsx')) configuredAllowedTypes.push('xlsx');
}

const ALLOWED_FILE_TYPES = Array.from(new Set(configuredAllowedTypes));

// Max file size (default 15MB)
// Bisa dioverride via env MAX_FILE_SIZE (bytes)
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || String(15 * 1024 * 1024), 10); // 15MB

// Max files for bulk upload (default 10)
// Bisa dioverride via env MAX_BULK_FILES
const MAX_BULK_FILES = parseInt(process.env.MAX_BULK_FILES || '10', 10);

// Mime types mapping untuk validation
const MIME_TYPES = {
  'txt': 'text/plain',
  'pdf': 'application/pdf',
  'csv': 'text/csv',
  'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'xls': 'application/vnd.ms-excel',
  'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'png': 'image/png',
  'gif': 'image/gif',
  'webp': 'image/webp',
  'bmp': 'image/bmp',
  'tif': 'image/tiff',
  'tiff': 'image/tiff'
};

// Sanitize filename untuk prevent directory traversal
function sanitizeFilename(filename) {
  const raw = String(filename || '');

  // Remove path separators dan dangerous characters
  let cleaned = raw
    .replace(/\\/g, '') // Remove backslashes
    .replace(/\//g, '') // Remove forward slashes
    .replace(/\.\./g, '') // Remove double dots (directory traversal)
    .replace(/[<>:"|?*\x00-\x1f]/g, ''); // Remove invalid characters

  // Normalize whitespace (avoid trailing spaces that can cause odd stored filenames)
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // Common user mistake: whitespace before extension (e.g. "file .docx")
  cleaned = cleaned.replace(/\s+(\.[A-Za-z0-9]{1,10})$/g, '$1');

  // Cap length
  return cleaned.substring(0, 255);
}

// Get file extension dengan safe
function getFileExtension(filename) {
  const ext = path.extname(filename).toLowerCase().substring(1);
  return ext;
}

// Validate file berdasarkan extension dan mime type
function validateFileType(filename, mimetype) {
  const ext = getFileExtension(filename);
  
  // Check extension
  if (!ALLOWED_FILE_TYPES.includes(ext)) {
    return {
      valid: false,
      error: `File type '.${ext}' not allowed. Allowed types: ${ALLOWED_FILE_TYPES.join(', ')}`
    };
  }

  // Check mime type (basic validation)
  const expectedMime = MIME_TYPES[ext];
  if (expectedMime && mimetype !== expectedMime) {
    logger.warn({ expectedMime, mimetype, filename }, '[Upload Security] MIME type mismatch');
    // Ini hanya warning, tetap allow karena beberapa sistem mengirim MIME type berbeda
  }

  return { valid: true };
}

// Multer error handler
function handleMulterError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).send({
        error: `File size exceeds limit of ${(MAX_FILE_SIZE / 1024 / 1024).toFixed(2)}MB`
      });
    } else if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).send({ error: 'Too many files' });
    } else if (err.code === 'LIMIT_PART_COUNT') {
      return res.status(400).send({ error: 'Too many parts' });
    }
    return res.status(400).send({ error: `Upload error: ${err.message}` });
  }

  if (err) {
    const msg = err && err.message ? String(err.message) : String(err);
    const isClientError =
      msg.includes('File type') ||
      msg.includes('not allowed') ||
      msg.includes('Filename is required');
    return res.status(isClientError ? 400 : 500).send({ error: msg });
  }

  next();
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Pastikan uploads directory exist
    const uploadDir = path.join(__dirname, '..', '..', 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Sanitize filename
    const sanitized = sanitizeFilename(file.originalname);
    
    // Add timestamp untuk unique filename (prevent overwrite)
    const ext = path.extname(sanitized);
    const name = path.basename(sanitized, ext);
    const timestamp = Date.now();
    const unique = `${name}-${timestamp}${ext}`;
    
    cb(null, unique);
  }
});

// Multer file filter
const fileFilter = (req, file, cb) => {
  try {
    // Validate filename
    if (!file.originalname) {
      return cb(new Error('Filename is required'), false);
    }

    // Validate file type
    const validation = validateFileType(file.originalname, file.mimetype);
    if (!validation.valid) {
      logger.warn({ filename: file.originalname }, '[Upload Security] Invalid file type');
      return cb(new Error(validation.error), false);
    }

    // File size check (multer juga akan check, ini untuk early exit)
    // Akan di-handle oleh multer limits juga
    
    logger.info({ filename: file.originalname, size: file.size }, '[Upload] File accepted');
    cb(null, true);
  } catch (err) {
    logger.error({ err: err.message }, '[Upload] File filter error');
    cb(err, false);
  }
};

function createUploadWithLimits({ maxFiles }) {
  const files = Number.isFinite(maxFiles) ? Math.max(1, Math.floor(maxFiles)) : 1;
  return multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
      fileSize: MAX_FILE_SIZE,
      files,
      // parts must be >= files + fields + some overhead
      parts: Math.max(files + 12, 20),
      fields: 10,
    },
  });
}

// Create multer instances dengan security config
const upload = createUploadWithLimits({ maxFiles: 1 });
const uploadBulk = createUploadWithLimits({ maxFiles: MAX_BULK_FILES });

// Middleware: validate upload request SEBELUM multer process
function validateUploadRequest(req, res, next) {
  try {
    logger.info({ user: req.user || null }, '[Upload] Validating upload request');
    
    // Auth sudah di-check oleh verifyToken middleware (sebelum route ini)
    // Cukup pass ke next
    next();
  } catch (err) {
    logger.error({ err: err.message }, '[Upload] Validation error');
    res.status(500).send({ error: err.message });
  }
}

// Middleware: handle upload response
function handleUploadResponse(req, res, next) {
  logger.info({ filename: req.file && req.file.originalname, size: req.file && req.file.size }, '[Upload] Handling upload response');
  
  if (!req.file) {
    logger.error('[Upload] No file in request');
    return res.status(400).send({ error: 'No file uploaded' });
  }

  // Return file info (tanpa path yang bisa leak info)
  const originalname = (typeof req.file.originalname === 'string' && req.file.originalname.trim())
    ? req.file.originalname
    : path.basename(req.file.path || req.file.filename || 'uploaded-file');

  req.uploadInfo = {
    originalname,
    filename: req.file.filename,
    size: req.file.size,
    mimetype: req.file.mimetype,
    path: req.file.path // For internal use only
  };

  logger.info({ filename: req.uploadInfo.originalname }, '[Upload] Upload info set');
  next();
}

function handleUploadResponseMultiple(req, res, next) {
  const files = Array.isArray(req.files) ? req.files : [];

  if (!files.length) {
    logger.error('[Upload] No files in request');
    return res.status(400).send({ error: 'No files uploaded' });
  }

  req.uploadInfos = files.map((f) => ({
    originalname: f.originalname,
    filename: f.filename,
    size: f.size,
    mimetype: f.mimetype,
    path: f.path,
  }));

  next();
}

// Cleanup uploaded file jika ada error
async function cleanupUploadedFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.info({ filePath }, '[Upload] Cleaned up file');
    }
  } catch (err) {
    logger.error({ filePath, err: err.message }, '[Upload] Cleanup error');
  }
}

module.exports = {
  upload,
  uploadBulk,
  validateUploadRequest,
  handleUploadResponse,
  handleUploadResponseMultiple,
  handleMulterError,
  cleanupUploadedFile,
  sanitizeFilename,
  getFileExtension,
  validateFileType,
  MAX_FILE_SIZE,
  MAX_BULK_FILES,
  ALLOWED_FILE_TYPES
};

