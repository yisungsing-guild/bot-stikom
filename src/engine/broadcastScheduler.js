const prisma = require('../db');
const logger = require('../logger');
const { sanitizeWhatsappText } = require('../utils/textSanitizer');

// Broadcast Scheduler - memproses broadcast yang dijadwalkan
class BroadcastScheduler {
  constructor(provider, interval = 10000) {
    this.provider = provider;
    this.interval = interval; // check every 10 seconds
    this.isRunning = false;
  }

  // Start scheduler
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info({ interval: this.interval }, '[BroadcastScheduler] Started');
    this.scheduleCheck();
  }

  // Stop scheduler
  stop() {
    this.isRunning = false;
    logger.info('[BroadcastScheduler] Stopped');
  }

  // Recursive check loop
  scheduleCheck() {
    if (!this.isRunning) return;
    
    setTimeout(() => {
      this.processScheduled().catch(err => {
        logger.error({ err: err.message }, '[BroadcastScheduler Error]');
      });
      this.scheduleCheck();
    }, this.interval);
  }

  // Check dan proses broadcast yang sudah waktunya
  async processScheduled() {
    try {
      // Recovery: requeue broadcast yang stuck di in_progress terlalu lama
      // (mis. proses mati di tengah pengiriman)
      await this.recoverStaleInProgress();

      // Ambil broadcast yang status = 'queued' atau 'scheduled' dan waktunya sudah tiba
      const now = new Date();
      const candidates = await prisma.broadcast.findMany({
        where: {
          status: { in: ['queued', 'scheduled'] },
          scheduledAt: { lte: now }
        },
        take: 5 // ambil beberapa kandidat untuk diclaim satu per satu
      });

      for (const candidate of candidates) {
        try {
          // Coba claim secara atomik: ubah status menjadi in_progress hanya jika
          // masih queued/scheduled. updateMany mengembalikan count yang bisa
          // dipakai untuk mengetahui apakah klaim berhasil (multi-instance safe).
          const result = await prisma.broadcast.updateMany({
            where: {
              id: candidate.id,
              status: { in: ['queued', 'scheduled'] },
              scheduledAt: { lte: now }
            },
            data: { status: 'in_progress' }
          });

          if (!result || result.count === 0) {
            // Sudah diklaim oleh instance lain
            continue;
          }

          // Ambil record terbaru setelah klaim
          const broadcast = await prisma.broadcast.findUnique({ where: { id: candidate.id } });
          if (!broadcast) continue;

          await this.processBroadcast(broadcast);
        } catch (err) {
          logger.error({ err: err.message, candidateId: candidate.id }, '[BroadcastScheduler] claim/process error');
        }
      }
    } catch (err) {
      logger.error({ err: err.message }, '[BroadcastScheduler] processScheduled error');
    }
  }

  async recoverStaleInProgress() {
    try {
      const staleMs = parseInt(process.env.STALE_BROADCAST_MS || '600000', 10); // default 10 menit
      const now = Date.now();
      const staleBefore = new Date(now - (Number.isFinite(staleMs) ? staleMs : 600000));

      const result = await prisma.broadcast.updateMany({
        where: {
          status: 'in_progress',
          updatedAt: { lt: staleBefore }
        },
        data: { status: 'queued' }
      });

      if (result && result.count) {
        logger.warn({ count: result.count, staleMs }, '[BroadcastScheduler] Re-queued stale in_progress broadcasts');
      }
    } catch (err) {
      logger.error({ err: err.message }, '[BroadcastScheduler] recoverStaleInProgress error');
    }
  }

  // Process satu broadcast
  async processBroadcast(broadcast) {
    try {
      logger.info({ id: broadcast.id }, '[BroadcastScheduler] Processing broadcast');

      // NOTE: status sudah di-set menjadi 'in_progress' oleh caller (claim atomik).

      // Tentukan recipient list
      let recipients = [];
      if (broadcast.recipientList === 'all_opted_in') {
        // Ambil semua chat yang belum opt-out
        const chats = await prisma.chat.findMany({
          where: { optIn: true },
          select: { chatId: true }
        });
        recipients = chats.map(c => c.chatId);
      } else if (broadcast.recipientList) {
        try {
          if (Array.isArray(broadcast.recipientList)) {
            recipients = broadcast.recipientList;
          } else if (typeof broadcast.recipientList === 'string') {
            // Legacy: recipientList stored as JSON stringified array.
            recipients = JSON.parse(broadcast.recipientList);
          } else {
            // Prisma Json can also return objects; treat unknown shapes as empty.
            recipients = [];
          }
        } catch (e) {
          logger.error({ err: e.message, broadcastId: broadcast.id }, '[BroadcastScheduler] Invalid recipientList JSON');
          recipients = [];
        }
      }

      // Resume support: jangan kirim ulang ke chatId yang sudah sukses terkirim
      const sentLogs = await prisma.broadcastLog.findMany({
        where: { broadcastId: broadcast.id, status: 'sent' },
        select: { chatId: true }
      });
      const alreadySent = new Set(sentLogs.map(l => l.chatId));
      const failedCountAlready = await prisma.broadcastLog.count({
        where: { broadcastId: broadcast.id, status: 'failed' }
      });
      const recipientsToSend = recipients.filter(chatId => !alreadySent.has(chatId));

      logger.info(
        { broadcastId: broadcast.id, recipients: recipients.length, remaining: recipientsToSend.length },
        '[BroadcastScheduler] Sending broadcast'
      );

      if (recipientsToSend.length === 0) {
        const [sentCountTotal, failedCountTotal] = await Promise.all([
          prisma.broadcastLog.count({ where: { broadcastId: broadcast.id, status: 'sent' } }),
          prisma.broadcastLog.count({ where: { broadcastId: broadcast.id, status: 'failed' } })
        ]);

        await prisma.broadcast.update({
          where: { id: broadcast.id },
          data: {
            status: 'completed',
            sentCount: sentCountTotal,
            failedCount: failedCountTotal,
            completedAt: new Date()
          }
        });

        logger.info({ broadcastId: broadcast.id, sentCountTotal, failedCountTotal }, '[BroadcastScheduler] Broadcast already completed');
        return;
      }

      // Kirim ke setiap recipient dengan retry + exponential backoff
      const maxRetries = parseInt(process.env.MAX_SEND_RETRIES || '3', 10);
      const baseDelay = parseInt(process.env.BASE_SEND_DELAY_MS || '100', 10);

      let sentCount = 0;
      let failedCount = 0;

      const progressUpdateEvery = parseInt(process.env.BROADCAST_PROGRESS_UPDATE_EVERY || '25', 10);
      let processedSinceUpdate = 0;

      for (const chatId of recipientsToSend) {
        let attempts = 0;
        let lastError = null;
        const outboundBody = sanitizeWhatsappText(broadcast.body);

        while (attempts < maxRetries) {
          try {
            await this.provider.sendMessage(chatId, outboundBody);

            await prisma.broadcastLog.create({
              data: {
                broadcastId: broadcast.id,
                chatId,
                status: 'sent',
                sentAt: new Date()
              }
            });

            sentCount++;
            lastError = null;
            break; // sukses
          } catch (err) {
            attempts++;
            lastError = err;
            logger.warn({ chatId, attempt: attempts, err: err.message }, '[BroadcastScheduler] send attempt failed');

            if (attempts < maxRetries) {
              const delay = Math.pow(2, attempts) * baseDelay;
              await new Promise(resolve => setTimeout(resolve, delay));
              continue;
            }
          }
        }

        if (lastError) {
          logger.error({ chatId, err: lastError.message }, '[BroadcastScheduler] Failed to send after retries');
          await prisma.broadcastLog.create({
            data: {
              broadcastId: broadcast.id,
              chatId,
              status: 'failed',
              error: lastError.message
            }
          });
          failedCount++;
        }

        processedSinceUpdate++;
        if (progressUpdateEvery > 0 && processedSinceUpdate >= progressUpdateEvery) {
          processedSinceUpdate = 0;
          await prisma.broadcast.update({
            where: { id: broadcast.id },
            data: {
              // Keep-alive + best-effort progress for UI (final counts are recalculated below)
              sentCount: alreadySent.size + sentCount,
              failedCount: failedCountAlready + failedCount
            }
          }).catch(() => {});
        }

        // Throttle between messages a little to avoid provider limits
        await new Promise(resolve => setTimeout(resolve, baseDelay));
      }

      // Recalculate counts from logs for accuracy (resume-safe)
      const [sentCountTotal, failedCountTotal] = await Promise.all([
        prisma.broadcastLog.count({ where: { broadcastId: broadcast.id, status: 'sent' } }),
        prisma.broadcastLog.count({ where: { broadcastId: broadcast.id, status: 'failed' } })
      ]);

      await prisma.broadcast.update({
        where: { id: broadcast.id },
        data: {
          status: 'completed',
          sentCount: sentCountTotal,
          failedCount: failedCountTotal,
          completedAt: new Date()
        }
      });

      logger.info({ broadcastId: broadcast.id, sentCount: sentCountTotal, failedCount: failedCountTotal }, '[BroadcastScheduler] Broadcast completed');
    } catch (err) {
      logger.error({ err: err.message, broadcastId: broadcast.id }, '[BroadcastScheduler] processBroadcast error');
      
      // Mark sebagai failed
      await prisma.broadcast.update({
        where: { id: broadcast.id },
        data: { status: 'failed' }
      }).catch(() => {});
    }
  }
}

module.exports = { BroadcastScheduler };
