const prisma = require('../db');
const logger = require('../logger');

const DEFAULT_QUESTIONS_RECAP_CACHE_MS = 300000; // 5 minutes
const MAX_QUESTIONS_RECAP_CACHE_ENTRIES = 10;

// In-memory cache for expensive recap computation.
// Process-local (fine for current PM2 config: instances=1).
const questionsRecapCache = new Map();

function getQuestionsRecapCacheMs() {
  const raw = process.env.ANALYTICS_QUESTIONS_RECAP_CACHE_MS || process.env.ANALYTICS_RECAP_CACHE_MS;
  const n = parseInt(String(raw || ''), 10);
  if (Number.isFinite(n) && n >= 0) return n;
  return DEFAULT_QUESTIONS_RECAP_CACHE_MS;
}

// Analytics Engine - track retention, cohort analysis, engagement metrics
class AnalyticsEngine {
  static normalizeQuestion(text) {
    let s = String(text || '').toLowerCase();
    s = s.replace(/\s+/g, ' ').trim();
    if (!s) return '';

    // Strip common chat fillers to reduce duplicates.
    // Keep this conservative to avoid losing meaning.
    s = s
      .replace(/^(halo|hai|hi|ass?alam(u)?alaikum|pagi|siang|sore|malam)\b\s*/g, '')
      .replace(/^(kak|min|admin|gan|bro|sis|pak|bu)\b\s*/g, '')
      .replace(/^(saya\s+(ingin|mau)\s+)?(tanya|bertanya|nanya|mau\s+nanya)\b\s*/g, '')
      .replace(/^(mohon|tolong|boleh|bisa)\b\s*/g, '')
      .trim();

    // Normalize program mentions a bit.
    s = s
      .replace(/\bprogram\s+studi\b/g, 'prodi')
      .replace(/\bsistem\s+informasi\b/g, 'si')
      .replace(/\bteknologi\s+informasi\b/g, 'ti')
      .replace(/\bbisnis\s+digital\b/g, 'bd')
      .replace(/\bsistem\s+komputer\b/g, 'sk');

    // Remove punctuation/symbol noise.
    s = s
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return s;
  }

  static shouldIncludeUserMessageForRecap(text) {
    const raw = String(text || '').trim();
    if (!raw) return false;

    // Keep short but meaningful fee/program questions (e.g., "biaya sk").
    if (raw.length >= 6) return true;

    // Keep if it looks like a question.
    if (/[?]/.test(raw)) return true;
    const t = raw.toLowerCase();
    if (/^(apa|siapa|kapan|dimana|di\s+mana|berapa|bagaimana|gimana|kenapa|mengapa)\b/.test(t)) return true;

    return false;
  }

  static categorizeDivision(text) {
    const t = String(text || '').toLowerCase();
    if (!t.trim()) return 'lainnya';

    // Akademik
    if (/(perwalian|krs\b|khs\b|sks\b|perkuliahan|jadwal\s*(kuliah|perkuliahan|ujian|uts|uas|masuk\s*kuliah)|kalender\s+akademik|nilai|transkrip|semester|cuti\s+akademik|skripsi|yudisium|wisuda|bimbingan|sidang)/.test(t)) {
      return 'akademik';
    }

    // Keuangan
    if (/(biaya|pembayaran|bayar\b|dpp\b|ukt\b|spp\b|cicil|cicilan|angsuran|tagihan|invoice|kwitansi|denda|potongan|diskon|refund|pengembalian|uang\s+kembali)/.test(t)) {
      return 'keuangan';
    }

    // PMB / Marketing
    if (/(pmb\b|pendaftaran|daftar\b|registrasi|gelombang|syarat|berkas|alur|cara\s+daftar|jalur\s+masuk|brosur|open\s*house|info\s+penerimaan)/.test(t)) {
      return 'pmb';
    }

    // Program Studi
    if (/(prodi|jurusan|program\s+studi|sistem\s+informasi|teknologi\s+informasi|bisnis\s+digital|sistem\s+komputer|\bsi\b|\bti\b|\bbd\b|\bsk\b)/.test(t)) {
      return 'prodi';
    }

    // Beasiswa
    if (/(beasiswa|kip\b|kartu\s+indonesia\s+pintar)/.test(t)) {
      return 'beasiswa';
    }

    return 'lainnya';
  }

  // Global recap of frequently asked user questions (across all sessions).
  // NOTE: this is limited by how many messages are retained in Session.data.messages.
  static async getGlobalQuestionRecap(opts = {}) {
    const limitSessionsRaw = typeof opts.limitSessions === 'number' ? opts.limitSessions : 5000;
    const topRaw = typeof opts.top === 'number' ? opts.top : 12;

    const limitSessions = Math.min(Math.max(Math.trunc(limitSessionsRaw) || 5000, 1), 20000);
    const top = Math.min(Math.max(Math.trunc(topRaw) || 12, 1), 50);

    const cacheMs = getQuestionsRecapCacheMs();
    const cacheKey = `${limitSessions}:${top}`;
    const now = Date.now();

    if (cacheMs > 0) {
      const cached = questionsRecapCache.get(cacheKey);
      if (cached && cached.value && now < cached.expiresAt) {
        return cached.value;
      }

      // Stale-while-revalidate: return stale immediately, refresh in background.
      if (cached && cached.value && now >= cached.expiresAt) {
        if (!cached.refreshing) {
          cached.refreshing = this._computeGlobalQuestionRecap({ limitSessions, top })
            .then((val) => {
              cached.value = val;
              cached.expiresAt = Date.now() + cacheMs;
              return val;
            })
            .catch((err) => {
              logger.error({ err: err && err.message ? err.message : String(err) }, '[Analytics] getGlobalQuestionRecap refresh error');
              return cached.value;
            })
            .finally(() => {
              cached.refreshing = null;
            });
        }
        return cached.value;
      }

      if (cached && cached.refreshing) {
        return cached.refreshing;
      }
    }

    const computePromise = this._computeGlobalQuestionRecap({ limitSessions, top });
    if (cacheMs > 0) {
      const entry = {
        value: null,
        expiresAt: 0,
        refreshing: computePromise
      };
      questionsRecapCache.set(cacheKey, entry);
      while (questionsRecapCache.size > MAX_QUESTIONS_RECAP_CACHE_ENTRIES) {
        const oldestKey = questionsRecapCache.keys().next().value;
        if (!oldestKey) break;
        questionsRecapCache.delete(oldestKey);
      }

      try {
        const val = await computePromise;
        entry.value = val;
        entry.expiresAt = Date.now() + cacheMs;
        entry.refreshing = null;
        return val;
      } catch (err) {
        entry.refreshing = null;
        logger.error({ err: err && err.message ? err.message : String(err) }, '[Analytics] getGlobalQuestionRecap error');
        const fallback = { sessionsScanned: 0, totalUserMessages: 0, includedUserMessages: 0, uniqueQuestions: 0, top: [], byDivision: {} };
        entry.value = fallback;
        entry.expiresAt = Date.now() + cacheMs;
        return fallback;
      }
    }

    return computePromise;
  }

  static async _computeGlobalQuestionRecap({ limitSessions, top }) {
    try {
      const sessions = await prisma.session.findMany({
        orderBy: { updatedAt: 'desc' },
        take: limitSessions,
        select: { data: true }
      });

      const counts = new Map();
      const byDivisionCounts = new Map();
      let totalUserMessages = 0;
      let includedUserMessages = 0;

      for (const s of (sessions || [])) {
        const data = s && s.data ? s.data : {};
        const messages = Array.isArray(data.messages) ? data.messages : [];

        // Cheap total user message count for reporting.
        for (const m of messages) {
          if (m && m.direction === 'user') totalUserMessages += 1;
        }

        const questionCounts = (data && typeof data === 'object' && data.questionCounts && typeof data.questionCounts === 'object')
          ? data.questionCounts
          : null;

        // Fast path: aggregate per-session rollups if present.
        if (questionCounts) {
          for (const [q, cRaw] of Object.entries(questionCounts || {})) {
            const question = String(q || '').trim();
            const count = Number(cRaw || 0);
            if (!question || !Number.isFinite(count) || count <= 0) continue;

            includedUserMessages += count;
            counts.set(question, (counts.get(question) || 0) + count);

            const div = this.categorizeDivision(question);
            if (!byDivisionCounts.has(div)) byDivisionCounts.set(div, new Map());
            const dMap = byDivisionCounts.get(div);
            dMap.set(question, (dMap.get(question) || 0) + count);
          }
          continue;
        }

        // Legacy fallback: scan message log if rollup not available.
        for (const m of messages) {
          if (!m || m.direction !== 'user') continue;
          const raw = (m.message || '').toString().trim();
          if (!raw) continue;
          if (!this.shouldIncludeUserMessageForRecap(raw)) continue;
          const key = this.normalizeQuestion(raw);
          if (!key) continue;
          includedUserMessages += 1;
          counts.set(key, (counts.get(key) || 0) + 1);

          const div = this.categorizeDivision(raw);
          if (!byDivisionCounts.has(div)) byDivisionCounts.set(div, new Map());
          const dMap = byDivisionCounts.get(div);
          dMap.set(key, (dMap.get(key) || 0) + 1);
        }
      }

      const topList = Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, top)
        .map(([question, count]) => ({ question, count }));

      const divisionOrder = ['akademik', 'keuangan', 'pmb', 'prodi', 'beasiswa', 'lainnya'];
      const byDivision = {};
      for (const div of divisionOrder) {
        const dMap = byDivisionCounts.get(div);
        const dTop = dMap
          ? Array.from(dMap.entries())
              .sort((a, b) => b[1] - a[1])
              .slice(0, top)
              .map(([question, count]) => ({ question, count }))
          : [];
        byDivision[div] = {
          uniqueQuestions: dMap ? dMap.size : 0,
          top: dTop
        };
      }

      return {
        sessionsScanned: Array.isArray(sessions) ? sessions.length : 0,
        totalUserMessages,
        includedUserMessages,
        uniqueQuestions: counts.size,
        top: topList,
        byDivision
      };
    } catch (err) {
      logger.error({ err: err.message }, '[Analytics] getGlobalQuestionRecap error');
      return { sessionsScanned: 0, totalUserMessages: 0, includedUserMessages: 0, uniqueQuestions: 0, top: [], byDivision: {} };
    }
  }

  // Get retention rate - % user aktif pada hari ke-N
  // params: { days: [1, 3, 7, 30] }
  static async getRetentionRate(days = [1, 3, 7, 30]) {
    try {
      const results = {};
      
      for (const day of days) {
        const beforeDate = new Date();
        beforeDate.setDate(beforeDate.getDate() - day);
        
        // Hitung total unique users
        const totalUsers = await prisma.chat.findMany({
          where: {
            lastSeenAt: { lte: beforeDate }
          },
          select: { chatId: true },
          distinct: ['chatId']
        });

        // Hitung users yang aktif pada periode tersebut
        const activeUsers = await prisma.chat.findMany({
          where: {
            lastSeenAt: {
              gte: beforeDate,
              lte: new Date()
            }
          },
          select: { chatId: true },
          distinct: ['chatId']
        });

        const rate = totalUsers.length > 0 
          ? ((activeUsers.length / totalUsers.length) * 100).toFixed(2)
          : 0;

        results[`day_${day}`] = {
          totalUsers: totalUsers.length,
          activeUsers: activeUsers.length,
          retentionRate: parseFloat(rate)
        };
      }

      return results;
    } catch (err) {
      logger.error({ err: err.message }, '[Analytics] getRetentionRate error');
      return {};
    }
  }

  // Get cohort analysis - group user registration & track retention
  static async getCohortAnalysis() {
    try {
      const chats = await prisma.chat.findMany({
        select: { chatId: true, lastSeenAt: true }
      });

      // Group by week/month
      const cohorts = {};
      
      chats.forEach(chat => {
        const weekKey = this.getWeekKey(chat.lastSeenAt);
        if (!cohorts[weekKey]) {
          cohorts[weekKey] = {
            joined: 0,
            active: 0,
            retention: 0
          };
        }
        cohorts[weekKey].joined++;
        
        // Check if active dalam 7 hari terakhir
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        if (chat.lastSeenAt >= sevenDaysAgo) {
          cohorts[weekKey].active++;
        }
      });

      // Calculate retention rate per cohort
      Object.keys(cohorts).forEach(key => {
        const cohort = cohorts[key];
        cohort.retention = cohort.joined > 0 
          ? ((cohort.active / cohort.joined) * 100).toFixed(2)
          : 0;
      });

      return cohorts;
    } catch (err) {
      logger.error({ err: err.message }, '[Analytics] getCohortAnalysis error');
      return {};
    }
  }

  // Get handover/transfer rate
  static async getHandoverRate() {
    try {
      const totalChats = await prisma.chat.count();
      const handoverChats = await prisma.chat.count({
        where: { status: 'HUMAN' }
      });

      const rate = totalChats > 0 
        ? ((handoverChats / totalChats) * 100).toFixed(2)
        : 0;

      return {
        totalChats,
        handoverChats,
        handoverRate: parseFloat(rate)
      };
    } catch (err) {
      logger.error({ err: err.message }, '[Analytics] getHandoverRate error');
      return { totalChats: 0, handoverChats: 0, handoverRate: 0 };
    }
  }

  // Get popular topics/keywords (based on FSM menu selections)
  static async getPopularTopics() {
    try {
      const sessions = await prisma.session.findMany({
        select: { state: true }
      });

      const topicCount = {};
      sessions.forEach(session => {
        if (session.state && session.state !== 'root') {
          topicCount[session.state] = (topicCount[session.state] || 0) + 1;
        }
      });

      // Sort by count descending
      const sorted = Object.entries(topicCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10) // Top 10
        .map(([topic, count]) => ({ topic, count }));

      return sorted;
    } catch (err) {
      logger.error({ err: err.message }, '[Analytics] getPopularTopics error');
      return [];
    }
  }

  // Get active users heatmap (by hour)
  static async getActiveHeatmap() {
    try {
      const chats = await prisma.chat.findMany({
        select: { lastSeenAt: true }
      });

      const heatmap = {};
      for (let hour = 0; hour < 24; hour++) {
        heatmap[hour] = 0;
      }

      chats.forEach(chat => {
        const hour = new Date(chat.lastSeenAt).getHours();
        heatmap[hour]++;
      });

      return heatmap;
    } catch (err) {
      logger.error({ err: err.message }, '[Analytics] getActiveHeatmap error');
      return {};
    }
  }

  // Get user engagement summary
  static async getEngagementSummary() {
    try {
      const totalChats = await prisma.chat.count();
      const optedIn = await prisma.chat.count({ where: { optIn: true } });

      // Calculate avg active users per day (last 7 days)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      const activeLastWeek = await prisma.chat.count({
        where: { lastSeenAt: { gte: sevenDaysAgo } }
      });

      // Total sessions
      const totalSessions = await prisma.session.count();

      return {
        totalUsers: totalChats,
        optedIn,
        optedOut: totalChats - optedIn,
        activeLastWeek,
        avgSessionsPerUser: totalChats > 0 ? (totalSessions / totalChats).toFixed(2) : 0
      };
    } catch (err) {
      logger.error({ err: err.message }, '[Analytics] getEngagementSummary error');
      return {
        totalUsers: 0,
        optedIn: 0,
        optedOut: 0,
        activeLastWeek: 0,
        avgSessionsPerUser: 0
      };
    }
  }

  // Export analytics as CSV
  static async exportToCSV() {
    try {
      const summary = await this.getEngagementSummary();
      const retention = await this.getRetentionRate();
      const handover = await this.getHandoverRate();
      const topics = await this.getPopularTopics();

      let csv = 'Analytics Report\n';
      csv += `Generated: ${new Date().toISOString()}\n\n`;

      csv += 'ENGAGEMENT SUMMARY\n';
      csv += `Total Users,Opted In,Opted Out,Active Last Week,Avg Sessions/User\n`;
      csv += `${summary.totalUsers},${summary.optedIn},${summary.optedOut},${summary.activeLastWeek},${summary.avgSessionsPerUser}\n\n`;

      csv += 'RETENTION RATE\n';
      csv += 'Day,Total Users,Active Users,Retention Rate (%)\n';
      Object.entries(retention).forEach(([key, data]) => {
        const day = key.replace('day_', '');
        csv += `${day},${data.totalUsers},${data.activeUsers},${data.retentionRate}\n`;
      });

      csv += '\nHANDOVER METRICS\n';
      csv += `Total Chats,Handover Chats,Handover Rate (%)\n`;
      csv += `${handover.totalChats},${handover.handoverChats},${handover.handoverRate}\n\n`;

      csv += 'POPULAR TOPICS\n';
      csv += 'Topic,Count\n';
      topics.forEach(({ topic, count }) => {
        csv += `"${topic}",${count}\n`;
      });

      return csv;
    } catch (err) {
      logger.error({ err: err.message }, '[Analytics] exportToCSV error');
      return '';
    }
  }

  // Helper: Get week key from date
  static getWeekKey(date) {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const week = Math.ceil(d.getDate() / 7);
    return `${year}-W${week}-${month}`;
  }
}

module.exports = { AnalyticsEngine };
