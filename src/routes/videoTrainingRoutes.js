const express = require('express');
const prisma = require('../db');
const { FileParser } = require('../engine/fileParser');
const { ingestTrainingData } = require('../engine/ragEngine');
const { sendTrainingUploadNotification } = require('../utils/emailNotifier');
const {
  upload,
  validateUploadRequest,
  handleMulterError,
  handleUploadResponse,
  cleanupUploadedFile,
} = require('../middleware/uploadSecurity');

const router = express.Router();
function computePublicBaseUrl(req) {
  const baseEnv = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  if (baseEnv) return baseEnv;

  const forwardedProto = req && req.headers && req.headers['x-forwarded-proto']
    ? String(req.headers['x-forwarded-proto']).split(',')[0].trim()
    : '';
  const proto = forwardedProto || (req && req.protocol) || 'http';
  const host = req && typeof req.get === 'function' ? req.get('host') : null;
  if (host) return `${proto}://${host}`;
  return '';
}

function buildTrainingReviewLink(req, trainingId) {
  const baseUrl = computePublicBaseUrl(req);
  if (!baseUrl || !trainingId) return null;
  return `${baseUrl}/admin/training/${encodeURIComponent(String(trainingId))}`;
}

function queueTrainingUploadNotification(req, payload = {}) {
  setImmediate(async () => {
    try {
      const notifyResult = await sendTrainingUploadNotification({
        uploaderDisplayName: req.user && req.user.displayName ? String(req.user.displayName) : null,
        uploaderUsername: req.user && req.user.username ? String(req.user.username) : null,
        uploaderRole: req.user && req.user.role ? String(req.user.role) : null,
        createdAt: new Date().toISOString(),
        link: payload.trainingDataId ? buildTrainingReviewLink(req, payload.trainingDataId) : null,
        ...payload,
      });
      if (!notifyResult.ok) {
        console.warn('[video-training] notification failed', notifyResult);
      }
    } catch (err) {
      console.warn('[video-training] notification error', err && err.message ? err.message : err);
    }
  });
}

// Endpoint: accept direct video file upload (multipart/form-data field `file`)
router.post(
  '/video-upload',
  validateUploadRequest,
  upload.single('file'),
  handleMulterError,
  handleUploadResponse,
  async (req, res, next) => {
    let uploadedPath = null;
    try {
      if (!req.uploadInfo) {
        return res.status(400).send({ error: 'File wajib diunggah' });
      }

      uploadedPath = req.uploadInfo.path;

      const originalName = req.uploadInfo.originalname;
      const storedFilename = req.uploadInfo.filename;

      const divisionKey = req.query && req.query.divisionKey ? String(req.query.divisionKey).trim() : null;
      const transcriptText = req.body && req.body.transcriptText ? String(req.body.transcriptText).trim() : null;
      const visualContext = req.body && req.body.visualContext ? String(req.body.visualContext).trim() : null;
      const sourceUrl = req.body && req.body.sourceUrl ? String(req.body.sourceUrl).trim() : null;

      // Let FileParser decide transcription (it checks OPENAI_API_KEY and VIDEO_TRANSCRIPTION_ENABLED)
      const result = await FileParser.parseAndStoreFile(
        uploadedPath,
        originalName,
        null, // uploadedById (null for admin/server uploads)
        divisionKey,
        storedFilename,
        { transcriptText, visualContext, sourceUrl, storageType: 'file' }
      );

      if (!result.success) {
        // keep uploaded file for inspection
        return res.status(422).send({ error: result.error, errorCode: result.errorCode, trainingDataId: result.trainingDataId || null });
      }

      // Trigger ingestion in background
      setImmediate(async () => {
        try {
          await ingestTrainingData(result.trainingDataId, result.content, 'video', {
            divisionKey,
            filename: originalName,
            uploadedById: null,
            metadata: { sourceUrl: sourceUrl || null }
          });
        } catch (err) {
          console.error('[video-upload] background ingest failed', err && err.message ? err.message : err);
        }
      });

      res.status(201).send({ ok: true, trainingDataId: result.trainingDataId, filename: originalName });

      queueTrainingUploadNotification(req, {
        filename: originalName,
        trainingDataId: result.trainingDataId,
        divisionKey,
        source: 'video-upload',
        fileSize: req.uploadInfo.size,
        contentPreview: result.content ? result.content.substring(0, 200) : null
      });
    } catch (err) {
      // cleanup on failure
      if (uploadedPath) {
        await cleanupUploadedFile(uploadedPath);
      }
      next(err);
    }
  }
);

// Existing video URL endpoint (kept for external URL based ingestion)
router.post('/training/video-url', async (req, res, next) => {
  try {
    const { url, title, divisionKey: divisionKeyRaw, transcriptText, storageType = 'firebase' } = req.body || {};
    if (!url) {
      return res.status(400).send({ error: 'url required' });
    }

    const safeTitle = String(title || 'video-training').trim() || 'video-training';
    const safeTranscript = String(transcriptText || '').trim();
    const safeSourceUrl = String(url).trim();

    const training = await prisma.trainingData.create({
      data: {
        filename: safeTitle,
        content: FileParser.sanitizeTextForStorage(
          FileParser.buildVideoTrainingContent(safeTitle, safeTranscript, { sourceUrl: safeSourceUrl })
        ),
        source: 'video',
        divisionKey: divisionKeyRaw || null,
        sourceUrl: safeSourceUrl,
        storageType: String(storageType || 'firebase').trim(),
        transcriptText: safeTranscript || null,
        processingStatus: safeTranscript ? 'ready' : 'pending',
        active: true,
      }
    });

    setImmediate(async () => {
      try {
        await ingestTrainingData(training.id, training.content, 'video', {
          divisionKey: divisionKeyRaw || null,
          filename: training.filename,
          sourceFile: training.filename,
          uploadedById: null,
          metadata: {
            sourceUrl: safeSourceUrl,
            storageType: String(storageType || 'firebase').trim(),
            transcriptText: safeTranscript || null,
          },
        });
      } catch (err) {
        console.error('[video-training] ingest failed', err && err.message ? err.message : err);
      }
    });

    res.status(201).send({ ok: true, trainingDataId: training.id, filename: safeTitle, sourceUrl: safeSourceUrl });

    queueTrainingUploadNotification(req, {
      filename: safeTitle,
      trainingDataId: training.id,
      divisionKey: divisionKeyRaw || null,
      source: 'video-url',
      fileSize: training.content.length,
      contentPreview: training.content.substring(0, 200)
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
