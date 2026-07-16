const express = require('express');
const prisma = require('../db');
const { FileParser } = require('../engine/fileParser');
const { ingestTrainingData } = require('../engine/ragEngine');
const {
  upload,
  validateUploadRequest,
  handleMulterError,
  handleUploadResponse,
  cleanupUploadedFile,
} = require('../middleware/uploadSecurity');

const router = express.Router();

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
  } catch (err) {
    next(err);
  }
});

module.exports = router;
