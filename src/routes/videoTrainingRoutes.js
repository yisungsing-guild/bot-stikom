const express = require('express');
const prisma = require('../db');
const { FileParser } = require('../engine/fileParser');
const { ingestTrainingData } = require('../engine/ragEngine');

const router = express.Router();

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
